import type { Socket } from "node:net";
import { Deferred, Duration, Effect, Fiber, Stream } from "effect";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import {
  HerdrInvalidResponse,
  HerdrTransportError,
  HerdrUnsupportedEvent,
} from "./herdr-errors.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import {
  HerdrRawTestResponse,
  startHerdrTestServer,
  type HerdrTestServer,
} from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

const workspace = {
  workspace_id: "workspace-1",
  number: 1,
  label: "Fixture",
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: "tab-1",
  agent_status: "idle",
};

test("event subscriptions normalize, filter, and close their scoped socket", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            if (request.method === "events.subscribe") {
              return new HerdrRawTestResponse(
                [
                  JSON.stringify(response),
                  JSON.stringify({
                    event: "workspace_updated",
                    data: { type: "workspace_updated", workspace },
                  }),
                  JSON.stringify({
                    event: "workspace_created",
                    data: { type: "workspace_created", workspace },
                  }),
                  "",
                ].join("\n"),
              );
            }
            return response;
          }),
        );

        const event = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* Stream.runHead(
              herdr.events.subscribe([{ type: "workspace.created" }] as const),
            );
          }),
        );

        expect(event._tag).toBe("Some");
        if (event._tag === "Some") expect(event.value.type).toBe("workspace.created");
        yield* server.waitFor("close", server.requests.length);
        expect(server.openSocketMethods()).toEqual([]);
      }),
    ),
  ));

test("accepted live-only subscriptions safely buffer events across snapshot bootstrap", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        let subscriberSocket: Socket | undefined;
        const subscriptionAccepted = yield* Deferred.make<void>();
        const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
          Effect.gen(function* () {
            const response = makeHerdrSuccessResponse(request);
            if (request.method === "events.subscribe") {
              subscriberSocket = socket;
              yield* server.writeChunks(socket, [Buffer.from(`${JSON.stringify(response)}\n`)]);
              yield* Deferred.succeed(subscriptionAccepted, undefined);
              return;
            }
            if (request.method === "session.snapshot") {
              if (!subscriberSocket)
                throw new Error("Snapshot requested before subscription acceptance");
              yield* server.writeChunks(subscriberSocket, [
                Buffer.from(
                  `${JSON.stringify({
                    event: "workspace_created",
                    data: { type: "workspace_created", workspace },
                  })}\n`,
                ),
              ]);
            }
            return response;
          }),
        );

        const result = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const eventFiber = yield* herdr.events
              .subscribe([{ type: "workspace.created" }] as const)
              .pipe(Stream.runHead, Effect.forkChild);
            yield* Deferred.await(subscriptionAccepted);
            const snapshot = yield* herdr.session.snapshot();
            const event = yield* Fiber.join(eventFiber);
            return { snapshot, event };
          }),
        );

        expect(result.snapshot).toBeDefined();
        expect(result.event._tag).toBe("Some");
        if (result.event._tag === "Some") expect(result.event.value.type).toBe("workspace.created");
        const methods = server.requests.map((request) => request.method);
        expect(methods.indexOf("events.subscribe")).toBeLessThan(
          methods.indexOf("session.snapshot"),
        );
      }),
    ),
  ));

test("event subscriptions preserve an unknown server discriminant as a typed failure", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            if (request.method !== "events.subscribe") return response;
            return new HerdrRawTestResponse(
              `${JSON.stringify(response)}\n${JSON.stringify({
                event: "pane.future_state",
                data: { type: "pane.future_state" },
              })}\n`,
            );
          }),
        );

        const failure = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* Stream.runHead(
              herdr.events.subscribe([{ type: "workspace.created" }] as const),
            ).pipe(Effect.flip);
          }),
        );
        expect(failure).toBeInstanceOf(HerdrUnsupportedEvent);
        expect(failure).toMatchObject({ eventType: "pane.future_state" });
      }),
    ),
  ));

test("event malformed-frame failure and interruption both finalize sockets", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const malformedServer: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
          Effect.gen(function* () {
            const response = makeHerdrSuccessResponse(request);
            if (request.method === "events.subscribe") {
              yield* malformedServer.schedule(
                10,
                malformedServer.writeChunks(socket, [Buffer.from("{bad\n")]),
              );
            }
            return response;
          }),
        );

        const failure = yield* provideHerdrTestSdk(
          malformedServer.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* Stream.runHead(
              herdr.events.subscribe([{ type: "workspace.created" }] as const),
            ).pipe(Effect.flip);
          }),
        );
        expect(failure).toBeInstanceOf(HerdrInvalidResponse);
        yield* malformedServer.waitFor("close", malformedServer.requests.length);
        expect(malformedServer.openSocketMethods()).toEqual([]);

        const interruptionAccepted = yield* Deferred.make<void>();
        const interruptionServer: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
          Effect.gen(function* () {
            const response = makeHerdrSuccessResponse(request);
            if (request.method !== "events.subscribe") return response;
            yield* interruptionServer.writeChunks(socket, [
              Buffer.from(`${JSON.stringify(response)}\n`),
            ]);
            yield* Deferred.succeed(interruptionAccepted, undefined);
          }),
        );

        yield* provideHerdrTestSdk(
          interruptionServer.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const fiber = yield* Stream.runDrain(
              herdr.events.subscribe([{ type: "workspace.created" }] as const),
            ).pipe(Effect.forkChild);
            yield* Deferred.await(interruptionAccepted);
            yield* Fiber.interrupt(fiber);
          }),
        );
        yield* interruptionServer.waitFor("close", interruptionServer.requests.length);
        expect(interruptionServer.openSocketMethods()).toEqual([]);
      }),
    ),
  ));

test("event subscriptions apply socket backpressure while consumers are busy", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        let eventWriteFinished = false;
        const largeWorkspace = { ...workspace, label: "x".repeat(32 * 1024) };
        const eventLine = `${JSON.stringify({
          event: "workspace_created",
          data: { type: "workspace_created", workspace: largeWorkspace },
        })}\n`;
        const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
          Effect.gen(function* () {
            const response = makeHerdrSuccessResponse(request);
            if (request.method === "events.subscribe") {
              yield* server.writeChunks(socket, [Buffer.from(`${JSON.stringify(response)}\n`)]);
              yield* server.schedule(
                0,
                Effect.gen(function* () {
                  yield* server.writeChunks(socket, [Buffer.from(eventLine.repeat(512))]);
                  eventWriteFinished = true;
                }),
              );
              return;
            }
            return response;
          }),
        );

        const finishedWhileConsumerWasBusy = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const firstEventReceived = yield* Deferred.make<void>();
            const releaseConsumer = yield* Deferred.make<void>();
            const fiber = yield* herdr.events
              .subscribe([{ type: "workspace.created" }] as const)
              .pipe(
                Stream.runForEach(() =>
                  Deferred.succeed(firstEventReceived, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseConsumer)),
                  ),
                ),
                Effect.forkChild,
              );

            yield* Deferred.await(firstEventReceived);
            yield* Effect.sleep(Duration.millis(250));
            const result = eventWriteFinished;
            yield* Deferred.succeed(releaseConsumer, undefined);
            yield* Fiber.interrupt(fiber);
            return result;
          }),
        );

        expect(finishedWhileConsumerWasBusy).toBe(false);
      }),
    ),
  ));

test("event subscriptions reject a partial final frame when the server closes", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
          Effect.gen(function* () {
            const response = makeHerdrSuccessResponse(request);
            if (request.method === "events.subscribe") {
              yield* server.writeChunks(socket, [Buffer.from(`${JSON.stringify(response)}\n`)]);
              socket.end('{"event":"workspace_created"');
              return;
            }
            return response;
          }),
        );

        const outcome = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* herdr.events.subscribe([{ type: "workspace.created" }] as const).pipe(
              Stream.runDrain,
              Effect.match({
                onFailure: (failure) => failure,
                onSuccess: () => undefined,
              }),
            );
          }),
        );

        expect(outcome).toBeInstanceOf(HerdrTransportError);
        expect(outcome).toMatchObject({ reason: "premature_close" });
      }),
    ),
  ));

test("event subscriptions decode UTF-8 characters fragmented across socket reads", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const expectedLabel = "Fixture 🌱";
        const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
          Effect.gen(function* () {
            const response = makeHerdrSuccessResponse(request);
            if (request.method === "events.subscribe") {
              const eventBytes = Buffer.from(
                `${JSON.stringify({
                  event: "workspace_created",
                  data: {
                    type: "workspace_created",
                    workspace: { ...workspace, label: expectedLabel },
                  },
                })}\n`,
              );
              const plantBytes = Buffer.from("🌱");
              const plantOffset = eventBytes.indexOf(plantBytes);
              yield* server.writeChunks(socket, [
                Buffer.from(`${JSON.stringify(response)}\n`),
                eventBytes.subarray(0, plantOffset + 2),
              ]);
              // Give the reader an event-loop turn before completing the split UTF-8 code point.
              yield* server.schedule(
                10,
                server.writeChunks(socket, [eventBytes.subarray(plantOffset + 2)]),
              );
              return;
            }
            return response;
          }),
        );

        const event = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* Stream.runHead(
              herdr.events.subscribe([{ type: "workspace.created" }] as const),
            );
          }),
        );

        expect(event._tag).toBe("Some");
        if (event._tag === "Some") expect(event.value.workspace.label).toBe(expectedLabel);
      }),
    ),
  ));

test.for(["invalid UTF-8", "UTF-8 BOM"])(
  "event subscriptions reject %s instead of normalizing the wire bytes",
  (encoding, context) =>
    runHerdrTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* startHerdrTestServer((request) =>
            Effect.sync(() => {
              const response = makeHerdrSuccessResponse(request);
              if (request.method !== "events.subscribe") return response;
              const eventBytes = Buffer.from(
                `${JSON.stringify({
                  event: "workspace_created",
                  data: { type: "workspace_created", workspace: { ...workspace, label: "!" } },
                })}\n`,
              );
              if (encoding === "invalid UTF-8") eventBytes[eventBytes.indexOf("!")] = 0xff;
              return new HerdrRawTestResponse(
                Buffer.concat([
                  Buffer.from(`${JSON.stringify(response)}\n`),
                  encoding === "UTF-8 BOM" ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
                  eventBytes,
                ]),
              );
            }),
          );

          const failure = yield* provideHerdrTestSdk(
            server.socketPath,
            Effect.gen(function* () {
              const herdr = yield* HerdrSdk;
              return yield* herdr.events
                .subscribe([{ type: "workspace.created" }] as const)
                .pipe(Stream.runHead, Effect.flip);
            }),
          );
          expect(failure).toMatchObject({ _tag: "HerdrInvalidResponse", reason: "malformed_json" });
          yield* server.waitFor("close", server.requests.length);
          expect(server.openSocketMethods()).not.toContain("events.subscribe");
        }),
      ),
    ),
);

test("event wait preserves an unknown server discriminant as a typed failure", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            if (request.method !== "events.wait") return makeHerdrSuccessResponse(request);
            return new HerdrRawTestResponse(
              `${JSON.stringify({
                id: request.id,
                result: {
                  type: "wait_matched",
                  event: { event: "pane.future_state", data: { type: "pane.future_state" } },
                },
              })}\n`,
            );
          }),
        );

        const failure = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* herdr.events.wait({ type: "workspace.created" }).pipe(Effect.flip);
          }),
        );
        expect(failure).toBeInstanceOf(HerdrUnsupportedEvent);
        expect(failure).toMatchObject({ eventType: "pane.future_state" });
      }),
    ),
  ));

test("reusing a cold subscription opens independent sockets without replaying prior events", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        let subscriptionCount = 0;
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            if (request.method !== "events.subscribe") return response;
            subscriptionCount += 1;
            return new HerdrRawTestResponse(
              `${JSON.stringify(response)}\n${JSON.stringify({
                event: "workspace_created",
                data: {
                  type: "workspace_created",
                  workspace: { ...workspace, label: `Subscription ${subscriptionCount}` },
                },
              })}\n`,
            );
          }),
        );

        const events = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const subscription = herdr.events.subscribe([{ type: "workspace.created" }] as const);
            expect(subscriptionCount).toBe(0);
            const first = yield* Stream.runHead(subscription);
            const next = yield* Effect.all(
              [Stream.runHead(subscription), Stream.runHead(subscription)],
              { concurrency: "unbounded" },
            );
            return [first, ...next];
          }),
        );
        expect(subscriptionCount).toBe(3);
        expect(
          events
            .map((event) => (event._tag === "Some" ? event.value.workspace.label : "missing"))
            .sort(),
        ).toEqual(["Subscription 1", "Subscription 2", "Subscription 3"]);
      }),
    ),
  ));

test.for([
  { suffix: "{bad", reason: "malformed_json" },
  { suffix: "x".repeat(1024 * 1024 + 1), reason: "oversized_frame" },
])("event subscriptions deliver the valid prefix before $reason", ({ suffix, reason }, context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            if (request.method !== "events.subscribe") return response;
            return new HerdrRawTestResponse(
              [
                JSON.stringify(response),
                ...["First", "Second"].map((label) =>
                  JSON.stringify({
                    event: "workspace_created",
                    data: { type: "workspace_created", workspace: { ...workspace, label } },
                  }),
                ),
                suffix,
                "",
              ].join("\n"),
            );
          }),
        );

        const labels: string[] = [];
        const failure = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* herdr.events.subscribe([{ type: "workspace.created" }] as const).pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  labels.push(event.workspace.label);
                }),
              ),
              Effect.flip,
            );
          }),
        );
        expect(labels).toEqual(["First", "Second"]);
        expect(failure).toMatchObject({ _tag: "HerdrInvalidResponse", reason });
      }),
    ),
  ),
);

test("interrupting an accepted idle subscription closes its socket before the SDK scope ends", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const accepted = yield* Deferred.make<void>();
        const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
          Effect.gen(function* () {
            if (request.method === "events.subscribe") {
              yield* server.writeChunks(socket, [
                Buffer.from(`${JSON.stringify(makeHerdrSuccessResponse(request))}\n`),
              ]);
              yield* Deferred.succeed(accepted, undefined);
              return;
            }
            return makeHerdrSuccessResponse(request);
          }),
        );

        yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const fiber = yield* herdr.events
              .subscribe([{ type: "workspace.created" }] as const)
              .pipe(Stream.runDrain, Effect.forkChild);
            yield* Deferred.await(accepted);
            yield* Fiber.interrupt(fiber);
            yield* server.waitFor("close", server.requests.length);
            expect(server.openSocketMethods()).not.toContain("events.subscribe");
          }),
        );
      }),
    ),
  ));

test.for([
  { event: "workspace_created", data: {} },
  { event: "pane.scroll_changed", data: {} },
  { event: "workspace_created", data: { type: "workspace_updated", workspace } },
])("event subscriptions reject malformed known envelopes: $event", (envelope, context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            if (request.method !== "events.subscribe") return response;
            return new HerdrRawTestResponse(
              `${JSON.stringify(response)}\n${JSON.stringify(envelope)}\n`,
            );
          }),
        );

        const failure = yield* provideHerdrTestSdk(
          server.socketPath,
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            return yield* herdr.events
              .subscribe([
                { type: "workspace.created" },
                { type: "workspace.updated" },
                { type: "pane.scroll_changed", paneId: "pane-1" },
              ])
              .pipe(Stream.runHead, Effect.flip);
          }),
        );
        expect(failure).toBeInstanceOf(HerdrInvalidResponse);
        expect(failure).toMatchObject({ reason: "schema_mismatch" });
        yield* server.waitFor("close", server.requests.length);
        expect(server.openSocketMethods()).not.toContain("events.subscribe");
      }),
    ),
  ),
);

/** Provides an isolated SDK Layer while preserving fixture and configuration failures. */
function provideHerdrTestSdk<A, E>(socketPath: string, effect: Effect.Effect<A, E, HerdrSdk>) {
  return effect.pipe(
    Effect.provide(herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(socketPath) })),
  );
}
