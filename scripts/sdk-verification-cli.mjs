// Use Vite+'s exported local CLI, bypassing the global vp package-script dispatcher.
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node-shared";
import { Effect } from "effect";
import {
  runVerificationCommand,
  traceVerificationExecution,
  verificationNodeLayer,
} from "./sdk-verification-process.mjs";

const args = process.argv.slice(2);
const trace = args.includes("--trace");
if (args[0] === "test" && (trace || process.env.HERDR_TRACE === "1")) {
  NodeRuntime.runMain(
    traceVerificationExecution(
      { kind: "verification", name: "runtime", enabled: true },
      Effect.gen(function* () {
        const result = yield* runVerificationCommand(
          process.execPath,
          [
            fileURLToPath(import.meta.resolve("vite-plus/bin")),
            ...args.filter((arg) => arg !== "--trace"),
          ],
          { stage: "runtime", timeout: 600_000 },
        );
        return result.exitCode ?? 1;
      }),
    ).pipe(
      Effect.tap((code) =>
        Effect.sync(() => {
          process.exitCode = code;
        }),
      ),
      Effect.provide(verificationNodeLayer),
    ),
  );
} else {
  // Dynamic loading is the unavoidable CLI module boundary; Vite+ owns its process lifecycle.
  await import("vite-plus/bin");
}
