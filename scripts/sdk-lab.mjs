import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node-shared";
import { Console, Effect, FileSystem, Schema } from "effect";
import {
  runVerificationCommand,
  traceVerificationExecution,
  verificationNodeLayer,
} from "./sdk-verification-process.mjs";
const parseRecipeResult = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      numPassedTests: Schema.Literal(1),
      numFailedTests: Schema.Literal(0),
    }),
  ),
);

const runSdkLab = Effect.fn("runSdkLab")(function* () {
  const args = process.argv.slice(2).filter((arg) => arg !== "--trace");
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    yield* Console.log(
      "Usage: node scripts/sdk-lab.mjs --list | --scenario <exact-id> [--trace]\nLocal fixtures only; 20s process budget, no live socket options.\n--trace exports to HERDR_TRACE_ENDPOINT; no implicit viewer startup or installation.\nRecipes: src/herdr-learning.test.ts (hypothesis, controls, assertions).",
    );
    return 0;
  }
  if (
    !(args.length === 1 && args[0] === "--list") &&
    !(args.length === 2 && args[0] === "--scenario")
  ) {
    yield* Console.error(
      "SDK lab arguments rejected: use --help or an exact --scenario from --list.",
    );
    return 2;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(join(root, "src/herdr-learning.test.ts"));
  // Literal recipe declarations are the catalog; no TypeScript loader or duplicate inventory.
  const scenarios = new Map(
    [...source.matchAll(/\/\/ Hypothesis: ([^\n]+)\n\s*test\(\s*"sdk learning: ([a-z-]+)"/g)].map(
      (match) => [match[2], match[1]],
    ),
  );
  if (scenarios.size === 0) {
    yield* Console.error(
      "SDK lab catalog empty: expected recipe declarations with hypothesis comments.",
    );
    return 1;
  }
  if (args[0] === "--list") {
    for (const [id, description] of scenarios) yield* Console.log(`${id}: ${description}`);
    return 0;
  }
  if (!scenarios.has(args[1])) {
    yield* Console.error("SDK lab scenario rejected: choose an exact ID from --list.");
    return 2;
  }
  const vitest = yield* Effect.try({
    try: () => {
      const require = createRequire(import.meta.url);
      const vitePlusRequire = createRequire(require.resolve("vite-plus/package.json"));
      return join(dirname(vitePlusRequire.resolve("vitest/package.json")), "vitest.mjs");
    },
    catch: () =>
      new Error(
        "SDK lab unavailable: installed vite-plus/Vitest is required; no packages were downloaded.",
      ),
  });
  // Short prefixes matter on macOS; parent scope removes the tree even after forced termination.
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "hl-" });
  const report = join(temporary, "result.json");
  const result = yield* runVerificationCommand(
    process.execPath,
    [
      vitest,
      "run",
      "src/herdr-learning.test.ts",
      "--testNamePattern",
      `^sdk learning: ${args[1]}$`,
      "--testTimeout",
      "5000",
      "--hookTimeout",
      "5000",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${report}`,
    ],
    {
      cwd: root,
      stage: "lab.recipe",
      timeout: 20_000,
      env: { TMPDIR: temporary, TMP: temporary, TEMP: temporary },
    },
  );
  if (result.error?._tag === "TimeoutError") {
    yield* Console.error("SDK lab deadline exceeded: stopped the local recipe.");
    return 124;
  }
  if (result.status === "fail") return result.exitCode ?? 1;
  // Vitest can exit zero when -t matches nothing. Require exactly one passing assertion-bearing recipe.
  yield* fs.readFileString(report).pipe(Effect.flatMap(parseRecipeResult));
  return 0;
});

traceVerificationExecution(
  {
    kind: "lab",
    name: "lab",
    enabled: process.argv.includes("--trace") || process.env.HERDR_TRACE === "1",
  },
  runSdkLab(),
).pipe(
  Effect.scoped,
  Effect.catch(() =>
    Console.error(
      "SDK lab failed: local setup, recipe report, or cleanup was invalid; installed dependencies are required.",
    ).pipe(Effect.as(1)),
  ),
  Effect.tap((code) =>
    Effect.sync(() => {
      process.exitCode = code;
    }),
  ),
  Effect.provide(verificationNodeLayer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
