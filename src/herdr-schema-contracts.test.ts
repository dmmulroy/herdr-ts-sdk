import { Duration, Effect, Option, Schema } from "effect";
import { FastCheck } from "effect/testing";
import { expect, test } from "vite-plus/test";
import {
  AgentName,
  AgentTarget,
  HerdrAbsolutePath,
  HerdrJsonValue,
  HerdrMetadataTokenPatch,
  HerdrRequestDeadline,
  HerdrRevision,
  HerdrSdk,
  LayoutNode,
  LayoutTarget,
  PaneId,
  PaneMetadataReportInput,
  PaneReadInput,
  PaneSwapInput,
  WorktreeOpenInput,
  herdrSdkLayerFromOptions,
} from "./index.ts";
import { HerdrInvalidInput, HerdrInvalidResponse } from "./herdr-errors.ts";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { HerdrRawTestResponse, startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

// Fixed seeds make the invariant probes reproducible without a live Herdr session.
test("metadata token names and counts reject invalid keys rather than dropping them", () => {
  const parse = Schema.decodeUnknownOption(HerdrMetadataTokenPatch);
  FastCheck.assert(
    FastCheck.property(FastCheck.string(), (key) => {
      const patch = Object.fromEntries([[key, null]]);
      const decoded = parse(patch);
      expect(Option.isSome(decoded)).toBe(/^[A-Za-z0-9_-]{1,32}$/.test(key));
      if (Option.isSome(decoded)) expect(decoded.value).toStrictEqual(patch);
    }),
    { seed: 2101, numRuns: 200 },
  );
  for (const count of [0, 1, 16, 17]) {
    const patch = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`token_${index}`, "value"]),
    );
    expect(Option.isSome(parse(patch))).toBe(count <= 16);
  }
  for (const key of ["__proto__", "constructor", "toString", "A".repeat(32)]) {
    const patch = Object.fromEntries([[key, null]]);
    expect(Schema.decodeUnknownSync(HerdrMetadataTokenPatch)(patch)).toStrictEqual(patch);
  }
});

test("state labels accept any subset of known statuses and reject unknown names", () => {
  const statuses = ["idle", "working", "blocked", "done", "unknown"];
  FastCheck.assert(
    FastCheck.property(FastCheck.subarray(statuses), (selected) => {
      const stateLabels = Object.fromEntries(selected.map((status) => [status, "Custom label"]));
      const parsed = Schema.decodeUnknownSync(PaneMetadataReportInput)({
        source: "fixture",
        stateLabels,
      });
      expect(Option.getOrThrow(parsed.stateLabels)).toStrictEqual(stateLabels);
      expect(Schema.encodeSync(PaneMetadataReportInput)(parsed)).toStrictEqual({
        source: "fixture",
        stateLabels,
      });
    }),
    { seed: 2102, numRuns: 40 },
  );
  for (const key of ["paused", "workng", "Working", "", "__proto__"]) {
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(PaneMetadataReportInput)({
          source: "fixture",
          stateLabels: Object.fromEntries([[key, "Busy"]]),
        }),
      ),
    ).toBe(true);
  }
});

test("agent targets normalize kind and reject competing selectors even when one is invalid", () => {
  expect(AgentTarget.make({ paneId: PaneId.make("pane-1") })).toStrictEqual({
    kind: "pane",
    paneId: "pane-1",
  });
  expect(AgentTarget.make({ name: AgentName.make("worker") })).toStrictEqual({
    kind: "agent",
    name: "worker",
  });
  for (const input of [{ paneId: "pane-1" }, { kind: "pane", paneId: "pane-1" }]) {
    expect(Schema.decodeUnknownSync(AgentTarget)(input)).toStrictEqual({
      kind: "pane",
      paneId: "pane-1",
    });
  }
  for (const input of [{ name: "worker" }, { kind: "agent", name: "worker" }]) {
    expect(Schema.decodeUnknownSync(AgentTarget)(input)).toStrictEqual({
      kind: "agent",
      name: "worker",
    });
  }
  for (const input of [
    {},
    { kind: "agent", paneId: "pane-1" },
    { kind: "pane", name: "worker" },
    { paneId: "pane-1", name: "worker" },
    { paneId: "", name: "worker" },
    { paneId: "pane-1", name: "" },
    { paneId: undefined, name: "worker" },
  ])
    expect(Option.isNone(Schema.decodeUnknownOption(AgentTarget)(input))).toBe(true);
});

test("layout targets and pane swaps require one selection mode", () => {
  for (const input of [
    {},
    { tabId: "tab-1", paneId: "pane-1" },
    { tabId: "", paneId: "pane-1" },
    { tabId: "tab-1", paneId: "" },
    { tabId: undefined, paneId: "pane-1" },
  ])
    expect(Option.isNone(Schema.decodeUnknownOption(LayoutTarget)(input))).toBe(true);
  for (const input of [{ tabId: "tab-1" }, { paneId: "pane-1" }]) {
    expect(Option.isSome(Schema.decodeUnknownOption(LayoutTarget)(input))).toBe(true);
  }
  for (const input of [
    { direction: "right", sourcePaneId: "pane-1", targetPaneId: "pane-2" },
    { direction: "invalid", sourcePaneId: "pane-1", targetPaneId: "pane-2" },
    { paneId: "pane-1", sourcePaneId: "pane-1", targetPaneId: "pane-2" },
    { direction: "right", sourcePaneId: "" },
    { direction: "right", targetPaneId: undefined },
  ])
    expect(Option.isNone(Schema.decodeUnknownOption(PaneSwapInput)(input))).toBe(true);
  for (const input of [
    { direction: "right" },
    { sourcePaneId: "pane-1", targetPaneId: "pane-2" },
  ]) {
    expect(Option.isSome(Schema.decodeUnknownOption(PaneSwapInput)(input))).toBe(true);
  }
});

test("layout ratios retain their strict bounds and public encoded shape", () => {
  const root = {
    type: "split",
    direction: "right",
    first: { type: "pane" },
    second: { type: "pane" },
  };
  for (const ratio of [0, 1, -1, NaN, Infinity]) {
    expect(Option.isNone(Schema.decodeUnknownOption(LayoutNode)({ ...root, ratio }))).toBe(true);
  }
  const validRoot = { ...root, ratio: 0.5 };
  expect(
    Schema.encodeSync(LayoutNode)(Schema.decodeUnknownSync(LayoutNode)(validRoot)),
  ).toStrictEqual(validRoot);
});

test("worktree choices retain their source exclusion and required path-or-branch selection", () => {
  for (const input of [
    {},
    { path: "/tmp/project", branch: "main" },
    { path: "/tmp/project", cwd: "/tmp", workspaceId: "workspace-1" },
  ]) {
    expect(Option.isNone(Schema.decodeUnknownOption(WorktreeOpenInput)(input))).toBe(true);
  }
  for (const input of [{ path: "/tmp/project" }, { branch: "main" }]) {
    expect(Option.isSome(Schema.decodeUnknownOption(WorktreeOpenInput)(input))).toBe(true);
  }
});

test("request deadlines reject negative and infinite durations while allowing zero", () => {
  for (const duration of [Duration.infinity, Duration.millis(-1)]) {
    expect(Option.isNone(Schema.decodeUnknownOption(HerdrRequestDeadline)(duration))).toBe(true);
  }
  expect(Option.isSome(Schema.decodeUnknownOption(HerdrRequestDeadline)(Duration.zero))).toBe(true);
});

test("schema-less JSON rejects nonfinite numbers and class instances, including nested values", () => {
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    new Date(),
    { nested: [Infinity] },
    JSON.parse("1e400"),
  ]) {
    expect(Option.isNone(Schema.decodeUnknownOption(HerdrJsonValue)(value))).toBe(true);
  }
  const json = { nested: [null, false, "text", 1] };
  expect(Schema.decodeUnknownSync(HerdrJsonValue)(json)).toStrictEqual(json);
});

test("natural-number schemas retain safe-integer bounds", () => {
  const parse = Schema.decodeUnknownOption(HerdrRevision);
  FastCheck.assert(
    FastCheck.property(FastCheck.double(), (value) => {
      expect(Option.isSome(parse(value))).toBe(Number.isSafeInteger(value) && value >= 0);
    }),
    { seed: 2103, numRuns: 100 },
  );
  for (const value of [
    0,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    Infinity,
    NaN,
    -1,
    0.5,
  ]) {
    expect(Option.isSome(parse(value))).toBe(Number.isSafeInteger(value) && value >= 0);
  }
});

test("public pane-read encoding still omits absent lines rather than adopting request nulls", () => {
  const parsed = Schema.decodeUnknownSync(PaneReadInput)({ source: "visible", stripAnsi: false });
  expect(Schema.encodeSync(PaneReadInput)(parsed)).toStrictEqual({
    source: "visible",
    stripAnsi: false,
  });
});

test("overflowing JSON numbers become correlated invalid-response failures through the SDK", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(
            request.method === "agent.explain"
              ? new HerdrRawTestResponse(
                  `{"id":${JSON.stringify(request.id)},"result":{"type":"agent_explain","explain":{"overflow":1e400}}}\n`,
                )
              : makeHerdrSuccessResponse(request),
          ),
        );
        const failure = yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          return yield* sdk.agents
            .explain({ name: "worker" }, { requestId: "overflow" })
            .pipe(Effect.flip);
        }).pipe(
          Effect.provide(
            herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
          ),
        );
        expect(failure).toBeInstanceOf(HerdrInvalidResponse);
        expect(failure).toMatchObject({ reason: "schema_mismatch", requestId: "overflow" });
        yield* server.waitFor("close", server.requests.length);
        expect(server.openSocketMethods()).toStrictEqual([]);
      }),
    ),
  ));

test("invalid targets and metadata fail at SDK boundaries before any socket request", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(makeHerdrSuccessResponse(request)),
        );
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const paneId = sdk.ids.pane("pane-1");
          const workspaceId = sdk.ids.workspace("workspace-1");
          for (const tokens of [
            { "bad.key": "value" },
            Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`token${i}`, null])),
          ]) {
            expect(
              yield* sdk.panes
                .reportMetadata(paneId, { source: "fixture", tokens })
                .pipe(Effect.flip),
            ).toBeInstanceOf(HerdrInvalidInput);
            expect(
              yield* sdk.workspaces
                .reportMetadata(workspaceId, { source: "fixture", tokens })
                .pipe(Effect.flip),
            ).toBeInstanceOf(HerdrInvalidInput);
          }
          const invalidLabels = { working: "Busy", paused: "Paused" };
          expect(
            yield* sdk.panes
              .reportMetadata(paneId, { source: "fixture", stateLabels: invalidLabels })
              .pipe(Effect.flip),
          ).toBeInstanceOf(HerdrInvalidInput);
          for (const target of [
            { paneId: "pane-1", name: "worker" },
            { paneId: "", name: "worker" },
          ]) {
            // @ts-expect-error JavaScript callers can still send competing selectors.
            expect(yield* sdk.agents.get(target).pipe(Effect.flip)).toBeInstanceOf(
              HerdrInvalidInput,
            );
          }
          const layoutTarget = { paneId: "pane-1", tabId: "" };
          // @ts-expect-error Competing layout targets are invalid even when one ID is empty.
          const layoutRequest = sdk.layouts.export(layoutTarget);
          expect(yield* layoutRequest.pipe(Effect.flip)).toBeInstanceOf(HerdrInvalidInput);
          const swapInput = {
            direction: "right",
            sourcePaneId: "pane-1",
            targetPaneId: "pane-2",
          } as const;
          // @ts-expect-error Competing pane-swap modes must never silently pick a branch.
          const swapRequest = sdk.panes.swap(swapInput);
          expect(yield* swapRequest.pipe(Effect.flip)).toBeInstanceOf(HerdrInvalidInput);
          expect(server.requests).toStrictEqual([]);
          yield* sdk.panes.reportMetadata(paneId, {
            source: "fixture",
            stateLabels: { working: "Busy" },
            tokens: { removed: null },
          });
          yield* sdk.agents.get({ kind: "pane", paneId });
          yield* sdk.agents.focus({ kind: "agent", name: "worker" });
        }).pipe(
          Effect.provide(
            herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
          ),
        );
        expect(
          server.requests.find((request) => request.method === "pane.report_metadata")?.params,
        ).toMatchObject({ state_labels: { working: "Busy" }, tokens: { removed: null } });
        expect(
          server.requests.find((request) => request.method === "agent.get")?.params,
        ).toStrictEqual({ target: "pane-1" });
        expect(
          server.requests.find((request) => request.method === "agent.focus")?.params,
        ).toStrictEqual({ target: "worker" });
        yield* server.waitFor("close", server.requests.length);
        expect(server.openSocketMethods()).toStrictEqual([]);
      }),
    ),
  ));
