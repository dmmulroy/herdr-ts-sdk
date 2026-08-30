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

/** Foreground window-title operations owned by the client service. */
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

/** Foreground Herdr client capability. */
export interface IClientService {
  /** Nested foreground window-title operations. */
  readonly windowTitle: IClientWindowTitle;
}

/** Yieldable Effect service for foreground Herdr client operations. */
export class ClientService extends Context.Service<ClientService, IClientService>()(
  "@herdr/sdk/ClientService",
) {}

/** Constructs client operations while preserving the shared transport requirement. */
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

/** Provides client operations while retaining the shared transport requirement. */
export const clientServiceLayerWithoutDependencies: Layer.Layer<
  ClientService,
  never,
  HerdrTransport
> = Layer.effect(ClientService, makeClientService);

/** Production client-service Layer using the ambient Herdr transport graph. */
export const clientServiceLayer = clientServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
