import { Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { expect, test } from "vite-plus/test";
import {
  acquireSdkTelemetryTestServer,
  sdkTelemetryRecordedSpans,
} from "../scripts/sdk-telemetry-test-server.ts";
import { traceSdkExecution } from "../scripts/sdk-telemetry.mjs";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import { HerdrRawTestResponse, startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

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
