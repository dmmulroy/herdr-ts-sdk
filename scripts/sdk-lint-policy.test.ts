import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { runVerificationCommand, verificationNodeLayer } from "./sdk-verification-process.mjs";

test(
  "root lint rejects explicit any and non-null escapes while accepting narrowed inputs",
  (context) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-lint-policy-" });
        const cases = [
          {
            file: "preserved-type.ts",
            source:
              "export function readLength(value: string | undefined): number { return value?.length ?? 0; }\n",
            diagnostic: undefined,
          },
          {
            file: "explicit-any.ts",
            source: "export function eraseType(value: any): any { return value; }\n",
            diagnostic: "no-explicit-any",
          },
          {
            file: "non-null.ts",
            source:
              "export function assertPresent(value: string | undefined): number { return value!.length; }\n",
            diagnostic: "no-non-null-assertion",
          },
        ];
        for (const fixture of cases) {
          const path = join(directory, fixture.file);
          yield* fs.writeFileString(path, fixture.source);
          // Run the actual checkout configuration, not a duplicate rule list or inline override.
          const result = yield* runVerificationCommand(
            process.execPath,
            ["scripts/sdk-verification-cli.mjs", "lint", path],
            { capture: true, timeout: 20000, stage: "lint policy fixture" },
          );
          if (fixture.diagnostic === undefined) {
            expect(result.exitCode).toBe(0);
          } else {
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain(fixture.diagnostic);
          }
        }
      }).pipe(Effect.scoped, Effect.provide(verificationNodeLayer)),
      { signal: context.signal },
    ),
  60000,
);
