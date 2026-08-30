/** Generated and exhaustively checked against the bundled Herdr schema; do not edit. */
import type { Request } from "./wire-request.ts";
import type { ResponseResult } from "./wire-success-response.ts";

export interface WireMethodMap {
  readonly "agent.explain": {
    readonly params: Extract<Request, { readonly method: "agent.explain" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_explain" }>;
  };
  readonly "agent.focus": {
    readonly params: Extract<Request, { readonly method: "agent.focus" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_info" }>;
  };
  readonly "agent.get": {
    readonly params: Extract<Request, { readonly method: "agent.get" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_info" }>;
  };
  readonly "agent.list": {
    readonly params: Extract<Request, { readonly method: "agent.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_list" }>;
  };
  readonly "agent.prompt": {
    readonly params: Extract<Request, { readonly method: "agent.prompt" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_prompted" }>;
  };
  readonly "agent.read": {
    readonly params: Extract<Request, { readonly method: "agent.read" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_read" }>;
  };
  readonly "agent.rename": {
    readonly params: Extract<Request, { readonly method: "agent.rename" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_info" }>;
  };
  readonly "agent.send_keys": {
    readonly params: Extract<Request, { readonly method: "agent.send_keys" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "agent.start": {
    readonly params: Extract<Request, { readonly method: "agent.start" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_started" }>;
  };
  readonly "agent.view.clear": {
    readonly params: Extract<Request, { readonly method: "agent.view.clear" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_view" }>;
  };
  readonly "agent.view.set": {
    readonly params: Extract<Request, { readonly method: "agent.view.set" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_view" }>;
  };
  readonly "agent.wait": {
    readonly params: Extract<Request, { readonly method: "agent.wait" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_info" }>;
  };
  readonly "client.window_title.clear": {
    readonly params: Extract<Request, { readonly method: "client.window_title.clear" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "client_window_title" }>;
  };
  readonly "client.window_title.set": {
    readonly params: Extract<Request, { readonly method: "client.window_title.set" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "client_window_title" }>;
  };
  readonly "events.subscribe": {
    readonly params: Extract<Request, { readonly method: "events.subscribe" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "subscription_started" }>;
  };
  readonly "events.wait": {
    readonly params: Extract<Request, { readonly method: "events.wait" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "wait_matched" }>;
  };
  readonly "integration.install": {
    readonly params: Extract<Request, { readonly method: "integration.install" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "integration_install" }>;
  };
  readonly "integration.uninstall": {
    readonly params: Extract<Request, { readonly method: "integration.uninstall" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "integration_uninstall" }>;
  };
  readonly "layout.apply": {
    readonly params: Extract<Request, { readonly method: "layout.apply" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "layout_apply" }>;
  };
  readonly "layout.export": {
    readonly params: Extract<Request, { readonly method: "layout.export" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "layout_export" }>;
  };
  readonly "layout.set_split_ratio": {
    readonly params: Extract<Request, { readonly method: "layout.set_split_ratio" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "layout_split_ratio_set" }>;
  };
  readonly "notification.show": {
    readonly params: Extract<Request, { readonly method: "notification.show" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "notification_show" }>;
  };
  readonly "pane.clear_agent_authority": {
    readonly params: Extract<Request, { readonly method: "pane.clear_agent_authority" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.close": {
    readonly params: Extract<Request, { readonly method: "pane.close" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.current": {
    readonly params: Extract<Request, { readonly method: "pane.current" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_current" }>;
  };
  readonly "pane.edges": {
    readonly params: Extract<Request, { readonly method: "pane.edges" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_edges" }>;
  };
  readonly "pane.focus": {
    readonly params: Extract<Request, { readonly method: "pane.focus" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_info" }>;
  };
  readonly "pane.focus_direction": {
    readonly params: Extract<Request, { readonly method: "pane.focus_direction" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_focus_direction" }>;
  };
  readonly "pane.get": {
    readonly params: Extract<Request, { readonly method: "pane.get" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_info" }>;
  };
  readonly "pane.graphics.clear": {
    readonly params: Extract<Request, { readonly method: "pane.graphics.clear" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.graphics.info": {
    readonly params: Extract<Request, { readonly method: "pane.graphics.info" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_graphics_info" }>;
  };
  readonly "pane.graphics.set": {
    readonly params: Extract<Request, { readonly method: "pane.graphics.set" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.graphics.stream": {
    readonly params: {
      readonly pane_id: string;
      readonly layer_id?: string | null;
      readonly z_index?: number;
    };
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.input.set": {
    readonly params: Extract<Request, { readonly method: "pane.input.set" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.layout": {
    readonly params: Extract<Request, { readonly method: "pane.layout" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_layout" }>;
  };
  readonly "pane.list": {
    readonly params: Extract<Request, { readonly method: "pane.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_list" }>;
  };
  readonly "pane.move": {
    readonly params: Extract<Request, { readonly method: "pane.move" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_move" }>;
  };
  readonly "pane.neighbor": {
    readonly params: Extract<Request, { readonly method: "pane.neighbor" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_neighbor" }>;
  };
  readonly "pane.process_info": {
    readonly params: Extract<Request, { readonly method: "pane.process_info" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_process_info" }>;
  };
  readonly "pane.read": {
    readonly params: Extract<Request, { readonly method: "pane.read" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_read" }>;
  };
  readonly "pane.release_agent": {
    readonly params: Extract<Request, { readonly method: "pane.release_agent" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.rename": {
    readonly params: Extract<Request, { readonly method: "pane.rename" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_info" }>;
  };
  readonly "pane.report_agent": {
    readonly params: Extract<Request, { readonly method: "pane.report_agent" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.report_agent_session": {
    readonly params: Extract<Request, { readonly method: "pane.report_agent_session" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.report_metadata": {
    readonly params: Extract<Request, { readonly method: "pane.report_metadata" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.resize": {
    readonly params: Extract<Request, { readonly method: "pane.resize" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_resize" }>;
  };
  readonly "pane.send_input": {
    readonly params: Extract<Request, { readonly method: "pane.send_input" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.send_keys": {
    readonly params: Extract<Request, { readonly method: "pane.send_keys" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.send_text": {
    readonly params: Extract<Request, { readonly method: "pane.send_text" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "pane.split": {
    readonly params: Extract<Request, { readonly method: "pane.split" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_info" }>;
  };
  readonly "pane.swap": {
    readonly params: Extract<Request, { readonly method: "pane.swap" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_swap" }>;
  };
  readonly "pane.wait_for_output": {
    readonly params: Extract<Request, { readonly method: "pane.wait_for_output" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "output_matched" }>;
  };
  readonly "pane.zoom": {
    readonly params: Extract<Request, { readonly method: "pane.zoom" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pane_zoom" }>;
  };
  readonly ping: {
    readonly params: Extract<Request, { readonly method: "ping" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "pong" }>;
  };
  readonly "plugin.action.invoke": {
    readonly params: Extract<Request, { readonly method: "plugin.action.invoke" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_action_invoked" }>;
  };
  readonly "plugin.action.list": {
    readonly params: Extract<Request, { readonly method: "plugin.action.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_action_list" }>;
  };
  readonly "plugin.disable": {
    readonly params: Extract<Request, { readonly method: "plugin.disable" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_disabled" }>;
  };
  readonly "plugin.enable": {
    readonly params: Extract<Request, { readonly method: "plugin.enable" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_enabled" }>;
  };
  readonly "plugin.link": {
    readonly params: Extract<Request, { readonly method: "plugin.link" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_linked" }>;
  };
  readonly "plugin.list": {
    readonly params: Extract<Request, { readonly method: "plugin.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_list" }>;
  };
  readonly "plugin.log.list": {
    readonly params: Extract<Request, { readonly method: "plugin.log.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_log_list" }>;
  };
  readonly "plugin.pane.close": {
    readonly params: Extract<Request, { readonly method: "plugin.pane.close" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_pane_closed" }>;
  };
  readonly "plugin.pane.focus": {
    readonly params: Extract<Request, { readonly method: "plugin.pane.focus" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_pane_focused" }>;
  };
  readonly "plugin.pane.open": {
    readonly params: Extract<Request, { readonly method: "plugin.pane.open" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_pane_opened" | "ok" }>;
  };
  readonly "plugin.unlink": {
    readonly params: Extract<Request, { readonly method: "plugin.unlink" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "plugin_unlinked" }>;
  };
  readonly "popup.close": {
    readonly params: Extract<Request, { readonly method: "popup.close" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "server.agent_manifests": {
    readonly params: Extract<Request, { readonly method: "server.agent_manifests" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_manifest_status" }>;
  };
  readonly "server.live_handoff": {
    readonly params: Extract<Request, { readonly method: "server.live_handoff" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "server.reload_agent_manifests": {
    readonly params: Extract<
      Request,
      { readonly method: "server.reload_agent_manifests" }
    >["params"];
    readonly result: Extract<ResponseResult, { readonly type: "agent_manifest_reload" }>;
  };
  readonly "server.reload_config": {
    readonly params: Extract<Request, { readonly method: "server.reload_config" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "config_reload" }>;
  };
  readonly "server.stop": {
    readonly params: Extract<Request, { readonly method: "server.stop" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "session.snapshot": {
    readonly params: Extract<Request, { readonly method: "session.snapshot" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "session_snapshot" }>;
  };
  readonly "tab.close": {
    readonly params: Extract<Request, { readonly method: "tab.close" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "tab.create": {
    readonly params: Extract<Request, { readonly method: "tab.create" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "tab_created" }>;
  };
  readonly "tab.focus": {
    readonly params: Extract<Request, { readonly method: "tab.focus" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "tab_info" }>;
  };
  readonly "tab.get": {
    readonly params: Extract<Request, { readonly method: "tab.get" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "tab_info" }>;
  };
  readonly "tab.list": {
    readonly params: Extract<Request, { readonly method: "tab.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "tab_list" }>;
  };
  readonly "tab.move": {
    readonly params: Extract<Request, { readonly method: "tab.move" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "tab_list" }>;
  };
  readonly "tab.rename": {
    readonly params: Extract<Request, { readonly method: "tab.rename" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "tab_info" }>;
  };
  readonly "workspace.close": {
    readonly params: Extract<Request, { readonly method: "workspace.close" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "workspace.create": {
    readonly params: Extract<Request, { readonly method: "workspace.create" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "workspace_created" }>;
  };
  readonly "workspace.focus": {
    readonly params: Extract<Request, { readonly method: "workspace.focus" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "workspace_info" }>;
  };
  readonly "workspace.get": {
    readonly params: Extract<Request, { readonly method: "workspace.get" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "workspace_info" }>;
  };
  readonly "workspace.list": {
    readonly params: Extract<Request, { readonly method: "workspace.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "workspace_list" }>;
  };
  readonly "workspace.move": {
    readonly params: Extract<Request, { readonly method: "workspace.move" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "workspace_list" }>;
  };
  readonly "workspace.move_block": {
    readonly params: Extract<Request, { readonly method: "workspace.move_block" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "workspace_list" }>;
  };
  readonly "workspace.rename": {
    readonly params: Extract<Request, { readonly method: "workspace.rename" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "workspace_info" }>;
  };
  readonly "workspace.report_metadata": {
    readonly params: Extract<Request, { readonly method: "workspace.report_metadata" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "ok" }>;
  };
  readonly "worktree.create": {
    readonly params: Extract<Request, { readonly method: "worktree.create" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "worktree_created" }>;
  };
  readonly "worktree.list": {
    readonly params: Extract<Request, { readonly method: "worktree.list" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "worktree_list" }>;
  };
  readonly "worktree.open": {
    readonly params: Extract<Request, { readonly method: "worktree.open" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "worktree_opened" }>;
  };
  readonly "worktree.remove": {
    readonly params: Extract<Request, { readonly method: "worktree.remove" }>["params"];
    readonly result: Extract<ResponseResult, { readonly type: "worktree_removed" }>;
  };
}

/** Every schema-declared request method plus the schema-skipped binary graphics stream. */
export type WireMethod = keyof WireMethodMap;

/** Success discriminants accepted for each correlated wire method. */
export const wireResultTypesByMethod = {
  "agent.explain": ["agent_explain"],
  "agent.focus": ["agent_info"],
  "agent.get": ["agent_info"],
  "agent.list": ["agent_list"],
  "agent.prompt": ["agent_prompted"],
  "agent.read": ["pane_read"],
  "agent.rename": ["agent_info"],
  "agent.send_keys": ["ok"],
  "agent.start": ["agent_started"],
  "agent.view.clear": ["agent_view"],
  "agent.view.set": ["agent_view"],
  "agent.wait": ["agent_info"],
  "client.window_title.clear": ["client_window_title"],
  "client.window_title.set": ["client_window_title"],
  "events.subscribe": ["subscription_started"],
  "events.wait": ["wait_matched"],
  "integration.install": ["integration_install"],
  "integration.uninstall": ["integration_uninstall"],
  "layout.apply": ["layout_apply"],
  "layout.export": ["layout_export"],
  "layout.set_split_ratio": ["layout_split_ratio_set"],
  "notification.show": ["notification_show"],
  "pane.clear_agent_authority": ["ok"],
  "pane.close": ["ok"],
  "pane.current": ["pane_current"],
  "pane.edges": ["pane_edges"],
  "pane.focus": ["pane_info"],
  "pane.focus_direction": ["pane_focus_direction"],
  "pane.get": ["pane_info"],
  "pane.graphics.clear": ["ok"],
  "pane.graphics.info": ["pane_graphics_info"],
  "pane.graphics.set": ["ok"],
  "pane.graphics.stream": ["ok"],
  "pane.input.set": ["ok"],
  "pane.layout": ["pane_layout"],
  "pane.list": ["pane_list"],
  "pane.move": ["pane_move"],
  "pane.neighbor": ["pane_neighbor"],
  "pane.process_info": ["pane_process_info"],
  "pane.read": ["pane_read"],
  "pane.release_agent": ["ok"],
  "pane.rename": ["pane_info"],
  "pane.report_agent": ["ok"],
  "pane.report_agent_session": ["ok"],
  "pane.report_metadata": ["ok"],
  "pane.resize": ["pane_resize"],
  "pane.send_input": ["ok"],
  "pane.send_keys": ["ok"],
  "pane.send_text": ["ok"],
  "pane.split": ["pane_info"],
  "pane.swap": ["pane_swap"],
  "pane.wait_for_output": ["output_matched"],
  "pane.zoom": ["pane_zoom"],
  ping: ["pong"],
  "plugin.action.invoke": ["plugin_action_invoked"],
  "plugin.action.list": ["plugin_action_list"],
  "plugin.disable": ["plugin_disabled"],
  "plugin.enable": ["plugin_enabled"],
  "plugin.link": ["plugin_linked"],
  "plugin.list": ["plugin_list"],
  "plugin.log.list": ["plugin_log_list"],
  "plugin.pane.close": ["plugin_pane_closed"],
  "plugin.pane.focus": ["plugin_pane_focused"],
  "plugin.pane.open": ["plugin_pane_opened", "ok"],
  "plugin.unlink": ["plugin_unlinked"],
  "popup.close": ["ok"],
  "server.agent_manifests": ["agent_manifest_status"],
  "server.live_handoff": ["ok"],
  "server.reload_agent_manifests": ["agent_manifest_reload"],
  "server.reload_config": ["config_reload"],
  "server.stop": ["ok"],
  "session.snapshot": ["session_snapshot"],
  "tab.close": ["ok"],
  "tab.create": ["tab_created"],
  "tab.focus": ["tab_info"],
  "tab.get": ["tab_info"],
  "tab.list": ["tab_list"],
  "tab.move": ["tab_list"],
  "tab.rename": ["tab_info"],
  "workspace.close": ["ok"],
  "workspace.create": ["workspace_created"],
  "workspace.focus": ["workspace_info"],
  "workspace.get": ["workspace_info"],
  "workspace.list": ["workspace_list"],
  "workspace.move": ["workspace_list"],
  "workspace.move_block": ["workspace_list"],
  "workspace.rename": ["workspace_info"],
  "workspace.report_metadata": ["ok"],
  "worktree.create": ["worktree_created"],
  "worktree.list": ["worktree_list"],
  "worktree.open": ["worktree_opened"],
  "worktree.remove": ["worktree_removed"],
} as const satisfies {
  readonly [Method in WireMethod]: readonly WireMethodMap[Method]["result"]["type"][];
};
