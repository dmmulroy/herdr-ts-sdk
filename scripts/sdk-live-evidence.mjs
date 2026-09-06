import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect, FileSystem, Schedule, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { sdkEvidenceScenarioResultSchema } from "./sdk-evidence-scenario.mjs";

/** Live results preserve the fixture result fields without misclassifying the execution. */
export const sdkLiveEvidenceResultSchema = Schema.Struct({
  ...sdkEvidenceScenarioResultSchema.fields,
  scenarioId: Schema.Literal("herdr-sdk-workflow"),
});
/** @typedef {typeof sdkLiveEvidenceResultSchema.Type} SdkLiveEvidenceResult */
/** Bounded gate messages: before precedes the action; observed follows SDK assertions, not UI paint. */
export const sdkLiveEvidenceStepSchema = Schema.Struct({
  id: Schema.Literals([
    "landing",
    "create-tab",
    "split-pane",
    "run-left",
    "run-right",
    "close-split",
    "close-tab",
  ]),
  phase: Schema.Literals(["before", "observed"]),
  caption: Schema.String.check(Schema.isMaxLength(32), Schema.isPattern(/^[\x20-\x7e]+$/)),
  expectedText: Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(
    Schema.isMaxLength(8),
  ),
  absentText: Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(
    Schema.isMaxLength(8),
  ),
});
/** @typedef {typeof sdkLiveEvidenceStepSchema.Type} SdkLiveEvidenceStep */
/** Private subprocess configuration; never populated from ambient Herdr caller context. */
export const sdkLiveEvidenceConfigSchema = Schema.Struct({
  socketPath: Schema.String,
  root: Schema.String,
  directory: Schema.String,
  trace: Schema.Boolean,
});
const decodeSdkLiveEvidenceConfig = Schema.decodeEffect(
  Schema.fromJsonString(sdkLiveEvidenceConfigSchema),
);
/** Decode configuration only at the explicit Vitest subprocess boundary; library parse options stay private.
 * @param {string} input
 * @returns {Effect.Effect<typeof sdkLiveEvidenceConfigSchema.Type, Schema.SchemaError>}
 */
export function parseSdkLiveEvidenceConfig(input) {
  return decodeSdkLiveEvidenceConfig(input);
}
const parseLiveStep = Schema.decodeEffect(Schema.fromJsonString(sdkLiveEvidenceStepSchema));
const parseLiveResult = Schema.decodeEffect(Schema.fromJsonString(sdkLiveEvidenceResultSchema));
const repository = fileURLToPath(new URL("../", import.meta.url));

/** Classified bridge failure; an uncertain action is never automatically replayed. */
export class SdkLiveEvidenceError extends Data.TaggedError("SdkLiveEvidenceError") {
  /** @param {{reason:"unsafe-target"|"unavailable"|"invalid-message"|"child-failed"|"output-limit"}} options */
  constructor(options) {
    super(options);
    /** Bridge failure classification; uncertain actions must not be replayed automatically. */
    this.reason = options.reason;
    /** Bounded recovery guidance without subprocess output or private paths. */
    this.message = `SDK live evidence ${options.reason}: inspect the owned session and partial artifacts; do not replay uncertain actions.`;
  }
}

/** Publish complete private gate/result JSON by rename, so readers never parse partial writes.
 * @param {string} path @param {string} content
 */
export function publishSdkLiveEvidenceJson(path, content) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${path}.pending`, content, { flag: "wx", mode: 0o600 });
    yield* fs.rename(`${path}.pending`, path);
  });
}

/** Execute the SDK workflow once in the installed Vitest TS loader. Caller owns the isolated sandbox and UI recorder.
 * Every callback must finish successfully to authorize the next action. No callback is retried.
 * @template E, R
 * @param {{socketPath:string,root:string,trace?:boolean,onStep:(step:SdkLiveEvidenceStep)=>Effect.Effect<void,E,R>}} options
 */
export function runSdkLiveEvidence(options) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const inside = (/** @type {string} */ parent, /** @type {string} */ child) => {
        const path = relative(parent, child);
        return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
      };
      if (!isAbsolute(options.root) || !isAbsolute(options.socketPath))
        return yield* Effect.fail(new SdkLiveEvidenceError({ reason: "unsafe-target" }));
      const root = yield* fs.realPath(options.root);
      const socketParent = yield* fs.realPath(dirname(options.socketPath));
      const checkout = yield* fs.realPath(repository);
      const temporaryRoot = yield* fs.realPath(tmpdir());
      const privateTmp = yield* fs.realPath("/tmp");
      const socket = yield* fs.realPath(options.socketPath);
      if (
        (!inside(temporaryRoot, root) && !inside(privateTmp, root)) ||
        !inside(root, socket) ||
        !inside(root, join(socketParent, "socket")) ||
        root === checkout ||
        inside(checkout, root)
      )
        return yield* Effect.fail(new SdkLiveEvidenceError({ reason: "unsafe-target" }));
      const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: "workflow-" });
      const vitest = yield* Effect.try({
        try: () => {
          const require = createRequire(import.meta.url);
          const viteRequire = createRequire(require.resolve("vite-plus/package.json"));
          return join(dirname(viteRequire.resolve("vitest/package.json")), "vitest.mjs");
        },
        catch: () => new SdkLiveEvidenceError({ reason: "unavailable" }),
      });
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            vitest,
            "run",
            "src/herdr-live-evidence.test.ts",
            "--testNamePattern",
            "^sdk isolated live evidence execution$",
            "--testTimeout",
            "120000",
            "--reporter=dot",
          ],
          {
            cwd: repository,
            env: {
              PATH: dirname(process.execPath),
              HOME: directory,
              TMPDIR: directory,
              LANG: "C.UTF-8",
              CI: "1",
              NO_COLOR: "1",
              HERDR_LIVE_EVIDENCE_CONFIG: JSON.stringify({
                socketPath: options.socketPath,
                root,
                directory,
                trace: options.trace ?? false,
              }),
              HERDR_TRACE: options.trace ? "1" : "0",
              HERDR_TRACE_ENDPOINT: options.trace ? process.env.HERDR_TRACE_ENDPOINT : undefined,
              HERDR_TRACE_VIEWER_URL: options.trace
                ? process.env.HERDR_TRACE_VIEWER_URL
                : undefined,
            },
            extendEnv: false,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            forceKillAfter: "1 second",
          },
        ),
      );
      const drain = (/** @type {typeof child.stdout} */ stream) =>
        stream.pipe(
          Stream.runFoldEffect(
            () => 0,
            (size, chunk) =>
              size + chunk.length > 131072
                ? Effect.fail(new SdkLiveEvidenceError({ reason: "output-limit" }))
                : Effect.succeed(size + chunk.length),
          ),
        );
      const gates = Effect.gen(function* () {
        for (let index = 0; ; index++) {
          const path = join(directory, `step-${index}.json`);
          yield* Effect.gen(function* () {
            if (yield* fs.exists(path)) return true;
            if (yield* fs.exists(join(directory, "result.json"))) return true;
            if (!(yield* child.isRunning)) return true;
            return false;
          }).pipe(
            Effect.repeat({ schedule: Schedule.spaced("20 millis"), until: (ready) => ready }),
          );
          if (!(yield* fs.exists(path))) break;
          const step = yield* readLiveJson(path, parseLiveStep);
          yield* options.onStep(step);
          yield* publishSdkLiveEvidenceJson(join(directory, `ack-${index}.json`), "true");
        }
      });
      const [code] = yield* Effect.all(
        [child.exitCode, drain(child.stdout), drain(child.stderr), gates],
        { concurrency: "unbounded" },
      );
      if (!(yield* fs.exists(join(directory, "result.json"))))
        return yield* Effect.fail(new SdkLiveEvidenceError({ reason: "child-failed" }));
      const result = yield* readLiveJson(join(directory, "result.json"), parseLiveResult);
      return code !== 0 && result.product.status === "passed"
        ? {
            ...result,
            product: { status: /** @type {const} */ ("failed"), errorTag: "ChildProcessFailure" },
          }
        : result;
    }),
  ).pipe(Effect.timeout("130 seconds"));
}

/** Bound private JSON before decoding at the process boundary.
 * @template A, E, R @param {string} path @param {(text:string)=>Effect.Effect<A,E,R>} parse
 */
function readLiveJson(path, parse) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if ((yield* fs.stat(path)).size > 131072)
      return yield* Effect.fail(new SdkLiveEvidenceError({ reason: "invalid-message" }));
    const bytes = yield* fs.stream(path).pipe(
      Stream.runFoldEffect(
        () => Buffer.alloc(0),
        (previous, chunk) =>
          previous.byteLength + chunk.byteLength > 131072
            ? Effect.fail(new SdkLiveEvidenceError({ reason: "invalid-message" }))
            : Effect.succeed(Buffer.concat([previous, chunk])),
      ),
    );
    return yield* parse(bytes.toString("utf8"));
  });
}
