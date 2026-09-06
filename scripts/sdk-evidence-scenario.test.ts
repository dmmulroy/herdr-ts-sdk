import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Queue, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect, test } from "vite-plus/test";
import {
  prepareSdkEvidenceScenario,
  readSdkEvidenceScenarioResult,
  runSdkEvidenceScenario,
  sdkEvidenceScenarioCatalog,
} from "./sdk-evidence-scenario.mjs";
import { verificationNodeLayer } from "./sdk-verification-process.mjs";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";

for (const scenario of sdkEvidenceScenarioCatalog) {
  test(
    `evidence bridge executes ${scenario.id} against fixtures`,
    (context) =>
      runSdkToolingTest(
        context,
        Effect.gen(function* () {
          const result = yield* runSdkEvidenceScenario({ scenarioId: scenario.id });
          expect(result.product).toEqual({ status: "passed" });
          expect(result.checks.length).toBeGreaterThan(0);
          expect(result.checks.every((check) => check.status === "passed")).toBe(true);
          expect(result.telemetry.status).toBe("disabled");
          expect(result.traceIds).toEqual([]);
          expect(result.chapters.every((chapter) => chapter.caption.length <= 32)).toBe(true);
        }).pipe(Effect.provide(verificationNodeLayer)),
      ),
    30000,
  );
}

test(
  "evidence failed assertions survive nonzero Vitest exit with actual observed error",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const result = yield* runSdkEvidenceScenario({
          scenarioId: "compatibility-recovery",
          fixtureFailure: true,
        });
        expect(result.product).toEqual({ status: "failed", errorTag: "AssertionFailure" });
        expect(result.checks).toHaveLength(1);
        expect(result.checks[0]).toMatchObject({
          id: "malformed-response",
          status: "failed",
          expected: "HerdrInvalidResponse",
        });
        expect(result.checks[0]?.observed).not.toBe("HerdrInvalidResponse");
        expect(result.checks[0]?.observed).toMatch(/^Herdr[A-Za-z]+$/);
        expect(result.chapters.find((chapter) => chapter.id === "recovery")?.checkIds).toEqual([]);
      }).pipe(Effect.provide(verificationNodeLayer)),
    ),
  30000,
);

test(
  "a passed execution report cannot hide nonzero Vitest exit",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const result = yield* runSdkEvidenceScenario({
          scenarioId: "compatibility-recovery",
          fixtureExitFailure: true,
        });
        expect(result.checks).toHaveLength(5);
        expect(result.checks.every((check) => check.status === "passed")).toBe(true);
        expect(result.product).toEqual({ status: "failed", errorTag: "ChildProcessFailure" });
      }).pipe(Effect.provide(verificationNodeLayer)),
    ),
  30000,
);

test("evidence preparation rejects checkout writes and isolates inherited environment", (context) =>
  runSdkToolingTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "he-" });
        const prepared = yield* prepareSdkEvidenceScenario({
          scenarioId: "compatibility-recovery",
          resultPath: join(temporary, "result.json"),
        });
        expect(prepared.environment.HERDR_TRACE).toBe("0");
        expect(prepared.environment).not.toHaveProperty("HERDR_SOCKET_PATH");
        expect(prepared.environment).not.toHaveProperty("NODE_OPTIONS");
        expect(prepared.environment.HOME).not.toBe(process.env.HOME);
        const rejected = yield* prepareSdkEvidenceScenario({
          scenarioId: "compatibility-recovery",
          resultPath: fileURLToPath(new URL("../evidence-result.json", import.meta.url)),
        }).pipe(Effect.exit);
        expect(Exit.isFailure(rejected)).toBe(true);
        yield* fs.writeFileString(join(temporary, "existing.json"), "do not overwrite");
        expect(
          Exit.isFailure(
            yield* prepareSdkEvidenceScenario({
              scenarioId: "compatibility-recovery",
              resultPath: join(temporary, "existing.json"),
            }).pipe(Effect.exit),
          ),
        ).toBe(true);
        expect(yield* fs.readFileString(join(temporary, "existing.json"))).toBe("do not overwrite");
      }),
    ).pipe(Effect.provide(verificationNodeLayer)),
  ));

test("evidence report reads reject malformed, oversized and symlinked files", (context) =>
  runSdkToolingTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "he-" });
        const report = join(temporary, "result.json");
        yield* fs.writeFileString(report, "{broken");
        expect(Exit.isFailure(yield* readSdkEvidenceScenarioResult(report).pipe(Effect.exit))).toBe(
          true,
        );
        yield* fs.writeFileString(report, " ".repeat(131073));
        expect(Exit.isFailure(yield* readSdkEvidenceScenarioResult(report).pipe(Effect.exit))).toBe(
          true,
        );
        const link = join(temporary, "link.json");
        yield* fs.symlink(report, link);
        expect(Exit.isFailure(yield* readSdkEvidenceScenarioResult(link).pipe(Effect.exit))).toBe(
          true,
        );
      }),
    ).pipe(Effect.provide(verificationNodeLayer)),
  ));

test(
  "gated recording waits for newline before executing and publishes one completed report",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "he-" });
          const report = join(temporary, "result.json");
          const prepared = yield* prepareSdkEvidenceScenario({
            scenarioId: "compatibility-recovery",
            resultPath: report,
            gated: true,
          });
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const ready = yield* Deferred.make<void>();
          const input = yield* Queue.unbounded<Uint8Array, Cause.Done>();
          const pages = yield* Effect.forEach(["intro", "blocked", "recovery"], (id) =>
            Deferred.make<void>().pipe(Effect.map((signal) => ({ id, signal }))),
          );
          const child = yield* spawner.spawn(
            ChildProcess.make(prepared.command, prepared.args, {
              cwd: prepared.cwd,
              env: prepared.environment,
              extendEnv: false,
              stdin: Stream.fromQueue(input),
              stdout: "pipe",
              stderr: "pipe",
              forceKillAfter: "1 second",
            }),
          );
          const output = yield* child.stdout.pipe(
            Stream.decodeText(),
            Stream.runFoldEffect(
              () => "",
              (text, chunk) =>
                Effect.gen(function* () {
                  const next = text + chunk;
                  if (next.includes("SDK_EVIDENCE_READY"))
                    yield* Deferred.succeed(ready, undefined);
                  for (const page of pages)
                    if (next.includes(`SDK_EVIDENCE_PAGE_${page.id}`))
                      yield* Deferred.succeed(page.signal, undefined);
                  return next.slice(-32768);
                }),
            ),
            Effect.forkScoped,
          );
          yield* child.stderr.pipe(Stream.runDrain, Effect.forkScoped);
          yield* Deferred.await(ready);
          expect(yield* fs.exists(report)).toBe(false);
          expect(yield* fs.exists(`${report}.execution`)).toBe(false);
          yield* Queue.offer(input, new TextEncoder().encode("\n"));
          for (const page of pages) {
            yield* Deferred.await(page.signal);
            expect((yield* readSdkEvidenceScenarioResult(report)).product.status).toBe("passed");
            yield* Queue.offer(input, new TextEncoder().encode("\n"));
          }
          yield* Queue.end(input);
          expect(yield* child.exitCode).toBe(0);
          const text = yield* Fiber.join(output);
          const result = yield* readSdkEvidenceScenarioResult(report);
          expect(text.match(/SDK_EVIDENCE_COMPLETE/g)).toHaveLength(1);
          expect(text).toContain(`run=${result.runId}`);
          expect(text).toContain("observed: HerdrInvalidResponse");
          expect(text).toContain("SDK already executed once");
          expect(text).not.toContain("Test Files");
          expect(result.product.status).toBe("passed");
        }),
      ).pipe(Effect.timeout("25 seconds"), Effect.provide(verificationNodeLayer)),
    ),
  30000,
);
