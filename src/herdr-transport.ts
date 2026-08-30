import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { NodeStream } from "@effect/platform-node-shared";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  type WireMethod,
  type WireMethodMap,
  wireResultTypesByMethod,
} from "./generated/wire-method-map.ts";
import type { ErrorResponse } from "./generated/wire-error-response.ts";
import type { ResponseResult } from "./generated/wire-success-response.ts";
import { parseHerdrWireResponse } from "./herdr-wire-parser.ts";
import { HerdrConfig, HerdrRequestDeadline, herdrConfigLayer } from "./herdr-config.ts";
import {
  HerdrInvalidInput,
  HerdrInvalidResponse,
  HerdrRequestTimeout,
  HerdrServerError,
  HerdrTransportError,
  HerdrUnsupportedEvent,
  HerdrUnsupportedProtocol,
  HerdrUnsupportedResult,
} from "./herdr-errors.ts";
import {
  type HerdrSocketLineBuffer,
  makeHerdrSocketLineBuffer,
  splitHerdrSocketLines,
} from "./herdr-socket-lines.ts";

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
              : Key]: CamelCaseWireValue<Value[Key]>;
        }
      : never;

/** Camel-cased SDK parameters correlated to one generated wire method. */
export type HerdrWireParameters<Method extends WireMethod> = Method extends "ping"
  ? {
      readonly application?: {
        readonly name: string;
        readonly version?: string;
      };
    }
  : CamelCaseWireValue<WireMethodMap[Method]["params"]>;

/** Local request options applied by the transport rather than the Herdr server. */
export const HerdrTransportRequestOptions = Schema.Struct({
  requestId: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
  requestTimeout: Schema.OptionFromOptionalKey(HerdrRequestDeadline),
});

/** Normalized local request options consumed by transport internals. */
export interface HerdrTransportRequestOptions extends Schema.Schema.Type<
  typeof HerdrTransportRequestOptions
> {}

/** Ergonomic request options accepted by public SDK operations. */
export interface HerdrTransportRequestOptionsEncoded extends Schema.Codec.Encoded<
  typeof HerdrTransportRequestOptions
> {}

/** Expected failures shared by ordinary Herdr transport requests. */
export type HerdrTransportRequestError =
  | HerdrTransportError
  | HerdrInvalidInput
  | HerdrRequestTimeout
  | HerdrInvalidResponse
  | HerdrUnsupportedProtocol
  | HerdrUnsupportedResult
  | HerdrServerError;

/** Expected request failures for a specific generated Herdr method. */
export type HerdrTransportMethodError<Method extends WireMethod> =
  | HerdrTransportRequestError
  | (Method extends "events.wait" ? HerdrUnsupportedEvent : never);

type HerdrOrdinaryWireMethod = Exclude<WireMethod, "events.wait">;

/** Correlated success returned after the generated method result contract is checked. */
export interface HerdrTransportSuccess<Method extends WireMethod> {
  /** Wire request identifier echoed by the server. */
  readonly requestId: string;
  /** Generated result variant associated with the requested method. */
  readonly result: WireMethodMap[Method]["result"];
}

/** Scoped stream handshake retaining the socket until the owning scope closes. */
export interface HerdrTransportStream<
  Method extends "events.subscribe" | "pane.graphics.stream",
> extends HerdrTransportSuccess<Method> {
  /** Pulls ordered socket bytes with Node readable backpressure and scoped cleanup. */
  readonly readBytes: Stream.Stream<Uint8Array, HerdrTransportError>;
  /** Writes bytes through the acquired stream resource. */
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, HerdrTransportError>;
}

/** Deep Unix-socket and protocol capability shared by every Herdr namespace service. */
export interface IHerdrTransport {
  /** Sends one request after the shared protocol compatibility check. */
  readonly request: {
    <Method extends HerdrOrdinaryWireMethod>(
      method: Method,
      params: HerdrWireParameters<Method>,
      options?: HerdrTransportRequestOptionsEncoded,
    ): Effect.Effect<HerdrTransportSuccess<Method>, HerdrTransportRequestError>;
    (
      method: "events.wait",
      params: HerdrWireParameters<"events.wait">,
      options?: HerdrTransportRequestOptionsEncoded,
    ): Effect.Effect<
      HerdrTransportSuccess<"events.wait">,
      HerdrTransportRequestError | HerdrUnsupportedEvent
    >;
  };
  /** Acquires a long-lived subscription or graphics socket in the current scope. */
  readonly openStream: <Method extends "events.subscribe" | "pane.graphics.stream">(
    method: Method,
    params: HerdrWireParameters<Method>,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<HerdrTransportStream<Method>, HerdrTransportRequestError, Scope.Scope>;
  /** Writes bytes to an acquired long-lived stream with interruption and deadline cleanup. */
  readonly writeStreamBytes: (
    stream: HerdrTransportStream<"pane.graphics.stream">,
    bytes: Uint8Array,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrInvalidInput | HerdrTransportError | HerdrRequestTimeout>;
}

/** Yieldable Effect service owning Herdr Unix-socket and protocol operations. */
export class HerdrTransport extends Context.Service<HerdrTransport, IHerdrTransport>()(
  "@herdr/sdk/HerdrTransport",
) {}

interface WireJsonObject {
  readonly [key: string]: WireJsonValue | undefined;
}

type WireJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly WireJsonValue[]
  | WireJsonObject;

const WireJsonValueSchema: Schema.Codec<WireJsonValue> = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Undefined,
  Schema.Array(Schema.suspend((): Schema.Codec<WireJsonValue> => WireJsonValueSchema)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<WireJsonValue> => WireJsonValueSchema),
  ),
]);

const parseWireJsonValue = Schema.decodeUnknownSync(WireJsonValueSchema);
const isWireJsonObject = Schema.is(
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<WireJsonValue> => WireJsonValueSchema),
  ),
);
const parseHerdrTransportRequestOptions = Schema.decodeUnknownEffect(HerdrTransportRequestOptions);

const HerdrWaitEventProbe = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("wait_matched"),
    event: Schema.Struct({ event: Schema.String }),
  }),
});

type TransportOperation = HerdrTransportError["operation"];

/** Constructs the transport while preserving its Herdr configuration requirement. */
export const makeHerdrTransport = Effect.gen(function* () {
  const config = yield* HerdrConfig;

  const requestWithoutCompatibility = <Method extends WireMethod>(
    operation: TransportOperation,
    method: Method,
    params: HerdrWireParameters<Method>,
    options: HerdrTransportRequestOptionsEncoded = {},
  ): Effect.Effect<
    HerdrTransportSuccess<Method>,
    HerdrTransportRequestError | HerdrUnsupportedEvent
  > => {
    return Effect.gen(function* () {
      const parsedOptions = yield* parseHerdrTransportRequestOptions(options).pipe(
        Effect.mapError((cause) => new HerdrInvalidInput("transport.requestOptions", cause)),
      );
      const requestId = Option.getOrElse(parsedOptions.requestId, randomUUID);
      const deadline = Option.getOrElse(parsedOptions.requestTimeout, () => config.requestTimeout);
      const payload = encodeWireRequest(requestId, method, params);
      yield* Effect.annotateCurrentSpan({
        "herdr.method": method,
        "herdr.operation": operation,
      });
      const value = yield* exchangeWireLine(
        config.socketPath,
        payload,
        operation,
        requestId,
        deadline,
      );
      const response = yield* Effect.try({
        try: () => parseHerdrWireResponse(value, requestId),
        catch: (cause) => {
          const eventProbe = Schema.decodeUnknownOption(HerdrWaitEventProbe)(value);
          return method === "events.wait" && Option.isSome(eventProbe)
            ? new HerdrUnsupportedEvent(eventProbe.value.result.event.event, requestId)
            : new HerdrInvalidResponse("schema_mismatch", requestId, cause);
        },
      });

      if (response.id !== requestId) {
        return yield* new HerdrInvalidResponse(
          "correlation_mismatch",
          requestId,
          new Error(`Herdr returned response ID ${response.id}`),
        );
      }
      if (isWireErrorResponse(response)) {
        return yield* new HerdrServerError(response.error.code, response.error.message, requestId);
      }
      if (!isExpectedWireResult(method, response.result)) {
        return yield* new HerdrUnsupportedResult(
          method,
          response.result.type,
          wireResultTypesByMethod[method].join(" or "),
          requestId,
        );
      }
      yield* Effect.annotateCurrentSpan("herdr.result_type", response.result.type);
      return { requestId, result: response.result };
    });
  };

  const pingParameters: HerdrWireParameters<"ping"> = Option.match(config.application, {
    onNone: () => ({}),
    onSome: (application) => ({
      application: {
        name: application.name,
        ...(Option.isSome(application.version) ? { version: application.version.value } : {}),
      },
    }),
  });

  const compatibilityCheck = yield* Effect.cached(
    requestWithoutCompatibility("compatibility_check", "ping", pingParameters).pipe(
      Effect.catchTag("HerdrUnsupportedEvent", Effect.die),
      Effect.flatMap(({ requestId, result }) =>
        result.protocol === config.supportedProtocol
          ? Effect.void
          : Effect.fail(
              new HerdrUnsupportedProtocol(result.protocol, config.supportedProtocol, requestId),
            ),
      ),
    ),
  );

  const openStream = <Method extends "events.subscribe" | "pane.graphics.stream">(
    method: Method,
    params: HerdrWireParameters<Method>,
    options: HerdrTransportRequestOptionsEncoded = {},
  ): Effect.Effect<HerdrTransportStream<Method>, HerdrTransportRequestError, Scope.Scope> => {
    const operation = method === "events.subscribe" ? "event_subscription" : "graphics_stream";

    return Effect.fn("HerdrTransport.openStream")(function* () {
      const parsedOptions = yield* parseHerdrTransportRequestOptions(options).pipe(
        Effect.mapError((cause) => new HerdrInvalidInput("transport.requestOptions", cause)),
      );
      const requestId = Option.getOrElse(parsedOptions.requestId, randomUUID);
      const deadline = Option.getOrElse(parsedOptions.requestTimeout, () => config.requestTimeout);
      const payload = encodeWireRequest(requestId, method, params);
      yield* Effect.annotateCurrentSpan({
        "herdr.method": method,
        "herdr.operation": operation,
      });
      yield* compatibilityCheck;
      return yield* Effect.gen(function* () {
        const socket = yield* Effect.acquireRelease(
          connectSocket(config.socketPath, operation, requestId),
          closeSocket,
        );
        yield* writeSocketPayload(socket, payload, operation, requestId);
        const handshake = yield* readSocketLine(socket, operation, requestId);
        const response = yield* Effect.try({
          try: () => parseHerdrWireResponse(handshake.value, requestId),
          catch: (cause) => new HerdrInvalidResponse("schema_mismatch", requestId, cause),
        });

        if (response.id !== requestId) {
          return yield* new HerdrInvalidResponse(
            "correlation_mismatch",
            requestId,
            new Error(`Herdr returned response ID ${response.id}`),
          );
        }
        if (isWireErrorResponse(response)) {
          return yield* new HerdrServerError(
            response.error.code,
            response.error.message,
            requestId,
          );
        }
        if (!isExpectedWireResult(method, response.result)) {
          return yield* new HerdrUnsupportedResult(
            method,
            response.result.type,
            wireResultTypesByMethod[method].join(" or "),
            requestId,
          );
        }
        yield* Effect.annotateCurrentSpan("herdr.result_type", response.result.type);
        const writeSemaphore = yield* Semaphore.make(1);
        return {
          requestId,
          result: response.result,
          readBytes: makeHerdrSocketByteStream(socket, handshake.remainder, operation, requestId),
          write: (bytes: Uint8Array) =>
            writeSemaphore
              .withPermit(writeSocketPayload(socket, bytes, "graphics_write", requestId))
              .pipe(Effect.onInterrupt(() => closeSocket(socket))),
        };
      }).pipe(
        Effect.timeoutOrElse({
          duration: deadline,
          orElse: () =>
            Effect.fail(new HerdrRequestTimeout(operation, requestId, Duration.toMillis(deadline))),
        }),
      );
    })();
  };

  function request<Method extends HerdrOrdinaryWireMethod>(
    method: Method,
    params: HerdrWireParameters<Method>,
    options?: HerdrTransportRequestOptionsEncoded,
  ): Effect.Effect<HerdrTransportSuccess<Method>, HerdrTransportRequestError>;
  function request(
    method: "events.wait",
    params: HerdrWireParameters<"events.wait">,
    options?: HerdrTransportRequestOptionsEncoded,
  ): Effect.Effect<
    HerdrTransportSuccess<"events.wait">,
    HerdrTransportRequestError | HerdrUnsupportedEvent
  >;
  function request<Method extends WireMethod>(
    method: Method,
    params: HerdrWireParameters<Method>,
    options: HerdrTransportRequestOptionsEncoded = {},
  ): Effect.Effect<
    HerdrTransportSuccess<Method>,
    HerdrTransportRequestError | HerdrUnsupportedEvent
  > {
    return Effect.fn("HerdrTransport.request")(function* () {
      if (method === "ping") {
        const response = yield* requestWithoutCompatibility(
          "compatibility_check",
          method,
          params,
          options,
        );
        yield* verifyProtocolCompatibility(
          response.result,
          response.requestId,
          config.supportedProtocol,
        );
        return response;
      }
      yield* compatibilityCheck;
      return yield* requestWithoutCompatibility("request", method, params, options);
    })();
  }

  return HerdrTransport.of({
    openStream,
    request,
    writeStreamBytes: Effect.fn("HerdrTransport.writeStreamBytes")(function* (
      stream,
      bytes,
      options = {},
    ) {
      const parsedOptions = yield* parseHerdrTransportRequestOptions(options).pipe(
        Effect.mapError((cause) => new HerdrInvalidInput("transport.requestOptions", cause)),
      );
      const deadline = Option.getOrElse(parsedOptions.requestTimeout, () => config.requestTimeout);
      yield* Effect.annotateCurrentSpan({
        "herdr.method": "pane.graphics.stream",
        "herdr.operation": "graphics_write",
      });
      return yield* stream.write(bytes).pipe(
        Effect.timeoutOrElse({
          duration: deadline,
          orElse: () =>
            Effect.fail(
              new HerdrRequestTimeout(
                "graphics_write",
                stream.requestId,
                Duration.toMillis(deadline),
              ),
            ),
        }),
      );
    }),
  });
});

/** Provides the transport while retaining its Herdr configuration requirement. */
export const herdrTransportLayerWithoutDependencies: Layer.Layer<
  HerdrTransport,
  never,
  HerdrConfig
> = Layer.effect(HerdrTransport, makeHerdrTransport);

/** Production transport Layer using the ambient Herdr configuration Layer. */
export const herdrTransportLayer = herdrTransportLayerWithoutDependencies.pipe(
  Layer.provide(herdrConfigLayer),
);

function isExpectedWireResult<Method extends WireMethod>(
  method: Method,
  result: ResponseResult,
): result is WireMethodMap[Method]["result"] {
  const acceptedTypes: readonly string[] = wireResultTypesByMethod[method];
  return acceptedTypes.includes(result.type);
}

function connectSocket(
  socketPath: string,
  operation: TransportOperation,
  requestId: string,
): Effect.Effect<Socket, HerdrTransportError> {
  return Effect.callback<Socket, HerdrTransportError>((resume) => {
    const socket = createConnection(resolveHerdrSocketEndpoint(socketPath));
    let completed = false;
    const cleanup = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = (): void => {
      completed = true;
      cleanup();
      resume(Effect.succeed(socket));
    };
    const onError = (cause: Error): void => {
      completed = true;
      cleanup();
      socket.destroy();
      resume(Effect.fail(new HerdrTransportError(operation, "connect", requestId, cause)));
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    return Effect.sync(() => {
      if (completed) return;
      completed = true;
      cleanup();
      socket.destroy();
    });
  });
}

/** Resolves Herdr's filesystem-shaped IPC name to Node's Windows named-pipe endpoint. */
export function resolveHerdrSocketEndpoint(
  socketPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32" || socketPath.startsWith("\\\\")) return socketPath;
  return `\\\\.\\pipe\\${socketPath}`;
}

function closeSocket(socket: Socket): Effect.Effect<void> {
  return Effect.sync(() => socket.destroy());
}

function makeHerdrSocketByteStream(
  socket: Socket,
  initialBytes: readonly Uint8Array[],
  operation: TransportOperation,
  requestId: string,
): Stream.Stream<Uint8Array, HerdrTransportError> {
  const socketBytes = NodeStream.fromReadable<Uint8Array, HerdrTransportError>({
    evaluate: () => socket,
    onError: (cause) => new HerdrTransportError(operation, "read", requestId, cause),
  });
  return initialBytes.length === 0
    ? socketBytes
    : Stream.concat(Stream.fromIterable(initialBytes), socketBytes);
}

function writeSocketPayload(
  socket: Socket,
  payload: string | Uint8Array,
  operation: TransportOperation,
  requestId: string,
): Effect.Effect<void, HerdrTransportError> {
  return Effect.callback<void, HerdrTransportError>((resume) => {
    let completed = false;
    socket.write(payload, (cause) => {
      if (completed) return;
      completed = true;
      if (cause === undefined || cause === null) resume(Effect.void);
      else {
        resume(Effect.fail(new HerdrTransportError(operation, "write", requestId, cause)));
      }
    });
    return Effect.sync(() => {
      if (completed) return;
      completed = true;
      socket.destroy();
    });
  });
}

interface HerdrSocketLine {
  readonly value: unknown;
  readonly remainder: readonly Uint8Array[];
}

function readSocketLine(
  socket: Socket,
  operation: TransportOperation,
  requestId: string,
): Effect.Effect<HerdrSocketLine, HerdrTransportError | HerdrInvalidResponse> {
  return Effect.gen(function* () {
    const socketBytes = NodeStream.fromReadable<Uint8Array, HerdrTransportError>({
      evaluate: () => socket,
      closeOnDone: false,
      onError: (cause) => new HerdrTransportError(operation, "read", requestId, cause),
    });
    const line = yield* socketBytes.pipe(
      Stream.mapAccumArrayEffect(makeHerdrSocketLineBuffer, (state, chunks) =>
        parseFirstHerdrSocketLine(state, chunks, requestId),
      ),
      Stream.runHead,
    );
    if (Option.isSome(line)) return line.value;
    return yield* new HerdrTransportError(
      operation,
      "premature_close",
      requestId,
      new Error("Herdr closed the socket before sending a complete response line"),
    );
  });
}

function parseFirstHerdrSocketLine(
  state: HerdrSocketLineBuffer,
  chunks: readonly Uint8Array[],
  requestId: string,
): Effect.Effect<
  readonly [HerdrSocketLineBuffer, readonly HerdrSocketLine[]],
  HerdrInvalidResponse
> {
  return Effect.gen(function* () {
    const split = splitHerdrSocketLines(state, chunks, MAX_RESPONSE_LINE_BYTES, requestId, 1);
    if (Result.isFailure(split)) return yield* split.failure;

    const lineBytes = split.success.lines.at(0);
    if (lineBytes === undefined) return [split.success.buffer, []];

    const value = yield* Effect.try({
      try: () => JSON.parse(Buffer.from(lineBytes).toString("utf8")),
      catch: (cause) => new HerdrInvalidResponse("malformed_json", requestId, cause),
    });
    return [split.success.buffer, [{ value, remainder: split.success.remainder }]];
  });
}

function isWireErrorResponse(
  response: ReturnType<typeof parseHerdrWireResponse>,
): response is ErrorResponse {
  return "error" in response && !("result" in response);
}

function verifyProtocolCompatibility(
  result: ResponseResult,
  requestId: string,
  supportedProtocol: 21,
): Effect.Effect<void, HerdrUnsupportedProtocol | HerdrUnsupportedResult> {
  if (result.type !== "pong") {
    return Effect.fail(new HerdrUnsupportedResult("ping", result.type, "pong", requestId));
  }
  return result.protocol === supportedProtocol
    ? Effect.void
    : Effect.fail(new HerdrUnsupportedProtocol(result.protocol, supportedProtocol, requestId));
}

function encodeWireRequest<Method extends WireMethod>(
  requestId: string,
  method: Method,
  params: HerdrWireParameters<Method>,
): string {
  const encodedParams = toSnakeCaseWireValue(parseWireJsonValue(params));
  return `${JSON.stringify({ id: requestId, method, params: encodedParams })}\n`;
}

function toSnakeCaseWireValue(value: WireJsonValue): WireJsonValue {
  if (Array.isArray(value)) return value.map(toSnakeCaseWireValue);
  if (!isWireJsonObject(value)) return value;

  const output: { [key: string]: WireJsonValue } = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    output[toSnakeCaseWireKey(key)] = toSnakeCaseWireValue(child);
  }
  return output;
}

function toSnakeCaseWireKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function exchangeWireLine(
  socketPath: string,
  payload: string,
  operation: TransportOperation,
  requestId: string,
  deadline: Duration.Duration,
): Effect.Effect<unknown, HerdrTransportError | HerdrRequestTimeout | HerdrInvalidResponse> {
  const exchange = Effect.acquireUseRelease(
    connectSocket(socketPath, operation, requestId),
    (socket) =>
      Effect.gen(function* () {
        yield* writeSocketPayload(socket, payload, operation, requestId);
        const response = yield* readSocketLine(socket, operation, requestId);
        return response.value;
      }),
    closeSocket,
  );

  return exchange.pipe(
    Effect.timeoutOrElse({
      duration: deadline,
      orElse: () =>
        Effect.fail(new HerdrRequestTimeout(operation, requestId, Duration.toMillis(deadline))),
    }),
  );
}
