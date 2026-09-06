import { Deferred, Effect, Fiber, FileSystem, Layer, Ref, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { createServer, type Socket } from "node:net";
import { expect, test } from "vite-plus/test";
import { join, resolve } from "node:path";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { startSdkHerdrSandbox } from "./sdk-herdr-sandbox.mjs";

const fixture = (mode = "normal") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "sandbox-test-" });
    const executable = join(directory, "herdr");
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    yield* fs.writeFileString(
      executable,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve("scripts/sdk-herdr-sandbox-test-fixture.mjs"))} ${quote(mode)} ${quote(join(directory, "ready-marker"))} "$@"\n`,
      { mode: 0o700 },
    );
    return { fs, executable, directory };
  });
/** Keeps the real fixture child draining until its owner explicitly releases the private IPC gate. */
const acquireSandboxDrainGate = (directory: string) =>
  Effect.gen(function* () {
    const connected = yield* Deferred.make<Socket>();
    const connections = new Set<Socket>();
    const server = createServer((socket) => {
      connections.add(socket);
      socket.once("close", () => connections.delete(socket));
      Effect.runSync(Deferred.succeed(connected, socket));
    });
    yield* Effect.acquireRelease(
      Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)));
        server.listen(join(directory, "drain.sock"), () => resume(Effect.void));
      }),
      () =>
        Effect.callback<void>((resume) => {
          for (const socket of connections) socket.destroy();
          server.close(() => resume(Effect.void));
        }),
    );
    return connected;
  });

/** Observes real handle decisions without changing process state, exit results, or kill behavior. */
const observeSandboxShutdown = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const acknowledged = yield* Deferred.make<void>();
  const decision = yield* Deferred.make<"exit-wait" | "kill">();
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command);
        if (command._tag !== "StandardCommand") return handle;
        if (command.args.at(-1) === "server")
          return ChildProcessSpawner.makeHandle({
            ...handle,
            exitCode: Effect.gen(function* () {
              yield* Deferred.succeed(decision, "exit-wait");
              return yield* handle.exitCode;
            }),
            kill: (options) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(decision, "kill");
                return yield* handle.kill(options);
              }),
          });
        if (command.args.includes("stop"))
          return ChildProcessSpawner.makeHandle({
            ...handle,
            exitCode: Effect.gen(function* () {
              const code = yield* handle.exitCode;
              if (code === 0) yield* Deferred.succeed(acknowledged, undefined);
              return code;
            }),
          });
        return handle;
      }),
    ),
  );
  return { layer, acknowledged, decision };
});

const parseEnvironment = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

test("sandbox isolates environment and owns idempotent graceful teardown", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture();
      const root = yield* Effect.scoped(
        Effect.gen(function* () {
          const sandbox = yield* startSdkHerdrSandbox({ executable: f.executable });
          const environment = yield* parseEnvironment(
            yield* f.fs.readFileString(join(sandbox.root, "fixture-environment.json")),
          );
          expect(environment.HOME).toBe(sandbox.root);
          expect(environment.HERDR_SOCKET_PATH).toBe(sandbox.socketPath);
          expect(environment.HERDR_PANE_ID).toBeUndefined();
          expect(environment.NODE_OPTIONS).toBeUndefined();
          expect(environment.API_TOKEN_CLOUDFLARE).toBeUndefined();
          expect(sandbox.client.args).toEqual(["--session", "sdk-evidence"]);
          expect(sandbox.metadata).toMatchObject({
            executable: f.executable,
            clientVersion: "0.8.2",
            clientProtocol: 20,
            serverVersion: "0.8.2",
            serverProtocol: 20,
          });
          expect(sandbox.metadata.executableSha256).toMatch(/^[a-f0-9]{64}$/);
          const config = yield* f.fs.readFileString(join(sandbox.root, "config/herdr/config.toml"));
          expect(config).toContain('shell_mode = "non_login"');
          expect(config).toContain("manifest_check = false");
          yield* Effect.all([sandbox.stop, sandbox.stop], { concurrency: "unbounded" });
          expect(yield* sandbox.cleanup).toEqual({ status: "stopped", method: "graceful" });
          return sandbox.root;
        }),
      );
      expect(yield* f.fs.exists(root)).toBe(false);
    }),
  ));

test("sandbox scope interruption stops the owned server and removes its root", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture();
      const acquired =
        yield* Deferred.make<Effect.Success<ReturnType<typeof startSdkHerdrSandbox>>>();
      const fiber = yield* Effect.gen(function* () {
        const sandbox = yield* startSdkHerdrSandbox({ executable: f.executable });
        yield* Deferred.succeed(acquired, sandbox);
        yield* Effect.never;
      }).pipe(Effect.scoped, Effect.forkChild);
      const sandbox = yield* Deferred.await(acquired);
      yield* Fiber.interrupt(fiber);
      expect(yield* sandbox.cleanup).toEqual({ status: "stopped", method: "graceful" });
      expect(yield* f.fs.exists(sandbox.root)).toBe(false);
    }),
  ));

test(
  "sandbox stalls stop only until bounded owned-child fallback",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const f = yield* fixture("stall-stop");
        const sandbox = yield* startSdkHerdrSandbox({ executable: f.executable });
        yield* sandbox.stop;
        expect(yield* sandbox.cleanup).toEqual({ status: "stopped", method: "owned-child" });
      }),
    ),
  10000,
);

test("sandbox waits for owned child exit after successful CLI shutdown acknowledgement", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture("drain-stop");
      const draining = yield* acquireSandboxDrainGate(f.directory);
      const observed = yield* observeSandboxShutdown;
      const sandbox = yield* startSdkHerdrSandbox({ executable: f.executable }).pipe(
        Effect.provide(observed.layer),
      );
      const stop = yield* sandbox.stop.pipe(Effect.provide(observed.layer), Effect.forkScoped);
      const connection = yield* Deferred.await(draining);
      yield* Deferred.await(observed.acknowledged);
      const decision = yield* Deferred.await(observed.decision);
      // Releasing only after the actual handle decision makes the old kill-before-wait path red.
      yield* Effect.sync(() => connection.end());
      yield* Fiber.join(stop);
      expect(decision).toBe("exit-wait");
      expect(yield* sandbox.cleanup).toEqual({ status: "stopped", method: "graceful" });
    }),
  ));

test("sandbox bounds acknowledged shutdown when the owned child never finishes draining", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture("drain-stop");
      const draining = yield* acquireSandboxDrainGate(f.directory);
      const observed = yield* observeSandboxShutdown;
      const sandbox = yield* startSdkHerdrSandbox({ executable: f.executable }).pipe(
        Effect.provide(observed.layer),
      );
      const stop = yield* sandbox.stop.pipe(
        Effect.provide(observed.layer),
        Effect.timeout("4 seconds"),
        Effect.forkScoped,
      );
      yield* Deferred.await(draining);
      yield* Deferred.await(observed.acknowledged);
      const decision = yield* Deferred.await(observed.decision);
      // Deliberately never release the IPC gate: only the bounded owned-child fallback can finish.
      yield* Fiber.join(stop);
      expect(decision).toBe("exit-wait");
      expect(yield* sandbox.cleanup).toEqual({ status: "stopped", method: "owned-child" });
    }),
  ));

test(
  "sandbox readiness interruption reports cleanup without returning a handle",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const f = yield* fixture("stall-ready");
        const cleanup = yield* Ref.make("unreported");
        const fiber = yield* startSdkHerdrSandbox({
          executable: f.executable,
          onCleanup: (outcome) => Ref.set(cleanup, outcome.status),
        }).pipe(Effect.scoped, Effect.forkChild);
        const marker = join(f.directory, "ready-marker");
        yield* Effect.gen(function* () {
          while (!(yield* f.fs.exists(marker))) yield* Effect.sleep(10);
        }).pipe(Effect.timeout(5000));
        const root = yield* f.fs.readFileString(marker);
        yield* Fiber.interrupt(fiber);
        expect(yield* Ref.get(cleanup)).toBe("stopped");
        expect(yield* f.fs.exists(root)).toBe(false);
      }),
    ),
  10000,
);

test("sandbox reports unavailable executable without accessing ambient Herdr", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const result = yield* startSdkHerdrSandbox({ executable: "/no-such-herdr-sdk-fixture" }).pipe(
        Effect.result,
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.reason).toBe("unavailable");
    }),
  ));

test("sandbox discovers only the private debug application socket", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture("debug");
      const sandbox = yield* startSdkHerdrSandbox({ executable: f.executable });
      expect(sandbox.socketPath).toBe(
        join(sandbox.root, "config/herdr-dev/sessions/sdk-evidence/herdr.sock"),
      );
      expect(sandbox.client.environment.HERDR_SOCKET_PATH).toBe(sandbox.socketPath);
      yield* sandbox.stop;
      expect((yield* sandbox.cleanup).status).toBe("stopped");
    }),
  ));

test("sandbox malformed metadata fails safely and still reports final cleanup", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture("bad-metadata");
      const cleanup = yield* Ref.make("unreported");
      const result = yield* startSdkHerdrSandbox({
        executable: f.executable,
        onCleanup: (outcome) => Ref.set(cleanup, outcome.status),
      }).pipe(Effect.scoped, Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.reason).toBe("metadata-invalid");
        expect(JSON.stringify(result.failure)).not.toContain("private diagnostic sentinel");
      }
      expect(yield* Ref.get(cleanup)).toBe("stopped");
    }),
  ));
