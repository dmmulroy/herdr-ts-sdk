import { Effect } from "effect";
import { HerdrInvalidInput, HerdrInvalidResponse } from "./herdr-errors.ts";

/** Classifies a schema-owned public-input parser failure at its operation boundary. */
export function decodeHerdrInput<Input, Success, ParseError, Requirements>(
  operation: string,
  parser: (input: Input) => Effect.Effect<Success, ParseError, Requirements>,
  input: Input,
): Effect.Effect<Success, HerdrInvalidInput, Requirements> {
  return parser(input).pipe(Effect.mapError((cause) => new HerdrInvalidInput(operation, cause)));
}

/** Classifies a schema-owned wire parser failure at its correlated response boundary. */
export function decodeHerdrWire<Input, Success, ParseError, Requirements>(
  parser: (input: Input) => Effect.Effect<Success, ParseError, Requirements>,
  input: Input,
  requestId: string,
): Effect.Effect<Success, HerdrInvalidResponse, Requirements> {
  return parser(input).pipe(
    Effect.mapError((cause) => new HerdrInvalidResponse("schema_mismatch", requestId, cause)),
  );
}
