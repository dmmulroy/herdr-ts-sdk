/**
 * Public entrypoint for the Effect-native Herdr SDK.
 *
 * Re-exports the root SDK, configuration, domain schemas, normalized models, typed errors,
 * transport options, namespace services, constructors, and Layers. Generated wire contracts and
 * socket implementation details remain private.
 *
 * @since 0.8.2
 */
export * from "./herdr-sdk.ts";
export * from "./herdr-config.ts";
export * from "./herdr-domain.ts";
export * from "./herdr-models.ts";
export * from "./herdr-pane-interaction-models.ts";
export type { IPaneInteraction } from "./pane-interaction.ts";
export * from "./herdr-errors.ts";
export {
  HerdrTransport,
  HerdrTransportRequestOptions,
  herdrTransportLayer,
  herdrTransportLayerWithoutDependencies,
} from "./herdr-transport.ts";
export type {
  HerdrStreamWireMethod,
  HerdrTransportMethodError,
  HerdrTransportRequestError,
  HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";
export * from "./server-service.ts";
export * from "./session-service.ts";
export * from "./notification-service.ts";
export * from "./client-service.ts";
export * from "./command-service.ts";
export * from "./client-shell-service.ts";
export * from "./herdr-client-shell-models.ts";
export * from "./herdr-client-shell-input.ts";
export * from "./herdr-endpoint-errors.ts";
export * from "./product-announcement-service.ts";
export * from "./release-notes-service.ts";
export * from "./workspace-service.ts";
export * from "./worktree-service.ts";
export * from "./tab-service.ts";
export * from "./pane-service.ts";
export * from "./layout-service.ts";
export * from "./agent-service.ts";
export * from "./event-service.ts";
export * from "./integration-service.ts";
export * from "./plugin-service.ts";
export * from "./popup-service.ts";
