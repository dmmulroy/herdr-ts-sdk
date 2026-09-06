import { NodeFileSystem } from "@effect/platform-node-shared";
import { Deferred, Effect, Exit, Fiber, FileSystem, Logger } from "effect";
import { createConnection, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { expect, expectTypeOf, test, type TestContext } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import {
  HerdrRawTestResponse,
  startHerdrTestServer,
  type HerdrTestFixtureError,
} from "./herdr-test-server.ts";
import { resolveHerdrSocketEndpoint } from "./herdr-transport.ts";

const requestBytes = Buffer.from(
  `${JSON.stringify({ id: "secret-request-id", method: "pane.graphics.stream", params: { pane_id: "secret-pane-id" } })}\n`,
);

const connectFixture = (socketPath: string) =>
  Effect.acquireRelease(
    Effect.callback<Socket, Error>((resume) => {
      const socket = createConnection(resolveHerdrSocketEndpoint(socketPath));
      const onError = (): void =>
        resume(Effect.fail(new Error("Fixture test client connection failed")));
      socket.on("error", onError);
      socket.once("connect", () => resume(Effect.succeed(socket)));
      return Effect.sync(() => {
        if (socket.connecting) socket.destroy();
      });
    }),
    (socket) =>
      Effect.sync(() => {
        socket.destroy();
      }),
  );

const readBytes = (socket: Socket, length: number) =>
  Effect.callback<Buffer, Error>((resume) => {
    let bytes = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.byteLength >= length) resume(Effect.succeed(bytes));
    };
    const onClose = (): void =>
      resume(Effect.fail(new Error("Fixture test client closed before bytes arrived")));
    socket.on("data", onData);
    socket.once("close", onClose);
    return Effect.sync(() => {
      socket.off("data", onData);
      socket.off("close", onClose);
    });
  }).pipe(Effect.timeout(5000));

const runTest = <A, E>(
  context: TestContext,
  effect: Effect.Effect<A, E, import("effect").Scope.Scope | FileSystem.FileSystem>,
) => runHerdrTest(context, effect.pipe(Effect.provide(NodeFileSystem.layer)));

test("fixture gates response stages and preserves split UTF-8/coalesced raw bytes", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const socketReady = yield* Deferred.make<Socket>();
      const server = yield* startHerdrTestServer((_request, socket) =>
        Deferred.succeed(socketReady, socket).pipe(Effect.asVoid),
      );
      const gate = yield* server.createResponseGate();
      const client = yield* connectFixture(server.socketPath);
      yield* server.waitFor("accept");
      client.write(requestBytes.subarray(0, 11));
      client.write(requestBytes.subarray(11));
      yield* server.waitFor("request");
      const accepted = yield* Deferred.await(socketReady);
      const response = Buffer.from('"☃"\n{}\n');
      const firstRead = yield* readBytes(client, 2).pipe(Effect.forkScoped);
      yield* server.writeChunks(accepted, [response.subarray(0, 2)]);
      expect(yield* Fiber.join(firstRead)).toEqual(response.subarray(0, 2));
      const remaining = yield* readBytes(client, response.byteLength - 2).pipe(Effect.forkScoped);
      yield* server.schedule(
        1,
        Effect.gen(function* () {
          if (yield* gate.wait)
            yield* server.writeChunks(accepted, [response.subarray(2, 3), response.subarray(3)]);
        }),
      );
      yield* gate.release;
      expect(yield* Fiber.join(remaining)).toEqual(response.subarray(2));
      // Binary LF bytes are data, not a count of graphics frames.
      client.write(Buffer.from([10, 0, 255, 10]));
      yield* server.waitFor("data");
      client.destroy();
      yield* server.waitFor("close");
      expect(server.openSocketCount()).toBe(0);
      expect(server.requests).toHaveLength(1);
      yield* server.close;
      yield* server.close;
    }),
  ));

test.for(["accept", "request", "data", "close"] as const)(
  "fixture %s waits time out with bounded safe diagnostics",
  (kind, context) =>
    runTest(
      context,
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer(() => Effect.void, { timelineCapacity: 3 });
        const result = yield* Effect.flip(server.waitFor(kind, 1, 5));
        expect(result.message).toContain(`wait timeout kind=${kind}`);
        expect(result.message).toContain("reproduce with the focused fixture test");
        expect(result.message.length).toBeLessThan(1000);
      }),
    ),
);

test("fixture bounds metadata and keeps cumulative waits independent of eviction", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer(
        () => Effect.succeed(new HerdrRawTestResponse(Buffer.from("secret-response"))),
        { timelineCapacity: 2 },
      );
      for (let index = 1; index <= 6; index++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* connectFixture(server.socketPath);
            const response = yield* readBytes(client, 15).pipe(Effect.forkScoped);
            client.write(requestBytes);
            yield* server.waitFor("request", index);
            expect((yield* Fiber.join(response)).toString()).toBe("secret-response");
          }),
        );
        yield* server.waitFor("close", index);
        expect(server.timeline().length).toBeLessThanOrEqual(2);
      }
      yield* server.waitFor("accept", 6);
      yield* server.waitFor("request", 6);
      const snapshot = server.timeline();
      expect(snapshot).toHaveLength(2);
      expect(JSON.stringify(snapshot)).not.toContain("secret");
      expect(Object.keys(snapshot[0] ?? {})).toEqual(["sequence", "kind", "connection", "bytes"]);
      const failure = yield* Effect.flip(server.waitFor("request", 7, 5));
      expect(failure.message).not.toContain("secret");
      expect(server.requests).toHaveLength(6);
      yield* server.close;
      expect(snapshot).toHaveLength(2);
    }),
  ));

test.for(["throw", "effect", "parse", "schema", "utf8"] as const)(
  "fixture propagates %s failure without retaining secret causes and cleans sockets",
  (mode, context) =>
    runTest(
      context,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const server = yield* startHerdrTestServer(() => {
          if (mode === "throw") throw new Error("secret-callback-error");
          return Effect.fail(new Error("secret-effect-error"));
        });
        const client = yield* connectFixture(server.socketPath);
        client.write(
          mode === "utf8"
            ? Buffer.concat([Buffer.from('{"id":"'), Buffer.from([255]), requestBytes.subarray(7)])
            : mode === "parse"
              ? "secret-invalid-json\n"
              : mode === "schema"
                ? '{"id":"secret-id","method":"secret-method"}\n'
                : requestBytes,
        );
        const failure = yield* Effect.flip(server.waitFor("request", 2));
        expect(failure.message).not.toContain("secret");
        expect(JSON.stringify(server.timeline())).not.toContain("secret");
        yield* Effect.flip(server.close);
        expect(server.openSocketCount()).toBe(0);
        expect(yield* fs.exists(dirname(server.socketPath))).toBe(false);
      }),
    ),
);

test("fixture scope interrupts callback and scheduled work, releases gates, rejects unfinished waits", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const callbackStarted = yield* Deferred.make<void>();
      const callbackStopped = yield* Deferred.make<void>();
      const server = yield* startHerdrTestServer(() =>
        Effect.gen(function* () {
          yield* Deferred.succeed(callbackStarted, undefined);
          yield* Effect.never;
        }).pipe(Effect.ensuring(Deferred.succeed(callbackStopped, undefined))),
      );
      const gate = yield* server.createResponseGate();
      let scheduled = false;
      yield* server.schedule(
        60_000,
        Effect.sync(() => {
          scheduled = true;
        }),
      );
      const client = yield* connectFixture(server.socketPath);
      client.write(requestBytes);
      yield* Deferred.await(callbackStarted);
      const pending = yield* server.waitFor("request", 2).pipe(Effect.exit, Effect.forkScoped);
      yield* server.close;
      expect(yield* gate.wait).toBe(false);
      expect(Exit.isFailure(yield* Fiber.join(pending))).toBe(true);
      yield* Deferred.await(callbackStopped).pipe(Effect.timeout(5000));
      expect(scheduled).toBe(false);
      expect(server.openSocketCount()).toBe(0);
    }),
  ));

test("fixture cleans its own directory after failed startup without removing a caller path", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "hf-" });
      const blocker = join(directory, "blocker");
      yield* fs.writeFileString(blocker, "keep");
      // An invalid pipe name on Windows, a non-directory parent on Unix.
      const socketPath = process.platform === "win32" ? "\\\\.\\pipe\\" : join(blocker, "socket");
      const failure = yield* Effect.flip(
        startHerdrTestServer(() => Effect.void, { directory, socketPath }),
      );
      expect(failure.message).toContain("startup");
      expect(yield* fs.readDirectory(directory)).toEqual(["blocker"]);
      expect(yield* fs.readFileString(blocker)).toBe("keep");
    }),
  ));

test("fixture automatic cleanup fails on an unobserved callback failure", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const server = yield* startHerdrTestServer(() =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              return yield* Effect.fail(new Error("secret-unobserved-failure"));
            }),
          );
          const client = yield* connectFixture(server.socketPath);
          client.write(requestBytes);
          yield* Deferred.await(entered);
          // Peer closure proves the failure supervisor ran, without consuming its diagnostic.
          yield* Effect.callback<void>((resume) => {
            if (client.closed) {
              resume(Effect.void);
              return;
            }
            const onClose = (): void => resume(Effect.void);
            client.once("close", onClose);
            return Effect.sync(() => {
              client.off("close", onClose);
            });
          }).pipe(Effect.timeout(5000));
        }),
      ).pipe(Effect.exit);
      expect(Exit.isFailure(outcome)).toBe(true);
      expect(JSON.stringify(outcome)).not.toContain("secret-unobserved-failure");
    }),
  ));

test("fixture schedule rejects invalid delays with typed errors and remains usable", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer(() => Effect.void);
      expectTypeOf(server.schedule).toEqualTypeOf<
        (
          delayMs: number,
          work: Effect.Effect<void, unknown>,
        ) => Effect.Effect<void, HerdrTestFixtureError>
      >();
      const rejectedWork = yield* Deferred.make<void>();
      for (const delay of [-1, 0.5, NaN, Infinity, 2_147_483_648]) {
        const error = yield* server
          .schedule(delay, Deferred.succeed(rejectedWork, undefined).pipe(Effect.asVoid))
          .pipe(Effect.flip);
        expect(error._tag).toBe("HerdrTestFixtureError");
        expect(error.message).toContain("invalid delay");
      }
      const acceptedWork = yield* Deferred.make<void>();
      yield* server.schedule(0, Deferred.succeed(acceptedWork, undefined).pipe(Effect.asVoid));
      yield* Deferred.await(acceptedWork);
      yield* server.close;
      expect(yield* Deferred.isDone(rejectedWork)).toBe(false);
    }),
  ));

test("fixture schedule accepts zero delay and supervises work failures", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer(() => Effect.void);
      yield* server.schedule(0, Effect.fail(new Error("secret-scheduled-failure")));
      const failure = yield* Effect.flip(server.waitFor("request"));
      expect(failure.message).not.toContain("secret");
      yield* Effect.flip(server.close);
    }),
  ));

test.for(["callback", "scheduled"] as const)(
  "fixture reports %s cleanup defects mixed with interruption",
  (source, context) =>
    runTest(
      context,
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const work = Deferred.succeed(ready, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.die(new Error("secret-cleanup-defect"))),
        );
        const server = yield* startHerdrTestServer(() =>
          source === "callback" ? work : Effect.void,
        );
        if (source === "scheduled") yield* server.schedule(0, work);
        else {
          const client = yield* connectFixture(server.socketPath);
          client.write(requestBytes);
        }
        yield* Deferred.await(ready);
        const error = yield* Effect.flip(server.close);
        expect(error.message).toContain("callback, socket, or request parsing");
        expect(error.message).not.toContain("secret-cleanup-defect");
        expect(server.timeline().some((entry) => entry.kind === "failure")).toBe(true);
      }),
    ),
);

test("fixture logs bounded metadata only for enclosing failures, not successful scopes", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const messages: unknown[] = [];
      const logger = Logger.make((options) => {
        messages.push(options.message);
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* startHerdrTestServer(() => Effect.void);
        }),
      ).pipe(Effect.provide(Logger.layer([logger])));
      expect(messages).toHaveLength(0);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const server = yield* startHerdrTestServer(() => Effect.void, { timelineCapacity: 2 });
          const client = yield* connectFixture(server.socketPath);
          client.write(requestBytes);
          yield* server.waitFor("request");
          return yield* Effect.fail(new Error("secret-caller-assertion"));
        }),
      ).pipe(Effect.exit, Effect.provide(Logger.layer([logger])));
      expect(messages).toHaveLength(1);
      expect(JSON.stringify(messages)).toContain("enclosing scope failed");
      expect(JSON.stringify(messages)).toContain("timeline=");
      expect(JSON.stringify(messages)).not.toContain("secret");
      expect(JSON.stringify(messages).length).toBeLessThan(1000);
    }),
  ));

test("fixture scope finalization removes its endpoint and directory", (context) =>
  runTest(
    context,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const socketPath = yield* Effect.scoped(
        Effect.gen(function* () {
          const server = yield* startHerdrTestServer(() => Effect.void);
          yield* connectFixture(server.socketPath);
          yield* server.waitFor("accept");
          return server.socketPath;
        }),
      );
      expect(yield* fs.exists(dirname(socketPath))).toBe(false);
    }),
  ));

test.for([0, -1, Infinity, NaN, 1.5, 2 ** 32])(
  "fixture rejects invalid bound %s before acquiring resources",
  (timelineCapacity, context) =>
    runTest(
      context,
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          startHerdrTestServer(() => Effect.void, { timelineCapacity }),
        );
        expect(error.message).toContain("invalid limit");
      }),
    ),
);
