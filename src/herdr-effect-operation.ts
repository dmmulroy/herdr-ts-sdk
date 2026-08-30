/**
 * Names protocol-facing Effect operations without changing their error or requirement types.
 *
 * Service implementations use this helper to attach stable tracing spans that point diagnostics back to the owning SDK operation.
 *
 * @since 0.8.2
 */
import { Effect } from "effect";

/**
 * Adds a searchable traced Effect boundary to one Herdr service operation.
 *
 * @category combinators
 * @since 0.8.2
 */
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
