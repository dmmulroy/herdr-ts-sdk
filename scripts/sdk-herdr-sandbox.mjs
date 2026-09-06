import { Data, Effect, FileSystem, Ref, Schema, Semaphore, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

/** Isolated Herdr startup failures never include terminal output or environment values. */
export class SdkHerdrSandboxError extends Data.TaggedError("SdkHerdrSandboxError") {
  /** @param {{operation:string,reason:"invalid-input"|"unavailable"|"process-exit"|"timeout"|"metadata-invalid"|"output-limit",message:string}} input */
  constructor(input) {
    super(input);
    /** Owned sandbox operation that failed, without private session paths. */
    this.operation = input.operation;
    /** Failure classification that keeps acquisition and cleanup outcomes distinct. */
    this.reason = input.reason;
  }
}
/** @param {string} operation @param {SdkHerdrSandboxError["reason"]} reason */
const sandboxFailure = (operation, reason) =>
  new SdkHerdrSandboxError({
    operation,
    reason,
    message:
      "SDK Herdr sandbox could not complete its isolated lifecycle; inspect the classified reason and cleanup outcome before starting another demo.",
  });
/** @typedef {{command:string,args:ReadonlyArray<string>,cwd:string,environment:NodeJS.ProcessEnv}} SdkHerdrSandboxClient */
/** @typedef {{status:"pending"}|{status:"stopped",method:"graceful"|"owned-child"|"not-started"}|{status:"failed",reason:"root-removal"|"owned-child-still-running"|"owned-child-stop"|"cleanup-timeout"}} SdkHerdrSandboxCleanup */

const sandboxVersion = Schema.String.check(Schema.isPattern(/^[0-9][a-zA-Z0-9.+-]{0,79}$/));
const sandboxProtocol = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const parseSandboxStatus = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      client: Schema.Struct({ version: sandboxVersion, protocol: sandboxProtocol }),
      server: Schema.Struct({
        status: Schema.Literal("running"),
        version: sandboxVersion,
        protocol: sandboxProtocol,
      }),
    }),
  ),
);

/** CLI calls are only startup readiness and owned-session shutdown, never demonstration actions. */
const runSandboxCommand = Effect.fnUntraced(
  function* (
    /** @type {SdkHerdrSandboxClient} */ client,
    /** @type {ReadonlyArray<string>} */ args,
    capture = false,
  ) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(client.command, args, {
        cwd: client.cwd,
        env: client.environment,
        extendEnv: false,
        stdin: "ignore",
        stdout: capture ? "pipe" : "ignore",
        stderr: "ignore",
        forceKillAfter: 250,
      }),
    );
    const [code, output] = yield* Effect.all(
      [
        child.exitCode,
        capture
          ? child.stdout.pipe(
              Stream.runFoldEffect(
                () => Buffer.alloc(0),
                (buffer, chunk) =>
                  buffer.length + chunk.length > 16384
                    ? Effect.fail(sandboxFailure("metadata", "output-limit"))
                    : Effect.succeed(Buffer.concat([buffer, chunk])),
              ),
            )
          : Effect.succeed(Buffer.alloc(0)),
      ],
      { concurrency: "unbounded" },
    );
    if (code !== 0) return yield* Effect.fail(sandboxFailure("command", "process-exit"));
    return output.toString("utf8");
  },
  Effect.timeout(2000),
  Effect.scoped,
  Effect.catchTags({
    PlatformError: () => Effect.fail(sandboxFailure("command", "unavailable")),
    TimeoutError: () => Effect.fail(sandboxFailure("command", "timeout")),
  }),
);

/**
 * Starts a fresh isolated Herdr server in the caller's Scope. No ambient session, socket,
 * environment, or working directory is accepted. The optional absolute executable supports
 * offline lifecycle fixtures. Readiness is socket existence plus successful API snapshot,
 * not a claim that an attached TUI has painted. Cleanup remains independently observable.
 * @param {{executable?:string,onCleanup?:(outcome:SdkHerdrSandboxCleanup)=>Effect.Effect<void>}} options
 */
export const startSdkHerdrSandbox = (options = {}) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let command = options.executable;
      if (command === undefined) {
        for (const candidate of [
          "/opt/homebrew/bin/herdr",
          join(homedir(), ".local/bin/herdr"),
          join(homedir(), ".cargo/bin/herdr"),
          "/usr/local/bin/herdr",
          "/usr/bin/herdr",
        ]) {
          if (yield* fs.exists(candidate)) {
            command = candidate;
            break;
          }
        }
      }
      if (command === undefined) return yield* Effect.fail(sandboxFailure("start", "unavailable"));
      if (!isAbsolute(command)) return yield* Effect.fail(sandboxFailure("start", "invalid-input"));
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // Short, private roots keep both API and client sockets within Unix path limits.
      const root = yield* fs.makeTempDirectory({ directory: "/tmp", prefix: "hs-" });
      const cleanup = yield* Ref.make(
        /** @type {SdkHerdrSandboxCleanup} */ ({ status: "pending" }),
      );
      let spawned = false;
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (!spawned) yield* Ref.set(cleanup, { status: "stopped", method: "not-started" });
          const outcome = yield* Ref.get(cleanup);
          if (!spawned || outcome.status === "stopped")
            yield* fs
              .remove(root, { recursive: true })
              .pipe(
                Effect.catchTag("PlatformError", () =>
                  Ref.set(cleanup, { status: "failed", reason: "root-removal" }),
                ),
              );
          if (options.onCleanup) yield* options.onCleanup(yield* Ref.get(cleanup));
        }),
      );
      yield* fs.chmod(root, 0o700);
      const sessionName = "sdk-evidence";
      const configHome = join(root, "config");
      const configPath = join(configHome, "herdr", "config.toml");
      let socketPath = join(configHome, "herdr", "sessions", sessionName, "herdr.sock");
      yield* fs.makeDirectory(join(configHome, "herdr"), { recursive: true });
      yield* fs.writeFileString(
        configPath,
        'onboarding = false\n[terminal]\ndefault_shell = "/bin/sh"\nshell_mode = "non_login"\nnew_cwd = "home"\n[update]\nversion_check = false\nmanifest_check = false\n',
        { mode: 0o600 },
      );
      /** @type {SdkHerdrSandboxClient} */
      const client = {
        command,
        args: ["--session", sessionName],
        cwd: root,
        environment: {
          PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
          HOME: root,
          TMPDIR: root,
          XDG_CONFIG_HOME: configHome,
          XDG_CACHE_HOME: join(root, "cache"),
          XDG_STATE_HOME: join(root, "state"),
          HERDR_CONFIG_PATH: configPath,
          HERDR_SOCKET_PATH: socketPath,
          SHELL: "/bin/sh",
          TERM: "xterm-256color",
          LANG: "en_US.UTF-8",
        },
      };
      const lock = yield* Semaphore.make(1);
      const child = yield* spawner.spawn(
        ChildProcess.make(command, [...client.args, "server"], {
          cwd: root,
          env: client.environment,
          extendEnv: false,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          forceKillAfter: 500,
        }),
      );
      spawned = true;
      const stop = Effect.gen(function* () {
        if ((yield* Ref.get(cleanup)).status !== "pending") return;
        const graceful = yield* Effect.gen(function* () {
          yield* runSandboxCommand(client, ["session", "stop", sessionName]);
          // Stop acknowledgement may precede owned process exit while Herdr drains resources.
          // Share the command's graceful budget; leave time for the bounded forced fallback.
          // A completed signalled exit is still termination, not a failed cleanup.
          yield* child.exitCode.pipe(Effect.result);
        }).pipe(Effect.timeout(2000), Effect.result);
        let method = /** @type {"graceful"|"owned-child"} */ ("graceful");
        if (graceful._tag === "Failure" || (yield* child.isRunning)) {
          method = "owned-child";
          if (yield* child.isRunning) yield* child.kill({ forceKillAfter: 500 });
        }
        // A signalled exit is a PlatformError in the Node adapter, not failed cleanup.
        yield* child.exitCode.pipe(Effect.result);
        if (yield* child.isRunning) {
          yield* Ref.set(cleanup, { status: "failed", reason: "owned-child-still-running" });
          return;
        }
        yield* Ref.set(cleanup, { status: "stopped", method });
      }).pipe(
        Effect.interruptible,
        Effect.timeout(4000),
        Effect.catchTags({
          PlatformError: () => Ref.set(cleanup, { status: "failed", reason: "owned-child-stop" }),
          TimeoutError: () => Ref.set(cleanup, { status: "failed", reason: "cleanup-timeout" }),
        }),
        (effect) => lock.withPermit(effect),
        Effect.uninterruptible,
      );
      yield* Effect.addFinalizer(() => stop);
      yield* restore(
        Effect.gen(function* () {
          while (true) {
            if (!(yield* child.isRunning))
              return yield* Effect.fail(sandboxFailure("ready", "process-exit"));
            // Debug builds use herdr-dev. Probe only two exact paths beneath our private root.
            for (const appDirectory of ["herdr", "herdr-dev"]) {
              const candidate = join(
                configHome,
                appDirectory,
                "sessions",
                sessionName,
                "herdr.sock",
              );
              if (yield* fs.exists(candidate)) {
                socketPath = candidate;
                client.environment.HERDR_SOCKET_PATH = candidate;
                break;
              }
            }
            if (yield* fs.exists(socketPath)) {
              const ready = yield* runSandboxCommand(client, [
                ...client.args,
                "api",
                "snapshot",
              ]).pipe(Effect.result);
              if (ready._tag === "Success") break;
            }
            yield* Effect.sleep(50);
          }
        }).pipe(Effect.timeout(10000)),
      );
      const status = yield* restore(
        Effect.gen(function* () {
          const text = yield* runSandboxCommand(client, [...client.args, "status", "--json"], true);
          return yield* parseSandboxStatus(text).pipe(
            Effect.catchTag("SchemaError", () =>
              Effect.fail(sandboxFailure("metadata", "metadata-invalid")),
            ),
          );
        }),
      );
      // Fingerprint executable bytes, never infer build provenance from an adjacent source tree.
      const fingerprint = yield* restore(
        fs.stream(command).pipe(
          Stream.runFoldEffect(
            () => ({ hash: createHash("sha256"), bytes: 0 }),
            (state, chunk) =>
              state.bytes + chunk.length > 134217728
                ? Effect.fail(sandboxFailure("metadata", "output-limit"))
                : Effect.sync(() => ({
                    hash: state.hash.update(chunk),
                    bytes: state.bytes + chunk.length,
                  })),
          ),
          Effect.timeout(5000),
        ),
      );
      // Server protocol/version are the CLI's actual ping result, not bundled schema claims.
      const metadata = {
        executable: command,
        executableSha256: fingerprint.hash.digest("hex"),
        clientVersion: status.client.version,
        clientProtocol: status.client.protocol,
        serverVersion: status.server.version,
        serverProtocol: status.server.protocol,
      };
      return { root, sessionName, socketPath, client, metadata, stop, cleanup: Ref.get(cleanup) };
    }),
  ).pipe(
    Effect.catchTags({
      PlatformError: () => Effect.fail(sandboxFailure("start", "unavailable")),
      TimeoutError: () => Effect.fail(sandboxFailure("ready", "timeout")),
    }),
  );
