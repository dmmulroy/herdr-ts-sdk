/**
 * Composes the complete Effect-native Herdr SDK.
 *
 * `HerdrSdk` is a yieldable namespace aggregate; its production Layer shares one configuration and transport while direct service Layers preserve visible requirements.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer } from "effect";
import {
  AgentService,
  type IAgentService,
  agentServiceLayerWithoutDependencies,
} from "./agent-service.ts";
import {
  ClientService,
  type IClientService,
  clientServiceLayerWithoutDependencies,
} from "./client-service.ts";
import {
  HerdrConfig,
  type HerdrConfigOptions,
  type IHerdrConfig,
  herdrConfigLayer,
  herdrConfigLayerFromOptions,
} from "./herdr-config.ts";
import { type IHerdrIds, herdrIds } from "./herdr-domain.ts";
import { HerdrConfigurationError } from "./herdr-errors.ts";
import {
  EventService,
  type IEventService,
  eventServiceLayerWithoutDependencies,
} from "./event-service.ts";
import {
  IntegrationService,
  type IIntegrationService,
  integrationServiceLayerWithoutDependencies,
} from "./integration-service.ts";
import {
  LayoutService,
  type ILayoutService,
  layoutServiceLayerWithoutDependencies,
} from "./layout-service.ts";
import {
  NotificationService,
  type INotificationService,
  notificationServiceLayerWithoutDependencies,
} from "./notification-service.ts";
import {
  PaneService,
  type IPaneService,
  paneServiceLayerWithoutDependencies,
} from "./pane-service.ts";
import {
  PluginService,
  type IPluginService,
  pluginServiceLayerWithoutDependencies,
} from "./plugin-service.ts";
import {
  PopupService,
  type IPopupService,
  popupServiceLayerWithoutDependencies,
} from "./popup-service.ts";
import {
  ServerService,
  type IServerService,
  serverServiceLayerWithoutDependencies,
} from "./server-service.ts";
import {
  SessionService,
  type ISessionService,
  sessionServiceLayerWithoutDependencies,
} from "./session-service.ts";
import { TabService, type ITabService, tabServiceLayerWithoutDependencies } from "./tab-service.ts";
import { herdrTransportLayerWithoutDependencies } from "./herdr-transport.ts";
import {
  WorkspaceService,
  type IWorkspaceService,
  workspaceServiceLayerWithoutDependencies,
} from "./workspace-service.ts";
import {
  WorktreeService,
  type IWorktreeService,
  worktreeServiceLayerWithoutDependencies,
} from "./worktree-service.ts";

/**
 * Stripe-style aggregate of the exact Herdr configuration and namespace services.
 *
 * @category services
 * @since 0.8.2
 */
export interface IHerdrSdk {
  /** Immutable configuration snapshot shared by the full SDK graph. */
  readonly config: IHerdrConfig;
  /** Pure schema-owned identifier constructors. */
  readonly ids: IHerdrIds;
  /** Server lifecycle and compatibility operations. */
  readonly server: IServerService;
  /** Session snapshot operations. */
  readonly session: ISessionService;
  /** Foreground notification operations. */
  readonly notifications: INotificationService;
  /** Foreground client operations. */
  readonly client: IClientService;
  /** Workspace operations. */
  readonly workspaces: IWorkspaceService;
  /** Git worktree operations. */
  readonly worktrees: IWorktreeService;
  /** Tab operations. */
  readonly tabs: ITabService;
  /** Pane and graphics operations. */
  readonly panes: IPaneService;
  /** Declarative layout operations. */
  readonly layouts: ILayoutService;
  /** Agent and nested view operations. */
  readonly agents: IAgentService;
  /** Event stream and wait operations. */
  readonly events: IEventService;
  /** Built-in integration operations. */
  readonly integrations: IIntegrationService;
  /** Plugin and nested plugin-resource operations. */
  readonly plugins: IPluginService;
  /** Foreground popup operations. */
  readonly popups: IPopupService;
}

/**
 * Yieldable Effect service aggregating the independently constructed Herdr namespaces.
 *
 * @category services
 * @since 0.8.2
 */
export class HerdrSdk extends Context.Service<HerdrSdk, IHerdrSdk>()("@rudironsoni/sdk/HerdrSdk") {}

/**
 * Aggregates exact contextual service values without constructing or proxying them.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeHerdrSdk = Effect.gen(function* () {
  const config = yield* HerdrConfig;
  const server = yield* ServerService;
  const session = yield* SessionService;
  const notifications = yield* NotificationService;
  const client = yield* ClientService;
  const workspaces = yield* WorkspaceService;
  const worktrees = yield* WorktreeService;
  const tabs = yield* TabService;
  const panes = yield* PaneService;
  const layouts = yield* LayoutService;
  const agents = yield* AgentService;
  const events = yield* EventService;
  const integrations = yield* IntegrationService;
  const plugins = yield* PluginService;
  const popups = yield* PopupService;

  return HerdrSdk.of({
    config,
    ids: herdrIds,
    server,
    session,
    notifications,
    client,
    workspaces,
    worktrees,
    tabs,
    panes,
    layouts,
    agents,
    events,
    integrations,
    plugins,
    popups,
  });
});

/**
 * Bundles Herdr namespace services while preserving their requirements.
 *
 * @category layers
 * @since 0.8.2
 */
export const herdrSdkLayerWithoutDependencies = Layer.effect(HerdrSdk, makeHerdrSdk);

const herdrNamespaceServicesLayerWithoutDependencies = Layer.mergeAll(
  serverServiceLayerWithoutDependencies,
  sessionServiceLayerWithoutDependencies,
  notificationServiceLayerWithoutDependencies,
  clientServiceLayerWithoutDependencies,
  workspaceServiceLayerWithoutDependencies,
  worktreeServiceLayerWithoutDependencies,
  tabServiceLayerWithoutDependencies,
  paneServiceLayerWithoutDependencies,
  layoutServiceLayerWithoutDependencies,
  agentServiceLayerWithoutDependencies,
  eventServiceLayerWithoutDependencies,
  integrationServiceLayerWithoutDependencies,
  pluginServiceLayerWithoutDependencies,
  popupServiceLayerWithoutDependencies,
);

function makeHerdrSdkLayer(configLayer: Layer.Layer<HerdrConfig, HerdrConfigurationError>) {
  const sharedDependencies = herdrTransportLayerWithoutDependencies.pipe(
    Layer.provideMerge(configLayer),
  );
  const configuredNamespaces = herdrNamespaceServicesLayerWithoutDependencies.pipe(
    Layer.provideMerge(sharedDependencies),
  );
  return herdrSdkLayerWithoutDependencies.pipe(Layer.provide(configuredNamespaces));
}

/**
 * Production SDK Layer sharing one ambient configuration and transport instance.
 *
 * @category layers
 * @since 0.8.2
 */
export const herdrSdkLayer = makeHerdrSdkLayer(herdrConfigLayer);

/**
 * Creates a production SDK Layer with explicit options ahead of ambient configuration.
 *
 * @category layers
 * @since 0.8.2
 */
export function herdrSdkLayerFromOptions(
  options: HerdrConfigOptions,
): Layer.Layer<HerdrSdk, HerdrConfigurationError> {
  return makeHerdrSdkLayer(herdrConfigLayerFromOptions(options));
}
