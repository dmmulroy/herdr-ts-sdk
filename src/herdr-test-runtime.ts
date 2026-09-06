/**
 * Effect-native Vitest execution boundary for optional local development tracing.
 * @since 0.8.2
 */
import { Console, Effect, type Scope } from "effect";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "vite-plus/test";
import { traceSdkExecution } from "../scripts/sdk-telemetry.mjs";

const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const testExecutionCounts = new WeakMap<TestContext["task"], number>();

/**
 * Runs an Effect body at the Vitest/FastCheck boundary, closing its resources before trace export.
 * Explicit Vitest context keeps concurrent tests isolated; synchronous assertions outside this
 * boundary have no synthetic span. Each generated property case is a separate execution, not a retry;
 * only the first 32 executions per test are traced. Undefined context denotes a suite lifecycle hook.
 * @category Testing
 * @since 0.8.2
 */
export function runHerdrTest<A, E>(
  context: TestContext | undefined,
  effect: Effect.Effect<A, E, Scope.Scope>,
  options: Pick<Parameters<typeof traceSdkExecution>[0], "enabled" | "endpoint" | "runId"> = {},
): Promise<A> {
  const enabled = options.enabled ?? process.env.HERDR_TRACE === "1";
  const count =
    !enabled || context === undefined ? 1 : (testExecutionCounts.get(context.task) ?? 0) + 1;
  if (enabled && context !== undefined) testExecutionCounts.set(context.task, count);
  const identity = {
    ...options,
    enabled: enabled && count <= 32,
    kind: "test" as const,
    name: context?.task.fullName ?? "suite-hook",
    file:
      context === undefined
        ? undefined
        : relative(repositoryDirectory, context.task.file.filepath).replaceAll("\\", "/"),
    attempt: context?.task.result?.repeatCount ?? 0,
  };
  return Effect.runPromise(
    Effect.gen(function* () {
      if (enabled && count === 33)
        yield* Console.warn(
          "SDK test trace limit: later Effect executions in this test run without tracing (limit 32)",
        );
      const result = yield* traceSdkExecution(
        identity,
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan("sdk.execution_index", count);
          return yield* effect;
        }),
      );
      if (result.telemetry.status === "partial" || result.telemetry.status === "unavailable")
        yield* Console.warn(
          `SDK test telemetry ${result.telemetry.status}: run=${result.runId} dropped=${result.telemetry.dropped}`,
        );
      return yield* result.tracedExit;
    }),
    { signal: context?.signal },
  );
}
