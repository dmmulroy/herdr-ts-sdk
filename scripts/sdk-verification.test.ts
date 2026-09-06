import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, type TestContext } from "vite-plus/test";
import { runHerdrTest } from "../src/herdr-test-runtime.ts";
import { runVerificationCommand, verificationNodeLayer } from "./sdk-verification-process.mjs";

const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));

const makeVerificationFixture = Effect.fn("makeVerificationFixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "herdr-sdk-verification-" });
  yield* fs.makeDirectory(join(directory, "scripts"));
  for (const file of yield* fs.readDirectory(join(repositoryDirectory, "scripts"))) {
    if (
      file.endsWith(".mjs") &&
      (file.startsWith("sdk-verification-") ||
        file.startsWith("sdk-telemetry") ||
        file === "sdk-verify.mjs" ||
        file === "sdk-doctor.mjs" ||
        file === "generate-wire-types.mjs")
    ) {
      yield* fs.copyFile(
        join(repositoryDirectory, "scripts", file),
        join(directory, "scripts", file),
      );
    }
  }
  yield* fs.copyFile(join(repositoryDirectory, "package.json"), join(directory, "package.json"));
  yield* fs.copy(join(repositoryDirectory, "schema"), join(directory, "schema"));
  yield* fs.copy(join(repositoryDirectory, "src/generated"), join(directory, "src/generated"));
  yield* fs.symlink(join(repositoryDirectory, "node_modules"), join(directory, "node_modules"));
  return directory;
});

function runVerificationTest<A, E>(
  context: TestContext,
  effect: Effect.Effect<
    A,
    E,
    | FileSystem.FileSystem
    | import("effect/unstable/process/ChildProcessSpawner").ChildProcessSpawner
    | import("effect/Scope").Scope
  >,
) {
  return runHerdrTest(context, effect.pipe(Effect.provide(verificationNodeLayer)));
}

const runVerificationCli = (
  directory: string,
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
) =>
  runVerificationCommand(process.execPath, [join(directory, "scripts/sdk-verify.mjs"), ...args], {
    cwd: directory,
    env,
    capture: true,
    timeout: 30_000,
  });

const readGeneratedFiles = Effect.fn("readGeneratedFiles")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const files = (yield* fs.readDirectory(join(directory, "src/generated"))).sort();
  return yield* Effect.forEach(files, (file) =>
    fs
      .readFileString(join(directory, "src/generated", file))
      .pipe(Effect.map((source) => ({ file, source }))),
  );
});

describe("verification subprocess lifecycle", () => {
  it("preserves nonzero status, separate output and explicit environment without a shell", (context) =>
    runVerificationTest(
      context,
      Effect.gen(function* () {
        const result = yield* runVerificationCommand(
          process.execPath,
          [
            "-e",
            "console.log(process.env.HERDR_VERIFY_FIXTURE); console.error('fixture stderr'); process.exitCode = 7",
          ],
          {
            capture: true,
            env: { HERDR_VERIFY_FIXTURE: "fixture stdout" },
          },
        );
        expect(result).toMatchObject({
          status: "fail",
          exitCode: 7,
          detail: "exit 7",
          stdout: "fixture stdout\n",
          stderr: "fixture stderr\n",
        });
      }),
    ));

  it("retains only bounded output tails", (context) =>
    runVerificationTest(
      context,
      Effect.gen(function* () {
        const result = yield* runVerificationCommand(
          process.execPath,
          ["-e", "process.stdout.write('x'.repeat(100000) + 'TAIL')"],
          { capture: true },
        );
        expect(result.status).toBe("pass");
        expect(result.stdout.length).toBe(16_384);
        expect(result.output.endsWith("TAIL")).toBe(true);
      }),
    ));

  it("returns a typed failure for an unavailable executable", (context) =>
    runVerificationTest(
      context,
      Effect.gen(function* () {
        const result = yield* runVerificationCommand(
          join(repositoryDirectory, "missing-verification-executable"),
          [],
          { capture: true },
        );
        expect(result.status).toBe("fail");
        expect(result.error?._tag).toBe("PlatformError");
        expect(result.exitCode).toBeNull();
      }),
    ));

  it(
    "times out and forcibly releases a child that ignores SIGTERM",
    (context) =>
      runVerificationTest(
        context,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "herdr-sdk-timeout-" });
          const pidFile = join(directory, "child.pid");
          const result = yield* runVerificationCommand(
            process.execPath,
            [
              "-e",
              "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
              pidFile,
            ],
            { capture: true, timeout: 1_000 },
          );
          expect(result.status).toBe("fail");
          expect(result.error?._tag).toBe("TimeoutError");
          const pid = Number(yield* fs.readFileString(pidFile));
          expect(Number.isSafeInteger(pid)).toBe(true);
          expect(() => process.kill(pid, 0)).toThrow();
        }),
      ),
    10_000,
  );
});

describe("verification CLI", () => {
  it(
    "detects changed, missing and stale generated files without rewriting them",
    (context) =>
      runVerificationTest(
        context,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* makeVerificationFixture();
          const before = yield* readGeneratedFiles(directory);
          const clean = yield* runVerificationCli(directory, ["generated"]);
          expect(clean.output).toContain("PASS generated");
          expect(clean.exitCode).toBe(0);
          expect(yield* readGeneratedFiles(directory)).toEqual(before);
          yield* fs.writeFileString(
            join(directory, "src/generated/stale.ts"),
            "// stale fixture\n",
          );
          yield* fs.writeFileString(
            join(directory, "src/generated/wire-request.ts"),
            "// changed fixture\n",
          );
          yield* fs.remove(join(directory, "src/generated/wire-event.ts"));
          const changed = yield* readGeneratedFiles(directory);
          const drift = yield* runVerificationCli(directory, ["generated"]);
          expect(drift.exitCode).toBe(1);
          expect(drift.output).toContain("missing=[wire-event.ts]");
          expect(drift.output).toContain("stale=[stale.ts]");
          expect(drift.output).toContain("changed=[wire-request.ts]");
          expect(yield* readGeneratedFiles(directory)).toEqual(changed);
        }),
      ),
    30_000,
  );

  it(
    "continues after stage failures and never passes a missing required package check",
    (context) =>
      runVerificationTest(
        context,
        Effect.gen(function* () {
          const directory = yield* makeVerificationFixture();
          const before = yield* readGeneratedFiles(directory);
          const quick = yield* runVerificationCli(directory, ["quick"], {
            HERDR_VERIFY_TIMEOUT_MS: "1000",
          });
          expect(quick.exitCode).toBe(1);
          expect(quick.output).toContain("SKIPPED generated, runtime, package");
          const full = yield* runVerificationCli(directory, ["full"], {
            HERDR_VERIFY_TIMEOUT_MS: "1000",
          });
          expect(full.exitCode).toBe(1);
          expect(full.output).toContain("RUN runtime");
          expect(full.output).toContain("FAIL package: exit 1");
          expect(full.output).toContain("FAIL verification (full)");
          expect(full.output).not.toContain("SKIPPED package");
          expect(yield* readGeneratedFiles(directory)).toEqual(before);
        }),
      ),
    30_000,
  );

  it(
    "rejects protocol disagreement and reports the recorded upstream commit",
    (context) =>
      runVerificationTest(
        context,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* makeVerificationFixture();
          const manifestPath = join(directory, "package.json");
          const manifest = yield* fs.readFileString(manifestPath);
          yield* fs.writeFileString(
            manifestPath,
            manifest.replace(/"protocol":\s*\d+/, '"protocol": 999'),
          );
          const mismatch = yield* runVerificationCli(directory, ["generated"]);
          expect(mismatch.exitCode).toBe(1);
          expect(mismatch.output).toContain(
            "package.json herdr.protocol must equal schema.protocol",
          );
          yield* fs.writeFileString(manifestPath, manifest);
          const aligned = yield* runVerificationCli(directory, ["generated"]);
          expect(aligned.output).toContain("recorded upstreamCommit");
          expect(aligned.output).toContain("not independently verified");
        }),
      ),
    30_000,
  );

  it.for(["0", "-1", "abc", "600001", "1.5"])(
    "rejects malformed timeout %s before any stage",
    (timeout, context) =>
      runVerificationTest(
        context,
        Effect.gen(function* () {
          const result = yield* runVerificationCli(repositoryDirectory, ["generated"], {
            HERDR_VERIFY_TIMEOUT_MS: timeout,
          });
          expect(result.exitCode).toBe(1);
          expect(result.output).toContain("FAIL verification configuration");
          expect(result.output).not.toContain("RUN generated");
        }),
      ),
  );

  it("accepts a numeric environment timeout and reports bounded stage failure", (context) =>
    runVerificationTest(
      context,
      Effect.gen(function* () {
        const result = yield* runVerificationCli(repositoryDirectory, ["generated"], {
          HERDR_VERIFY_TIMEOUT_MS: "1",
        });
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("deadline 1ms");
        expect(result.output).toContain("FAIL generated");
        expect(result.output).not.toContain("FAIL verification configuration");
      }),
    ));

  it("rejects unknown CLI flags without running mutating tool options", (context) =>
    runVerificationTest(
      context,
      Effect.gen(function* () {
        const result = yield* runVerificationCli(repositoryDirectory, ["--fix"]);
        expect(result.exitCode).toBe(2);
        expect(result.output).toContain("Verification usage:");
        expect(result.output).not.toContain("RUN ");
      }),
    ));

  it(
    "probes development CLI help without accidentally running runtime tests",
    (context) =>
      runVerificationTest(
        context,
        Effect.gen(function* () {
          const result = yield* runVerificationCommand(
            process.execPath,
            [join(repositoryDirectory, "scripts/sdk-doctor.mjs")],
            { cwd: repositoryDirectory, capture: true, timeout: 20_000 },
          );
          expect(result.output).toContain("PASS development tooling");
          expect(result.output).toContain("separate from package runtime floor");
          expect(result.output).toContain("live Herdr not contacted");
          expect(result.output).not.toContain("Test Files");
        }),
      ),
    25_000,
  );

  it("reports unavailable tooling rather than installing dependencies", (context) =>
    runVerificationTest(
      context,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* makeVerificationFixture();
        yield* fs.remove(join(directory, "node_modules"));
        const result = yield* runVerificationCommand(
          process.execPath,
          [join(directory, "scripts/sdk-doctor.mjs")],
          { cwd: directory, capture: true },
        );
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("FAIL dependencies");
        expect(result.output).toContain("SKIPPED package manager");
        expect(yield* fs.exists(join(directory, "node_modules"))).toBe(false);
      }),
    ));
});
