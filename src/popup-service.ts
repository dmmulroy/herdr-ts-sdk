import { Context, Effect, Layer } from "effect";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

/** Foreground popup lifecycle capability. */
export interface IPopupService {
  /** Closes the active foreground popup. */
  readonly close: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
}

/** Yieldable Effect service for foreground popup operations. */
export class PopupService extends Context.Service<PopupService, IPopupService>()(
  "@herdr/sdk/PopupService",
) {}

/** Constructs popup operations while preserving the shared transport requirement. */
export const makePopupService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return PopupService.of({
    close: defineHerdrOperation("PopupService.close", (options = {}) =>
      transport.request("popup.close", {}, options).pipe(Effect.asVoid),
    ),
  });
});

/** Provides popup operations while retaining the shared transport requirement. */
export const popupServiceLayerWithoutDependencies: Layer.Layer<
  PopupService,
  never,
  HerdrTransport
> = Layer.effect(PopupService, makePopupService);

/** Production popup-service Layer using the ambient Herdr transport graph. */
export const popupServiceLayer = popupServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
