import { createHash } from "node:crypto";
import { Effect, Fiber, Option, Queue, Result, Schema, Stream, type Scope } from "effect";
import { expect, test } from "vite-plus/test";
import {
  HerdrAbsolutePath,
  HerdrSdk,
  HerdrEndpointClosed,
  HerdrEndpointInvalidMessage,
  HerdrEndpointRequestTimeout,
  HerdrEndpointStaleReference,
  HerdrEndpointUnsupportedMethod,
  HerdrInvalidInput,
  herdrSdkLayerFromOptions,
  ClientShellProjection,
  type ClientShellHostThemeInputEncoded,
} from "./index.ts";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";
import {
  startEndpointTestServer,
  fixtureControl,
  fixturePatch,
  fixtureResponse,
  fixtureFrame,
  fixtureText,
  fixtureSurface,
} from "./herdr-endpoint-test-server.ts";
import {
  decodeEndpointMessage,
  encodeEndpointRequest,
  encodeEndpointText,
} from "./herdr-endpoint-codecs.ts";
// Frozen Herdr tests/fixtures/endpoint-snapshot-v1.json (unchanged v0.9.0–v0.9.5), checked by upstream protocol/endpoint.rs.
import snapshotFixture from "./fixtures/endpoint-snapshot-v1.json" with { type: "json" };

const geometry = { surface: { columns: 80, rows: 24 }, cellPixels: { width: 8, height: 16 } };
const withSdk = <A, E>(program: Effect.Effect<A, E, HerdrSdk | Scope.Scope>) =>
  Effect.gen(function* () {
    const api = yield* startHerdrTestServer((request) =>
      Effect.succeed(makeHerdrSuccessResponse(request)),
    );
    return yield* program.pipe(
      Effect.provide(
        herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(api.socketPath) }),
      ),
    );
  });

test("endpoint request encoding matches the frozen upstream generation-1 SHA-256", () => {
  // v0.9.5 src/protocol/wire.rs::client_shell_endpoint_messages_roundtrip (unchanged since v0.9.0).
  const frame = encodeEndpointRequest(
    "boot-a",
    '{"id":"request-a","method":"session.snapshot","params":{}}',
  );
  expect(createHash("sha256").update(frame.subarray(4)).digest("hex")).toBe(
    "de5693585a01f6b0d5ee07c51b6ddf79ee9f67dbf183255822d31f35210f5ffb",
  );
  const response = fixtureResponse(
    "request-a",
    '{"id":"request-a","result":{"type":"ok"}}',
    true,
    "boot-a",
  );
  const decoded = Result.getOrThrow(decodeEndpointMessage(response.subarray(4)));
  expect(decoded).toMatchObject({
    kind: "response",
    bootId: "boot-a",
    requestId: "request-a",
    finalChunk: true,
  });
});

test("binary endpoint parsing rejects trailing, truncated, oversized integer and invalid UTF-8 fields", () => {
  for (const payload of [
    new Uint8Array([20]),
    new Uint8Array([20, 0, 0, 9]),
    new Uint8Array([20, 1, 255, 0]),
    new Uint8Array([253, 255, 255, 255, 255, 255, 255, 255, 255]),
  ]) {
    const parsed = decodeEndpointMessage(payload);
    expect(Result.isFailure(parsed)).toBe(true);
  }
});

test("callback-owned endpoint decodes frozen projections, activates surfaces, applies patches, and closes escaped handles", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({ fragmented: true });
        const escaped = yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            return yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath, timeoutMs: 2000 },
              (shell) =>
                Effect.gen(function* () {
                  const projection = yield* shell.snapshot();
                  expect(projection.bootId).toBe("boot-v1");
                  expect(projection.workspaces[0]?.agentStatus).toBe("unknown");
                  expect(projection.tabs[0]?.agentStatus).toBe("working");
                  expect(projection.commands[0]?.action).toBe("shell");
                  const acknowledgement = yield* shell.surface.set({ active: true });
                  expect(acknowledgement.projectionRevision).toBe(7);
                  const surface = yield* shell.surface.awaitReady();
                  expect(surface.frame.cells[0]?.symbol).toBe("x");
                  yield* endpoint.send(fixturePatch());
                  const patched = yield* shell.surface.states.pipe(
                    Stream.filter(
                      (state) => state.status === "active" && state.surface.surfaceRevision === 2,
                    ),
                    Stream.runHead,
                  );
                  expect(Option.isSome(patched)).toBe(true);
                  if (Option.isSome(patched) && patched.value.status === "active")
                    expect(patched.value.surface.frame.cells[0]?.symbol).toBe("y");
                  const command = projection.commands[0];
                  if (command === undefined)
                    return yield* Effect.die(new Error("Fixture command missing"));
                  yield* shell.commands.invokeInPane(command, sdk.ids.pane("w1:p1"));
                  const forged = { ...command };
                  expect(yield* shell.commands.invoke(forged).pipe(Effect.flip)).toBeInstanceOf(
                    HerdrEndpointStaleReference,
                  );
                  yield* shell.input.paste(sdk.ids.pane("w1:p1"), { text: "one\ntwo" });
                  const input = yield* Queue.take(endpoint.inputs);
                  expect([...input]).toEqual([
                    ...encodeEndpointText("pane", "w1:p1", "one\ntwo", "paste").subarray(4),
                  ]);
                  yield* shell.surface.set({ active: false });
                  expect(yield* shell.surface.state()).toEqual({ status: "inactive" });
                  return shell;
                }),
            );
          }),
        );
        yield* Queue.take(endpoint.closed);
        expect(yield* escaped.snapshot().pipe(Effect.flip)).toBeInstanceOf(HerdrEndpointClosed);
        expect(yield* escaped.connectionState()).toBe("closed");
      }),
    ),
  ));

test("endpoint callback failure and interruption both close the socket", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer();
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            const failed = yield* sdk.clientShell
              .withConnection({ ...geometry, socketPath: endpoint.socketPath }, () =>
                Effect.fail("callback-failure"),
              )
              .pipe(Effect.flip);
            expect(failed).toBe("callback-failure");
            yield* Queue.take(endpoint.closed);
            const entered = yield* Queue.make<void>();
            const fiber = yield* sdk.clientShell
              .withConnection({ ...geometry, socketPath: endpoint.socketPath }, () =>
                Effect.gen(function* () {
                  yield* Queue.offer(entered, undefined);
                  return yield* Effect.never;
                }),
              )
              .pipe(Effect.forkScoped);
            yield* Queue.take(entered);
            yield* Fiber.interrupt(fiber);
            yield* Queue.take(endpoint.closed);
          }),
        );
      }),
    ),
  ));

test("a read-only projection stream owns and closes its inactive endpoint", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer();
        const projections = yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            return yield* sdk.clientShell
              .projections({ ...geometry, socketPath: endpoint.socketPath })
              .pipe(Stream.take(1), Stream.runCollect);
          }),
        );
        expect(projections.length).toBe(1);
        yield* Queue.take(endpoint.closed);
      }),
    ),
  ));

test("endpoint response chunks correlate independently and server rejections do not disconnect", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({
          response: (request) => {
            const json = JSON.stringify({
              id: request.id,
              error: { code: "stale_release_notes", message: "fixture stale notes" },
            });
            const middle = Math.floor(json.length / 2);
            return Effect.succeed([
              fixtureResponse(request.id, json.slice(0, middle), false),
              fixtureResponse(request.id, json.slice(middle)),
            ]);
          },
        });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  const errors = yield* Effect.all(
                    [
                      shell.releaseNotes.dismiss({ version: "a" }).pipe(Effect.flip),
                      shell.releaseNotes.dismiss({ version: "b" }).pipe(Effect.flip),
                    ],
                    { concurrency: 2 },
                  );
                  for (const error of errors)
                    expect(error).toMatchObject({
                      _tag: "HerdrServerError",
                      serverCode: "stale_release_notes",
                    });
                  expect(yield* shell.connectionState()).toBe("ready");
                }),
            );
          }),
        );
      }),
    ),
  ));

test("missing endpoint methods fail locally without closing the connection", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({ advertisedMethods: [] });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  expect(
                    yield* shell.releaseNotes.dismiss({ version: "x" }).pipe(Effect.flip),
                  ).toBeInstanceOf(HerdrEndpointUnsupportedMethod);
                  expect(yield* shell.connectionState()).toBe("ready");
                }),
            );
          }),
        );
      }),
    ),
  ));

test("invalid patch bases fail the connection rather than presenting corrupted content", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer();
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            const error = yield* sdk.clientShell
              .withConnection({ ...geometry, socketPath: endpoint.socketPath }, (shell) =>
                Effect.gen(function* () {
                  yield* shell.surface.set({ active: true });
                  yield* shell.surface.awaitReady();
                  yield* endpoint.send(fixturePatch(99));
                  return yield* shell.projections.pipe(Stream.runDrain);
                }),
              )
              .pipe(Effect.flip);
            expect(error).toBeInstanceOf(HerdrEndpointInvalidMessage);
          }),
        );
        yield* Queue.take(endpoint.closed);
      }),
    ),
  ));

test("silent endpoint health failures terminate a live stream with a typed deadline", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({ health: false });
        const failure = yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            return yield* sdk.clientShell
              .projections({
                ...geometry,
                socketPath: endpoint.socketPath,
                healthIntervalMs: 1,
                timeoutMs: 250,
              })
              .pipe(Stream.runDrain, Effect.flip);
          }),
        );
        expect(failure).toBeInstanceOf(HerdrEndpointRequestTimeout);
        yield* Queue.take(endpoint.closed);
      }),
    ),
  ));

test("malformed initial snapshot closes acquisition before returning a handle", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({
          snapshot: { ...snapshotFixture, boot_id: "" },
        });
        const failure = yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            return yield* sdk.clientShell
              .withConnection({ ...geometry, socketPath: endpoint.socketPath }, () => Effect.void)
              .pipe(Effect.flip);
          }),
        );
        expect(failure).toBeInstanceOf(HerdrEndpointInvalidMessage);
        yield* Queue.take(endpoint.closed);
      }),
    ),
  ));

test("agent completion companions attach only to the projection with their boot and revision", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({
          completions: { "w1:p1": 3, "w9:p9": 4 },
          response: (request) =>
            Effect.succeed([
              fixtureResponse(
                request.id,
                JSON.stringify({
                  id: request.id,
                  result: {
                    type: "client_shell_surface_set",
                    active: false,
                    projection_revision: 8,
                  },
                }),
              ),
              // A companion for another revision, malformed data, and a malformed agent-view
              // envelope are all ignorable; none may attach to revision 8.
              fixtureControl(
                "endpoint.agent-completions.v1",
                JSON.stringify({ boot_id: "boot-v1", revision: 7, completions: { "w1:p1": 5 } }),
              ),
              fixtureControl("endpoint.agent-completions.v1", "{malformed"),
              fixtureControl("endpoint.agent-view.v1", JSON.stringify({ boot_id: "boot-v1" })),
              fixtureControl(
                "shell.snapshot.v1",
                JSON.stringify({ ...snapshotFixture, revision: 8 }),
              ),
            ]),
        });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  const seeded = yield* shell.snapshot();
                  expect(seeded.agents.map((agent) => agent.completionSeq)).toEqual([
                    Option.some(3),
                  ]);
                  yield* shell.surface.set({ active: false });
                  const latest = yield* shell.projections.pipe(
                    Stream.filter((projection) => projection.revision === 8),
                    Stream.runHead,
                  );
                  expect(
                    Option.getOrThrow(latest).agents.map((agent) => agent.completionSeq),
                  ).toEqual([Option.none()]);
                }),
            );
          }),
        );
      }),
    ),
  ));

test("surface acknowledgements do not present frames below their revision floor", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({
          response: (request) =>
            Effect.succeed([
              fixtureResponse(
                request.id,
                JSON.stringify({
                  id: request.id,
                  result: {
                    type: "client_shell_surface_set",
                    active: true,
                    projection_revision: 8,
                  },
                }),
              ),
              fixtureSurface(1, 7),
              fixtureControl(
                "shell.snapshot.v1",
                JSON.stringify({ ...snapshotFixture, revision: 8 }),
              ),
            ]),
        });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  yield* shell.surface.set({ active: true });
                  yield* shell.projections.pipe(
                    Stream.filter((projection) => projection.revision === 8),
                    Stream.runHead,
                  );
                  expect(yield* shell.surface.state()).toMatchObject({
                    status: "awaitingSurface",
                    projectionFloor: 8,
                  });
                  yield* endpoint.send(fixtureSurface(2, 8));
                  expect((yield* shell.surface.awaitReady()).projectionRevision).toBe(8);
                }),
            );
          }),
        );
      }),
    ),
  ));

test("rejected surface interest restores confirmed state without disconnecting", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({ advertisedMethods: [] });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  expect(
                    yield* shell.surface.set({ active: true }).pipe(Effect.flip),
                  ).toBeInstanceOf(HerdrEndpointUnsupportedMethod);
                  expect(yield* shell.surface.state()).toEqual({ status: "inactive" });
                }),
            );
          }),
        );
      }),
    ),
  ));

test.for(["correlation", "emptyChunk", "timeout"] as const)(
  "endpoint %s failures close pending requests and the owning callback",
  (mode, context) =>
    runHerdrTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* startEndpointTestServer({
            response: (request) =>
              Effect.succeed(
                mode === "timeout"
                  ? []
                  : [
                      mode === "emptyChunk"
                        ? fixtureResponse(request.id, "", false)
                        : fixtureResponse("wrong-request", "{}"),
                    ],
              ),
          });
          const failure = yield* withSdk(
            Effect.gen(function* () {
              const sdk = yield* HerdrSdk;
              return yield* sdk.clientShell
                .withConnection(
                  { ...geometry, socketPath: endpoint.socketPath, timeoutMs: 250 },
                  (shell) => shell.releaseNotes.dismiss({ version: "0.9.0" }),
                )
                .pipe(Effect.flip);
            }),
          );
          expect(failure).toBeInstanceOf(
            mode === "timeout" ? HerdrEndpointRequestTimeout : HerdrEndpointInvalidMessage,
          );
          yield* Queue.take(endpoint.closed);
        }),
      ),
    ),
);

test("health failure ends callback-owned sessions even when the callback is not reading", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer({ health: false });
        const failure = yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            return yield* sdk.clientShell
              .withConnection(
                {
                  ...geometry,
                  socketPath: endpoint.socketPath,
                  healthIntervalMs: 1,
                  timeoutMs: 250,
                },
                () => Effect.never,
              )
              .pipe(Effect.flip);
          }),
        );
        expect(failure).toBeInstanceOf(HerdrEndpointRequestTimeout);
        yield* Queue.take(endpoint.closed);
      }),
    ),
  ));

test("unknown optional named controls are ignored but malformed mandatory snapshot controls fail", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer();
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            const failure = yield* sdk.clientShell
              .withConnection({ ...geometry, socketPath: endpoint.socketPath }, (shell) =>
                Effect.gen(function* () {
                  yield* endpoint.send(fixtureControl("future.optional", "not JSON"));
                  yield* endpoint.send(
                    fixtureFrame([
                      Buffer.from([20]),
                      fixtureText("shell.snapshot.v2"),
                      fixtureText("{}"),
                    ]),
                  );
                  return yield* shell.projections.pipe(Stream.runDrain);
                }),
              )
              .pipe(Effect.flip);
            expect(failure).toBeInstanceOf(HerdrEndpointInvalidMessage);
          }),
        );
      }),
    ),
  ));

// Golden payloads were produced offline by bincode 2.0.1 (`config::standard()`) over mirrors of
// v0.9.5 src/protocol/wire.rs ClientMessage::ClientShellHostTheme; palette (4, {10,20,30}) is the
// upstream client_shell_host_theme_roundtrip value. Components >=251 prove u8 fields are raw bytes.
const hostThemeGoldenPayloads = [
  {
    input: { kind: "palette", colors: [{ index: 4, color: { r: 10, g: 20, b: 30 } }] },
    payload: [17, 1, 1, 4, 10, 20, 30],
  },
  {
    input: { kind: "defaultColor", target: "foreground", color: { r: 255, g: 251, b: 0 } },
    payload: [17, 0, 0, 255, 251, 0],
  },
  {
    input: { kind: "defaultColor", target: "background", color: { r: 1, g: 2, b: 3 } },
    payload: [17, 0, 1, 1, 2, 3],
  },
  { input: { kind: "appearance", appearance: "dark" }, payload: [17, 2, 0] },
  { input: { kind: "appearance", appearance: "light" }, payload: [17, 2, 1] },
  {
    input: {
      kind: "palette",
      colors: [
        { index: 255, color: { r: 252, g: 253, b: 254 } },
        { index: 0, color: { r: 0, g: 0, b: 0 } },
      ],
    },
    payload: [17, 1, 2, 255, 252, 253, 254, 0, 0, 0, 0],
  },
] as const satisfies ReadonlyArray<{
  readonly input: ClientShellHostThemeInputEncoded;
  readonly payload: readonly number[];
}>;
const fullHostPalette = Array.from({ length: 256 }, (_, index) => ({
  index,
  color: { r: index, g: 0, b: 0 },
}));

test("host theme updates write exact upstream bincode, reject invalid colors locally, and close with the session", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer();
        const escaped = yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            return yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  for (const golden of hostThemeGoldenPayloads) {
                    yield* shell.setHostTheme(golden.input);
                    expect([...(yield* Queue.take(endpoint.inputs))]).toEqual(golden.payload);
                  }
                  // 256 entries is the upstream per-message bound; its length is a varint (251, u16LE).
                  yield* shell.setHostTheme({ kind: "palette", colors: fullHostPalette });
                  const full = yield* Queue.take(endpoint.inputs);
                  expect([...full.subarray(0, 6)]).toEqual([17, 1, 251, 0, 1, 0]);
                  expect(full.length).toBe(1029);
                  const invalid: ReadonlyArray<ClientShellHostThemeInputEncoded> = [
                    { kind: "defaultColor", target: "foreground", color: { r: 256, g: 0, b: 0 } },
                    { kind: "defaultColor", target: "background", color: { r: 1.5, g: 0, b: 0 } },
                    { kind: "palette", colors: [{ index: 256, color: { r: 0, g: 0, b: 0 } }] },
                    { kind: "palette", colors: [] },
                    {
                      kind: "palette",
                      colors: [...fullHostPalette, { index: 0, color: { r: 0, g: 0, b: 0 } }],
                    },
                  ];
                  for (const input of invalid)
                    expect(yield* shell.setHostTheme(input).pipe(Effect.flip)).toBeInstanceOf(
                      HerdrInvalidInput,
                    );
                  // Nothing was written for rejected input: the next frame is the next valid update.
                  yield* shell.setHostTheme({ kind: "appearance", appearance: "light" });
                  expect([...(yield* Queue.take(endpoint.inputs))]).toEqual([17, 2, 1]);
                  expect(yield* shell.connectionState()).toBe("ready");
                  return shell;
                }),
            );
          }),
        );
        yield* Queue.take(endpoint.closed);
        expect(
          yield* escaped.setHostTheme({ kind: "appearance", appearance: "dark" }).pipe(Effect.flip),
        ).toBeInstanceOf(HerdrEndpointClosed);
      }),
    ),
  ));

const wireAgentView = {
  source: "example.views",
  label: "focus",
  filter: {
    op: "all",
    filters: [
      { op: "eq", field: "status", value: "idle" },
      { op: "not", filter: { op: "exists", field: { token: "muted" } } },
    ],
  },
  sort: [{ field: "state_change_seq", order: "desc" }, { field: { token: "priority" } }],
};
const agentViewControl = (revision: number, view: unknown, bootId = "boot-v1") =>
  fixtureControl("endpoint.agent-view.v1", JSON.stringify({ boot_id: bootId, revision, view }));
const snapshotControl = (revision: number) =>
  fixtureControl("shell.snapshot.v1", JSON.stringify({ ...snapshotFixture, revision }));

test("agent-view companions attach only to the snapshot with their boot and revision", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        // Each surface.set response is followed by one step's companions and snapshot.
        const steps: ReadonlyArray<readonly Uint8Array[]> = [
          // A later snapshot without a companion has no view (Herdr resends it while active).
          [snapshotControl(8)],
          // A malformed envelope is ignored and does not discard the matching pending companion.
          [
            agentViewControl(9, wireAgentView),
            fixtureControl("endpoint.agent-view.v1", "{bad"),
            snapshotControl(9),
          ],
          // A view that fails the SDK's agent-view schema is unrecognized, not a connection failure.
          [agentViewControl(10, { source: 5 }), snapshotControl(10)],
          [agentViewControl(11, { source: "x", filter: { op: "regex" } }), snapshotControl(11)],
          // Stale-revision and other-boot companions never attach.
          [agentViewControl(11, wireAgentView), snapshotControl(12)],
          [agentViewControl(13, wireAgentView, "boot-other"), snapshotControl(13)],
          // An explicit null view means the view was cleared.
          [agentViewControl(14, null), snapshotControl(14)],
        ];
        let step = 0;
        const endpoint = yield* startEndpointTestServer({
          agentView: wireAgentView,
          response: (request) =>
            Effect.sync(() => [
              fixtureResponse(
                request.id,
                JSON.stringify({
                  id: request.id,
                  result: {
                    type: "client_shell_surface_set",
                    active: false,
                    projection_revision: 7,
                  },
                }),
              ),
              ...(steps[step++] ?? []),
            ]),
        });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  const seeded = yield* shell.snapshot();
                  expect(seeded.agentView).toEqual({
                    status: "active",
                    view: {
                      source: "example.views",
                      label: Option.some("focus"),
                      filter: Option.some(wireAgentView.filter),
                      sort: Option.some([
                        { field: "state_change_seq", order: Option.some("desc") },
                        { field: { token: "priority" }, order: Option.none() },
                      ]),
                    },
                  });
                  const agentViewAt = (revision: number) =>
                    Effect.gen(function* () {
                      yield* shell.surface.set({ active: false });
                      const projection = yield* shell.projections.pipe(
                        Stream.filter((candidate) => candidate.revision === revision),
                        Stream.runHead,
                      );
                      return Option.getOrThrow(projection).agentView.status;
                    });
                  expect(yield* agentViewAt(8)).toBe("none");
                  expect(yield* agentViewAt(9)).toBe("active");
                  expect(yield* agentViewAt(10)).toBe("unrecognized");
                  expect(yield* agentViewAt(11)).toBe("unrecognized");
                  expect(yield* agentViewAt(12)).toBe("none");
                  expect(yield* agentViewAt(13)).toBe("none");
                  expect(yield* agentViewAt(14)).toBe("none");
                  expect(yield* shell.connectionState()).toBe("ready");
                }),
            );
          }),
        );
      }),
    ),
  ));

test("snapshots without an agent-view companion report no view", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* startEndpointTestServer();
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            const projection = yield* sdk.clientShell
              .projections({ ...geometry, socketPath: endpoint.socketPath })
              .pipe(Stream.runHead);
            expect(Option.getOrThrow(projection).agentView).toEqual({ status: "none" });
          }),
        );
      }),
    ),
  ));

test("agent-view companions follow upstream ordering: stale traffic never discards a newer view", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const steps: ReadonlyArray<readonly Uint8Array[]> = [
          // A stale snapshot must not consume the pending companion for revision 8.
          [agentViewControl(8, wireAgentView), snapshotControl(6), snapshotControl(8)],
          // An older (but still future) companion must not replace a newer pending one.
          [agentViewControl(10, wireAgentView), agentViewControl(9, null), snapshotControl(10)],
          // A companion older than the current snapshot never attaches to a later one.
          [agentViewControl(9, wireAgentView), snapshotControl(11)],
          // A companion after its matching snapshot attaches to it; the first match wins.
          [snapshotControl(12), agentViewControl(12, wireAgentView), agentViewControl(12, null)],
          [],
        ];
        let step = 0;
        const endpoint = yield* startEndpointTestServer({
          response: (request) =>
            Effect.sync(() => [
              fixtureResponse(
                request.id,
                JSON.stringify({
                  id: request.id,
                  result: {
                    type: "client_shell_surface_set",
                    active: false,
                    projection_revision: 7,
                  },
                }),
              ),
              ...(steps[step++] ?? []),
            ]),
        });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  const agentViewAt = (revision: number, status: string) =>
                    Effect.gen(function* () {
                      yield* shell.surface.set({ active: false });
                      const projection = yield* shell.projections.pipe(
                        Stream.filter(
                          (candidate) =>
                            candidate.revision === revision &&
                            candidate.agentView.status === status,
                        ),
                        Stream.runHead,
                        Effect.timeoutOrElse({
                          duration: 1000,
                          orElse: () => Effect.succeed(Option.none()),
                        }),
                      );
                      return Option.isSome(projection);
                    });
                  expect(yield* agentViewAt(8, "active")).toBe(true);
                  expect(yield* agentViewAt(10, "active")).toBe(true);
                  expect(yield* agentViewAt(11, "none")).toBe(true);
                  expect(yield* agentViewAt(12, "active")).toBe(true);
                  // The trailing null companion for revision 12 was processed before this response.
                  yield* shell.surface.set({ active: false });
                  expect((yield* shell.snapshot()).agentView.status).toBe("active");
                }),
            );
          }),
        );
      }),
    ),
  ));

test("agentView is SDK-derived: snapshot wire keys never set it and encoding never emits it", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const wireExtra = { agentView: { status: "future" } };
        const decoded = Schema.decodeUnknownSync(ClientShellProjection)({
          ...snapshotFixture,
          ...wireExtra,
        });
        expect(decoded.agentView).toEqual({ status: "none" });
        expect(Object.hasOwn(Schema.encodeSync(ClientShellProjection)(decoded), "agentView")).toBe(
          false,
        );
        const endpoint = yield* startEndpointTestServer({
          snapshot: { ...snapshotFixture, ...wireExtra },
          agentView: wireAgentView,
        });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            const projection = yield* sdk.clientShell
              .projections({ ...geometry, socketPath: endpoint.socketPath })
              .pipe(Stream.runHead);
            expect(Option.getOrThrow(projection).agentView.status).toBe("active");
          }),
        );
      }),
    ),
  ));

const completionsControl = (revision: number, completions: Record<string, number>) =>
  fixtureControl(
    "endpoint.agent-completions.v1",
    JSON.stringify({ boot_id: "boot-v1", revision, completions }),
  );
const worktreeSnapshotControl = (revision: number, worktreeDirectory: string) =>
  fixtureControl(
    "shell.snapshot.v1",
    JSON.stringify({ ...snapshotFixture, revision, worktree_directory: worktreeDirectory }),
  );

test("equal-revision snapshots replace the projection like upstream and keep attached companions", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const steps: ReadonlyArray<readonly Uint8Array[]> = [
          // Same revision, no new companions: replaced metadata, previously attached companions kept.
          [worktreeSnapshotControl(7, "replaced")],
          // A matching pending completion companion wins over the attached one; the agent-view
          // companion for the current revision loses to the first attached view.
          [
            completionsControl(7, { "w1:p1": 5 }),
            agentViewControl(7, null),
            worktreeSnapshotControl(7, "again"),
          ],
          // Older snapshots are still dropped.
          [worktreeSnapshotControl(6, "stale")],
          // Pending completions never move backwards: revision 8 must not displace revision 9.
          [
            completionsControl(9, { "w1:p1": 4 }),
            completionsControl(8, { "w1:p1": 6 }),
            snapshotControl(9),
          ],
        ];
        let step = 0;
        const endpoint = yield* startEndpointTestServer({
          completions: { "w1:p1": 3 },
          agentView: wireAgentView,
          response: (request) =>
            Effect.sync(() => [
              fixtureResponse(
                request.id,
                JSON.stringify({
                  id: request.id,
                  result: {
                    type: "client_shell_surface_set",
                    active: false,
                    projection_revision: 7,
                  },
                }),
              ),
              ...(steps[step++] ?? []),
            ]),
        });
        yield* withSdk(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            yield* sdk.clientShell.withConnection(
              { ...geometry, socketPath: endpoint.socketPath },
              (shell) =>
                Effect.gen(function* () {
                  const projectionWhere = (
                    matches: (projection: ClientShellProjection) => boolean,
                  ) =>
                    Effect.gen(function* () {
                      yield* shell.surface.set({ active: false });
                      const projection = yield* shell.projections.pipe(
                        Stream.filter(matches),
                        Stream.runHead,
                      );
                      return Option.getOrThrow(projection);
                    });
                  const completionSeqs = (projection: ClientShellProjection) =>
                    projection.agents.map((agent) => agent.completionSeq);
                  const replaced = yield* projectionWhere(
                    (p) => p.worktreeDirectory === "replaced",
                  );
                  expect(replaced.revision).toBe(7);
                  expect(replaced.agentView.status).toBe("active");
                  expect(completionSeqs(replaced)).toEqual([Option.some(3)]);
                  const again = yield* projectionWhere((p) => p.worktreeDirectory === "again");
                  expect(again.agentView.status).toBe("active");
                  expect(completionSeqs(again)).toEqual([Option.some(5)]);
                  // The stale step's response was processed after its snapshot frame.
                  yield* shell.surface.set({ active: false });
                  expect((yield* shell.snapshot()).worktreeDirectory).toBe("again");
                  const newer = yield* projectionWhere((p) => p.revision === 9);
                  expect(completionSeqs(newer)).toEqual([Option.some(4)]);
                  expect(newer.agentView.status).toBe("none");
                }),
            );
          }),
        );
      }),
    ),
  ));
