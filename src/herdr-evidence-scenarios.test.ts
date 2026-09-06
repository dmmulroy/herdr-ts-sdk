import { Cause, Console, Effect, Exit, FileSystem, Schema } from "effect";
import { expect, test } from "vite-plus/test";
import { executeHerdrEvidenceRecipe } from "./herdr-evidence-scenarios.ts";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import {
  sdkEvidenceScenarioCatalog,
  sdkEvidenceScenarioResultSchema,
  type SdkEvidenceScenarioResult,
} from "../scripts/sdk-evidence-scenario.mjs";
import { traceSdkExecution } from "../scripts/sdk-telemetry.mjs";
import { verificationNodeLayer } from "../scripts/sdk-verification-process.mjs";

const parseEvidenceScenarioId = Schema.decodeUnknownEffect(
  sdkEvidenceScenarioResultSchema.fields.scenarioId,
);

// This is the only TS loading boundary used by the plain-Node execution bridge.
test("sdk evidence execution", (context) => {
  if (!process.env.HERDR_EVIDENCE_SCENARIO) return;
  return Effect.runPromise(
    Effect.gen(function* () {
      const id = yield* parseEvidenceScenarioId(process.env.HERDR_EVIDENCE_SCENARIO);
      const scenario = sdkEvidenceScenarioCatalog.find((entry) => entry.id === id);
      if (!scenario || !process.env.HERDR_EVIDENCE_RESULT)
        return yield* Effect.die("SDK evidence execution configuration missing");
      const checks: Array<SdkEvidenceScenarioResult["checks"][number]> = [];
      yield* Console.log(`FIXTURE EVIDENCE: ${scenario.title}`);
      const execution = yield* traceSdkExecution(
        {
          kind: "lab",
          name: `sdk learning: ${id}`,
          file: "src/herdr-learning.test.ts",
          enabled: process.env.HERDR_TRACE === "1",
        },
        executeHerdrEvidenceRecipe(id, checks, {
          fixtureFailure: process.env.HERDR_EVIDENCE_FIXTURE_FAILURE === "1",
        }),
      );
      for (const check of checks) {
        yield* Console.log(
          `[${check.chapterId}/${check.id}] ${check.status}: ${check.label}\n  expected=${check.expected}\n  observed=${check.observed}`,
        );
      }
      const product: SdkEvidenceScenarioResult["product"] = Exit.isSuccess(execution.tracedExit)
        ? { status: "passed" }
        : {
            status: Cause.hasInterruptsOnly(execution.tracedExit.cause) ? "interrupted" : "failed",
            errorTag: checks.some((check) => check.status === "failed")
              ? "AssertionFailure"
              : "RecipeFailure",
          };
      const result: SdkEvidenceScenarioResult = {
        scenarioId: id,
        title: scenario.title,
        defaultClaim: scenario.defaultClaim,
        checks,
        chapters: scenario.chapters.map((chapter) => ({
          ...chapter,
          checkIds: checks
            .filter((check) => check.chapterId === chapter.id)
            .map((check) => check.id),
        })),
        product,
        runId: execution.runId,
        traceIds: execution.traceId ? [execution.traceId] : [],
        telemetry: execution.telemetry,
        limitations: [
          "Local fixture evidence only; no live Herdr UI or graphics rendering was exercised.",
          "Trace IDs list the execution root; shared compatibility roots require viewer link discovery.",
          "HTTP export acknowledgement does not prove viewer ingestion.",
        ],
      };
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        `${process.env.HERDR_EVIDENCE_RESULT}.execution`,
        JSON.stringify(result),
        { flag: "wx", mode: 0o600 },
      );
      yield* Console.log(
        `Observed product=${product.status} run=${result.runId} traces=${result.traceIds.join(",") || "none"} telemetry=${result.telemetry.status}`,
      );
      if (process.env.HERDR_EVIDENCE_EXIT_FAILURE === "1")
        return yield* Effect.fail("SdkEvidenceFixtureExitFailure");
      return yield* execution.tracedExit;
    }).pipe(Effect.provide(verificationNodeLayer)),
    { signal: context.signal },
  );
});

test("evidence compatibility observations come from the reusable assertions", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const checks: Array<SdkEvidenceScenarioResult["checks"][number]> = [];
      yield* executeHerdrEvidenceRecipe("compatibility-recovery", checks);
      expect(checks.map((check) => [check.id, check.observed, check.status])).toEqual([
        ["malformed-response", "HerdrInvalidResponse", "passed"],
        ["request-blocked", '["ping"]', "passed"],
        ["compatibility-shared", "2", "passed"],
        ["workspace-recovered", "2", "passed"],
        ["popup-recovered", "1", "passed"],
      ]);
    }),
  ));
