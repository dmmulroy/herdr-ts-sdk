/**
 * Owns a bounded, scoped generation-1 client-shell connection and its correlated requests.
 * Binary reads, health probes, and response routing are independent of presentation consumers.
 * @since 0.9.0
 */
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { NodeStream } from "@effect/platform-node-shared";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Option,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { type WireMethod, type WireMethodMap } from "./generated/wire-method-map.ts";
import type { SuccessResponse } from "./generated/wire-success-response.ts";
import type { ErrorResponse } from "./generated/wire-error-response.ts";
import { HerdrServerError, HerdrUnsupportedResult } from "./herdr-errors.ts";
import {
  HerdrEndpointClosed,
  HerdrEndpointInvalidMessage,
  HerdrEndpointNegotiationError,
  HerdrEndpointRequestTimeout,
  HerdrEndpointTransportError,
  HerdrEndpointUnsupportedMethod,
  type HerdrEndpointFailure,
} from "./herdr-endpoint-errors.ts";
import {
  decodeEndpointMessage,
  encodeEndpointControl,
  encodeEndpointRequest,
  type EndpointServerMessage,
} from "./herdr-endpoint-codecs.ts";
import { encodeWireRequest, type HerdrWireParameters } from "./herdr-wire-encoder.ts";
import { isExpectedWireResult, parseHerdrWireResponse } from "./herdr-wire-parser.ts";
import { type HerdrStreamWireMethod, resolveHerdrSocketEndpoint } from "./herdr-transport.ts";

const EndpointWelcome = Schema.Struct({
  generation: Schema.Natural,
  server_version: Schema.String,
  snapshot_codec: Schema.String,
  surface_codec: Schema.String,
  input_codec: Schema.String,
  blob_codec: Schema.String,
  methods: Schema.Array(Schema.String),
  capabilities: Schema.Array(Schema.String),
  error: Schema.OptionFromOptionalNullOr(
    Schema.Struct({ code: Schema.String, message: Schema.String }),
  ),
});
const parseWelcome = Schema.decodeEffect(Schema.fromJsonString(EndpointWelcome));
const parseEndpointErrorBody = Schema.decodeUnknownEffect(
  Schema.Struct({ code: Schema.String, message: Schema.String }),
);

/** Parsed connection settings owned by ClientShellService. @category models @since 0.9.0 */
export interface EndpointConnectionSettings {
  /** Explicit client endpoint, not the ordinary API socket. */
  readonly socketPath: string;
  /** Initial negotiated hello JSON with fixed supported codec names. */
  readonly hello: string;
  /** Acquisition/write/request deadline in milliseconds. */
  readonly timeoutMs: number;
  /** Hard bound on one binary frame and one reassembled response. */
  readonly maximumBytes: number;
}
/** Request errors preserve server rejection separately from connection failure. @category errors @since 0.9.0 */
export type EndpointRequestError =
  | HerdrEndpointFailure
  | HerdrEndpointUnsupportedMethod
  | HerdrServerError
  | HerdrUnsupportedResult;
/** Connection-local request methods; connection-scoped API-socket streams use their own transport. @category models @since 0.9.0 */
export type EndpointRequestMethod = Exclude<WireMethod, HerdrStreamWireMethod>;
/** Internal protocol connection; only ClientShellService exposes domain operations. @category services @since 0.9.0 */
export interface EndpointWireConnection {
  /** Negotiated endpoint version and advertised capability names. */
  readonly welcome: typeof EndpointWelcome.Type;
  /** Changes boot binding only when the owning projection decoder accepts its initial snapshot. */
  readonly bindBoot: (bootId: string) => Effect.Effect<void, HerdrEndpointFailure>;
  /** Installs the single presentation/control handler; queued pre-install messages are bounded. */
  readonly installHandler: (
    handler: (message: EndpointServerMessage) => Effect.Effect<void, HerdrEndpointFailure>,
  ) => Effect.Effect<void, HerdrEndpointFailure>;
  /** Sends a serialized complete binary frame; ambiguous writes invalidate the connection. */
  readonly write: (encode: () => Uint8Array) => Effect.Effect<void, HerdrEndpointFailure>;
  /** Sends one method-indexed request on this endpoint connection. */
  readonly request: <M extends EndpointRequestMethod>(
    method: M,
    params: HerdrWireParameters<M>,
  ) => Effect.Effect<
    { readonly requestId: string; readonly result: WireMethodMap[M]["result"] },
    EndpointRequestError
  >;
  /** Fails when the owning session or endpoint connection ends. */
  readonly failure: Effect.Effect<never, HerdrEndpointFailure>;
  /** Checks handle liveness without performing I/O. */
  readonly ensureOpen: Effect.Effect<void, HerdrEndpointClosed>;
  /** Preserves a terminal protocol failure for consumers starting after that failure. */
  readonly ensureHealthy: Effect.Effect<void, HerdrEndpointFailure>;
  /** Terminates the connection and all pending work with a bounded classified failure. */
  readonly fail: (error: HerdrEndpointFailure) => Effect.Effect<void>;
}

type PendingEndpointRequest = {
  readonly result: Deferred.Deferred<SuccessResponse | ErrorResponse, HerdrEndpointFailure>;
  readonly chunks: Uint8Array[];
  byteLength: number;
};

function connectEndpointSocket(path: string): Effect.Effect<Socket, HerdrEndpointTransportError> {
  return Effect.callback((resume) => {
    const socket = createConnection(resolveHerdrSocketEndpoint(path));
    let connected = false;
    const onError = () => {
      if (!connected) resume(Effect.fail(new HerdrEndpointTransportError("connect")));
    };
    socket.on("error", onError);
    socket.once("close", () => socket.off("error", onError));
    socket.once("connect", () => {
      connected = true;
      resume(Effect.succeed(socket));
    });
    return Effect.sync(() => {
      if (!connected) socket.destroy();
    });
  });
}

/** Acquires one endpoint socket with bounded framing and complete callback cancellation cleanup. @category constructors @since 0.9.0 */
export const acquireEndpointConnection = (
  settings: EndpointConnectionSettings,
): Effect.Effect<EndpointWireConnection, HerdrEndpointFailure, Scope.Scope> =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(
      connectEndpointSocket(settings.socketPath).pipe(
        Effect.timeoutOrElse({
          duration: settings.timeoutMs,
          orElse: () => Effect.fail(new HerdrEndpointRequestTimeout("connect")),
        }),
        Effect.interruptible,
      ),
      (connection) =>
        Effect.sync(() => {
          connection.destroy();
        }),
    );
    const stopped = yield* Deferred.make<never, HerdrEndpointFailure>();
    const welcomeReady = yield* Deferred.make<typeof EndpointWelcome.Type, HerdrEndpointFailure>();
    const pending = new Map<string, PendingEndpointRequest>();
    const writeLock = yield* Semaphore.make(1);
    const routeLock = yield* Semaphore.make(1);
    let closed = false;
    let bootId: string | undefined;
    let welcomed = false;
    let handler:
      | ((message: EndpointServerMessage) => Effect.Effect<void, HerdrEndpointFailure>)
      | undefined;
    const earlyMessages: EndpointServerMessage[] = [];
    let earlyBytes = 0;
    const ensureOpen = Effect.suspend(() =>
      closed ? Effect.fail(new HerdrEndpointClosed()) : Effect.void,
    );
    const fail = (error: HerdrEndpointFailure) =>
      Effect.gen(function* () {
        if (closed) return;
        closed = true;
        socket.destroy();
        yield* Deferred.fail(stopped, error);
        yield* Deferred.fail(welcomeReady, error);
        for (const entry of pending.values()) yield* Deferred.fail(entry.result, error);
        pending.clear();
        earlyMessages.length = 0;
        earlyBytes = 0;
      });
    yield* Effect.addFinalizer(() => fail(new HerdrEndpointClosed()));

    const write = (encode: () => Uint8Array) =>
      writeLock.withPermit(
        Effect.gen(function* () {
          yield* ensureOpen;
          const bytes = yield* Effect.try({
            try: encode,
            catch: (error) =>
              error instanceof HerdrEndpointInvalidMessage
                ? error
                : new HerdrEndpointInvalidMessage("framing"),
          });
          if (bytes.length > settings.maximumBytes + 4)
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("oversized_frame"));
          yield* Effect.callback<void, HerdrEndpointTransportError>((resume) => {
            socket.write(bytes, (error) =>
              resume(error ? Effect.fail(new HerdrEndpointTransportError("write")) : Effect.void),
            );
          }).pipe(
            Effect.timeoutOrElse({
              duration: settings.timeoutMs,
              orElse: () => Effect.fail(new HerdrEndpointRequestTimeout("write")),
            }),
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? fail(
                    Option.getOrElse(
                      Cause.findErrorOption(exit.cause),
                      () => new HerdrEndpointClosed(),
                    ),
                  )
                : Effect.void,
            ),
          );
        }),
      );

    const receive = (
      message: EndpointServerMessage,
      byteLength: number,
    ): Effect.Effect<void, HerdrEndpointFailure> =>
      Effect.gen(function* () {
        if (!welcomed) {
          if (message.kind !== "control" || message.name !== "endpoint.welcome.v1")
            return yield* Effect.fail(new HerdrEndpointNegotiationError("welcome"));
          const welcome = yield* parseWelcome(message.data).pipe(
            Effect.mapError(() => new HerdrEndpointNegotiationError("welcome")),
          );
          if (Option.isSome(welcome.error))
            return yield* Effect.fail(new HerdrEndpointNegotiationError("rejected"));
          if (welcome.generation !== 1)
            return yield* Effect.fail(new HerdrEndpointNegotiationError("generation"));
          if (
            welcome.snapshot_codec !== "shell.snapshot.v1" ||
            welcome.surface_codec !== "shell.surface.v1" ||
            welcome.input_codec !== "shell.input.semantic.v1" ||
            welcome.blob_codec !== "shell.blob.v1"
          )
            return yield* Effect.fail(new HerdrEndpointNegotiationError("codec"));
          if (
            !welcome.capabilities.includes("surface_interest") ||
            !welcome.capabilities.includes("health_check")
          )
            return yield* Effect.fail(new HerdrEndpointNegotiationError("capability"));
          welcomed = true;
          yield* Deferred.succeed(welcomeReady, welcome);
          return;
        }
        if (message.kind === "shutdown") return yield* Effect.fail(new HerdrEndpointClosed());
        if (message.kind === "response") {
          const entry = pending.get(message.requestId);
          if (entry === undefined || message.bootId !== bootId)
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("correlation"));
          entry.byteLength += message.data.length;
          const bufferedBytes = [...pending.values()].reduce(
            (total, request) => total + request.byteLength,
            0,
          );
          if (
            bufferedBytes > settings.maximumBytes ||
            entry.chunks.length >= 4096 ||
            (message.data.length === 0 && !message.finalChunk)
          )
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("resource_limit"));
          entry.chunks.push(message.data);
          if (!message.finalChunk) return;
          const response = yield* Effect.try({
            try: () =>
              parseHerdrWireResponse(
                JSON.parse(
                  new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(entry.chunks)),
                ),
                message.requestId,
              ),
            catch: () => new HerdrEndpointInvalidMessage("schema"),
          });
          if (response.id !== message.requestId)
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("correlation"));
          pending.delete(message.requestId);
          yield* Deferred.succeed(entry.result, response);
          return;
        }
        yield* routeLock.withPermit(
          Effect.gen(function* () {
            if (handler !== undefined) return yield* handler(message);
            earlyBytes += byteLength;
            if (earlyMessages.length >= 64 || earlyBytes > settings.maximumBytes)
              return yield* Effect.fail(new HerdrEndpointInvalidMessage("resource_limit"));
            earlyMessages.push(message);
          }),
        );
      });

    let headerOffset = 0;
    const header = Buffer.alloc(4);
    let payload: Buffer | undefined;
    let payloadOffset = 0;
    const reader = NodeStream.fromReadable<Uint8Array, HerdrEndpointTransportError>({
      evaluate: () => socket,
      onError: () => new HerdrEndpointTransportError("read"),
    }).pipe(
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          let offset = 0;
          while (offset < chunk.length) {
            if (payload === undefined) {
              const count = Math.min(4 - headerOffset, chunk.length - offset);
              header.set(chunk.subarray(offset, offset + count), headerOffset);
              headerOffset += count;
              offset += count;
              if (headerOffset < 4) continue;
              const length = header.readUInt32LE();
              if (length === 0 || length > settings.maximumBytes)
                return yield* Effect.fail(new HerdrEndpointInvalidMessage("oversized_frame"));
              payload = Buffer.alloc(length);
              payloadOffset = 0;
              headerOffset = 0;
            }
            const count = Math.min(payload.length - payloadOffset, chunk.length - offset);
            payload.set(chunk.subarray(offset, offset + count), payloadOffset);
            payloadOffset += count;
            offset += count;
            if (payloadOffset === payload.length) {
              const message = yield* Result.match(decodeEndpointMessage(payload), {
                onFailure: Effect.fail,
                onSuccess: Effect.succeed,
              });
              const length = payload.length;
              payload = undefined;
              payloadOffset = 0;
              yield* receive(message, length);
            }
          }
        }),
      ),
      Effect.andThen(Effect.fail(new HerdrEndpointTransportError("premature_close"))),
      Effect.catch(fail),
    );
    yield* reader.pipe(Effect.forkScoped);
    yield* write(() => encodeEndpointControl("endpoint.hello.v1", settings.hello));
    const welcome = yield* Deferred.await(welcomeReady).pipe(
      Effect.timeoutOrElse({
        duration: settings.timeoutMs,
        orElse: () => Effect.fail(new HerdrEndpointRequestTimeout("connect")),
      }),
      Effect.tapError(fail),
    );

    const request = <M extends EndpointRequestMethod>(
      method: M,
      params: HerdrWireParameters<M>,
    ): Effect.Effect<
      { readonly requestId: string; readonly result: WireMethodMap[M]["result"] },
      EndpointRequestError
    > =>
      Effect.gen(function* () {
        yield* ensureOpen;
        if (!welcome.methods.includes(method))
          return yield* Effect.fail(new HerdrEndpointUnsupportedMethod(method));
        if (bootId === undefined)
          return yield* Effect.fail(new HerdrEndpointInvalidMessage("revision"));
        if (pending.size >= 32)
          return yield* Effect.fail(new HerdrEndpointInvalidMessage("resource_limit"));
        const requestBootId = bootId;
        const requestId = randomUUID();
        const result = yield* Deferred.make<
          SuccessResponse | ErrorResponse,
          HerdrEndpointFailure
        >();
        pending.set(requestId, { result, chunks: [], byteLength: 0 });
        const response = yield* Effect.gen(function* () {
          yield* write(() =>
            encodeEndpointRequest(
              requestBootId,
              encodeWireRequest(requestId, method, params).trimEnd(),
            ),
          );
          return yield* Deferred.await(result);
        }).pipe(
          Effect.timeoutOrElse({
            duration: settings.timeoutMs,
            orElse: () => Effect.fail(new HerdrEndpointRequestTimeout("request")),
          }),
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              pending.delete(requestId);
              if (Exit.isFailure(exit))
                yield* fail(
                  Option.getOrElse(
                    Cause.findErrorOption(exit.cause),
                    () => new HerdrEndpointClosed(),
                  ),
                );
            }),
          ),
        );
        if ("error" in response) {
          const error = yield* parseEndpointErrorBody(response.error).pipe(
            Effect.mapError(() => new HerdrEndpointInvalidMessage("schema")),
          );
          return yield* Effect.fail(new HerdrServerError(error.code, error.message, requestId));
        }
        if (!isExpectedWireResult(method, response.result))
          return yield* Effect.fail(
            new HerdrUnsupportedResult(method, response.result.type, method, requestId),
          );
        return { requestId, result: response.result };
      });

    return {
      welcome,
      write,
      request,
      failure: Deferred.await(stopped),
      ensureOpen,
      fail,
      ensureHealthy: Effect.suspend(() => (closed ? Deferred.await(stopped) : Effect.void)),
      bindBoot: (id) =>
        Effect.gen(function* () {
          yield* ensureOpen;
          if (bootId !== undefined && bootId !== id)
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("revision"));
          bootId = id;
        }),
      installHandler: (next) =>
        routeLock.withPermit(
          Effect.gen(function* () {
            yield* ensureOpen;
            if (handler !== undefined)
              return yield* Effect.fail(new HerdrEndpointInvalidMessage("resource_limit"));
            handler = next;
            for (const message of earlyMessages) yield* next(message);
            earlyMessages.length = 0;
            earlyBytes = 0;
          }),
        ),
    };
  });
