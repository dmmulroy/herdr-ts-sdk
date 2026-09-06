import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, FileSystem, Layer } from "effect";
import { runVerificationCommand, verificationNodeLayer } from "./sdk-verification-process.mjs";
import { expect, test, type TestContext } from "vite-plus/test";
import { runHerdrTest } from "../src/herdr-test-runtime.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function runLabCommand(args: readonly string[], directory = root) {
  return runVerificationCommand(
    process.execPath,
    [join(directory, "scripts/sdk-lab.mjs"), ...args],
    {
      cwd: directory,
      capture: true,
      timeout: 25_000,
    },
  );
}

const runLabTest = <A, E>(
  context: TestContext,
  effect: Effect.Effect<A, E, Layer.Success<typeof verificationNodeLayer>>,
) => runHerdrTest(context, effect.pipe(Effect.provide(verificationNodeLayer)));

test(
  "SDK lab help is inert and rejects unsupported argument shapes",
  (context) =>
    runLabTest(
      context,
      Effect.gen(function* () {
        const help = yield* runLabCommand(["--help"]);
        expect(help.status).toBe("pass");
        expect(help.output).toContain("Local fixtures only");
        expect(help.output).not.toContain("RUN  v");
        for (const args of [
          ["--socket", "/tmp/live.sock"],
          ["--scenario"],
          ["--scenario", ".*"],
          ["--scenario", "request-wire-result", "--watch"],
          ["--list", "--help"],
          ["--scenario=request-wire-result"],
          ["--scenario", "toString"],
        ]) {
          const result = yield* runLabCommand(args);
          expect(result.detail).toBe("exit 2");
          expect(result.output).toContain("rejected");
          expect(result.output).not.toContain("RUN  v");
        }
      }),
    ),
  15_000,
);

test(
  "SDK lab catalog executes every exact recipe and leaves no temporary report tree",
  (context) =>
    runLabTest(
      context,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const listed = yield* runLabCommand(["--list"]);
        expect(listed.status).toBe("pass");
        // Catalog data owns stdout; optional tracing diagnostics belong to stderr.
        const ids = listed.stdout
          .trim()
          .split("\n")
          .map((line) => line.split(":")[0]);
        expect(ids).toHaveLength(4);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
          expect(id).toBeDefined();
          if (id === undefined) return yield* Effect.die("SDK lab test catalog missing an ID");
          const result = yield* runLabCommand(["--scenario", id]);
          expect(result.status, result.output).toBe("pass");
          expect(result.output).toContain("1 passed | 3 skipped");
          const report = /JSON report written to ([^\r\n]+)/.exec(result.output)?.[1];
          expect(report).toBeDefined();
          if (report === undefined) return yield* Effect.die("SDK lab test expected a report path");
          expect(yield* fs.exists(dirname(report))).toBe(false);
        }
      }),
    ),
  20_000,
);

// An isolated miniature checkout exercises real failing Vitest, not a mocked process implementation.
test.for(["assertion-failure", "zero-matches", "empty-catalog", "deadline"] as const)(
  "SDK lab fails closed for %s",
  { timeout: 30_000 },
  (mode, context) =>
    runLabTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "hlt-" });
          yield* fs.makeDirectory(join(directory, "scripts"));
          yield* fs.makeDirectory(join(directory, "src"));
          yield* fs.symlink(join(root, "node_modules"), join(directory, "node_modules"));
          for (const file of yield* fs.readDirectory(join(root, "scripts"))) {
            if (
              file === "sdk-lab.mjs" ||
              file === "sdk-verification-process.mjs" ||
              (file.startsWith("sdk-telemetry") && file.endsWith(".mjs"))
            )
              yield* fs.copyFile(join(root, "scripts", file), join(directory, "scripts", file));
          }
          yield* fs.copyFile(
            join(root, "src/herdr-test-runtime.ts"),
            join(directory, "src/herdr-test-runtime.ts"),
          );
          const recipe =
            mode === "assertion-failure"
              ? '// Hypothesis: Deliberately fail an assertion.\ntest("sdk learning: probe", () => expect(1).toBe(2));'
              : mode === "zero-matches"
                ? '// Hypothesis: A declared but unreachable test must not pass.\nif (false) {\n// Hypothesis: A declared but unreachable test must not pass.\ntest("sdk learning: probe", () => expect(1).toBe(1));\n}\ntest("another test", () => expect(1).toBe(1));'
                : mode === "deadline"
                  ? '// Hypothesis: The parent budget stops an unresponsive recipe.\ntest("sdk learning: probe", (context) => runHerdrTest(context, Console.log("SDK lab test temporary: " + tmpdir()).pipe(Effect.andThen(Effect.never))), 60_000);'
                  : 'test("another test", () => expect(1).toBe(1));';
          yield* fs.writeFileString(
            join(directory, "src/herdr-learning.test.ts"),
            `import { expect, test } from "vite-plus/test";\nimport { Console, Effect } from "effect";\nimport { runHerdrTest } from "./herdr-test-runtime.ts";\nimport { tmpdir } from "node:os";\n${recipe}\n`,
          );
          const result = yield* runLabCommand(["--scenario", "probe"], directory);
          expect(result.detail, result.output).toBe(mode === "deadline" ? "exit 124" : "exit 1");
          if (mode === "deadline") {
            expect(result.output).toContain("SDK lab deadline exceeded");
            const temporary = /SDK lab test temporary: ([^\r\n]+)/.exec(result.output)?.[1]?.trim();
            expect(temporary).toBeDefined();
            if (temporary !== undefined) expect(yield* fs.exists(temporary)).toBe(false);
          }
          if (mode === "zero-matches") expect(result.output).toContain("recipe report");
          if (mode === "empty-catalog") expect(result.output).toContain("catalog empty");
        }),
      ),
    ),
);
