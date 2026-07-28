import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { WireMethod, WireMethodMap } from "./generated/wire-method-map.ts";
import { HerdrError } from "./herdr-error.ts";
import { herdrIdHelpers } from "./herdr-ids.ts";
import {
  parseHerdrEventEnvelope,
  SocketHerdrEventStream,
  SocketPaneGraphicsStream,
} from "./herdr-streams.ts";
import {
  HerdrTransport,
  normalizeHerdrNamedResources,
  toCamelCaseValue,
  type WireSdkParams,
} from "./herdr-transport.ts";
import { assertHerdrWireSuccessResult } from "./herdr-wire-parser.ts";
import type * as T from "./herdr-public-api.ts";

const SUPPORTED_PROTOCOL = 18;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const MAX_GRAPHICS_ONE_SHOT_BYTES = 512 * 1024;

type WireResultDiscriminant<Method extends WireMethod> = WireMethodMap[Method]["result"] extends {
  readonly type: infer Result extends string;
}
  ? Result
  : never;
type WireMethodForResult<Result extends string> = {
  readonly [Method in WireMethod]: Result extends WireResultDiscriminant<Method> ? Method : never;
}[WireMethod];

/** Stripe-style TypeScript client for Herdr protocol 18. */
export default class Herdr {
  /** Validating helpers for branded Herdr identifiers and absolute paths. */
  readonly ids: T.HerdrIdHelpers = herdrIdHelpers;
  /** Server lifecycle and protocol operations. */
  readonly server: T.ServerNamespace;
  /** Session snapshot operations. */
  readonly session: T.SessionNamespace;
  /** Foreground notification operations. */
  readonly notifications: T.NotificationNamespace;
  /** Foreground client operations. */
  readonly client: T.ClientNamespace;
  /** Workspace resource operations. */
  readonly workspaces: T.WorkspaceNamespace;
  /** Git worktree resource operations. */
  readonly worktrees: T.WorktreeNamespace;
  /** Tab resource operations. */
  readonly tabs: T.TabNamespace;
  /** Pane resource operations, including graphics. */
  readonly panes: T.PaneNamespace;
  /** Declarative layout operations. */
  readonly layouts: T.LayoutNamespace;
  /** Agent resource and agent view operations. */
  readonly agents: T.AgentNamespace;
  /** Event subscription and wait operations. */
  readonly events: T.EventNamespace;
  /** Built-in integration operations. */
  readonly integrations: T.IntegrationNamespace;
  /** Plugin, action, log, and plugin pane operations. */
  readonly plugins: T.PluginNamespace;
  /** Foreground popup operations. */
  readonly popups: T.PopupNamespace;

  readonly #transport: HerdrTransport;
  readonly #application: T.HerdrClientOptions["application"];
  #compatibilityCheck: Promise<T.PingResult> | undefined;

  /** Creates a lazy client; no socket is opened until the first operation. */
  constructor(options: T.HerdrClientOptions = {}) {
    validateMilliseconds(options.requestTimeoutMs, "requestTimeoutMs");
    this.#transport = new HerdrTransport(
      resolveHerdrSocketPath(options),
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.#application = options.application;

    this.server = {
      ping: async (requestOptions) => this.pingAndVerify(requestOptions),
      stop: async (requestOptions) => this.requestVoid("server.stop", {}, requestOptions),
      liveHandoff: async (params = {}, requestOptions) =>
        this.requestVoid("server.live_handoff", params, requestOptions),
      reloadConfig: async (requestOptions) =>
        this.requestValue("server.reload_config", {}, "config_reload", requestOptions),
      getAgentManifests: async (requestOptions) =>
        this.requestValue("server.agent_manifests", {}, "agent_manifest_status", requestOptions),
      reloadAgentManifests: async (requestOptions) =>
        this.requestValue(
          "server.reload_agent_manifests",
          {},
          "agent_manifest_reload",
          requestOptions,
          "manifests",
        ),
    };
    this.session = {
      snapshot: async (requestOptions) =>
        this.requestValue("session.snapshot", {}, "session_snapshot", requestOptions, "snapshot"),
    };
    this.notifications = {
      show: async (params, requestOptions) =>
        this.requestValue("notification.show", params, "notification_show", requestOptions),
    };
    this.client = {
      windowTitle: {
        set: async (title, requestOptions) =>
          this.requestValue(
            "client.window_title.set",
            { title },
            "client_window_title",
            requestOptions,
          ),
        clear: async (requestOptions) =>
          this.requestValue("client.window_title.clear", {}, "client_window_title", requestOptions),
      },
    };

    this.workspaces = {
      create: async (params = {}, requestOptions) =>
        this.requestValue("workspace.create", params, "workspace_created", requestOptions),
      list: async (requestOptions) =>
        this.requestValue("workspace.list", {}, "workspace_list", requestOptions, "workspaces"),
      get: async (id, requestOptions) =>
        this.requestValue(
          "workspace.get",
          { workspaceId: id },
          "workspace_info",
          requestOptions,
          "workspace",
        ),
      focus: async (id, requestOptions) =>
        this.requestValue(
          "workspace.focus",
          { workspaceId: id },
          "workspace_info",
          requestOptions,
          "workspace",
        ),
      rename: async (id, label, requestOptions) =>
        this.requestValue(
          "workspace.rename",
          { workspaceId: id, label },
          "workspace_info",
          requestOptions,
          "workspace",
        ),
      move: async (id, params, requestOptions) =>
        this.requestValue(
          "workspace.move",
          { workspaceId: id, ...params },
          "workspace_list",
          requestOptions,
          "workspaces",
        ),
      moveBlock: async (ids, params = {}, requestOptions) =>
        this.requestValue(
          "workspace.move_block",
          { workspaceIds: ids, ...params },
          "workspace_list",
          requestOptions,
          "workspaces",
        ),
      reportMetadata: async (id, params, requestOptions) => {
        validateMetadataTtl(params.ttlMs);
        await this.requestVoid(
          "workspace.report_metadata",
          { workspaceId: id, ...params },
          requestOptions,
        );
      },
      close: async (id, requestOptions) =>
        this.requestVoid("workspace.close", { workspaceId: id }, requestOptions),
    };
    this.worktrees = {
      list: async (params = {}, requestOptions) =>
        this.requestValue("worktree.list", params, "worktree_list", requestOptions),
      create: async (params = {}, requestOptions) =>
        this.requestValue("worktree.create", params, "worktree_created", requestOptions),
      open: async (params, requestOptions) =>
        this.requestValue("worktree.open", params, "worktree_opened", requestOptions),
      remove: async (workspaceId, params = {}, requestOptions) =>
        this.requestValue(
          "worktree.remove",
          { workspaceId, ...params },
          "worktree_removed",
          requestOptions,
        ),
    };
    this.tabs = {
      create: async (params = {}, requestOptions) =>
        this.requestValue("tab.create", params, "tab_created", requestOptions),
      list: async (params = {}, requestOptions) =>
        this.requestValue("tab.list", params, "tab_list", requestOptions, "tabs"),
      get: async (id, requestOptions) =>
        this.requestValue("tab.get", { tabId: id }, "tab_info", requestOptions, "tab"),
      focus: async (id, requestOptions) =>
        this.requestValue("tab.focus", { tabId: id }, "tab_info", requestOptions, "tab"),
      rename: async (id, label, requestOptions) =>
        this.requestValue("tab.rename", { tabId: id, label }, "tab_info", requestOptions, "tab"),
      move: async (id, params, requestOptions) =>
        this.requestValue("tab.move", { tabId: id, ...params }, "tab_list", requestOptions, "tabs"),
      close: async (id, requestOptions) =>
        this.requestVoid("tab.close", { tabId: id }, requestOptions),
    };

    const graphics: T.PaneGraphicsNamespace = {
      info: async (id, requestOptions) =>
        this.requestValue(
          "pane.graphics.info",
          { paneId: id },
          "pane_graphics_info",
          requestOptions,
        ),
      set: async (id, frame, requestOptions) => {
        validateGraphicsFrame(frame, MAX_GRAPHICS_ONE_SHOT_BYTES, "one-shot");
        await this.requestVoid(
          "pane.graphics.set",
          {
            paneId: id,
            format: frame.format,
            imageWidth: frame.imageWidth,
            imageHeight: frame.imageHeight,
            dataBase64: Buffer.from(frame.data).toString("base64"),
            placement: frame.placement,
          },
          requestOptions,
        );
      },
      clear: async (id, requestOptions) =>
        this.requestVoid("pane.graphics.clear", { paneId: id }, requestOptions),
      openStream: async (id, requestOptions = {}) => {
        await this.ensureCompatible(requestOptions);
        const opened = await this.#transport.openStream(
          "pane.graphics.stream",
          { paneId: id },
          requestOptions,
        );
        try {
          this.parseResult(opened.initialResult, "ok", opened.requestId);
          return new SocketPaneGraphicsStream(
            opened.socket,
            opened.requestId,
            id,
            requestOptions.signal,
          );
        } catch (cause) {
          opened.socket.destroy();
          throw cause;
        }
      },
    };
    this.panes = {
      graphics,
      split: async (targetPaneId, params, requestOptions) => {
        validateRatio(params.ratio);
        return this.requestValue(
          "pane.split",
          { targetPaneId, ...params },
          "pane_info",
          requestOptions,
          "pane",
        );
      },
      swap: async (params, requestOptions) =>
        this.requestValue("pane.swap", params, "pane_swap", requestOptions, "swap"),
      move: async (paneId, params, requestOptions) => {
        if (params.destination.type === "tab") validateRatio(params.destination.ratio);
        return this.requestValue(
          "pane.move",
          { paneId, ...params },
          "pane_move",
          requestOptions,
          "moveResult",
        );
      },
      zoom: async (paneId, params = {}, requestOptions) =>
        this.requestValue("pane.zoom", { paneId, ...params }, "pane_zoom", requestOptions, "zoom"),
      layout: async (paneId, requestOptions) =>
        this.requestValue("pane.layout", { paneId }, "pane_layout", requestOptions, "layout"),
      processInfo: async (paneId, requestOptions) =>
        this.requestValue(
          "pane.process_info",
          { paneId },
          "pane_process_info",
          requestOptions,
          "processInfo",
        ),
      neighbor: async (paneId, direction, requestOptions) =>
        this.requestValue(
          "pane.neighbor",
          { paneId, direction },
          "pane_neighbor",
          requestOptions,
          "neighbor",
        ),
      edges: async (paneId, requestOptions) =>
        this.requestValue("pane.edges", { paneId }, "pane_edges", requestOptions, "edges"),
      focusDirection: async (direction, params = {}, requestOptions) =>
        this.requestValue(
          "pane.focus_direction",
          { direction, ...params },
          "pane_focus_direction",
          requestOptions,
          "focus",
        ),
      resize: async (direction, params = {}, requestOptions) =>
        this.requestValue(
          "pane.resize",
          { direction, ...params },
          "pane_resize",
          requestOptions,
          "resize",
        ),
      list: async (params = {}, requestOptions) =>
        this.requestValue("pane.list", params, "pane_list", requestOptions, "panes"),
      current: async (params = {}, requestOptions) =>
        this.requestValue("pane.current", params, "pane_current", requestOptions, "pane"),
      get: async (id, requestOptions) =>
        this.requestValue("pane.get", { paneId: id }, "pane_info", requestOptions, "pane"),
      focus: async (id, requestOptions) =>
        this.requestValue("pane.focus", { paneId: id }, "pane_info", requestOptions, "pane"),
      rename: async (id, label, requestOptions) =>
        this.requestValue(
          "pane.rename",
          { paneId: id, label },
          "pane_info",
          requestOptions,
          "pane",
        ),
      sendText: async (id, text, requestOptions) =>
        this.requestVoid("pane.send_text", { paneId: id, text }, requestOptions),
      sendKeys: async (id, keys, requestOptions) =>
        this.requestVoid("pane.send_keys", { paneId: id, keys }, requestOptions),
      sendInput: async (id, input, requestOptions) =>
        this.requestVoid("pane.send_input", { paneId: id, ...input }, requestOptions),
      read: async (id, params, requestOptions) =>
        this.requestValue(
          "pane.read",
          { paneId: id, ...params },
          "pane_read",
          requestOptions,
          "read",
        ),
      waitForOutput: async (id, params, requestOptions) => {
        validateMilliseconds(params.timeoutMs, "pane wait timeoutMs");
        return this.requestValue(
          "pane.wait_for_output",
          { paneId: id, ...params },
          "output_matched",
          requestOptions,
        );
      },
      reportAgent: async (id, params, requestOptions) =>
        this.requestVoid("pane.report_agent", { paneId: id, ...params }, requestOptions),
      reportAgentSession: async (id, params, requestOptions) =>
        this.requestVoid("pane.report_agent_session", { paneId: id, ...params }, requestOptions),
      reportMetadata: async (id, params, requestOptions) => {
        validateMetadataTtl(params.ttlMs);
        await this.requestVoid("pane.report_metadata", { paneId: id, ...params }, requestOptions);
      },
      clearAgentAuthority: async (id, params = {}, requestOptions) =>
        this.requestVoid("pane.clear_agent_authority", { paneId: id, ...params }, requestOptions),
      releaseAgent: async (id, params, requestOptions) =>
        this.requestVoid("pane.release_agent", { paneId: id, ...params }, requestOptions),
      close: async (id, requestOptions) =>
        this.requestVoid("pane.close", { paneId: id }, requestOptions),
    };

    this.layouts = {
      export: async (target, requestOptions) =>
        this.requestValue("layout.export", target ?? {}, "layout_export", requestOptions, "layout"),
      apply: async (params, requestOptions) => {
        validateLayoutNode(params.root);
        return this.requestValue("layout.apply", params, "layout_apply", requestOptions, "layout");
      },
      setSplitRatio: async (target, params, requestOptions) => {
        validateRatio(params.ratio);
        return this.requestValue(
          "layout.set_split_ratio",
          { ...target, ...params },
          "layout_split_ratio_set",
          requestOptions,
          "layout",
        );
      },
    };
    const view: T.AgentViewNamespace = {
      set: async (params, requestOptions) =>
        this.requestValue("agent.view.set", params, "agent_view", requestOptions),
      clear: async (params = {}, requestOptions) =>
        this.requestValue("agent.view.clear", params, "agent_view", requestOptions),
    };
    this.agents = {
      view,
      list: async (requestOptions) =>
        this.requestValue("agent.list", {}, "agent_list", requestOptions, "agents"),
      get: async (target, requestOptions) =>
        this.requestValue(
          "agent.get",
          serializeAgentTarget(target),
          "agent_info",
          requestOptions,
          "agent",
        ),
      read: async (target, params, requestOptions) =>
        this.requestValue(
          "agent.read",
          { ...serializeAgentTarget(target), ...params },
          "pane_read",
          requestOptions,
          "read",
        ),
      explain: async (target, requestOptions) =>
        this.requestValue(
          "agent.explain",
          serializeAgentTarget(target),
          "agent_explain",
          requestOptions,
          "explain",
        ),
      sendKeys: async (target, keys, requestOptions) =>
        this.requestVoid(
          "agent.send_keys",
          { ...serializeAgentTarget(target), keys },
          requestOptions,
        ),
      rename: async (target, name, requestOptions) =>
        this.requestValue(
          "agent.rename",
          { ...serializeAgentTarget(target), name },
          "agent_info",
          requestOptions,
          "agent",
        ),
      focus: async (target, requestOptions) =>
        this.requestValue(
          "agent.focus",
          serializeAgentTarget(target),
          "agent_info",
          requestOptions,
          "agent",
        ),
      start: async (params, requestOptions) => {
        if (
          params.timeoutMs !== undefined &&
          (!Number.isInteger(params.timeoutMs) ||
            params.timeoutMs <= 3_000 ||
            params.timeoutMs > 300_000)
        )
          throw new HerdrError(
            "invalid_argument",
            "Agent start timeoutMs must be greater than 3000 and at most 300000",
            "local",
          );
        return this.requestValue("agent.start", params, "agent_started", requestOptions);
      },
      prompt: async (target, params, requestOptions) => {
        validateMilliseconds(params.wait?.timeoutMs, "agent prompt wait timeoutMs");
        return this.requestValue(
          "agent.prompt",
          { ...serializeAgentTarget(target), ...params },
          "agent_prompted",
          requestOptions,
          "agent",
        );
      },
      wait: async (target, params = {}, requestOptions) => {
        validateMilliseconds(params.timeoutMs, "agent wait timeoutMs");
        return this.requestValue(
          "agent.wait",
          { ...serializeAgentTarget(target), ...params },
          "agent_info",
          requestOptions,
          "agent",
        );
      },
    };
    this.events = {
      subscribe: async (subscriptions, requestOptions = {}) => {
        await this.ensureCompatible(requestOptions);
        const opened = await this.#transport.openStream(
          "events.subscribe",
          { subscriptions },
          requestOptions,
        );
        try {
          this.parseResult(opened.initialResult, "subscription_started", opened.requestId);
          // SAFETY: Event type inference is determined by the submitted subscription tuple; the stream parser validates runtime envelopes.
          return new SocketHerdrEventStream(
            opened.socket,
            opened.requestId,
            requestOptions.signal,
          ) as T.HerdrEventStream<T.EventForSubscription<(typeof subscriptions)[number]>>;
        } catch (cause) {
          opened.socket.destroy();
          throw cause;
        }
      },
      wait: async (match, params = {}, requestOptions) => {
        validateMilliseconds(params.timeoutMs, "event wait timeoutMs");
        const waitParams = { matchEvent: serializeEventMatch(match), ...params };
        // SAFETY: serializeEventMatch exhaustively translates the public dot-named discriminant to the generated wire event shape.
        const wireWaitParams = waitParams as WireSdkParams<"events.wait">;
        return this.requestValue(
          "events.wait",
          wireWaitParams,
          "wait_matched",
          requestOptions,
          "event",
        );
      },
    };
    this.integrations = {
      install: async (target, requestOptions) =>
        this.requestValue("integration.install", { target }, "integration_install", requestOptions),
      uninstall: async (target, requestOptions) =>
        this.requestValue(
          "integration.uninstall",
          { target },
          "integration_uninstall",
          requestOptions,
        ),
    };
    const actions: T.PluginActionNamespace = {
      list: async (params = {}, requestOptions) =>
        this.requestValue(
          "plugin.action.list",
          params,
          "plugin_action_list",
          requestOptions,
          "actions",
        ),
      invoke: async (id, params = {}, requestOptions) =>
        this.requestValue(
          "plugin.action.invoke",
          { actionId: id, ...params },
          "plugin_action_invoked",
          requestOptions,
        ),
    };
    const logs: T.PluginLogNamespace = {
      list: async (params = {}, requestOptions) =>
        this.requestValue("plugin.log.list", params, "plugin_log_list", requestOptions, "logs"),
    };
    const openPluginPane = async (
      pluginId: T.PluginId,
      params: T.PluginPaneOpenParams,
      requestOptions?: T.HerdrRequestOptions,
    ): Promise<T.PluginPane | void> => this.openPluginPane(pluginId, params, requestOptions);
    const pluginPanes: T.PluginPaneNamespace = {
      // SAFETY: The overload narrows the implementation's union return by placement; runtime behavior handles popup and manifest-selected popup responses.
      open: openPluginPane as T.PluginPaneNamespace["open"],
      focus: async (paneId, requestOptions) =>
        this.requestValue(
          "plugin.pane.focus",
          { paneId },
          "plugin_pane_focused",
          requestOptions,
          "pluginPane",
        ),
      close: async (paneId, requestOptions) =>
        this.requestValue("plugin.pane.close", { paneId }, "plugin_pane_closed", requestOptions),
    };
    this.plugins = {
      actions,
      logs,
      panes: pluginPanes,
      link: async (params, requestOptions) =>
        this.requestValue("plugin.link", params, "plugin_linked", requestOptions, "plugin"),
      list: async (params = {}, requestOptions) =>
        this.requestValue("plugin.list", params, "plugin_list", requestOptions, "plugins"),
      unlink: async (id, requestOptions) =>
        this.requestValue("plugin.unlink", { pluginId: id }, "plugin_unlinked", requestOptions),
      enable: async (id, requestOptions) =>
        this.requestValue(
          "plugin.enable",
          { pluginId: id },
          "plugin_enabled",
          requestOptions,
          "plugin",
        ),
      disable: async (id, requestOptions) =>
        this.requestValue(
          "plugin.disable",
          { pluginId: id },
          "plugin_disabled",
          requestOptions,
          "plugin",
        ),
    };
    this.popups = {
      close: async (requestOptions) => this.requestVoid("popup.close", {}, requestOptions),
    };
  }

  private async pingAndVerify(options: T.HerdrRequestOptions = {}): Promise<T.PingResult> {
    const response = await this.#transport.request(
      "ping",
      this.#application === undefined ? {} : { application: this.#application },
      options,
    );
    const ping = this.parseResult<T.PingResult>(response.result, "pong", response.requestId);
    if (ping.protocol !== SUPPORTED_PROTOCOL)
      throw new HerdrError(
        "unsupported_protocol",
        `Unsupported Herdr protocol ${ping.protocol}; expected ${SUPPORTED_PROTOCOL}`,
        response.requestId,
      );
    return ping;
  }

  private async ensureCompatible(options: T.HerdrRequestOptions): Promise<void> {
    this.#compatibilityCheck ??= this.pingAndVerify(options).catch((cause: unknown) => {
      this.#compatibilityCheck = undefined;
      throw cause;
    });
    await this.#compatibilityCheck;
  }

  private async requestVoid<Method extends WireMethodForResult<"ok">>(
    method: Method,
    params: WireSdkParams<Method>,
    options: T.HerdrRequestOptions = {},
  ): Promise<void> {
    await this.ensureCompatible(options);
    const response = await this.#transport.request(method, params, options);
    this.parseResult(response.result, "ok", response.requestId);
  }

  private async requestValue<Value, Method extends WireMethod>(
    method: Method,
    params: WireSdkParams<Method>,
    expectedType: WireResultDiscriminant<Method>,
    options: T.HerdrRequestOptions = {},
    selector?: string,
  ): Promise<Value> {
    await this.ensureCompatible(options);
    const response = await this.#transport.request(method, params, options);
    return this.parseResult<Value>(response.result, expectedType, response.requestId, selector);
  }

  private async openPluginPane(
    pluginId: T.PluginId,
    params: T.PluginPaneOpenParams,
    options: T.HerdrRequestOptions = {},
  ): Promise<T.PluginPane | void> {
    if (params.placement === "popup") {
      await this.requestVoid("plugin.pane.open", { pluginId, ...params }, options);
      return;
    }
    await this.ensureCompatible(options);
    const response = await this.#transport.request(
      "plugin.pane.open",
      { pluginId, ...params },
      options,
    );
    const camel = normalizeHerdrNamedResources(toCamelCaseValue(response.result, true));
    if (isJsonObject(camel) && camel.type === "ok") {
      if (params.placement === undefined) return;
      throw new HerdrError(
        "unsupported_result",
        `Unsupported result discriminant ok; expected plugin_pane_opened for ${params.placement}`,
        response.requestId,
      );
    }
    return this.parseResult<T.PluginPane>(
      response.result,
      "plugin_pane_opened",
      response.requestId,
      "pluginPane",
    );
  }

  private parseResult<Value>(
    result: unknown,
    expectedType: string,
    requestId: string,
    selector?: string,
  ): Value {
    const camel = normalizeHerdrNamedResources(
      toCamelCaseValue(result, expectedType !== "agent_explain"),
    );
    if (!isJsonObject(camel))
      throw new HerdrError("invalid_response", "Result must be an object", requestId);
    if (camel.type !== expectedType)
      throw new HerdrError(
        "unsupported_result",
        `Unsupported result discriminant ${JSON.stringify(camel.type)}; expected ${expectedType}`,
        requestId,
      );
    const normalizedWaitEvent =
      expectedType === "wait_matched"
        ? parseHerdrEventEnvelope(readRawEvent(result, requestId), requestId)
        : undefined;
    assertHerdrWireSuccessResult(result, requestId);
    const { type: _type, ...rawPayload } = camel;
    const payload: { readonly [key: string]: T.JsonValue } =
      expectedType === "integration_install" || expectedType === "integration_uninstall"
        ? integrationResultPayload(rawPayload)
        : rawPayload;
    const selected = selector === undefined ? payload : payload[selector];
    const value =
      expectedType === "wait_matched" && selector === "event" ? normalizedWaitEvent : selected;
    if (selector !== undefined && value === undefined)
      throw new HerdrError(
        "invalid_response",
        `Result ${expectedType} is missing ${selector}`,
        requestId,
      );
    // SAFETY: Each namespace method supplies the protocol-schema-correlated result discriminant and optional payload selector.
    return value as Value;
  }
}

function readRawEvent(result: unknown, requestId: string): unknown {
  if (result === null || typeof result !== "object" || !("event" in result))
    throw new HerdrError("invalid_response", "Wait result is missing event", requestId);
  return result.event;
}

function integrationResultPayload(payload: { readonly [key: string]: T.JsonValue }): {
  readonly [key: string]: T.JsonValue;
} {
  const details = payload.details;
  const messages = isJsonObject(details) ? (details.messages ?? []) : [];
  return { target: payload.target ?? "", messages };
}

function isJsonObject(
  value: T.JsonValue | undefined,
): value is { readonly [key: string]: T.JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializeEventMatch(match: T.EventMatch): Readonly<Record<string, unknown>> {
  const { type, ...fields } = match;
  return { event: type.replace(".", "_"), ...fields };
}

function serializeAgentTarget(target: T.AgentTarget): { readonly target: string } {
  return { target: "paneId" in target ? target.paneId : target.name };
}

function validateMilliseconds(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || !Number.isInteger(value) || value < 0))
    throw new HerdrError(
      "invalid_argument",
      `${name} must be a finite non-negative integer`,
      "local",
    );
}

function validateMetadataTtl(ttlMs: number | undefined): void {
  if (ttlMs !== undefined && (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 86_400_000))
    throw new HerdrError(
      "invalid_argument",
      "Metadata ttlMs must be between 1 and 86400000",
      "local",
    );
}

function validateRatio(ratio: number | undefined): void {
  if (ratio !== undefined && (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1))
    throw new HerdrError(
      "invalid_argument",
      "Split ratio must be greater than 0 and less than 1",
      "local",
    );
}

function validateLayoutNode(node: T.LayoutNode): void {
  if (node.type === "split") {
    validateRatio(node.ratio);
    validateLayoutNode(node.first);
    validateLayoutNode(node.second);
  }
}

function validateGraphicsFrame(
  frame: T.PaneGraphicsFrame,
  maximumBytes: number,
  mode: string,
): void {
  if (frame.data.byteLength === 0)
    throw new HerdrError("invalid_frame", `Graphics ${mode} frame must contain data`, "local");
  if (frame.data.byteLength > maximumBytes)
    throw new HerdrError(
      "image_too_large",
      `Graphics ${mode} frame exceeds ${maximumBytes} bytes`,
      "local",
    );
  if (
    !Number.isInteger(frame.imageWidth) ||
    frame.imageWidth <= 0 ||
    !Number.isInteger(frame.imageHeight) ||
    frame.imageHeight <= 0
  )
    throw new HerdrError(
      "invalid_frame",
      `Graphics ${mode} dimensions must be positive integers`,
      "local",
    );
}

function resolveHerdrSocketPath(options: T.HerdrClientOptions): string {
  if ("socketPath" in options && options.socketPath !== undefined)
    return parseAbsoluteSocketPath(options.socketPath, "socketPath");
  const session = "session" in options ? options.session : undefined;
  if (session !== undefined)
    return join(resolveHerdrConfigDirectory(), "sessions", parseSessionName(session), "herdr.sock");
  if (process.env.HERDR_SOCKET_PATH !== undefined)
    return parseAbsoluteSocketPath(process.env.HERDR_SOCKET_PATH, "HERDR_SOCKET_PATH");
  if (process.env.HERDR_SESSION !== undefined)
    return join(
      resolveHerdrConfigDirectory(),
      "sessions",
      parseSessionName(process.env.HERDR_SESSION),
      "herdr.sock",
    );
  return join(resolveHerdrConfigDirectory(), "herdr.sock");
}

function parseAbsoluteSocketPath(value: string, source: string): string {
  if (!isAbsolute(value))
    throw new HerdrError(
      "invalid_configuration",
      `${source} must contain an absolute socket path`,
      "local",
    );
  return value;
}

function parseSessionName(value: string): string {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  )
    throw new HerdrError(
      "invalid_configuration",
      "Herdr session name must be non-empty and must not contain path separators",
      "local",
    );
  return value;
}

function resolveHerdrConfigDirectory(): string {
  if (process.env.HERDR_CONFIG_DIR !== undefined)
    return parseAbsoluteSocketPath(process.env.HERDR_CONFIG_DIR, "HERDR_CONFIG_DIR");
  if (process.platform === "win32")
    return join(
      process.env.APPDATA === undefined
        ? homedir()
        : parseAbsoluteSocketPath(process.env.APPDATA, "APPDATA"),
      "herdr",
    );
  const configHome =
    process.env.XDG_CONFIG_HOME === undefined
      ? join(homedir(), ".config")
      : parseAbsoluteSocketPath(process.env.XDG_CONFIG_HOME, "XDG_CONFIG_HOME");
  return join(configHome, "herdr");
}
