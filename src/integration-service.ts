/**
 * Installs and removes Herdr terminal-agent integrations.
 *
 * The integration service accepts the schema-owned built-in integration targets and returns the server-reported change result.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Schema } from "effect";
import { IntegrationChangeResult, type IntegrationTarget } from "./herdr-models.ts";
import { decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseIntegrationChangeResult = Schema.decodeUnknownEffect(IntegrationChangeResult);

/**
 * Built-in integration installation and removal capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IIntegrationService {
  /** Installs one built-in terminal-agent integration. */
  readonly install: (
    target: IntegrationTarget,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<IntegrationChangeResult, HerdrTransportRequestError>;
  /** Removes one built-in terminal-agent integration. */
  readonly uninstall: (
    target: IntegrationTarget,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<IntegrationChangeResult, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for Herdr integrations.
 *
 * @category services
 * @since 0.8.2
 */
export class IntegrationService extends Context.Service<IntegrationService, IIntegrationService>()(
  "@rudironsoni/sdk/IntegrationService",
) {}

/**
 * Constructs integration operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeIntegrationService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  const change = defineHerdrOperation(
    "IntegrationService.change",
    (
      method: "integration.install" | "integration.uninstall",
      target: IntegrationTarget,
      options: HerdrTransportRequestOptionsEncoded,
    ) =>
      Effect.gen(function* () {
        const response = yield* transport.request(method, { target }, options);
        return yield* decodeHerdrWire(
          parseIntegrationChangeResult,
          {
            target: response.result.target,
            messages: response.result.details.messages,
          },
          response.requestId,
        );
      }),
  );

  return IntegrationService.of({
    install: defineHerdrOperation("IntegrationService.install", (target, options = {}) =>
      change("integration.install", target, options),
    ),
    uninstall: defineHerdrOperation("IntegrationService.uninstall", (target, options = {}) =>
      change("integration.uninstall", target, options),
    ),
  });
});

/**
 * Provides integrations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const integrationServiceLayerWithoutDependencies: Layer.Layer<
  IntegrationService,
  never,
  HerdrTransport
> = Layer.effect(IntegrationService, makeIntegrationService);

/**
 * Production integration-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const integrationServiceLayer = integrationServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
