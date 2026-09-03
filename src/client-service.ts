/**
 * Controls state owned by the foreground Herdr client.
 *
 * The client service currently owns persistent window-title overrides and keeps that client-specific capability separate from terminal resources.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Schema } from "effect";
import { ClientWindowTitleResult } from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseClientWindowTitle = Schema.decodeUnknownEffect(Schema.String);
const parseClientWindowTitleResult = Schema.decodeUnknownEffect(ClientWindowTitleResult);

/**
 * Foreground window-title operations owned by the client service.
 *
 * @category services
 * @since 0.8.2
 */
export interface IClientWindowTitle {
  /** Sets the foreground client's window title. */
  readonly set: (
    title: string,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<ClientWindowTitleResult, HerdrTransportRequestError>;
  /** Clears the foreground client's window-title override. */
  readonly clear: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<ClientWindowTitleResult, HerdrTransportRequestError>;
}

/**
 * Foreground Herdr client capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IClientService {
  /** Nested foreground window-title operations. */
  readonly windowTitle: IClientWindowTitle;
}

/**
 * Yieldable Effect service for foreground Herdr client operations.
 *
 * @category services
 * @since 0.8.2
 */
export class ClientService extends Context.Service<ClientService, IClientService>()(
  "@rudironsoni/sdk/ClientService",
) {}

/**
 * Constructs client operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeClientService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return ClientService.of({
    windowTitle: {
      set: defineHerdrOperation("ClientService.windowTitle.set", (title, options = {}) =>
        Effect.gen(function* () {
          const parsedTitle = yield* decodeHerdrInput(
            "ClientService.windowTitle.set",
            parseClientWindowTitle,
            title,
          );
          const response = yield* transport.request(
            "client.window_title.set",
            { title: parsedTitle },
            options,
          );
          return yield* decodeHerdrWire(
            parseClientWindowTitleResult,
            response.result,
            response.requestId,
          );
        }),
      ),
      clear: defineHerdrOperation("ClientService.windowTitle.clear", (options = {}) =>
        Effect.gen(function* () {
          const response = yield* transport.request("client.window_title.clear", {}, options);
          return yield* decodeHerdrWire(
            parseClientWindowTitleResult,
            response.result,
            response.requestId,
          );
        }),
      ),
    },
  });
});

/**
 * Provides client operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const clientServiceLayerWithoutDependencies: Layer.Layer<
  ClientService,
  never,
  HerdrTransport
> = Layer.effect(ClientService, makeClientService);

/**
 * Production client-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const clientServiceLayer = clientServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
