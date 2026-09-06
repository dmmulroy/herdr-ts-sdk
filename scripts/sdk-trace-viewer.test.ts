import { fileURLToPath } from "node:url";
import { Effect, FileSystem } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { runSdkTraceViewerCli } from "./sdk-trace-viewer.mjs";
import { runVerificationCommand, verificationNodeLayer } from "./sdk-verification-process.mjs";

const viewerCli = fileURLToPath(new URL("./sdk-trace-viewer.mjs", import.meta.url));

describe("owned local trace viewer launcher", () => {
  it.for([
    ["--http", "0"],
    ["--http", "70000"],
    ["--http", "8000", "--browser-port", "8000"],
    ["--db-max-size", "0"],
    ["--db-max-size", "1GB"],
    ["--host", "0.0.0.0"],
    ["--open-browser", "true"],
  ])("rejects invalid or unsafe viewer options %s", (args, context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const error = yield* runSdkTraceViewerCli(args).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "SdkTraceViewerError" });
      }).pipe(Effect.provide(verificationNodeLayer)),
    ),
  );

  it("reports a missing binary without attempting an install", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const result = yield* runVerificationCommand(process.execPath, [viewerCli, "--check"], {
          capture: true,
          env: { PATH: directory },
        });
        expect(result.status).toBe("fail");
        expect(result.stderr).toContain("binary unavailable");
        expect(result.stderr).toContain("never installs");
        expect(yield* fs.readDirectory(directory)).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(verificationNodeLayer)),
    ));

  it("rejects an unsupported binary version before startup", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const binary = `${directory}/otel-desktop-viewer`;
        yield* fs.writeFileString(
          binary,
          `#!${process.execPath}\nconsole.log("otel-desktop-viewer version 9.9.9");\n`,
        );
        yield* fs.chmod(binary, 0o755);
        const result = yield* runVerificationCommand(process.execPath, [viewerCli, "--check"], {
          capture: true,
          env: { PATH: directory },
        });
        expect(result.status).toBe("fail");
        expect(result.stderr).toContain("version incompatible");
        expect(result.stderr).toContain("0.5.0");
      }).pipe(Effect.scoped, Effect.provide(verificationNodeLayer)),
    ));
});
