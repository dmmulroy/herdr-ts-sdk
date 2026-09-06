import { Effect, FileSystem, Fiber, Schedule, Schema } from "effect";
import { expect, test } from "vite-plus/test";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { runSdkEvidence, renderSdkEvidence } from "./sdk-evidence-runner.mjs";
import { readSdkEvidenceBundle, renderSdkEvidenceReview } from "./sdk-evidence-bundle.mjs";
import { runVerificationCommand, verificationNodeLayer } from "./sdk-verification-process.mjs";
import { acquireSdkTelemetryTestServer } from "./sdk-telemetry-test-server.js";

const parseEvidenceCliDirectory = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ directory: Schema.String })),
);

test(
  "unrecorded compatibility execution publishes truthful offline evidence",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const parent = yield* fs.makeTempDirectoryScoped({ prefix: "evidence-cli-test-" });
          const result = yield* runSdkEvidence({
            scenarioId: "compatibility-recovery",
            out: parent,
            claim: "<script>untrusted narrative</script>",
          });
          const manifest = yield* readSdkEvidenceBundle(result.directory);
          expect(manifest.outcomes.product.status).toBe("passed");
          expect(manifest.checks.length).toBeGreaterThan(1);
          expect(manifest.outcomes.recording.status).toBe("not-requested");
          expect(manifest.outcomes.viewer.status).toBe("not-requested");
          expect(manifest.outcomes.telemetry.status).toBe("not-requested");
          expect(renderSdkEvidenceReview(manifest).html).not.toContain("<script>");
          expect(yield* fs.exists(`${result.directory}/evidence.incomplete.json`)).toBe(false);
          const rerendered = yield* renderSdkEvidence(result.directory, "walkthrough");
          expect(rerendered.outcomes.render.status).toBe("unavailable");
          expect(rerendered.outcomes.product).toEqual(manifest.outcomes.product);
          expect(rerendered.checks).toEqual(manifest.checks);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
    ),
  30000,
);

test(
  "CLI JSON remains parseable and invalid commands never execute a scenario",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const catalog = yield* runVerificationCommand(
          process.execPath,
          ["scripts/sdk-evidence.mjs", "list", "--json"],
          { capture: true },
        );
        expect(catalog.exitCode).toBe(0);
        expect(() => JSON.parse(catalog.stdout)).not.toThrow();
        expect(catalog.stdout).toContain('"compatibility-recovery"');
        expect(catalog.stdout).toContain('"herdr-sdk-workflow"');
        expect(catalog.stdout).toContain("fresh isolated session");
        expect(catalog.stderr).toBe("");
        const help = yield* runVerificationCommand(
          process.execPath,
          ["scripts/sdk-evidence.mjs", "--help"],
          { capture: true },
        );
        expect(help.exitCode).toBe(0);
        expect(help.stdout).toContain("inspect BUNDLE_DIRECTORY");
        expect(help.stdout).toContain("explicitly consents");
        const unrecordedLive = yield* runVerificationCommand(
          process.execPath,
          ["scripts/sdk-evidence.mjs", "run", "herdr-sdk-workflow", "--json"],
          { capture: true },
        );
        expect(unrecordedLive.exitCode).toBe(1);
        expect(unrecordedLive.stderr).toContain("requires --record");
        for (const [scenario, binary] of [
          ["herdr-sdk-workflow", "relative-herdr"],
          ["compatibility-recovery", "/explicit/herdr"],
        ]) {
          const invalidBinary = yield* runVerificationCommand(
            process.execPath,
            [
              "scripts/sdk-evidence.mjs",
              "run",
              scenario ?? "",
              "--record",
              "--herdr-executable",
              binary ?? "",
              "--json",
            ],
            { capture: true },
          );
          expect(invalidBinary.exitCode).toBe(1);
          expect(invalidBinary.stderr).toContain("absolute binary path");
        }
        for (const option of ["--socket", "--session", "--cwd"]) {
          const ambientTarget = yield* runVerificationCommand(
            process.execPath,
            [
              "scripts/sdk-evidence.mjs",
              "run",
              "herdr-sdk-workflow",
              "--record",
              option,
              "ambient",
              "--json",
            ],
            { capture: true },
          );
          expect(ambientTarget.exitCode).toBe(1);
          expect(ambientTarget.stdout).toContain('"error":"SdkEvidenceCliError"');
        }
        const rejected = yield* runVerificationCommand(
          process.execPath,
          ["scripts/sdk-evidence.mjs", "run", "not-a-scenario", "--json"],
          { capture: true },
        );
        expect(rejected.exitCode).toBe(1);
        expect(rejected.stdout).toContain('"error":"SdkEvidenceRunError"');
        expect(rejected.stderr).toContain("Use evidence list");
        const unsupported = yield* runVerificationCommand(
          process.execPath,
          ["scripts/sdk-evidence.mjs", "inspect", "/tmp", "--record", "--json"],
          { capture: true },
        );
        expect(unsupported.exitCode).toBe(1);
        expect(unsupported.stdout).toContain('"error":"SdkEvidenceCliError"');
      }).pipe(Effect.provide(verificationNodeLayer)),
    ),
  15000,
);

test(
  "interrupted fixture execution leaves incomplete artifacts, never a finalized success",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const parent = yield* fs.makeTempDirectoryScoped({ prefix: "evidence-cli-interrupt-" });
          const fiber = yield* runSdkEvidence({
            scenarioId: "compatibility-recovery",
            out: parent,
          }).pipe(Effect.forkScoped);
          const entries = yield* fs.readDirectory(parent).pipe(
            Effect.repeat({
              schedule: Schedule.spaced("5 millis"),
              while: (entries) => entries.length === 0,
            }),
            Effect.timeout("2 seconds"),
          );
          yield* Fiber.interrupt(fiber);
          const directory = entries[0];
          expect(directory).toBeDefined();
          expect(yield* fs.exists(`${parent}/${directory}/evidence.json`)).toBe(false);
          expect(yield* fs.exists(`${parent}/${directory}/evidence.incomplete.json`)).toBe(true);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
    ),
  10000,
);

test(
  "unavailable collector and viewer preserve emitted IDs without invented bookmarks",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const parent = yield* fs.makeTempDirectoryScoped({
            prefix: "evidence-cli-trace-failure-",
          });
          const collector = yield* acquireSdkTelemetryTestServer({ status: 503 });
          const result = yield* runVerificationCommand(
            process.execPath,
            [
              "scripts/sdk-evidence.mjs",
              "run",
              "compatibility-recovery",
              "--trace",
              "--out",
              parent,
              "--json",
            ],
            {
              capture: true,
              env: {
                HERDR_TRACE_ENDPOINT: collector.endpoint,
                HERDR_TRACE_VIEWER_URL: collector.endpoint.replace("/v1/traces", ""),
              },
            },
          );
          expect(result.exitCode).toBe(0);
          const output = yield* parseEvidenceCliDirectory(result.stdout);
          const manifest = yield* readSdkEvidenceBundle(output.directory);
          expect(manifest.outcomes.product.status).toBe("passed");
          expect(manifest.outcomes.telemetry.status).toBe("unavailable");
          expect(manifest.outcomes.viewer.status).toBe("unavailable");
          expect(manifest.traceIds?.length).toBeGreaterThan(0);
          expect(manifest.traceBookmarks).toHaveLength(0);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
    ),
  15000,
);

test.skipIf(process.env.HERDR_EVIDENCE_RECORD_TEST !== "1")(
  "recorded review pages and poster rerender without changing execution evidence",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const parent = yield* fs.makeTempDirectoryScoped({
            prefix: "evidence-cli-recorded-test-",
          });
          const result = yield* runSdkEvidence({
            scenarioId: "compatibility-recovery",
            out: parent,
            record: true,
          });
          const before = result.manifest;
          expect(before.outcomes.product.status).toBe("passed");
          expect(before.outcomes.recording.status).toBe("passed");
          expect(before.outcomes.render.status).toBe("passed");
          expect(before.outcomes.cleanup.status).toBe("passed");
          const poster = before.artifacts.find((artifact) => artifact.id === "review-poster");
          expect(poster?.kind).toBe("frame");
          if (!poster) return yield* Effect.die("Recorded fixture poster unavailable");
          const bytes = yield* fs.readFile(`${result.directory}/${poster.path}`);
          expect(Buffer.from(bytes.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
          expect(
            before.chapters.every(
              (chapter) =>
                chapter.sourceStartMs !== undefined && chapter.playbackStartMs !== undefined,
            ),
          ).toBe(true);
          const after = yield* renderSdkEvidence(result.directory, "walkthrough");
          expect(after.outcomes.product).toEqual(before.outcomes.product);
          expect(after.source).toEqual(before.source);
          expect(after.checks).toEqual(before.checks);
          expect(after.id).toBe(before.id);
          expect(after.artifacts.find((artifact) => artifact.id === "review-poster")).toEqual(
            poster,
          );
          expect(after.artifacts.filter((artifact) => artifact.kind === "video")).toHaveLength(2);
          expect(after.chapters.map((chapter) => chapter.sourceStartMs)).toEqual(
            before.chapters.map((chapter) => chapter.sourceStartMs),
          );
          expect(after.chapters[0]?.playbackStartMs).toBeGreaterThan(
            before.chapters[0]?.playbackStartMs ?? 0,
          );
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
    ),
  180000,
);
