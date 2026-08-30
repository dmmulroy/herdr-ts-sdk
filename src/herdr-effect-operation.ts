import { Effect } from "effect";

/** Adds a searchable traced Effect boundary to one Herdr service operation. */
export function defineHerdrOperation<
  Args extends ReadonlyArray<unknown>,
  Success,
  Error,
  Requirements,
>(
  name: string,
  operation: (...args: Args) => Effect.Effect<Success, Error, Requirements>,
): (...args: Args) => Effect.Effect<Success, Error, Requirements> {
  return Effect.fn(name)(function* (...args: Args) {
    return yield* operation(...args);
  });
}
