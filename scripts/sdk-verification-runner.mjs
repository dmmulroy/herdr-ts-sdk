import { Config, Effect, FileSystem, Schema } from "effect";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVerificationProtocol } from "./sdk-verification-metadata.mjs";
import {
  runVerificationCommand,
  traceVerificationExecution,
  traceVerificationResult,
  verificationNodeLayer,
} from "./sdk-verification-process.mjs";

const directory = fileURLToPath(new URL("../", import.meta.url));
const directCli = join(directory, "scripts/sdk-verification-cli.mjs");
const allowedModes = ["quick", "full", "generated"];
const args = process.argv.slice(2).filter((arg) => arg !== "--trace");
const trace = process.argv.includes("--trace") || process.env.HERDR_TRACE === "1";
const mode = args[0] ?? "full";
/** @param {string} name @param {{status: string, detail: string}} result */
const report = (name, result) =>
  console.log(`${result.status.toUpperCase()} ${name}: ${result.detail}`);

const checkGeneratedDrift = Effect.fn("checkGeneratedDrift")(
  /** @param {number} timeout */
  function* (timeout) {
    const fs = yield* FileSystem.FileSystem;
    const protocol = yield* checkVerificationProtocol(directory);
    report("protocol", protocol);
    if (protocol.status !== "pass") return protocol;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "herdr-sdk-generated-" });
    const generated = join(temporary, "generated");
    const generation = yield* runVerificationCommand(
      process.execPath,
      [join(directory, "scripts/generate-wire-types.mjs"), "--output-dir", generated],
      { cwd: directory, timeout, stage: "generated.generate" },
    );
    if (generation.status !== "pass") return generation;
    const format = yield* runVerificationCommand(process.execPath, [directCli, "fmt", generated], {
      cwd: directory,
      timeout,
      stage: "generated.format",
    });
    if (format.status !== "pass") return format;
    const expected = (yield* fs.readDirectory(generated)).sort();
    const trackedDirectory = join(directory, "src/generated");
    const actual = (yield* fs.readDirectory(trackedDirectory)).sort();
    const missing = expected.filter((file) => !actual.includes(file));
    const stale = actual.filter((file) => !expected.includes(file));
    const changed = [];
    for (const file of expected.filter((file) => actual.includes(file))) {
      const expectedSource = yield* fs.readFileString(join(generated, file));
      const actualSource = yield* fs.readFileString(join(trackedDirectory, file));
      if (expectedSource !== actualSource) changed.push(file);
    }
    if (missing.length || stale.length || changed.length) {
      return {
        status: "fail",
        detail: `Generated drift; missing=[${missing.join(", ")}], stale=[${stale.join(", ")}], changed=[${changed.join(", ")}]. Run pnpm run generate explicitly.`,
      };
    }
    return {
      status: "pass",
      detail: `${expected.length} generated files match; checkout not rewritten`,
    };
  },
  Effect.scoped,
);

const verifySdk = Effect.gen(function* () {
  if ((mode === "--help" || mode === "-h") && args.length === 1) {
    console.log("Verification usage: node scripts/sdk-verify.mjs [quick|full|generated] [--trace]");
    console.log(
      "--trace: export local telemetry using HERDR_TRACE_ENDPOINT; never starts or installs a viewer.",
    );
    console.log(
      "quick: read-only format, lint, types, public docs and examples; skips generated/runtime/package.",
    );
    console.log(
      "full (default): quick plus temporary generation drift, runtime tests and required isolated package smoke.",
    );
    console.log(
      "generated: protocol metadata and byte/file-set drift using a disposable output directory.",
    );
    console.log(
      "HERDR_VERIFY_TIMEOUT_MS: per-stage deadline, integer 1..600000 (default 120000), plus bounded subprocess cleanup.",
    );
    console.log(
      "No installs, fixes, checkout builds or live Herdr connections. Failures do not hide later stage results.",
    );
    return 0;
  }
  if (!allowedModes.includes(mode) || args.length > 1) {
    console.error(
      "Verification usage: node scripts/sdk-verify.mjs [quick|full|generated] [--trace]",
    );
    return 2;
  }
  const timeout = yield* Config.schema(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 600_000 })),
    "HERDR_VERIFY_TIMEOUT_MS",
  ).pipe(Config.withDefault(120_000));
  /** @param {ReadonlyArray<string>} args */
  const node = (args) =>
    runVerificationCommand(process.execPath, args, { cwd: directory, timeout });
  /** @type {Array<[string, Effect.Effect<{status: string, detail: string}, import("effect/PlatformError").PlatformError, FileSystem.FileSystem | import("effect/unstable/process/ChildProcessSpawner").ChildProcessSpawner>]>} */
  const stages =
    mode === "generated"
      ? []
      : [
          ["format", node([directCli, "fmt", "--check"])],
          ["lint", node([directCli, "lint"])],
          [
            "types",
            node([
              join(directory, "node_modules/typescript/bin/tsc"),
              "--noEmit",
              "--incremental",
              "false",
            ]),
          ],
          ["public docs", node([join(directory, "scripts/check-public-jsdoc.mjs")])],
          [
            "examples",
            node([
              join(directory, "node_modules/typescript/bin/tsc"),
              "--project",
              "examples/tsconfig.json",
              "--noEmit",
              "--incremental",
              "false",
            ]),
          ],
        ];
  if (mode !== "quick") stages.push(["generated", checkGeneratedDrift(timeout)]);
  if (mode === "full") {
    stages.push(["runtime", node([directCli, "test", "run"])]);
    stages.push(["package", node([join(directory, "scripts/check-package.mjs")])]);
  }
  let failed = false;
  for (const [name, stage] of stages) {
    console.log(`RUN ${name} (deadline ${timeout}ms)`);
    const result = yield* traceVerificationResult(
      "sdk.verification.stage",
      name === "public docs" ? "public.docs" : name,
      stage.pipe(
        Effect.timeout(timeout),
        Effect.catch((error) =>
          Effect.succeed({ status: "fail", detail: `Verification stage failed (${error._tag})` }),
        ),
      ),
    );
    report(name, result);
    if (result.status === "fail") failed = true;
  }
  if (mode === "quick") {
    report("generated, runtime, package", {
      status: "skipped",
      detail: "quick mode; run pnpm run verify for full coverage",
    });
  }
  console.log(`${failed ? "FAIL" : "PASS"} verification (${mode})`);
  return failed ? 1 : 0;
});

NodeRuntime.runMain(
  traceVerificationExecution(
    { kind: "verification", name: "verify", enabled: trace },
    verifySdk,
  ).pipe(
    Effect.tap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      }),
    ),
    Effect.provide(verificationNodeLayer),
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(
          `FAIL verification configuration (${error._tag}); HERDR_VERIFY_TIMEOUT_MS must be an integer from 1 to 600000.`,
        );
        process.exitCode = 1;
      }),
    ),
  ),
);
