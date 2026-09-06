import { Cause, Console, Data, Effect, Exit, Layer, Stream } from "effect";
import { sdkTraceChildEnvironment, traceSdkExecution } from "./sdk-telemetry.mjs";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";

/** Node verification capabilities: scoped subprocesses, filesystem and native paths, with no package installation. */
export const verificationNodeLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/**
 * @typedef {{cwd?: string | undefined, timeout?: number | undefined, capture?: boolean | undefined, shell?: boolean | undefined, env?: NodeJS.ProcessEnv | undefined, stage?: string | undefined}} VerificationCommandOptions
 * @typedef {{status: "pass" | "fail", detail: string, output: string, stdout: string, stderr: string, exitCode: number | null, error?: import("effect/PlatformError").PlatformError | import("effect/Cause").TimeoutError}} VerificationCommandResult
 */

/**
 * Run a scoped verification subprocess; timeout includes output draining, then bounded process-tree termination.
 * Captured stdout/stderr each retain their last 16KiB; output is their combined tail, not interleaving order.
 * Nonzero exit and typed platform/timeout failures remain explicit results; interruption is never swallowed.
 */
export const runVerificationCommand = Effect.fnUntraced(
  /**
   * @param {string} command
   * @param {ReadonlyArray<string>} args
   * @param {VerificationCommandOptions} options
   * @returns {Effect.fn.Return<VerificationCommandResult, import("effect/PlatformError").PlatformError, ChildProcessSpawner.ChildProcessSpawner | import("effect/Scope").Scope>}
   */
  function* (command, args, { cwd, capture = false, shell = false, env = {} } = {}) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const traceEnvironment = yield* sdkTraceChildEnvironment;
    const handle = yield* spawner.spawn(
      ChildProcess.make(command, args, {
        cwd,
        shell,
        stdin: "ignore",
        stdout: capture ? "pipe" : "inherit",
        stderr: capture ? "pipe" : "inherit",
        env: {
          ...env,
          ...traceEnvironment,
          COREPACK_ENABLE_NETWORK: "0",
          COREPACK_ENABLE_AUTO_PIN: "0",
          npm_config_manage_package_manager_versions: "false",
        },
        extendEnv: true,
        forceKillAfter: "1 second",
      }),
    );
    const [code, stdout, stderr] = yield* Effect.all(
      [
        handle.exitCode,
        capture ? captureVerificationOutput(handle.stdout) : Effect.succeed(""),
        capture ? captureVerificationOutput(handle.stderr) : Effect.succeed(""),
      ],
      { concurrency: "unbounded" },
    );
    return {
      status: code === 0 ? "pass" : "fail",
      detail: code === 0 ? "completed" : `exit ${code}`,
      output: (stdout + stderr).slice(-16_384),
      stdout,
      stderr,
      exitCode: code,
    };
  },
  (effect, _command, _args, { timeout = 120_000, stage = "subprocess" } = {}) =>
    effect.pipe(
      Effect.timeout(timeout),
      Effect.scoped,
      Effect.catchTag("TimeoutError", (error) =>
        Effect.succeed(verificationCommandFailure(error, `timed out after ${timeout}ms`)),
      ),
      Effect.catchTag("PlatformError", (error) =>
        Effect.succeed(
          verificationCommandFailure(error, `Subprocess unavailable (${error.reason._tag})`),
        ),
      ),
      (commandEffect) => traceVerificationResult("sdk.command", stage, commandEffect),
    ),
);

/** Nonzero product exits are failures inside the trace, then restored at the CLI boundary. */
class VerificationExitError extends Data.TaggedError("VerificationExitError") {
  /** @param {{code: number}} options */
  constructor(options) {
    super(options);
    /** Exact product exit code restored after independent telemetry delivery. */
    this.code = options.code;
  }
}

/**
 * Run a CLI composition with scope-owned telemetry and preserve the exact product exit code.
 * No viewer is started; export diagnostics are independent of the product result.
 * @template E, R
 * @param {Parameters<typeof traceSdkExecution>[0]} input
 * @param {Effect.Effect<number, E, R>} effect
 * @returns {Effect.Effect<number, E, Exclude<R, import("effect/Scope").Scope>>}
 */
export function traceVerificationExecution(input, effect) {
  return Effect.gen(function* () {
    /** @type {number | undefined} */
    let productCode;
    const nonzeroExit = new VerificationExitError({ code: 1 });
    const result = yield* traceSdkExecution(
      input,
      Effect.gen(function* () {
        const code = yield* effect;
        productCode = code;
        if (code !== 0) return yield* Effect.fail(nonzeroExit);
        return code;
      }),
    );
    if (result.telemetry.status !== "disabled") {
      yield* Console.error(
        `SDK trace ${result.telemetry.status}: run=${result.runId} trace=${result.traceId ?? "unavailable"}`,
      );
      const viewer = yield* Effect.try(() => {
        const url = new URL(process.env.HERDR_TRACE_VIEWER_URL ?? "http://127.0.0.1:8000");
        if (
          url.protocol !== "http:" ||
          url.hostname !== "127.0.0.1" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/"
        )
          throw new Error("SDK trace viewer URL rejected");
        return url.origin;
      }).pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (viewer !== undefined) {
        yield* Console.error(`SDK trace viewer: ${viewer}`);
        yield* Console.error(
          `SDK trace query: node scripts/sdk-trace-query.mjs list --endpoint ${viewer} --run ${result.runId}`,
        );
      } else {
        yield* Console.error(
          "SDK trace viewer unavailable: HERDR_TRACE_VIEWER_URL must be a loopback HTTP base URL without credentials or query parameters.",
        );
      }
    }
    if (
      productCode !== undefined &&
      Exit.isFailure(result.tracedExit) &&
      result.tracedExit.cause.reasons.every(
        (reason) => Cause.isFailReason(reason) && reason.error === nonzeroExit,
      )
    )
      return productCode;
    return yield* result.tracedExit.pipe(Effect.catchTag("VerificationExitError", Effect.die));
  });
}

/**
 * Give a command or verification stage safe identity and failure status without exporting arguments or output.
 * @template {{status: string}} A
 * @template E, R
 * @param {"sdk.command" | "sdk.verification.stage"} spanName
 * @param {string} name
 * @param {Effect.Effect<A, E, R>} effect
 * @returns {Effect.Effect<A, E, R>}
 */
export function traceVerificationResult(spanName, name, effect) {
  return Effect.gen(function* () {
    /** @type {A | undefined} */
    let stageResult;
    const failedStage = new VerificationExitError({ code: 1 });
    const exit = yield* Effect.exit(
      Effect.gen(function* () {
        const result = yield* effect;
        stageResult = result;
        if (result.status === "fail") return yield* Effect.fail(failedStage);
        return result;
      }).pipe(
        Effect.withSpan(spanName, {
          attributes:
            spanName === "sdk.command" ? { "sdk.command.name": name } : { "sdk.stage.name": name },
        }),
      ),
    );
    if (
      stageResult !== undefined &&
      Exit.isFailure(exit) &&
      exit.cause.reasons.every(
        (reason) => Cause.isFailReason(reason) && reason.error === failedStage,
      )
    )
      return stageResult;
    return yield* exit.pipe(Effect.catchTag("VerificationExitError", Effect.die));
  });
}

/** @param {import("effect/PlatformError").PlatformError | import("effect/Cause").TimeoutError} error @param {string} detail @returns {VerificationCommandResult} */
function verificationCommandFailure(error, detail) {
  return { status: "fail", detail, output: "", stdout: "", stderr: "", exitCode: null, error };
}

/** @param {Stream.Stream<Uint8Array, import("effect/PlatformError").PlatformError>} stream */
function captureVerificationOutput(stream) {
  return stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (text, chunk) => (text + chunk).slice(-16_384),
    ),
  );
}
