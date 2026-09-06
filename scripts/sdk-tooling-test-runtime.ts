/**
 * Scope-owned Node execution boundary for tooling tests and Vitest cancellation.
 * @since 0.8.2
 */
import { Effect, type FileSystem, type Scope } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { TestContext } from "vite-plus/test";
import { verificationNodeLayer } from "./sdk-verification-process.mjs";

/**
 * Runs tooling tests with scoped Node capabilities and forwards Vitest cancellation to finalizers.
 * Explicit context keeps concurrent tests isolated; this boundary adds no telemetry wrapper.
 * @category Testing
 * @since 0.8.2
 */
export function runSdkToolingTest<A, E>(
  context: Pick<TestContext, "signal">,
  program: Effect.Effect<
    A,
    E,
    FileSystem.FileSystem | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
  >,
): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(verificationNodeLayer)), {
    signal: context.signal,
  });
}
