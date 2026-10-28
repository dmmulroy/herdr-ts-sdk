/**
 * Dismisses the current endpoint-owned product announcement by its exact identity.
 * Stale identities are server failures, never silently replaced by a newer announcement.
 * @since 0.9.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import { decodeHerdrInput } from "./herdr-schema-boundary.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

/** Opaque announcement identity within a version. @category schemas @since 0.9.0 */
export const ProductAnnouncementId = Schema.NonEmptyString.pipe(
  Schema.brand("ProductAnnouncementId"),
);
/** Parsed product announcement identifier. @category models @since 0.9.0 */
export type ProductAnnouncementId = typeof ProductAnnouncementId.Type;
/** Exact current announcement identity; version is not assumed to be semver. @category schemas @since 0.9.0 */
export const ProductAnnouncementDismissInput = Schema.Struct({
  version: Schema.String,
  id: ProductAnnouncementId,
});
/** Parsed announcement dismissal. @category models @since 0.9.0 */
export interface ProductAnnouncementDismissInput extends Schema.Schema.Type<
  typeof ProductAnnouncementDismissInput
> {}
/** Caller-supplied announcement identity. @category inputs @since 0.9.0 */
export type ProductAnnouncementDismissInputEncoded = typeof ProductAnnouncementDismissInput.Encoded;
const parseDismiss = Schema.decodeEffect(ProductAnnouncementDismissInput, {
  onExcessProperty: "error",
});

/** Endpoint product announcement lifecycle. @category services @since 0.9.0 */
export interface IProductAnnouncementService {
  /** Dismisses an exact identity; stale_announcement is never retried. */
  readonly dismiss: (
    input: ProductAnnouncementDismissInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
}
/** Yieldable product announcement capability. @category services @since 0.9.0 */
export class ProductAnnouncementService extends Context.Service<
  ProductAnnouncementService,
  IProductAnnouncementService
>()("herdr-sdk/ProductAnnouncementService") {}
/** Constructs announcement dismissal on the shared transport. @category constructors @since 0.9.0 */
export const makeProductAnnouncementService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return ProductAnnouncementService.of({
    dismiss: defineHerdrOperation("ProductAnnouncementService.dismiss", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "ProductAnnouncementService.dismiss",
          parseDismiss,
          input,
        );
        yield* transport.request("product_announcement.dismiss", parsed, options);
      }),
    ),
  });
});
/** Provides announcement operations with visible transport requirements. @category layers @since 0.9.0 */
export const productAnnouncementServiceLayerWithoutDependencies = Layer.effect(
  ProductAnnouncementService,
  makeProductAnnouncementService,
);
/** Production announcement-service Layer. @category layers @since 0.9.0 */
export const productAnnouncementServiceLayer =
  productAnnouncementServiceLayerWithoutDependencies.pipe(Layer.provide(herdrTransportLayer));
