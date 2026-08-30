import { Ajv2020 } from "ajv/dist/2020.js";
import herdrApiSchema from "../schema/herdr-api.schema.json" with { type: "json" };
import { wireResultTypesByMethod } from "./generated/wire-method-map.ts";
import type { SuccessResponse } from "./generated/wire-success-response.ts";
import type { HerdrTestRequest } from "./herdr-test-server.ts";

interface JsonSchemaProperties {
  readonly [key: string]: JsonSchema | undefined;
}

type JsonSchema = boolean | JsonSchemaNode;

interface JsonSchemaNode {
  readonly $ref?: string;
  readonly const?: string | number | boolean | null;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly oneOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly type?: string | readonly string[];
  readonly properties?: JsonSchemaProperties;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number | boolean;
}

interface FixtureJsonObject {
  [key: string]: FixtureJsonValue;
}

type FixtureJsonValue = string | number | boolean | null | FixtureJsonValue[] | FixtureJsonObject;

const schemaId = "https://herdr.dev/herdr-api.schema.json";
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema({ ...herdrApiSchema, $id: schemaId });
const successResponseParser = ajv.compile<SuccessResponse>({
  $ref: schemaId + "#/schemas/success_response",
});

const successDefinitions = new Map<string, JsonSchema>(
  Object.entries(herdrApiSchema.schemas.success_response.$defs),
);
const resultSchemas: readonly JsonSchema[] =
  herdrApiSchema.schemas.success_response.$defs.ResponseResult.oneOf;

/** Generates a schema-valid success response for one observed test request. */
export function makeHerdrSuccessResponse(request: HerdrTestRequest): SuccessResponse {
  let resultType: string = wireResultTypesByMethod[request.method][0];
  if (request.method === "plugin.pane.open" && request.params.placement === "popup") {
    resultType = "ok";
  }

  if (resultType === "pong") {
    return {
      id: request.id,
      result: { type: "pong", version: "0.8.2", protocol: 21 },
    };
  }

  const resultSchema = resultSchemas.find(
    (schema) =>
      schema !== false &&
      schema !== true &&
      schema.properties?.type !== false &&
      schema.properties?.type !== true &&
      schema.properties?.type?.const === resultType,
  );
  if (resultSchema === undefined) {
    throw new Error("No success-result schema found for " + resultType);
  }
  const candidate: FixtureJsonObject = {
    id: request.id,
    result: synthesizeJsonSchema(resultSchema, "result"),
  };
  if (successResponseParser(candidate)) return candidate;
  throw new Error(
    "Generated " +
      resultType +
      " fixture is invalid: " +
      ajv.errorsText(successResponseParser.errors),
  );
}

function synthesizeJsonSchema(schema: JsonSchema, key: string): FixtureJsonValue {
  if (schema === false) throw new Error("Cannot synthesize a false JSON schema");
  if (schema === true) return {};
  if (schema.$ref !== undefined) {
    const definitionName = schema.$ref.split("/").at(-1);
    const definition =
      definitionName === undefined ? undefined : successDefinitions.get(definitionName);
    if (definition === undefined) {
      throw new Error("Unknown success-schema reference " + schema.$ref);
    }
    return synthesizeJsonSchema(definition, key);
  }
  if (schema.const !== undefined) return schema.const;
  const firstEnum = schema.enum?.[0];
  if (firstEnum !== undefined) return firstEnum;
  const firstUnion = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (firstUnion !== undefined) return synthesizeJsonSchema(firstUnion, key);

  const selectedType = Array.isArray(schema.type)
    ? schema.type.find((type) => type !== "null")
    : schema.type;
  switch (selectedType) {
    case "object": {
      const output: FixtureJsonObject = {};
      for (const requiredKey of schema.required ?? []) {
        const propertySchema = schema.properties?.[requiredKey];
        if (propertySchema === undefined) {
          throw new Error("Required fixture property " + requiredKey + " has no schema");
        }
        output[requiredKey] = synthesizeJsonSchema(propertySchema, requiredKey);
      }
      return output;
    }
    case "array":
      return [];
    case "boolean":
      return false;
    case "integer":
    case "number": {
      const minimum = schema.minimum ?? 0;
      if (schema.exclusiveMinimum === true) return minimum + 1;
      if (schema.exclusiveMinimum === false || schema.exclusiveMinimum === undefined) {
        return minimum;
      }
      return schema.exclusiveMinimum + 1;
    }
    case "null":
      return null;
    case "string":
      return isPathKey(key) ? "/tmp/herdr-sdk-fixture" : "fixture";
    default:
      return {};
  }
}

function isPathKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("path") ||
    normalized === "cwd" ||
    normalized.endsWith("_cwd") ||
    normalized.endsWith("_root")
  );
}
