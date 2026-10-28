/**
 * Marks endpoint release notes seen by their exact current version identity.
 * Version strings include upstream preview identities and are not parsed as semver.
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

/** Identifies the currently displayed release notes. @category schemas @since 0.9.0 */
export const ReleaseNotesDismissInput = Schema.Struct({ version: Schema.String });
/** Parsed release-note dismissal. @category models @since 0.9.0 */
export interface ReleaseNotesDismissInput extends Schema.Schema.Type<
  typeof ReleaseNotesDismissInput
> {}
/** Caller-supplied release-note version identity. @category inputs @since 0.9.0 */
export type ReleaseNotesDismissInputEncoded = typeof ReleaseNotesDismissInput.Encoded;
const parseDismiss = Schema.decodeEffect(ReleaseNotesDismissInput, { onExcessProperty: "error" });

/** Endpoint release-note acknowledgement capability. @category services @since 0.9.0 */
export interface IReleaseNotesService {
  /** Marks exact current release notes seen; stale_release_notes is not retried. */
  readonly dismiss: (
    input: ReleaseNotesDismissInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
}
/** Yieldable release-note capability. @category services @since 0.9.0 */
export class ReleaseNotesService extends Context.Service<
  ReleaseNotesService,
  IReleaseNotesService
>()("herdr-sdk/ReleaseNotesService") {}
/** Constructs release-note dismissal using the shared transport. @category constructors @since 0.9.0 */
export const makeReleaseNotesService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return ReleaseNotesService.of({
    dismiss: defineHerdrOperation("ReleaseNotesService.dismiss", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("ReleaseNotesService.dismiss", parseDismiss, input);
        yield* transport.request("release_notes.dismiss", parsed, options);
      }),
    ),
  });
});
/** Provides release notes with a visible transport requirement. @category layers @since 0.9.0 */
export const releaseNotesServiceLayerWithoutDependencies = Layer.effect(
  ReleaseNotesService,
  makeReleaseNotesService,
);
/** Production release-notes Layer. @category layers @since 0.9.0 */
export const releaseNotesServiceLayer = releaseNotesServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
