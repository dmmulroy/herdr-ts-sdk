import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node-shared";
import { Console, Data, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { verificationNodeLayer } from "./sdk-verification-process.mjs";

/** The single evidence catalog; learning declarations retain their existing lab identities. */
export const sdkEvidenceScenarioCatalog = /** @type {const} */ ([
  {
    id: "compatibility-recovery",
    title: "Compatibility failure and recovery",
    defaultClaim:
      "A malformed compatibility response blocks the request; a later attempt recovers.",
    chapters: [
      {
        id: "blocked",
        title: "Initial compatibility failure",
        caption: "Malformed ping blocks request",
      },
      { id: "recovery", title: "Later requests recover", caption: "Recovery shares compatibility" },
    ],
  },
  {
    id: "scoped-subscription",
    title: "Scoped subscription cleanup",
    defaultClaim:
      "A finite event consumer normalizes its event and releases its subscription socket.",
    chapters: [
      { id: "accepted", title: "Accepted domain event", caption: "One normalized event" },
      { id: "cleanup", title: "Subscription cleanup", caption: "Subscription socket closes" },
    ],
  },
  {
    id: "graphics-writer",
    title: "Graphics frame serialization",
    defaultClaim:
      "Concurrent graphics writes serialize complete frames; scope closure invalidates the writer.",
    chapters: [
      { id: "frames", title: "Complete serialized frames", caption: "Two complete fixture frames" },
      { id: "cleanup", title: "Writer scope closes", caption: "Escaped writer rejects writes" },
    ],
  },
  {
    id: "request-wire-result",
    title: "Request wire and result",
    defaultClaim: "Domain input becomes wire input; wire output becomes domain output.",
    chapters: [
      { id: "request", title: "Encoded fixture request", caption: "Domain input becomes wire" },
      { id: "result", title: "Normalized domain result", caption: "Wire output becomes domain" },
    ],
  },
]);
const scenarioIdSchema = Schema.Literals(sdkEvidenceScenarioCatalog.map((scenario) => scenario.id));
const boundedText = Schema.String.check(Schema.isMaxLength(2048));
/** Checks contain fixture-only observations, never generic error or response dumps. */
export const sdkEvidenceCheckSchema = Schema.Struct({
  id: boundedText,
  chapterId: boundedText,
  label: boundedText,
  expected: boundedText,
  observed: boundedText,
  status: Schema.Literals(["passed", "failed"]),
});
/** Serialized execution contract; telemetry acknowledgement is independent of product assertions. */
export const sdkEvidenceScenarioResultSchema = Schema.Struct({
  scenarioId: scenarioIdSchema,
  title: boundedText,
  defaultClaim: boundedText,
  checks: Schema.Array(sdkEvidenceCheckSchema),
  chapters: Schema.Array(
    Schema.Struct({
      id: boundedText,
      title: boundedText,
      caption: boundedText,
      checkIds: Schema.Array(boundedText),
    }),
  ),
  product: Schema.Struct({
    status: Schema.Literals(["passed", "failed", "interrupted"]),
    errorTag: Schema.optionalKey(boundedText),
  }),
  runId: boundedText,
  traceIds: Schema.Array(Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))),
  telemetry: Schema.Struct({
    status: Schema.Literals(["disabled", "exported", "partial", "unavailable"]),
    exported: Schema.Number,
    dropped: Schema.Number,
  }),
  limitations: Schema.Array(boundedText),
});
/** @typedef {typeof sdkEvidenceScenarioResultSchema.Type} SdkEvidenceScenarioResult */
/** @typedef {typeof scenarioIdSchema.Type} SdkEvidenceScenarioId */
/** @typedef {{scenarioId: string, trace?: boolean, gated?: boolean, fixtureFailure?: boolean, fixtureExitFailure?: boolean, resultPath: string}} SdkEvidenceScenarioPreparation */
/** @typedef {{command:string,args:ReadonlyArray<string>,cwd:string,environment:NodeJS.ProcessEnv}} SdkEvidenceScenarioCommand */
const parseScenarioId = Schema.decodeUnknownEffect(scenarioIdSchema);
const parseScenarioResult = Schema.decodeEffect(
  Schema.fromJsonString(sdkEvidenceScenarioResultSchema),
);
const root = fileURLToPath(new URL("../", import.meta.url));

/** Evidence bridge failures contain classified metadata only; inspect partial artifacts before rerunning. */
export class SdkEvidenceScenarioError extends Data.TaggedError("SdkEvidenceScenarioError") {
  /** @param {{reason:"invalid-input"|"unavailable"|"invalid-result"|"child-failed"|"output-limit"}} options */
  constructor(options) {
    super(options);
    /** Scenario failure classification; does not expose subprocess output. */
    this.reason = options.reason;
    /** Recovery guidance preserves uncertain execution rather than authorizing a replay. */
    this.message = `SDK evidence scenario ${options.reason}: inspect the partial execution before rerunning.`;
  }
}

/** Prepare one real Vitest execution, with private fixture HOME and no ambient credentials or Herdr socket. Parent Scope owns the environment directory.
 * @param {SdkEvidenceScenarioPreparation} options
 * @returns {Effect.Effect<SdkEvidenceScenarioCommand, SdkEvidenceScenarioError | import("effect/PlatformError").PlatformError, FileSystem.FileSystem | import("effect/Scope").Scope>}
 */
export function prepareSdkEvidenceScenario(options) {
  return Effect.gen(function* () {
    const scenarioId = yield* parseScenarioId(options.scenarioId).pipe(
      Effect.mapError(() => new SdkEvidenceScenarioError({ reason: "invalid-input" })),
    );
    const fs = yield* FileSystem.FileSystem;
    yield* checkScenarioResultPath(options.resultPath);
    if (yield* fs.exists(options.resultPath))
      return yield* Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-input" }));
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "he-" });
    const environment = {
      PATH: dirname(process.execPath),
      HOME: temporary,
      TMPDIR: temporary,
      TMP: temporary,
      TEMP: temporary,
      LANG: "C.UTF-8",
      TERM: "xterm-256color",
      NO_COLOR: "1",
      CI: "1",
      COREPACK_ENABLE_NETWORK: "0",
      COREPACK_ENABLE_AUTO_PIN: "0",
      npm_config_manage_package_manager_versions: "false",
      HERDR_TRACE: options.trace ? "1" : "0",
    };
    return {
      command: process.execPath,
      args: [
        fileURLToPath(import.meta.url),
        "--scenario",
        scenarioId,
        "--result",
        options.resultPath,
        ...(options.trace ? ["--trace"] : []),
        ...(options.gated ? ["--gated"] : []),
        ...(options.fixtureFailure ? ["--fixture-failure"] : []),
        ...(options.fixtureExitFailure ? ["--fixture-exit-failure"] : []),
      ],
      cwd: root,
      environment: options.trace
        ? {
            ...environment,
            HERDR_TRACE_ENDPOINT: process.env.HERDR_TRACE_ENDPOINT,
            HERDR_TRACE_VIEWER_URL: process.env.HERDR_TRACE_VIEWER_URL,
          }
        : environment,
    };
  });
}

/** Read at most 128KiB of an outside-checkout report and parse before returning it. @param {string} resultPath */
export function readSdkEvidenceScenarioResult(resultPath) {
  return Effect.gen(function* () {
    yield* checkScenarioResultPath(resultPath);
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(resultPath);
    if (
      (yield* fs.realPath(resultPath)) !==
      join(yield* fs.realPath(dirname(resultPath)), resultPath.split(/[\\/]/).at(-1) ?? "")
    )
      return yield* Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-result" }));
    if (stat.size > 131072)
      return yield* Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-result" }));
    const bytes = yield* fs.stream(resultPath).pipe(
      Stream.runFoldEffect(
        () => Buffer.alloc(0),
        (previous, chunk) =>
          previous.byteLength + chunk.byteLength > 131072
            ? Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-result" }))
            : Effect.succeed(Buffer.concat([previous, chunk])),
      ),
    );
    return yield* parseScenarioResult(bytes.toString("utf8"));
  }).pipe(
    Effect.catchTag("SchemaError", () =>
      Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-result" })),
    ),
  );
}

/** Run a scenario once without terminal tools; Node filesystem/process Layers are selected by the caller.
 * @param {{scenarioId:string,trace?:boolean,fixtureFailure?:boolean,fixtureExitFailure?:boolean}} options
 */
export function runSdkEvidenceScenario(options) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "he-" });
      const resultPath = join(temporary, "scenario.json");
      const prepared = yield* prepareSdkEvidenceScenario({ ...options, resultPath });
      const code = yield* executeScenarioCommand(prepared, false);
      const result = yield* readSdkEvidenceScenarioResult(resultPath);
      if (code !== 0 && result.product.status === "passed")
        return yield* Effect.fail(new SdkEvidenceScenarioError({ reason: "child-failed" }));
      return result;
    }),
  ).pipe(Effect.timeout("25 seconds"));
}

/** Reject output in the checkout, including symlinked parents. @param {string} resultPath */
function checkScenarioResultPath(resultPath) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!isAbsolute(resultPath))
      return yield* Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-input" }));
    const parent = yield* fs.realPath(dirname(resultPath));
    const repository = yield* fs.realPath(root);
    const inside = relative(repository, join(parent, "result.json"));
    if (inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)))
      return yield* Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-input" }));
  });
}

/** Drain bounded child output even when not presenting it; no arbitrary shell execution. @param {SdkEvidenceScenarioCommand} prepared @param {boolean} present */
function executeScenarioCommand(prepared, present) {
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(prepared.command, prepared.args, {
          cwd: prepared.cwd,
          env: prepared.environment,
          extendEnv: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "1 second",
        }),
      );
      const drain = (/** @type {typeof child.stdout} */ stream, /** @type {boolean} */ stderr) =>
        stream.pipe(
          Stream.decodeText(),
          Stream.runFoldEffect(
            () => 0,
            (size, chunk) =>
              Effect.gen(function* () {
                const next = size + Buffer.byteLength(chunk);
                if (next > 131072)
                  return yield* Effect.fail(
                    new SdkEvidenceScenarioError({ reason: "output-limit" }),
                  );
                if (present)
                  yield* Effect.sync(() => (stderr ? process.stderr : process.stdout).write(chunk));
                return next;
              }),
          ),
        );
      const [code] = yield* Effect.all(
        [child.exitCode, drain(child.stdout, false), drain(child.stderr, true)],
        { concurrency: "unbounded" },
      );
      // A failed assertion still produces a rich failed result; callers must read that result.
      return code;
    }),
  ).pipe(Effect.timeout("20 seconds"));
}

// Presentation gates run only after the real fixture operation, except the initial start gate.
const waitForEvidenceReviewEnter = Effect.callback(
  /** @param {(effect: Effect.Effect<void, SdkEvidenceScenarioError>) => void} resume */ (
    resume,
  ) => {
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
    };
    const onData = (/** @type {Buffer} */ chunk) => {
      if (chunk.includes(10)) {
        cleanup();
        resume(Effect.void);
      }
    };
    const onEnd = () => {
      cleanup();
      resume(Effect.fail(new SdkEvidenceScenarioError({ reason: "child-failed" })));
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.resume();
    return Effect.sync(cleanup);
  },
).pipe(Effect.timeout("20 seconds"));

/** Fixture-only page values are bounded; complete observations remain in the report. @param {string} text */
function evidenceReviewText(text) {
  // oxlint-disable-next-line no-control-regex -- Strip terminal control characters before presenting fixture observations.
  const singleLine = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  return singleLine.length <= 34 ? singleLine : `${singleLine.slice(0, 22)} [truncated]`;
}

const scenarioCli = Effect.gen(function* () {
  const rawArgs = process.argv.slice(2);
  const gated = rawArgs.includes("--gated");
  const fixtureFailure = rawArgs.includes("--fixture-failure");
  const fixtureExitFailure = rawArgs.includes("--fixture-exit-failure");
  const args = rawArgs.filter(
    (arg) => arg !== "--gated" && arg !== "--fixture-failure" && arg !== "--fixture-exit-failure",
  );
  if (
    args[0] !== "--scenario" ||
    args[2] !== "--result" ||
    !args[1] ||
    !args[3] ||
    (args.length !== 4 && !(args.length === 5 && args[4] === "--trace"))
  )
    return yield* Effect.fail(new SdkEvidenceScenarioError({ reason: "invalid-input" }));
  const prepared = yield* prepareSdkEvidenceScenario({
    scenarioId: args[1],
    resultPath: args[3],
    trace: args[4] === "--trace",
  });
  const vitest = yield* Effect.try({
    try: () => {
      const require = createRequire(import.meta.url);
      const viteRequire = createRequire(require.resolve("vite-plus/package.json"));
      return join(dirname(viteRequire.resolve("vitest/package.json")), "vitest.mjs");
    },
    catch: () => new SdkEvidenceScenarioError({ reason: "unavailable" }),
  });
  if (gated) {
    yield* Console.log("SDK_EVIDENCE_READY");
    yield* waitForEvidenceReviewEnter;
  }
  const code = yield* executeScenarioCommand(
    {
      ...prepared,
      args: [
        vitest,
        "run",
        "src/herdr-evidence-scenarios.test.ts",
        "--testNamePattern",
        "^sdk evidence execution$",
        "--testTimeout",
        "10000",
        "--hookTimeout",
        "5000",
        "--reporter=dot",
      ],
      environment: {
        ...prepared.environment,
        HERDR_EVIDENCE_SCENARIO: args[1],
        HERDR_EVIDENCE_RESULT: args[3],
        HERDR_EVIDENCE_FIXTURE_FAILURE: fixtureFailure ? "1" : "0",
        HERDR_EVIDENCE_EXIT_FAILURE: fixtureExitFailure ? "1" : "0",
      },
    },
    !gated,
  );
  const execution = yield* readSdkEvidenceScenarioResult(`${args[3]}.execution`);
  const result =
    code !== 0 && execution.product.status === "passed"
      ? { ...execution, product: { status: "failed", errorTag: "ChildProcessFailure" } }
      : execution;
  const fs = yield* FileSystem.FileSystem;
  const finalized = `${args[3]}.finalized`;
  yield* fs.writeFileString(finalized, JSON.stringify(result), { flag: "wx", mode: 0o600 });
  // Hard link publishes a complete file atomically and fails rather than replacing another run.
  yield* fs.link(finalized, args[3]);
  yield* fs.remove(finalized);
  yield* fs.remove(`${args[3]}.execution`);
  if (gated) {
    yield* Console.log(
      `\u001b[2J\u001b[HObserved fixture review\n\n${result.title}\n\nSDK already executed once against local fixtures.\nPages review recorded assertions, not a second execution.\nNo live Herdr session or UI was exercised.\n\nProduct: ${result.product.status}\nSDK_EVIDENCE_PAGE_intro`,
    );
    yield* waitForEvidenceReviewEnter;
    for (const chapter of result.chapters) {
      const checks = result.checks.filter((check) => check.chapterId === chapter.id);
      yield* Console.log(
        `\u001b[2J\u001b[HObserved fixture review - ${chapter.title}\nSDK already executed once; observed results below.\n`,
      );
      for (const check of checks) {
        yield* Console.log(
          `${check.status.toUpperCase()} ${check.label}\n  expected: ${evidenceReviewText(check.expected)} | observed: ${evidenceReviewText(check.observed)}`,
        );
      }
      if (checks.length === 0)
        yield* Console.log("No checks reached in this chapter; no success is claimed.");
      yield* Console.log(`\nSDK_EVIDENCE_PAGE_${chapter.id}`);
      yield* waitForEvidenceReviewEnter;
    }
    yield* Console.log(
      `\u001b[2J\u001b[HObserved fixture review complete\n\nProduct: ${result.product.status}\nChecks: ${result.checks.filter((check) => check.status === "passed").length} passed, ${result.checks.filter((check) => check.status === "failed").length} failed\nTelemetry: ${result.telemetry.status} (not viewer confirmation)\nRun: ${result.runId}\nTrace: ${result.traceIds.join(", ") || "none"}\n`,
    );
  }
  yield* Console.log(
    `SDK_EVIDENCE_COMPLETE product=${result.product.status} run=${result.runId} review=${gated ? "shown" : "not-requested"}`,
  );
  if (gated) yield* Effect.sync(() => process.stdin.destroy());
  return code === 0 && result.product.status === "passed" ? 0 : 1;
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scenarioCli.pipe(
    Effect.scoped,
    Effect.catch(() =>
      Console.error("SDK evidence scenario execution unavailable; inspect partial artifacts.").pipe(
        Effect.as(1),
      ),
    ),
    Effect.tap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      }),
    ),
    Effect.provide(verificationNodeLayer),
    NodeRuntime.runMain({ disableErrorReporting: true }),
  );
}
