import { Deferred, Effect, Fiber, FileSystem, Layer, PlatformError } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { expect, test } from "vite-plus/test";
import { verificationNodeLayer } from "./sdk-verification-process.mjs";
import { renderSdkEvidence, runSdkEvidence } from "./sdk-evidence-runner.mjs";
import { readSdkEvidenceBundle } from "./sdk-evidence-bundle.mjs";

/** Only source fingerprint Git reads can spawn; a regressed preflight still cannot launch Herdr. */
const unavailableProcesses = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return ChildProcessSpawner.make((command) =>
      command._tag === "StandardCommand" &&
      command.command === "git" &&
      command.args[0] === "--no-optional-locks" &&
      command.args[1] === "-C" &&
      command.args[2] === process.cwd() &&
      (JSON.stringify(command.args.slice(3)) === JSON.stringify(["rev-parse", "HEAD"]) ||
        JSON.stringify(command.args.slice(3)) ===
          JSON.stringify(["status", "--porcelain", "--untracked-files=normal"]))
        ? spawner.spawn(command)
        : Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "ChildProcessSpawner",
              method: "spawn",
              description: "Tool acquisition disabled in the unavailable-recorder fixture",
            }),
          ),
    );
  }),
);

test(
  "interruption during live recorder preflight never publishes success or starts a sandbox",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const out = yield* fs.makeTempDirectoryScoped({ prefix: "live-evidence-interrupt-" });
          const entered = yield* Deferred.make<void>();
          const pausedRecorder = Layer.succeed(
            FileSystem.FileSystem,
            FileSystem.FileSystem.of({
              ...fs,
              exists: (path) =>
                path.endsWith("/termctrl")
                  ? Effect.gen(function* () {
                      yield* Deferred.succeed(entered, undefined);
                      return yield* Effect.never;
                    })
                  : fs.exists(path),
            }),
          );
          const fiber = yield* runSdkEvidence({
            scenarioId: "herdr-sdk-workflow",
            record: true,
            out,
          }).pipe(Effect.provide([pausedRecorder, unavailableProcesses]), Effect.forkScoped);
          yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
          yield* Fiber.interrupt(fiber);
          const entries = yield* fs.readDirectory(out);
          expect(entries).toHaveLength(1);
          expect(yield* fs.exists(`${out}/${entries[0]}/evidence.incomplete.json`)).toBe(true);
          expect(yield* fs.exists(`${out}/${entries[0]}/evidence.json`)).toBe(false);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
    ),
  10000,
);

test(
  "unlaunchable real recorder publishes unavailable isolated evidence without fixture fallback",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const out = yield* fs.makeTempDirectoryScoped({ prefix: "live-evidence-prerequisite-" });
          const result = yield* runSdkEvidence({
            scenarioId: "herdr-sdk-workflow",
            record: true,
            out,
          }).pipe(Effect.provide(unavailableProcesses));
          const manifest = yield* readSdkEvidenceBundle(result.directory);
          expect(manifest.executionKind).toBe("isolated-herdr");
          expect(manifest.outcomes.product.status).toBe("unavailable");
          expect(manifest.outcomes.recording.status).toBe("unavailable");
          expect(manifest.outcomes.cleanup.status).toBe("passed");
          expect(manifest.checks).toHaveLength(0);
          expect(manifest.artifacts.some((artifact) => artifact.kind === "recording")).toBe(false);
          expect(manifest.limitations.join(" ")).toContain("not executed");
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
    ),
  15000,
);

test.skipIf(
  process.env.HERDR_LIVE_EVIDENCE_TEST !== "1" || !process.env.HERDR_LIVE_EVIDENCE_EXECUTABLE,
)(
  "explicit isolated Herdr end-to-end recording retains assertions across rerender",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const executable = process.env.HERDR_LIVE_EVIDENCE_EXECUTABLE;
          if (!executable)
            return yield* Effect.die(
              "Opt-in real evidence requires an explicit compatible Herdr executable.",
            );
          const out = yield* fs.makeTempDirectoryScoped({ prefix: "live-evidence-opt-in-" });
          const result = yield* runSdkEvidence({
            scenarioId: "herdr-sdk-workflow",
            record: true,
            herdrExecutable: executable,
            out,
          });
          const before = result.manifest;
          expect(before.executionKind).toBe("isolated-herdr");
          expect(before.outcomes.product.status).toBe("passed");
          expect(before.checks).toHaveLength(8);
          expect(before.checks.every((check) => check.status === "passed")).toBe(true);
          expect(before.chapters).toHaveLength(7);
          expect(before.outcomes.recording.status).toBe("passed");
          expect(before.outcomes.render.status).toBe("passed");
          expect(before.outcomes.cleanup.status).toBe("passed");
          expect(
            before.artifacts.filter((artifact) => artifact.kind === "transcript"),
          ).toHaveLength(7);
          expect(before.artifacts.some((artifact) => artifact.kind === "video")).toBe(true);
          const poster = before.artifacts.find((artifact) => artifact.id === "review-poster");
          expect(poster?.kind).toBe("frame");
          if (!poster) return yield* Effect.die("Real evidence poster missing.");
          const bytes = yield* fs.readFile(`${result.directory}/${poster.path}`);
          expect(Buffer.from(bytes.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
          const split = yield* fs.readFileString(`${result.directory}/step-run-right.txt`);
          expect(split).toContain("SDK left: ready");
          expect(split).toContain("SDK right: ready");
          const landing = yield* fs.readFileString(`${result.directory}/step-close-tab.txt`);
          expect(landing).toContain("SDK Landing");
          expect(landing).not.toContain("SDK Workflow");
          expect(
            before.chapters.every(
              (chapter) =>
                chapter.sourceStartMs !== undefined &&
                chapter.sourceEndMs !== undefined &&
                chapter.playbackStartMs !== undefined,
            ),
          ).toBe(true);
          const after = yield* renderSdkEvidence(result.directory, "walkthrough");
          expect(after.outcomes.render.status).toBe("passed");
          expect(after.id).toBe(before.id);
          expect(after.checks).toEqual(before.checks);
          expect(after.source).toEqual(before.source);
          expect(after.outcomes.product).toEqual(before.outcomes.product);
          expect(after.outcomes.cleanup).toEqual(before.outcomes.cleanup);
          expect(after.artifacts.find((artifact) => artifact.id === "review-poster")).toEqual(
            poster,
          );
          expect(after.chapters.map((chapter) => chapter.sourceStartMs)).toEqual(
            before.chapters.map((chapter) => chapter.sourceStartMs),
          );
          expect(after.artifacts.filter((artifact) => artifact.kind === "video")).toHaveLength(2);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
    ),
  180000,
);
