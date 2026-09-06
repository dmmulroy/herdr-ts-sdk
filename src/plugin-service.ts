/**
 * Manages installed plugins and their actions, logs, links, and panes.
 *
 * Nested plugin capabilities remain parent-owned while preserving placement-specific pane results and schema-normalized invocation context.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import { type PaneId, type PluginActionId, type PluginId } from "./herdr-domain.ts";
import {
  InstalledPlugin,
  PluginAction,
  PluginActionInvocation,
  PluginActionInvokeInput,
  type PluginActionInvokeInputEncoded,
  PluginCommandLog,
  PluginFilterInput,
  type PluginFilterInputEncoded,
  PluginLinkInput,
  type PluginLinkInputEncoded,
  PluginLogListInput,
  type PluginLogListInputEncoded,
  PluginPane,
  PluginPaneCloseResult,
  PluginPaneOpenInput,
  type PluginPaneOpenInputEncoded,
  PluginUnlinkResult,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { HerdrUnsupportedResult } from "./herdr-errors.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseInstalledPlugin = Schema.decodeUnknownEffect(InstalledPlugin);
const parseInstalledPlugins = Schema.decodeUnknownEffect(Schema.Array(InstalledPlugin));
const parsePluginActionInvocation = Schema.decodeUnknownEffect(PluginActionInvocation);
const parsePluginActions = Schema.decodeUnknownEffect(Schema.Array(PluginAction));
const parsePluginCommandLogs = Schema.decodeUnknownEffect(Schema.Array(PluginCommandLog));
const parsePluginFilterInput = Schema.decodeEffect(PluginFilterInput);
const parsePluginActionInvokeInput = Schema.decodeEffect(PluginActionInvokeInput);
const parsePluginLinkInput = Schema.decodeEffect(PluginLinkInput);
const parsePluginLogListInput = Schema.decodeEffect(PluginLogListInput);
const parsePluginPane = Schema.decodeUnknownEffect(PluginPane);
const parsePluginPaneCloseResult = Schema.decodeUnknownEffect(PluginPaneCloseResult);
const parsePluginPaneOpenInput = Schema.decodeEffect(PluginPaneOpenInput);
const parsePluginUnlinkResult = Schema.decodeUnknownEffect(PluginUnlinkResult);

/**
 * Nested plugin action capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPluginActions {
  /** Lists actions, optionally for one plugin. */
  readonly list: (
    input?: PluginFilterInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly PluginAction[], HerdrTransportRequestError>;
  /** Invokes one qualified or plugin-scoped action. */
  readonly invoke: (
    id: PluginActionId,
    input?: PluginActionInvokeInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PluginActionInvocation, HerdrTransportRequestError>;
}

/**
 * Nested plugin command-log capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPluginLogs {
  /** Lists recent plugin command logs. */
  readonly list: (
    input?: PluginLogListInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly PluginCommandLog[], HerdrTransportRequestError>;
}

/**
 * Nested plugin pane capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPluginPanes {
  /** Opens a popup plugin pane without a persistent pane identifier. */
  readonly open: {
    (
      pluginId: PluginId,
      input: PluginPaneOpenInputEncoded & { readonly placement: "popup" },
      options?: HerdrTransportRequestOptionsEncoded,
    ): Effect.Effect<void, HerdrTransportRequestError>;
    (
      pluginId: PluginId,
      input: PluginPaneOpenInputEncoded & {
        readonly placement: "overlay" | "split" | "tab" | "zoomed";
      },
      options?: HerdrTransportRequestOptionsEncoded,
    ): Effect.Effect<PluginPane, HerdrTransportRequestError>;
    (
      pluginId: PluginId,
      input: PluginPaneOpenInputEncoded,
      options?: HerdrTransportRequestOptionsEncoded,
    ): Effect.Effect<PluginPane | void, HerdrTransportRequestError>;
  };
  /** Focuses one plugin-owned pane. */
  readonly focus: (
    paneId: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PluginPane, HerdrTransportRequestError>;
  /** Closes one plugin-owned pane. */
  readonly close: (
    paneId: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PluginPaneCloseResult, HerdrTransportRequestError>;
}

/**
 * Plugin lifecycle plus nested action, log, and pane capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPluginService {
  /** Nested plugin action operations. */
  readonly actions: IPluginActions;
  /** Nested plugin command-log operations. */
  readonly logs: IPluginLogs;
  /** Nested plugin pane operations. */
  readonly panes: IPluginPanes;
  /** Links a plugin manifest from an absolute path. */
  readonly link: (
    input: PluginLinkInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<InstalledPlugin, HerdrTransportRequestError>;
  /** Lists installed plugins, optionally selecting one. */
  readonly list: (
    input?: PluginFilterInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly InstalledPlugin[], HerdrTransportRequestError>;
  /** Unlinks one installed plugin. */
  readonly unlink: (
    id: PluginId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PluginUnlinkResult, HerdrTransportRequestError>;
  /** Enables one installed plugin. */
  readonly enable: (
    id: PluginId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<InstalledPlugin, HerdrTransportRequestError>;
  /** Disables one installed plugin. */
  readonly disable: (
    id: PluginId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<InstalledPlugin, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for Herdr plugin operations.
 *
 * @category services
 * @since 0.8.2
 */
export class PluginService extends Context.Service<PluginService, IPluginService>()(
  "@herdr/sdk/PluginService",
) {}

/**
 * Constructs plugin operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makePluginService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  function openPluginPane(
    pluginId: PluginId,
    input: PluginPaneOpenInputEncoded & { readonly placement: "popup" },
    options?: HerdrTransportRequestOptionsEncoded,
  ): Effect.Effect<void, HerdrTransportRequestError>;
  function openPluginPane(
    pluginId: PluginId,
    input: PluginPaneOpenInputEncoded & {
      readonly placement: "overlay" | "split" | "tab" | "zoomed";
    },
    options?: HerdrTransportRequestOptionsEncoded,
  ): Effect.Effect<PluginPane, HerdrTransportRequestError>;
  function openPluginPane(
    pluginId: PluginId,
    input: PluginPaneOpenInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ): Effect.Effect<PluginPane | void, HerdrTransportRequestError>;
  function openPluginPane(
    pluginId: PluginId,
    input: PluginPaneOpenInputEncoded,
    options: HerdrTransportRequestOptionsEncoded = {},
  ): Effect.Effect<PluginPane | void, HerdrTransportRequestError> {
    return Effect.fn("PluginService.panes.open")(function* () {
      const parsed = yield* decodeHerdrInput(
        "PluginService.panes.open",
        parsePluginPaneOpenInput,
        input,
      );
      const base = {
        pluginId,
        entrypoint: parsed.entrypoint,
        placement: Option.getOrNull(parsed.placement),
        width: Option.getOrNull(parsed.width),
        height: Option.getOrNull(parsed.height),
        workspaceId: Option.getOrNull(parsed.workspaceId),
        targetPaneId: Option.getOrNull(parsed.targetPaneId),
        direction: Option.getOrNull(parsed.direction),
        cwd: Option.getOrNull(parsed.cwd),
      };
      const withEnv = Option.match(parsed.env, {
        onNone: () => base,
        onSome: (env) => ({ ...base, env }),
      });
      const parameters = Option.match(parsed.focus, {
        onNone: () => withEnv,
        onSome: (focus) => ({ ...withEnv, focus }),
      });
      const response = yield* transport.request("plugin.pane.open", parameters, options);
      const placement = Option.getOrUndefined(parsed.placement);
      if (placement === "popup") {
        if (response.result.type === "ok") return;
        return yield* new HerdrUnsupportedResult(
          "plugin.pane.open",
          response.result.type,
          "ok",
          response.requestId,
        );
      }
      if (placement !== undefined && response.result.type === "ok") {
        return yield* new HerdrUnsupportedResult(
          "plugin.pane.open",
          response.result.type,
          "plugin_pane_opened",
          response.requestId,
        );
      }
      if (response.result.type === "ok") return;
      return yield* decodeHerdrWire(
        parsePluginPane,
        response.result.plugin_pane,
        response.requestId,
      );
    })();
  }

  const actions: IPluginActions = {
    list: defineHerdrOperation("PluginService.actions.list", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "PluginService.actions.list",
          parsePluginFilterInput,
          input,
        );
        const response = yield* transport.request(
          "plugin.action.list",
          { pluginId: Option.getOrNull(parsed.pluginId) },
          options,
        );
        return yield* decodeHerdrWire(
          parsePluginActions,
          response.result.actions,
          response.requestId,
        );
      }),
    ),
    invoke: defineHerdrOperation("PluginService.actions.invoke", (id, input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "PluginService.actions.invoke",
          parsePluginActionInvokeInput,
          input,
        );
        const context = Option.match(parsed.context, {
          onNone: () => null,
          onSome: encodePluginInvocationContext,
        });
        const response = yield* transport.request(
          "plugin.action.invoke",
          {
            actionId: id,
            pluginId: Option.getOrNull(parsed.pluginId),
            context,
          },
          options,
        );
        return yield* decodeHerdrWire(
          parsePluginActionInvocation,
          response.result,
          response.requestId,
        );
      }),
    ),
  };

  const logs: IPluginLogs = {
    list: defineHerdrOperation("PluginService.logs.list", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "PluginService.logs.list",
          parsePluginLogListInput,
          input,
        );
        const response = yield* transport.request(
          "plugin.log.list",
          {
            pluginId: Option.getOrNull(parsed.pluginId),
            limit: Option.getOrNull(parsed.limit),
          },
          options,
        );
        return yield* decodeHerdrWire(
          parsePluginCommandLogs,
          response.result.logs,
          response.requestId,
        );
      }),
    ),
  };

  const panes: IPluginPanes = {
    open: openPluginPane,
    focus: defineHerdrOperation("PluginService.panes.focus", (paneId, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("plugin.pane.focus", { paneId }, options);
        return yield* decodeHerdrWire(
          parsePluginPane,
          response.result.plugin_pane,
          response.requestId,
        );
      }),
    ),
    close: defineHerdrOperation("PluginService.panes.close", (paneId, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("plugin.pane.close", { paneId }, options);
        return yield* decodeHerdrWire(
          parsePluginPaneCloseResult,
          response.result,
          response.requestId,
        );
      }),
    ),
  };

  const setEnabled = defineHerdrOperation(
    "PluginService.setEnabled",
    (
      method: "plugin.enable" | "plugin.disable",
      id: PluginId,
      options: HerdrTransportRequestOptionsEncoded,
    ) =>
      Effect.gen(function* () {
        const response = yield* transport.request(method, { pluginId: id }, options);
        return yield* decodeHerdrWire(
          parseInstalledPlugin,
          response.result.plugin,
          response.requestId,
        );
      }),
  );

  return PluginService.of({
    actions,
    logs,
    panes,
    link: defineHerdrOperation("PluginService.link", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PluginService.link", parsePluginLinkInput, input);
        const source = Option.match(parsed.source, {
          onNone: () => null,
          onSome: encodePluginSourceInput,
        });
        const base = { path: parsed.path, source };
        const parameters = Option.match(parsed.enabled, {
          onNone: () => base,
          onSome: (enabled) => ({ ...base, enabled }),
        });
        const response = yield* transport.request("plugin.link", parameters, options);
        return yield* decodeHerdrWire(
          parseInstalledPlugin,
          response.result.plugin,
          response.requestId,
        );
      }),
    ),
    list: defineHerdrOperation("PluginService.list", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PluginService.list", parsePluginFilterInput, input);
        const response = yield* transport.request(
          "plugin.list",
          { pluginId: Option.getOrNull(parsed.pluginId) },
          options,
        );
        return yield* decodeHerdrWire(
          parseInstalledPlugins,
          response.result.plugins,
          response.requestId,
        );
      }),
    ),
    unlink: defineHerdrOperation("PluginService.unlink", (id, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("plugin.unlink", { pluginId: id }, options);
        return yield* decodeHerdrWire(parsePluginUnlinkResult, response.result, response.requestId);
      }),
    ),
    enable: defineHerdrOperation("PluginService.enable", (id, options = {}) =>
      setEnabled("plugin.enable", id, options),
    ),
    disable: defineHerdrOperation("PluginService.disable", (id, options = {}) =>
      setEnabled("plugin.disable", id, options),
    ),
  });
});

/**
 * Provides plugin operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const pluginServiceLayerWithoutDependencies: Layer.Layer<
  PluginService,
  never,
  HerdrTransport
> = Layer.effect(PluginService, makePluginService);

/**
 * Production plugin-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const pluginServiceLayer = pluginServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);

function encodePluginInvocationContext(
  context: PluginActionInvokeInput["context"] extends Option.Option<infer Value> ? Value : never,
) {
  return {
    workspaceId: Option.getOrNull(context.workspaceId),
    workspaceLabel: Option.getOrNull(context.workspaceLabel),
    workspaceCwd: Option.getOrNull(context.workspaceCwd),
    worktree: Option.getOrNull(context.worktree),
    tabId: Option.getOrNull(context.tabId),
    tabLabel: Option.getOrNull(context.tabLabel),
    focusedPaneId: Option.getOrNull(context.focusedPaneId),
    focusedPaneCwd: Option.getOrNull(context.focusedPaneCwd),
    focusedPaneAgent: Option.getOrNull(context.focusedPaneAgent),
    focusedPaneStatus: Option.getOrNull(context.focusedPaneStatus),
    selectedText: Option.getOrNull(context.selectedText),
    invocationSource: Option.getOrNull(context.invocationSource),
    correlationId: Option.getOrNull(context.correlationId),
    clickedUrl: Option.getOrNull(context.clickedUrl),
    linkHandlerId: Option.getOrNull(context.linkHandlerId),
  };
}

function encodePluginSourceInput(
  source: PluginLinkInput["source"] extends Option.Option<infer Value> ? Value : never,
) {
  const base = {
    owner: Option.getOrNull(source.owner),
    repo: Option.getOrNull(source.repo),
    subdir: Option.getOrNull(source.subdir),
    requestedRef: Option.getOrNull(source.requestedRef),
    resolvedCommit: Option.getOrNull(source.resolvedCommit),
    managedPath: Option.getOrNull(source.managedPath),
    installedUnixMs: Option.getOrNull(source.installedUnixMs),
  };
  return Option.match(source.kind, {
    onNone: () => base,
    onSome: (kind) => ({ ...base, kind }),
  });
}
