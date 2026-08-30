import { Cause, Effect, Exit } from "effect";
import { HerdrSdk, herdrSdkLayer } from "@herdr/sdk";

/** Runs one Herdr example with ambient SDK configuration and a readable terminal failure. */
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
