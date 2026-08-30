/**
 * Controls the active foreground popup.
 *
 * Popup closure remains separate from plugin-pane lifecycle because it targets client UI state rather than a persistent pane resource.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer } from "effect";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

/**
 * Foreground popup lifecycle capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPopupService {
  /** Closes the active foreground popup. */
  readonly close: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for foreground popup operations.
 *
 * @category services
 * @since 0.8.2
 */
export class PopupService extends Context.Service<PopupService, IPopupService>()(
  "@herdr/sdk/PopupService",
) {}

/**
 * Constructs popup operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makePopupService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return PopupService.of({
    close: defineHerdrOperation("PopupService.close", (options = {}) =>
      transport.request("popup.close", {}, options).pipe(Effect.asVoid),
    ),
  });
});

/**
 * Provides popup operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const popupServiceLayerWithoutDependencies: Layer.Layer<
  PopupService,
  never,
  HerdrTransport
> = Layer.effect(PopupService, makePopupService);

/**
 * Production popup-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const popupServiceLayer = popupServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
