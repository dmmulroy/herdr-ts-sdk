import { NodeRuntime } from "@effect/platform-node-shared";
import { Effect } from "effect";
import { type HerdrSdk, herdrSdkLayer } from "@herdr/sdk";

/**
 * Runs one Herdr example with ambient configuration and signal-safe finalization.
 * SIGINT and SIGTERM interrupt the program and await its resource cleanup before exit.
 *
 * @category running
 * @since 0.8.2
 */
export function runHerdrExample<A, E>(program: Effect.Effect<A, E, HerdrSdk>): void {
  NodeRuntime.runMain(program.pipe(Effect.provide(herdrSdkLayer)));
}
