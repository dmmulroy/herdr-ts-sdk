import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import type { WireMethod, WireMethodMap } from "./generated/wire-method-map.ts";
import { HerdrError } from "./herdr-error.ts";
import { assertHerdrWireEnvelope } from "./herdr-wire-parser.ts";
import type { HerdrRequestOptions, JsonValue, Milliseconds } from "./herdr-public-api.ts";

const MAX_RESPONSE_LINE_BYTES = 1024 * 1024;

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
            ? never
            : Key extends string
              ? CamelCaseWireKey<Key>
              : Key]: CamelCaseWireValue<Value[Key]> | undefined;
        }
      : Value;

/** Camel-cased SDK parameter shape correlated to one generated wire method. */
export type WireSdkParams<Method extends WireMethod> = CamelCaseWireValue<
  WireMethodMap[Method]["params"]
>;

/** Herdr socket request shape after camel-to-snake serialization. */
export interface WireRequest {
  readonly id: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface WireErrorBody {
  readonly code: string;
  readonly message: string;
}

interface WireResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: WireErrorBody;
}

/** Owns newline-delimited JSON socket requests and stream connections. */
export class HerdrTransport {
  readonly #socketPath: string;
  readonly #defaultTimeoutMs: Milliseconds;

  /** Creates a transport for one resolved local socket path. */
  constructor(socketPath: string, defaultTimeoutMs: Milliseconds) {
    this.#socketPath = socketPath;
    this.#defaultTimeoutMs = defaultTimeoutMs;
  }

  /** Sends one correlated request and returns the unknown wire result for boundary parsing. */
  async request<Method extends WireMethod>(
    method: Method,
    params: WireSdkParams<Method>,
    options: HerdrRequestOptions = {},
  ): Promise<{ readonly requestId: string; readonly result: WireMethodMap[Method]["result"] }> {
    const requestId = options.requestId ?? randomUUID();
    parseTransportTimeout(options.requestTimeoutMs, requestId);
    const socket = await this.openSocket(requestId, options);
    // SAFETY: Generated wire parameter records remain plain objects after compile-time camel-key mapping.
    const parameterRecord = params as Readonly<Record<string, unknown>>;
    const request: WireRequest = {
      id: requestId,
      method,
      params: toSnakeCaseRecord(parameterRecord),
    };
    socket.end(`${JSON.stringify(request)}\n`);
    const response = await readSocketJsonLine(socket, requestId, options.signal);
    const parsed = parseWireResponse(response, requestId);
    // SAFETY: Correlation ID and facade result-discriminant checks guard the generated method result type.
    return parsed as {
      readonly requestId: string;
      readonly result: WireMethodMap[Method]["result"];
    };
  }

  /** Opens a long-lived socket and writes its initial request without ending it. */
  async openStream<Method extends "events.subscribe" | "pane.graphics.stream">(
    method: Method,
    params: WireSdkParams<Method>,
    options: HerdrRequestOptions = {},
  ): Promise<{
    readonly requestId: string;
    readonly socket: Socket;
    readonly initialResult: WireMethodMap[Method]["result"];
  }> {
    const requestId = options.requestId ?? randomUUID();
    parseTransportTimeout(options.requestTimeoutMs, requestId);
    const socket = await this.openSocket(requestId, options);
    // SAFETY: Generated wire parameter records remain plain objects after compile-time camel-key mapping.
    const parameterRecord = params as Readonly<Record<string, unknown>>;
    const request: WireRequest = {
      id: requestId,
      method,
      params: toSnakeCaseRecord(parameterRecord),
    };
    socket.write(`${JSON.stringify(request)}\n`);
    const response = await readSocketJsonLine(socket, requestId, options.signal);
    try {
      const parsed = parseWireResponse(response, requestId);
      // SAFETY: Correlation ID and stream handshake checks guard the generated method result type.
      return {
        requestId,
        socket,
        initialResult: parsed.result as WireMethodMap[Method]["result"],
      };
    } catch (cause) {
      socket.destroy();
      throw cause;
    }
  }

  private async openSocket(requestId: string, options: HerdrRequestOptions): Promise<Socket> {
    if (options.signal?.aborted === true) {
      throw new HerdrError(
        "aborted",
        "Request was aborted before connecting",
        requestId,
        options.signal.reason,
      );
    }
    const socket = createConnection(this.#socketPath);
    const timeoutMs = options.requestTimeoutMs ?? this.#defaultTimeoutMs;
    return await new Promise<Socket>((resolve, reject) => {
      const cleanup = (): void => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const onConnect = (): void => {
        cleanup();
        socket.setTimeout(timeoutMs, () => socket.destroy(new Error("request timeout")));
        resolve(socket);
      };
      const onError = (cause: Error): void => {
        cleanup();
        reject(
          new HerdrError(
            "transport_error",
            `Socket connection failed at ${this.#socketPath}`,
            requestId,
            cause,
          ),
        );
      };
      const onAbort = (): void => {
        cleanup();
        socket.destroy();
        reject(
          new HerdrError(
            "aborted",
            "Request was aborted while connecting",
            requestId,
            options.signal?.reason,
          ),
        );
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function toSnakeCaseRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const converted = toSnakeCaseValue(value);
  if (converted === null || typeof converted !== "object" || Array.isArray(converted)) {
    throw new HerdrError(
      "invalid_request",
      "Request parameters must serialize to an object",
      "local",
    );
  }
  // SAFETY: Recursive conversion preserves an input object's record shape.
  return converted as Readonly<Record<string, unknown>>;
}

/** Converts camel-cased SDK values to snake-cased wire values recursively. */
export function toSnakeCaseValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(toSnakeCaseValue);
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined)
      output[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] =
        toSnakeCaseValue(child);
  }
  return output;
}

/** Converts snake-cased wire values to camel-cased SDK values recursively. */
export function toCamelCaseValue(value: unknown, omitNullProperties = false): JsonValue {
  if (Array.isArray(value))
    return value.map((child) => toCamelCaseValue(child, omitNullProperties));
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return value;
  if (typeof value !== "object")
    throw new HerdrError("invalid_response", "Unsupported non-JSON response value", "unknown");
  const output: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (omitNullProperties && child === null) continue;
    output[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] =
      toCamelCaseValue(child, omitNullProperties);
  }
  return normalizeHerdrDomainObject(output);
}

function normalizeHerdrDomainObject(output: Record<string, JsonValue>): JsonValue {
  if (typeof output.workspaceId === "string" && "activeTabId" in output) {
    output.id = output.workspaceId;
    delete output.workspaceId;
    output.tokens ??= {};
  } else if (
    typeof output.tabId === "string" &&
    typeof output.workspaceId === "string" &&
    "number" in output &&
    "paneCount" in output
  ) {
    output.id = output.tabId;
    delete output.tabId;
  } else if (
    typeof output.pluginId === "string" &&
    "manifestPath" in output &&
    "pluginRoot" in output
  ) {
    output.id = output.pluginId;
    output.root = output.pluginRoot;
    delete output.pluginId;
    delete output.pluginRoot;
  } else if (typeof output.actionId === "string" && "pluginId" in output && "contexts" in output) {
    output.id = output.actionId;
    delete output.actionId;
  } else if (typeof output.logId === "string" && "startedUnixMs" in output) {
    output.id = output.logId;
    delete output.logId;
  }
  return output;
}

/** Applies context-sensitive pane and agent output names after envelope parsing. */
export function normalizeHerdrNamedResources(value: JsonValue, key?: string): JsonValue {
  if (isJsonValueArray(value))
    return value.map((child) => normalizeHerdrNamedResources(child, key));
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, JsonValue> = { ...value };
  for (const [childKey, child] of Object.entries(output))
    output[childKey] = normalizeHerdrNamedResources(child, childKey);
  if ((key === "pane" || key === "rootPane" || key === "panes") && "terminalId" in output) {
    output.id = output.paneId ?? "";
    delete output.paneId;
    output.stateLabels ??= {};
    output.tokens ??= {};
  }
  if ((key === "agent" || key === "agents") && "terminalId" in output) {
    output.status = output.agentStatus ?? "unknown";
    delete output.agentStatus;
    output.screenDetectionSkipped ??= false;
    output.launchPending ??= false;
    output.interactiveReady ??= false;
    output.stateChangeSequence ??= 0;
    output.stateLabels ??= {};
    output.tokens ??= {};
  }
  return output;
}

function isJsonValueArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function parseTransportTimeout(timeoutMs: number | undefined, requestId: string): void {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs < 0)
  )
    throw new HerdrError(
      "invalid_argument",
      "Request timeout must be a finite non-negative integer",
      requestId,
    );
}

function parseWireResponse(
  value: unknown,
  requestId: string,
): { readonly requestId: string; readonly result: unknown } {
  assertHerdrWireEnvelope(value, requestId);
  if (value === null || typeof value !== "object")
    throw new HerdrError("invalid_response", "Response must be an object", requestId);
  const response = value as WireResponse;
  if (response.id !== requestId)
    throw new HerdrError(
      "invalid_response",
      `Response ID mismatch: expected ${requestId}`,
      requestId,
    );
  if (response.error !== undefined) {
    if (typeof response.error.code !== "string" || typeof response.error.message !== "string")
      throw new HerdrError("invalid_response", "Malformed wire error response", requestId);
    throw new HerdrError(response.error.code, response.error.message, requestId);
  }
  if (!("result" in response))
    throw new HerdrError("invalid_response", "Response is missing result", requestId);
  return { requestId, result: response.result };
}

/** Reads one newline-delimited JSON value while preserving bytes after the line on the socket. */
export async function readSocketJsonLine(
  socket: Socket,
  requestId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      socket.off("timeout", onTimeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (code: string, message: string, cause?: unknown): void => {
      cleanup();
      socket.destroy();
      reject(new HerdrError(code, message, requestId, cause));
    };
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(10);
      if (newline < 0) {
        if (buffered.length > MAX_RESPONSE_LINE_BYTES)
          fail("invalid_response", "Response line exceeds 1 MiB");
        return;
      }
      if (newline > MAX_RESPONSE_LINE_BYTES) {
        fail("invalid_response", "Response line exceeds 1 MiB");
        return;
      }
      cleanup();
      const remainder = buffered.subarray(newline + 1);
      if (remainder.length > 0) socket.unshift(remainder);
      try {
        resolve(JSON.parse(buffered.subarray(0, newline).toString("utf8")));
      } catch (cause) {
        fail("invalid_response", "Response contains invalid JSON", cause);
      }
    };
    const onError = (cause: Error): void => fail("transport_error", "Socket request failed", cause);
    const onEnd = (): void => fail("empty_response", "Socket closed before a response arrived");
    const onTimeout = (): void => fail("timeout", "Request transport deadline exceeded");
    const onAbort = (): void => fail("aborted", "Request was aborted", signal?.reason);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    socket.once("timeout", onTimeout);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
