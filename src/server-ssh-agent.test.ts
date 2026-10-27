import type { Socket } from "node:net";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { expect, test } from "vite-plus/test";
import {
  HerdrAbsolutePath,
  HerdrInvalidInput,
  HerdrSdk,
  HerdrServerError,
  HerdrSshAgentRegistrationClosed,
  herdrSdkLayerFromOptions,
} from "./index.ts";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

const agentSocket = { socketPath: "/tmp/herdr-sdk-agent.sock" };

const provideFixtureSdk = (socketPath: string) =>
  Effect.provide(herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(socketPath) }));

/** Starts a fixture that accepts registrations and exposes each lease's server-side socket. */
const startRegistrationServer = Effect.gen(function* () {
  const leases: Socket[] = [];
  const server = yield* startHerdrTestServer((request, socket) =>
    Effect.sync(() => {
      if (request.method === "server.ssh_agent.register") leases.push(socket);
      return makeHerdrSuccessResponse(request);
    }),
  );
  return { server, leases };
});

test("a scoped registration holds its connection until the owning Scope closes", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const { server } = yield* startRegistrationServer;
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const scope = yield* Scope.make();
          const registration = yield* sdk.server.sshAgent
            .registerScoped(agentSocket, { requestId: "lease" })
            .pipe(Scope.provide(scope));
          expect(registration).toMatchObject({
            requestId: "lease",
            socketPath: "/tmp/herdr-sdk-agent.sock",
          });
          expect(yield* registration.registrationState()).toBe("registered");
          expect(server.openSocketMethods()).toEqual(["server.ssh_agent.register"]);
          yield* Scope.close(scope, Exit.void);
          yield* server.waitFor("close", 2);
          expect(server.openSocketMethods()).toEqual([]);
        }).pipe(provideFixtureSdk(server.socketPath));
        expect(
          server.requests.find((request) => request.method === "server.ssh_agent.register"),
        ).toEqual({
          id: "lease",
          method: "server.ssh_agent.register",
          params: { socket_path: "/tmp/herdr-sdk-agent.sock" },
        });
      }),
    ),
  ));

test("a server-closed registration reports closure without interrupting a scoped owner", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const { server, leases } = yield* startRegistrationServer;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            const registration = yield* sdk.server.sshAgent.registerScoped(agentSocket);
            leases[0]?.destroy();
            const closed = yield* registration.awaitClosed().pipe(Effect.flip);
            expect(closed).toBeInstanceOf(HerdrSshAgentRegistrationClosed);
            expect(closed.requestId).toBe(registration.requestId);
            expect(yield* registration.registrationState()).toBe("closed");
          }),
        ).pipe(provideFixtureSdk(server.socketPath));
        expect(server.openSocketMethods()).toEqual([]);
      }),
    ),
  ));

test("withRegistration releases its connection on success, callback failure, and interruption", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const { server } = yield* startRegistrationServer;
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          expect(
            yield* sdk.server.sshAgent.withRegistration(agentSocket, () => Effect.succeed(42)),
          ).toBe(42);
          yield* server.waitFor("close", 2);

          const failure = yield* sdk.server.sshAgent
            .withRegistration(agentSocket, () => Effect.fail("callback-failure" as const))
            .pipe(Effect.flip);
          expect(failure).toBe("callback-failure");
          yield* server.waitFor("close", 3);

          const entered = yield* Deferred.make<void>();
          const fiber = yield* sdk.server.sshAgent
            .withRegistration(agentSocket, () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
            )
            .pipe(Effect.forkChild);
          yield* Deferred.await(entered);
          yield* Fiber.interrupt(fiber);
          yield* server.waitFor("close", 4);
          expect(server.openSocketMethods()).toEqual([]);
        }).pipe(provideFixtureSdk(server.socketPath));
      }),
    ),
  ));

test.for(["invalid_ssh_agent", "ssh_agent_unavailable"])(
  "server %s rejection fails acquisition and closes the socket",
  (code, context) =>
    runHerdrTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* startHerdrTestServer((request) =>
            Effect.succeed(
              request.method === "ping"
                ? makeHerdrSuccessResponse(request)
                : { id: request.id, error: { code, message: "fixture rejection" } },
            ),
          );
          const entered: string[] = [];
          const error = yield* Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            return yield* sdk.server.sshAgent
              .withRegistration(agentSocket, () => Effect.sync(() => entered.push("callback")))
              .pipe(Effect.flip);
          }).pipe(provideFixtureSdk(server.socketPath));
          expect(error).toBeInstanceOf(HerdrServerError);
          expect(error).toMatchObject({ serverCode: code });
          expect(entered).toEqual([]);
          yield* server.waitFor("close", 2);
          expect(server.openSocketMethods()).toEqual([]);
        }),
      ),
    ),
);

test("a relative agent socket path fails before any request", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const { server } = yield* startRegistrationServer;
        const failure = yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          return yield* sdk.server.sshAgent
            .withRegistration({ socketPath: "agent.sock" }, () => Effect.void)
            .pipe(Effect.flip);
        }).pipe(provideFixtureSdk(server.socketPath));
        expect(failure).toBeInstanceOf(HerdrInvalidInput);
        expect(server.requests).toHaveLength(0);
      }),
    ),
  ));
