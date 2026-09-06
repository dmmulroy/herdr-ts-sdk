import { Deferred, Duration, Effect, Exit, Fiber, Stream } from "effect";
import { expect, test } from "vite-plus/test";
import {
  acquireSdkTelemetryTestServer,
  sdkTelemetryRecordedSpans,
} from "../scripts/sdk-telemetry-test-server.ts";
import { traceSdkExecution } from "../scripts/sdk-telemetry.mjs";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import { HerdrGraphicsStreamClosed, HerdrRequestTimeout } from "./herdr-errors.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import { HerdrRawTestResponse, startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

test("graphics tracing separates lock and acknowledgement wait and records timeout invalidation", (context) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const collector = yield* acquireSdkTelemetryTestServer();
        const frameReceived = yield* Deferred.make<void>();
        const server = yield* startHerdrTestServer((request, socket) =>
          Effect.sync(() => {
            if (request.method === "pane.graphics.stream") {
              socket.removeAllListeners("data");
              socket.once("data", () => Effect.runSync(Deferred.succeed(frameReceived, undefined)));
            }
            return makeHerdrSuccessResponse(request);
          }),
        );
        const execution = yield* traceSdkExecution(
          {
            enabled: true,
            endpoint: collector.endpoint,
            kind: "test",
            name: "graphics timeout tracing",
          },
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const writer = yield* herdr.panes.graphics.openStream(herdr.ids.pane("private-pane"));
            const timeout = yield* writer
              .writeFile(
                {
                  format: "rgba",
                  imageWidth: 1,
                  imageHeight: 1,
                  filePath: herdr.ids.absolutePath("/tmp/private-frame.rgba"),
                  sequence: 1,
                  revision: 1,
                },
                { requestTimeout: Duration.millis(50) },
              )
              .pipe(Effect.flip);
            yield* Deferred.await(frameReceived);
            expect(timeout).toBeInstanceOf(HerdrRequestTimeout);
            const closed = yield* writer
              .write({
                format: "png",
                imageWidth: 1,
                imageHeight: 1,
                data: Uint8Array.of(1),
              })
              .pipe(Effect.flip);
            expect(closed).toBeInstanceOf(HerdrGraphicsStreamClosed);
          }).pipe(
            Effect.provide(
              herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
            ),
          ),
        );
        expect(Exit.isSuccess(execution.tracedExit)).toBe(true);
        expect(execution.telemetry.status).toBe("exported");
        yield* server.waitFor("close", server.requests.length);
        expect(server.openSocketMethods()).toEqual([]);
        const spans = sdkTelemetryRecordedSpans(collector.requests);
        const acquisition = spans.find((span) => span.name === "PaneService.graphics.openStream");
        const write = spans.find((span) => span.name === "PaneService.graphics.writeFile");
        const lock = spans.find(
          (span) => span.name === "herdr.graphics.lock.wait" && span.parentSpanId === write?.spanId,
        );
        const ack = spans.find((span) => span.name === "herdr.graphics.ack.wait");
        expect(acquisition).toBeDefined();
        expect(write).toBeDefined();
        expect(lock).toBeDefined();
        expect(ack).toBeDefined();
        if (!acquisition || !write || !lock || !ack) return;
        expect(write.links.some((link) => link.spanId === acquisition.spanId)).toBe(true);
        expect(write.parentSpanId).not.toBe(acquisition.spanId);
        expect(BigInt(lock.endTimeUnixNano)).toBeLessThanOrEqual(BigInt(ack.startTimeUnixNano));
        expect(BigInt(acquisition.endTimeUnixNano)).toBeLessThanOrEqual(
          BigInt(write.startTimeUnixNano),
        );
        expect(write.events).toContainEqual(
          expect.objectContaining({
            name: "herdr.graphics.invalidated",
            attributes: expect.arrayContaining([
              { key: "herdr.reason", value: { stringValue: "timeout" } },
            ]),
          }),
        );
        const exported = collector.requests.map((request) => request.body).join("");
        expect(exported).not.toContain("private-pane");
        expect(exported).not.toContain("private-frame");
        expect(exported).not.toContain(server.socketPath);
      }),
    ).pipe(Effect.timeout("5 seconds")),
    { signal: context.signal },
  ));

test.for(["success", "failure", "interrupted"] as const)(
  "subscription tracing ends after %s scope cleanup with bounded summary",
  (outcome, context) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const collector = yield* acquireSdkTelemetryTestServer();
          const accepted = yield* Deferred.make<void>();
          const server = yield* startHerdrTestServer((request) =>
            Effect.sync(() => {
              const response = makeHerdrSuccessResponse(request);
              if (request.method !== "events.subscribe") return response;
              if (outcome === "failure")
                return new HerdrRawTestResponse(JSON.stringify(response) + "\n{invalid-json}\n");
              return new HerdrRawTestResponse(
                JSON.stringify(response) +
                  "\n" +
                  JSON.stringify({
                    event: "workspace_created",
                    data: {
                      type: "workspace_created",
                      workspace: {
                        workspace_id: "private-workspace",
                        number: 1,
                        label: "private-label",
                        focused: true,
                        pane_count: 1,
                        tab_count: 1,
                        active_tab_id: "private-tab",
                        agent_status: "idle",
                      },
                    },
                  }) +
                  "\n",
              );
            }),
          );
          const execution = yield* traceSdkExecution(
            {
              enabled: true,
              endpoint: collector.endpoint,
              kind: "test",
              name: "subscription scope tracing",
            },
            Effect.gen(function* () {
              const herdr = yield* HerdrSdk;
              const events = herdr.events
                .subscribe([{ type: "workspace.created" }])
                .pipe(Stream.tap(() => Deferred.succeed(accepted, undefined)));
              if (outcome === "success") {
                yield* events.pipe(Stream.take(1), Stream.runDrain);
              } else if (outcome === "failure") {
                const failure = yield* events.pipe(Stream.runDrain, Effect.exit);
                expect(Exit.isFailure(failure)).toBe(true);
              } else {
                const consumer = yield* events.pipe(Stream.runDrain, Effect.forkScoped);
                yield* Deferred.await(accepted);
                yield* Fiber.interrupt(consumer);
              }
            }).pipe(
              Effect.provide(
                herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
              ),
            ),
          );
          expect(Exit.isSuccess(execution.tracedExit)).toBe(true);
          expect(execution.telemetry.status).toBe("exported");
          yield* server.waitFor("close", server.requests.length);
          expect(server.openSocketMethods()).toEqual([]);
          const spans = sdkTelemetryRecordedSpans(collector.requests);
          const subscription = spans.find((span) => span.name === "EventService.subscribe");
          expect(subscription).toBeDefined();
          if (!subscription) return;
          expect(
            subscription.events.filter((event) => event.name === "herdr.subscription.closed"),
          ).toHaveLength(1);
          expect(subscription.attributes).toContainEqual({
            key: "herdr.outcome",
            value: { stringValue: outcome },
          });
          expect(subscription.attributes).toContainEqual({
            key: "herdr.events.count",
            value: { intValue: outcome === "failure" ? 0 : 1 },
          });
          expect(
            subscription.events.filter((event) => event.name.startsWith("herdr.subscription."))
              .length,
          ).toBe(2);
          expect(subscription.events.length).toBeLessThanOrEqual(3);
          const closed = subscription.events.find(
            (event) => event.name === "herdr.subscription.closed",
          );
          expect(closed).toBeDefined();
          if (closed) {
            expect(BigInt(closed.timeUnixNano)).toBeLessThanOrEqual(
              BigInt(subscription.endTimeUnixNano),
            );
            const socketCloses = spans.filter((span) => span.name === "herdr.socket.close");
            expect(socketCloses.length).toBeGreaterThan(0);
            for (const socketClose of socketCloses) {
              expect(BigInt(socketClose.endTimeUnixNano)).toBeLessThanOrEqual(
                BigInt(closed.timeUnixNano),
              );
            }
          }
          if (outcome === "success")
            expect(subscription.events[0]?.name).toBe("herdr.subscription.accepted");
          const exported = collector.requests.map((request) => request.body).join("");
          expect(exported).not.toContain("private-label");
          expect(exported).not.toContain("private-workspace");
        }),
      ).pipe(Effect.timeout("5 seconds")),
      { signal: context.signal },
    ),
);
