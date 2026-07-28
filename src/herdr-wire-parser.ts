import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import herdrApiSchema from "../schema/herdr-api.schema.json" with { type: "json" };
import { HerdrError } from "./herdr-error.ts";

const SCHEMA_ID = "https://herdr.dev/herdr-api.schema.json";
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema({ ...herdrApiSchema, $id: SCHEMA_ID });
const parseSuccessResponse = ajv.compile({ $ref: `${SCHEMA_ID}#/schemas/success_response` });
const parseErrorResponse = ajv.compile({ $ref: `${SCHEMA_ID}#/schemas/error_response` });
const parseLifecycleEvent = ajv.compile({ $ref: `${SCHEMA_ID}#/schemas/event` });
const parseSubscriptionEvent = ajv.compile({ $ref: `${SCHEMA_ID}#/schemas/subscription_event` });

/** Parses an error response, while success variant parsing remains correlated to its method. */
export function assertHerdrWireEnvelope(value: unknown, requestId: string): void {
  if (value !== null && typeof value === "object" && "result" in value) return;
  if (parseErrorResponse(value)) return;
  throw invalidWireValue("response", requestId, parseErrorResponse.errors ?? []);
}

/** Parses a known-discriminant success result against the bundled protocol schema. */
export function assertHerdrWireSuccessResult(result: unknown, requestId: string): void {
  const response = { id: requestId, result };
  if (parseSuccessResponse(response)) return;
  throw invalidWireValue("response", requestId, parseSuccessResponse.errors ?? []);
}

/** Parses either lifecycle or specialized event envelope against the bundled schema. */
export function assertHerdrWireEvent(value: unknown, requestId: string): void {
  if (parseLifecycleEvent(value) || parseSubscriptionEvent(value)) return;
  throw invalidWireValue("event", requestId, [
    ...(parseLifecycleEvent.errors ?? []),
    ...(parseSubscriptionEvent.errors ?? []),
  ]);
}

function invalidWireValue(
  kind: "response" | "event",
  requestId: string,
  errors: readonly ErrorObject[],
): HerdrError {
  const detail = ajv.errorsText(errors.slice(0, 5), { separator: "; " });
  return new HerdrError(
    `invalid_${kind}`,
    `Wire ${kind} failed schema parsing: ${detail}`,
    requestId,
  );
}
