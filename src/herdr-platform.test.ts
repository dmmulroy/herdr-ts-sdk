import { Duration, Effect, Fiber } from "effect";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./index.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";
import { resolveHerdrSocketEndpoint } from "./herdr-transport.ts";

test("local platform socket completes public SDK success and server failure with socket cleanup", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(
            request.method === "server.reload_config"
              ? {
                  id: request.id,
                  error: { code: "fixture_rejected", message: "Fixture rejection" },
                }
              : makeHerdrSuccessResponse(request),
          ),
        );
        // The fixture exposes the logical path used by the SDK; Node receives its translated endpoint.
        expect(resolveHerdrSocketEndpoint(server.socketPath).startsWith("\\\\.\\pipe\\")).toBe(
          process.platform === "win32",
        );
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const ping = yield* sdk.server.ping();
          expect(ping).toHaveProperty("protocol");
          const failure = yield* sdk.server.reloadConfig().pipe(Effect.flip);
          expect(failure).toMatchObject({
            _tag: "HerdrServerError",
            serverCode: "fixture_rejected",
          });
        }).pipe(Effect.provide(herdrSdkLayerFromOptions({ socketPath: server.socketPath })));
        yield* server.waitFor("close", server.requests.length);
        expect(server.openSocketCount()).toBe(0);
        yield* server.close;
        expect(server.openSocketCount()).toBe(0);
        const closedFailure = yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          return yield* sdk.server.ping().pipe(Effect.flip);
        }).pipe(Effect.provide(herdrSdkLayerFromOptions({ socketPath: server.socketPath })));
        expect(closedFailure).toMatchObject({ _tag: "HerdrTransportError", reason: "connect" });
      }),
    ),
  ));

test("local platform socket times out and interrupts established requests without leaking sockets", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(request.method === "ping" ? makeHerdrSuccessResponse(request) : undefined),
        );
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          yield* sdk.server.ping();
          yield* server.waitFor("close", server.requests.length);
          const timeout = yield* sdk.server
            .reloadConfig({ requestTimeout: Duration.millis(50) })
            .pipe(Effect.flip);
          expect(timeout).toMatchObject({ _tag: "HerdrRequestTimeout" });
          yield* server.waitFor("close", server.requests.length);
          expect(server.openSocketCount()).toBe(0);
          const nextRequestCount = server.requests.length + 1;
          const fiber = yield* sdk.server
            .reloadConfig({ requestTimeout: Duration.seconds(10) })
            .pipe(Effect.forkChild);
          yield* server.waitFor("request", nextRequestCount);
          expect(server.openSocketCount()).toBe(1);
          yield* Fiber.interrupt(fiber);
          yield* server.waitFor("close", nextRequestCount);
          expect(server.openSocketCount()).toBe(0);
        }).pipe(Effect.provide(herdrSdkLayerFromOptions({ socketPath: server.socketPath })));
      }),
    ),
  ));
