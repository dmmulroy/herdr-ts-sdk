import { Cause, Effect, Exit } from "effect";
import { HerdrSdk, herdrSdkLayer } from "@rudironsoni/sdk";

/**
 * Runs one Herdr example with ambient SDK configuration and a readable terminal failure.
 *
 * @category running
 * @since 0.8.2
 */
export async function runHerdrExample<A, E>(program: Effect.Effect<A, E, HerdrSdk>): Promise<void> {
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(herdrSdkLayer)));
  Exit.match(exit, {
    onFailure: (cause) => {
      console.error(Cause.pretty(cause));
      process.exitCode = 1;
    },
    onSuccess: () => undefined,
  });
}
