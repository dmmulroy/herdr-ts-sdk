/**
 * Reads an immutable snapshot of the active Herdr session.
 *
 * A session snapshot returns workspaces, tabs, panes, agents, focus, and protocol state from one consistent server response.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Schema } from "effect";
import { SessionSnapshot } from "./herdr-models.ts";
import { decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseSessionSnapshot = Schema.decodeUnknownEffect(SessionSnapshot);

/**
 * Session snapshot capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface ISessionService {
  /** Reads one consistent snapshot of all session resources. */
  readonly snapshot: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<SessionSnapshot, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for Herdr session operations.
 *
 * @category services
 * @since 0.8.2
 */
export class SessionService extends Context.Service<SessionService, ISessionService>()(
  "@herdr/sdk/SessionService",
) {}

/**
 * Constructs session operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeSessionService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return SessionService.of({
    snapshot: defineHerdrOperation("SessionService.snapshot", (options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("session.snapshot", {}, options);
        return yield* decodeHerdrWire(
          parseSessionSnapshot,
          response.result.snapshot,
          response.requestId,
        );
      }),
    ),
  });
});

/**
 * Provides session operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const sessionServiceLayerWithoutDependencies: Layer.Layer<
  SessionService,
  never,
  HerdrTransport
> = Layer.effect(SessionService, makeSessionService);

/**
 * Production session-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const sessionServiceLayer = sessionServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
