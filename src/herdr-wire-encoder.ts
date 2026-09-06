/**
 * Encodes parsed domain options with private request codecs, then serializes typed requests.
 * The final serializer does not validate parameters or rewrite dictionary data.
 *
 * @since 0.8.2
 */
import { Effect, Schema } from "effect";
import type { WireMethod, WireMethodMap } from "./generated/wire-method-map.ts";
import {
  AgentPromptInput,
  AgentWaitInput,
  PaneGraphicsPlacement,
  PaneReadInput,
} from "./herdr-models.ts";

// Public inputs omit absent fields; these request codecs preserve the protocol's
// existing null/omission choices without changing those public encoded contracts.
const PaneReadRequestParameters = PaneReadInput.mapFields((fields) => ({
  ...fields,
  lines: Schema.OptionFromNullOr(Schema.requiredKey(fields.lines.from)),
}));
const AgentWaitRequestParameters = AgentWaitInput.mapFields((fields) => ({
  ...fields,
  timeoutMs: Schema.OptionFromNullOr(Schema.requiredKey(fields.timeoutMs.from)),
}));
const AgentPromptRequestParameters = AgentPromptInput.mapFields((fields) => ({
  ...fields,
  wait: Schema.OptionFromOptionalKey(AgentWaitRequestParameters),
}));
const PaneGraphicsStreamPlacement = PaneGraphicsPlacement.pipe(
  Schema.encodeKeys({
    viewportCol: "viewport_col",
    viewportRow: "viewport_row",
    gridCols: "grid_cols",
    gridRows: "grid_rows",
  }),
);
const encodePaneReadRequest = Schema.encodeEffect(PaneReadRequestParameters);
const encodeAgentWaitRequest = Schema.encodeEffect(AgentWaitRequestParameters);
const encodeAgentPromptRequest = Schema.encodeEffect(AgentPromptRequestParameters);
const encodePanePlacement = Schema.encodeEffect(PaneGraphicsPlacement);
const encodeStreamPlacement = Schema.encodeEffect(PaneGraphicsStreamPlacement);

/**
 * Encodes parsed pane/agent read options, keeping absent lines null and format flags omitted.
 *
 * @category encoding
 * @since 0.8.2
 */
export function encodePaneReadParameters(
  input: PaneReadInput,
): Effect.Effect<typeof PaneReadRequestParameters.Encoded, Schema.SchemaError> {
  return encodePaneReadRequest(input);
}

/**
 * Encodes parsed wait options without turning an omitted status list into null.
 *
 * @category encoding
 * @since 0.8.2
 */
export function encodeAgentWaitParameters(
  input: AgentWaitInput,
): Effect.Effect<typeof AgentWaitRequestParameters.Encoded, Schema.SchemaError> {
  return encodeAgentWaitRequest(input);
}

/**
 * Encodes nested prompt wait options with the same null/omission policy as agent.wait.
 *
 * @category encoding
 * @since 0.8.2
 */
export function encodeAgentPromptParameters(
  input: AgentPromptInput,
): Effect.Effect<typeof AgentPromptRequestParameters.Encoded, Schema.SchemaError> {
  return encodeAgentPromptRequest(input);
}

/**
 * Encodes one-shot graphics coordinates as camel-case request parameters.
 *
 * @category encoding
 * @since 0.8.2
 */
export function encodePaneGraphicsPlacement(
  input: PaneGraphicsPlacement,
): Effect.Effect<typeof PaneGraphicsPlacement.Encoded, Schema.SchemaError> {
  return encodePanePlacement(input);
}

/**
 * Encodes streaming graphics coordinates directly to the binary protocol's snake-case header.
 *
 * @category encoding
 * @since 0.8.2
 */
export function encodePaneGraphicsStreamPlacement(
  input: PaneGraphicsPlacement,
): Effect.Effect<typeof PaneGraphicsStreamPlacement.Encoded, Schema.SchemaError> {
  return encodeStreamPlacement(input);
}

type CamelCaseWireKey<Key extends string> = Key extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<CamelCaseWireKey<Tail>>}`
  : Key;

type CamelCaseWireValue<Value> = Value extends string | number | boolean | null | undefined
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly CamelCaseWireValue<Item>[]
    : Value extends object
      ? {
          readonly [Key in keyof Value as string extends Key
            ? unknown extends Value[Key]
              ? never
              : Key
            : Key extends string
              ? CamelCaseWireKey<Key>
              : Key]: Key extends "env" | "tokens" | "state_labels"
            ? Value[Key]
            : CamelCaseWireValue<Value[Key]>;
        }
      : never;

/**
 * Camel-cased protocol parameters retain caller-owned dictionary keys and value types.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrWireParameters<Method extends WireMethod> = Method extends "ping"
  ? { readonly application?: { readonly name: string; readonly version?: string } }
  : CamelCaseWireValue<WireMethodMap[Method]["params"]>;

// A constraint for the serialization traversal, not a parser or a replacement for method types.
type WireParameterJson =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly WireParameterJson[]
  | { readonly [key: string]: WireParameterJson };

/**
 * Encodes already-parsed request parameters as one NDJSON line; never validates them again.
 *
 * @category encoding
 * @since 0.8.2
 */
export function encodeWireRequest<Method extends WireMethod>(
  requestId: string,
  method: Method,
  params: HerdrWireParameters<NoInfer<Method>>,
): string {
  return `{"id":${JSON.stringify(requestId)},"method":${JSON.stringify(method)},"params":${encodeWireParameterValue(params)}}\n`;
}

function isWireParameterArray<Value extends WireParameterJson>(
  value: Value,
): value is Value & readonly WireParameterJson[] {
  return Array.isArray(value);
}

function encodeWireParameterValue<Value extends WireParameterJson>(value: Value): string {
  if (value === undefined) return "null";
  if (isWireParameterArray(value)) {
    return `[${Array.from(value, (child) => encodeWireParameterValue(child)).join(",")}]`;
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  const fields: string[] = [];
  for (const [key, child] of Object.entries<WireParameterJson>(value)) {
    if (child === undefined) continue;
    const wireKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    // Dictionaries are opaque JSON data, even when their keys look like protocol fields.
    // Serializing directly also preserves own __proto__ keys without assigning to a prototype.
    const encodedChild =
      key === "env" || key === "tokens" || key === "stateLabels"
        ? JSON.stringify(child)
        : encodeWireParameterValue(child);
    fields.push(`${JSON.stringify(wireKey)}:${encodedChild}`);
  }
  return `{${fields.join(",")}}`;
}
