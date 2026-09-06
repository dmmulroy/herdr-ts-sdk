import { Cause, Effect, Exit, Schema } from "effect";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "../src/herdr-test-runtime.js";
import {
  acquireSdkTelemetryTestServer,
  sdkTelemetryRecordedSpans,
} from "./sdk-telemetry-test-server.js";
import { traceSdkExecution } from "./sdk-telemetry.mjs";
import {
  runVerificationCommand,
  traceVerificationExecution,
  verificationNodeLayer,
} from "./sdk-verification-process.mjs";

const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const runId = "13944370-21b6-45dc-91e0-1a1db596b527";
const parseChildTraceEnvironment = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      enabled: Schema.String,
      endpoint: Schema.String,
      runId: Schema.String,
      parent: Schema.String,
      explicit: Schema.String,
    }),
  ),
);

test(
  "traced subprocesses explicitly propagate the active span and keep command data out of OTLP",
  (context) =>
    runHerdrTest(
      context,
      Effect.gen(function* () {
        const collector = yield* acquireSdkTelemetryTestServer();
        const traced = yield* traceSdkExecution(
          {
            kind: "verification",
            name: "runtime",
            enabled: true,
            endpoint: collector.endpoint,
            runId,
          },
          runVerificationCommand(
            process.execPath,
            [
              "-e",
              `console.log(JSON.stringify({enabled:process.env.HERDR_TRACE,endpoint:process.env.HERDR_TRACE_ENDPOINT,runId:process.env.HERDR_TRACE_RUN_ID,parent:process.env.TRACEPARENT,explicit:process.env.SDK_TRACE_FIXTURE}))`,
            ],
            {
              cwd: repositoryDirectory,
              capture: true,
              stage: "runtime",
              env: { SDK_TRACE_FIXTURE: "secret-command-marker" },
            },
          ),
        );
        expect(Exit.isSuccess(traced.tracedExit)).toBe(true);
        const command = yield* traced.tracedExit;
        const environment = yield* parseChildTraceEnvironment(command.stdout);
        expect(environment).toMatchObject({
          enabled: "1",
          endpoint: collector.endpoint,
          runId,
          explicit: "secret-command-marker",
        });
        const spans = sdkTelemetryRecordedSpans(collector.requests);
        const stage = spans.find((span) => span.name === "sdk.command");
        expect(stage).toBeDefined();
        expect(environment.parent).toBe(`00-${stage?.traceId}-${stage?.spanId}-01`);
        expect(collector.requests.map((request) => request.body).join("\n")).not.toContain(
          "secret-command-marker",
        );
        expect(command.exitCode).toBe(0);
      }).pipe(Effect.provide(verificationNodeLayer)),
      { enabled: false },
    ),
  15_000,
);

test(
  "disabled subprocess execution preserves explicit environment and produces no OTLP requests",
  (context) =>
    runHerdrTest(
      context,
      Effect.gen(function* () {
        const collector = yield* acquireSdkTelemetryTestServer();
        const traced = yield* traceSdkExecution(
          { kind: "verification", name: "runtime", enabled: false, endpoint: collector.endpoint },
          runVerificationCommand(
            process.execPath,
            [
              "-e",
              "console.log(process.env.TRACEPARENT); console.log(process.env.HERDR_TRACE); process.exitCode = 7",
            ],
            {
              capture: true,
              env: { HERDR_TRACE: "0", TRACEPARENT: "explicit-parent" },
            },
          ),
        );
        const command = yield* traced.tracedExit;
        expect(command.stdout).toBe("explicit-parent\n0\n");
        expect(command.exitCode).toBe(7);
        expect(traced.telemetry.status).toBe("disabled");
        expect(collector.requests).toHaveLength(0);
      }).pipe(Effect.provide(verificationNodeLayer)),
      { enabled: false },
    ),
  15_000,
);

test(
  "traced CLI strips only its trace flag and joins the selected Vitest worker execution",
  (context) =>
    runHerdrTest(
      context,
      Effect.gen(function* () {
        const collector = yield* acquireSdkTelemetryTestServer();
        const result = yield* runVerificationCommand(
          process.execPath,
          [
            "scripts/sdk-verification-cli.mjs",
            "test",
            "run",
            "src/herdr-learning.test.ts",
            "--trace",
            "--testNamePattern",
            "^sdk learning: graphics-writer$",
          ],
          {
            cwd: repositoryDirectory,
            capture: true,
            timeout: 20_000,
            env: {
              HERDR_TRACE: "0",
              HERDR_TRACE_ENDPOINT: collector.endpoint,
              HERDR_TRACE_VIEWER_URL: "http://127.0.0.1:8000",
              HERDR_TRACE_RUN_ID: runId,
              TRACEPARENT: "",
            },
          },
        );
        expect(result.exitCode, result.output).toBe(0);
        expect(stripVTControlCharacters(result.output)).toContain("1 passed | 3 skipped");
        expect(result.output).toContain("SDK trace exported");
        const spans = sdkTelemetryRecordedSpans(collector.requests);
        const roots = spans.filter((span) => span.name === "sdk.execution");
        expect(roots).toHaveLength(2);
        expect(new Set(roots.map((span) => span.traceId)).size).toBe(1);
        expect(
          roots.some((span) =>
            span.attributes.some(
              (attribute) =>
                attribute.key === "sdk.execution.kind" && attribute.value.stringValue === "test",
            ),
          ),
        ).toBe(true);
        expect(
          roots.every((span) =>
            span.attributes.some(
              (attribute) =>
                attribute.key === "sdk.run_id" && attribute.value.stringValue === runId,
            ),
          ),
        ).toBe(true);
        const child = roots.find(
          (span) => span.parentSpanId !== undefined && span.parentSpanId !== "",
        );
        expect(child).toBeDefined();
        expect(spans.some((span) => span.spanId === child?.parentSpanId)).toBe(true);
      }).pipe(Effect.provide(verificationNodeLayer)),
      { enabled: false },
    ),
  25_000,
);

test(
  "traced failures retain failed span status and interruption is never turned into success",
  (context) =>
    runHerdrTest(
      context,
      Effect.gen(function* () {
        const collector = yield* acquireSdkTelemetryTestServer();
        const code = yield* traceVerificationExecution(
          { kind: "verification", name: "runtime", enabled: true, endpoint: collector.endpoint },
          Effect.gen(function* () {
            const result = yield* runVerificationCommand(
              process.execPath,
              ["-e", "process.exitCode = 9"],
              { capture: true, stage: "runtime" },
            );
            return result.exitCode ?? 1;
          }),
        );
        expect(code).toBe(9);
        const spans = sdkTelemetryRecordedSpans(collector.requests);
        expect(spans.find((span) => span.name === "sdk.execution")?.status.code).toBe(2);
        expect(spans.find((span) => span.name === "sdk.command")?.status.code).toBe(2);
        const interrupted = yield* Effect.exit(
          traceVerificationExecution(
            { kind: "verification", name: "runtime", enabled: true, endpoint: collector.endpoint },
            Effect.interrupt,
          ),
        );
        expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(
          true,
        );
      }).pipe(Effect.provide(verificationNodeLayer)),
      { enabled: false },
    ),
  15_000,
);

test(
  "unavailable telemetry preserves the product exit and reports an explicit diagnostic",
  (context) =>
    runHerdrTest(
      context,
      Effect.gen(function* () {
        const collector = yield* acquireSdkTelemetryTestServer({ status: 503 });
        const code = yield* traceVerificationExecution(
          { kind: "verification", name: "runtime", enabled: true, endpoint: collector.endpoint },
          Effect.succeed(7),
        );
        expect(code).toBe(7);
        expect(collector.requests.length).toBeGreaterThan(0);
        expect(collector.requests.length).toBeLessThan(5);
        const result = yield* runVerificationCommand(
          process.execPath,
          ["scripts/sdk-lab.mjs", "--trace", "--scenario", "not-a-recipe"],
          {
            cwd: repositoryDirectory,
            capture: true,
            timeout: 10_000,
            env: {
              HERDR_TRACE: "0",
              HERDR_TRACE_ENDPOINT: collector.endpoint,
              HERDR_TRACE_VIEWER_URL: "http://127.0.0.1:8000",
              TRACEPARENT: "",
            },
          },
        );
        expect(result.exitCode, result.output).toBe(2);
        expect(result.output).toContain("SDK trace unavailable");
        expect(result.output).toContain("SDK trace query:");
        expect(result.output).toContain("SDK lab scenario rejected");
      }).pipe(Effect.provide(verificationNodeLayer)),
      { enabled: false },
    ),
  20_000,
);
