/** Generated from schema/herdr-api.schema.json; do not edit. */

export type Request = {
  id: string;
  [k: string]: unknown;
} & (
  | {
      method: "ping";
      params: PingParams;
      [k: string]: unknown;
    }
  | {
      method: "server.stop";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "server.live_handoff";
      params: ServerLiveHandoffParams;
      [k: string]: unknown;
    }
  | {
      method: "server.reload_config";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "server.agent_manifests";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "server.reload_agent_manifests";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "notification.show";
      params: NotificationShowParams;
      [k: string]: unknown;
    }
  | {
      method: "client.window_title.set";
      params: ClientWindowTitleSetParams;
      [k: string]: unknown;
    }
  | {
      method: "client.window_title.clear";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "session.snapshot";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "workspace.create";
      params: WorkspaceCreateParams;
      [k: string]: unknown;
    }
  | {
      method: "workspace.list";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "workspace.get";
      params: WorkspaceTarget;
      [k: string]: unknown;
    }
  | {
      method: "workspace.focus";
      params: WorkspaceTarget;
      [k: string]: unknown;
    }
  | {
      method: "workspace.rename";
      params: WorkspaceRenameParams;
      [k: string]: unknown;
    }
  | {
      method: "workspace.move";
      params: WorkspaceMoveParams;
      [k: string]: unknown;
    }
  | {
      method: "workspace.move_block";
      params: WorkspaceMoveBlockParams;
      [k: string]: unknown;
    }
  | {
      method: "workspace.report_metadata";
      params: WorkspaceReportMetadataParams;
      [k: string]: unknown;
    }
  | {
      method: "workspace.close";
      params: WorkspaceTarget;
      [k: string]: unknown;
    }
  | {
      method: "worktree.list";
      params: WorktreeListParams;
      [k: string]: unknown;
    }
  | {
      method: "worktree.create";
      params: WorktreeCreateParams;
      [k: string]: unknown;
    }
  | {
      method: "worktree.open";
      params: WorktreeOpenParams;
      [k: string]: unknown;
    }
  | {
      method: "worktree.remove";
      params: WorktreeRemoveParams;
      [k: string]: unknown;
    }
  | {
      method: "tab.create";
      params: TabCreateParams;
      [k: string]: unknown;
    }
  | {
      method: "tab.list";
      params: TabListParams;
      [k: string]: unknown;
    }
  | {
      method: "tab.get";
      params: TabTarget;
      [k: string]: unknown;
    }
  | {
      method: "tab.focus";
      params: TabTarget;
      [k: string]: unknown;
    }
  | {
      method: "tab.rename";
      params: TabRenameParams;
      [k: string]: unknown;
    }
  | {
      method: "tab.move";
      params: TabMoveParams;
      [k: string]: unknown;
    }
  | {
      method: "tab.close";
      params: TabTarget;
      [k: string]: unknown;
    }
  | {
      method: "agent.list";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.get";
      params: AgentTarget;
      [k: string]: unknown;
    }
  | {
      method: "agent.read";
      params: AgentReadParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.explain";
      params: AgentTarget;
      [k: string]: unknown;
    }
  | {
      method: "agent.send_keys";
      params: AgentSendKeysParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.rename";
      params: AgentRenameParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.view.set";
      params: AgentViewSetParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.view.clear";
      params: AgentViewClearParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.focus";
      params: AgentTarget;
      [k: string]: unknown;
    }
  | {
      method: "agent.start";
      params: AgentStartParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.prompt";
      params: AgentPromptParams;
      [k: string]: unknown;
    }
  | {
      method: "agent.wait";
      params: AgentWaitParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.split";
      params: PaneSplitParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.swap";
      params: PaneSwapParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.move";
      params: PaneMoveParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.zoom";
      params: PaneZoomParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.layout";
      params: PaneLayoutParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.process_info";
      params: PaneProcessInfoParams;
      [k: string]: unknown;
    }
  | {
      method: "layout.export";
      params: LayoutExportParams;
      [k: string]: unknown;
    }
  | {
      method: "layout.apply";
      params: LayoutApplyParams;
      [k: string]: unknown;
    }
  | {
      method: "layout.set_split_ratio";
      params: LayoutSetSplitRatioParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.neighbor";
      params: PaneNeighborParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.edges";
      params: PaneEdgesParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.focus_direction";
      params: PaneFocusDirectionParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.resize";
      params: PaneResizeParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.list";
      params: PaneListParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.current";
      params: PaneCurrentParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.get";
      params: PaneTarget;
      [k: string]: unknown;
    }
  | {
      method: "pane.focus";
      params: PaneTarget;
      [k: string]: unknown;
    }
  | {
      method: "pane.rename";
      params: PaneRenameParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.send_text";
      params: PaneSendTextParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.send_keys";
      params: PaneSendKeysParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.send_input";
      params: PaneSendInputParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.read";
      params: PaneReadParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.graphics.set";
      params: PaneGraphicsSetParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.graphics.clear";
      params: PaneGraphicsClearParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.graphics.info";
      params: PaneTarget;
      [k: string]: unknown;
    }
  | {
      method: "pane.report_agent";
      params: PaneReportAgentParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.report_agent_session";
      params: PaneReportAgentSessionParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.report_metadata";
      params: PaneReportMetadataParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.clear_agent_authority";
      params: PaneClearAgentAuthorityParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.release_agent";
      params: PaneReleaseAgentParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.close";
      params: PaneTarget;
      [k: string]: unknown;
    }
  | {
      method: "popup.close";
      params: EmptyParams;
      [k: string]: unknown;
    }
  | {
      method: "events.subscribe";
      params: EventsSubscribeParams;
      [k: string]: unknown;
    }
  | {
      method: "events.wait";
      params: EventsWaitParams;
      [k: string]: unknown;
    }
  | {
      method: "pane.wait_for_output";
      params: PaneWaitForOutputParams;
      [k: string]: unknown;
    }
  | {
      method: "integration.install";
      params: IntegrationInstallParams;
      [k: string]: unknown;
    }
  | {
      method: "integration.uninstall";
      params: IntegrationUninstallParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.link";
      params: PluginLinkParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.list";
      params: PluginListParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.unlink";
      params: PluginUnlinkParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.enable";
      params: PluginSetEnabledParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.disable";
      params: PluginSetEnabledParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.action.list";
      params: PluginActionListParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.action.invoke";
      params: PluginActionInvokeParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.log.list";
      params: PluginLogListParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.pane.open";
      params: PluginPaneOpenParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.pane.focus";
      params: PluginPaneFocusParams;
      [k: string]: unknown;
    }
  | {
      method: "plugin.pane.close";
      params: PluginPaneCloseParams;
      [k: string]: unknown;
    }
);
export type ToastHerdrPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type NotificationShowSound = "none" | "done" | "request";
export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";
export type AgentViewFilter =
  | {
      filters: AgentViewFilter[];
      op: "all";
      [k: string]: unknown;
    }
  | {
      filters: AgentViewFilter[];
      op: "any";
      [k: string]: unknown;
    }
  | {
      filter: AgentViewFilter;
      op: "not";
      [k: string]: unknown;
    }
  | {
      field: AgentViewField;
      op: "eq";
      value: AgentViewValue;
      [k: string]: unknown;
    }
  | {
      field: AgentViewField;
      op: "in";
      values: AgentViewValue[];
      [k: string]: unknown;
    }
  | {
      field: AgentViewField;
      op: "exists";
      [k: string]: unknown;
    };
export type AgentViewField =
  | AgentViewBuiltinField
  | {
      token: string;
      [k: string]: unknown;
    };
export type AgentViewBuiltinField =
  | "status"
  | "workspace_id"
  | "tab_id"
  | "pane_id"
  | "agent"
  | "seen"
  | "state_change_seq";
export type AgentViewValue =
  | string
  | boolean
  | number
  | {
      context: AgentViewContext;
      [k: string]: unknown;
    };
export type AgentViewContext = "current_workspace_id" | "current_tab_id";
export type AgentViewSortField =
  | AgentViewBuiltinSortField
  | {
      token: string;
      [k: string]: unknown;
    };
export type AgentViewBuiltinSortField =
  | "workspace_order"
  | "tab_order"
  | "pane_order"
  | "attention"
  | "status"
  | "agent"
  | "seen"
  | "state_change_seq";
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type SplitDirection = "right" | "down";
export type PaneDirection = "left" | "right" | "up" | "down";
export type PaneMoveDestination =
  | {
      ratio?: number | null;
      split: SplitDirection;
      tab_id: string;
      target_pane_id?: string | null;
      type: "tab";
      [k: string]: unknown;
    }
  | {
      label?: string | null;
      type: "new_tab";
      workspace_id?: string | null;
      [k: string]: unknown;
    }
  | {
      label?: string | null;
      tab_label?: string | null;
      type: "new_workspace";
      [k: string]: unknown;
    };
export type LayoutNode =
  | {
      command?: string[] | null;
      cwd?: string | null;
      env?: {
        [k: string]: string;
      };
      label?: string | null;
      pane_id?: string | null;
      type: "pane";
      [k: string]: unknown;
    }
  | {
      direction: SplitDirection;
      first: LayoutNode;
      ratio: number;
      second: LayoutNode;
      type: "split";
      [k: string]: unknown;
    };
export type PaneGraphicsFormat = "png" | "rgb" | "rgba";
export type PaneAgentState = "idle" | "working" | "blocked" | "unknown";
export type Subscription =
  | {
      type: "workspace.created";
      [k: string]: unknown;
    }
  | {
      type: "workspace.updated";
      [k: string]: unknown;
    }
  | {
      type: "workspace.metadata_updated";
      [k: string]: unknown;
    }
  | {
      type: "workspace.renamed";
      [k: string]: unknown;
    }
  | {
      type: "workspace.moved";
      [k: string]: unknown;
    }
  | {
      type: "workspace.reordered";
      [k: string]: unknown;
    }
  | {
      type: "workspace.closed";
      [k: string]: unknown;
    }
  | {
      type: "workspace.focused";
      [k: string]: unknown;
    }
  | {
      type: "worktree.created";
      [k: string]: unknown;
    }
  | {
      type: "worktree.opened";
      [k: string]: unknown;
    }
  | {
      type: "worktree.removed";
      [k: string]: unknown;
    }
  | {
      type: "tab.created";
      [k: string]: unknown;
    }
  | {
      type: "tab.closed";
      [k: string]: unknown;
    }
  | {
      type: "tab.focused";
      [k: string]: unknown;
    }
  | {
      type: "tab.renamed";
      [k: string]: unknown;
    }
  | {
      type: "tab.moved";
      [k: string]: unknown;
    }
  | {
      type: "pane.created";
      [k: string]: unknown;
    }
  | {
      type: "pane.closed";
      [k: string]: unknown;
    }
  | {
      type: "pane.updated";
      [k: string]: unknown;
    }
  | {
      type: "pane.focused";
      [k: string]: unknown;
    }
  | {
      type: "pane.moved";
      [k: string]: unknown;
    }
  | {
      type: "pane.exited";
      [k: string]: unknown;
    }
  | {
      type: "pane.agent_detected";
      [k: string]: unknown;
    }
  | {
      lines?: number | null;
      match: OutputMatch;
      pane_id: string;
      source: ReadSource;
      strip_ansi?: boolean;
      type: "pane.output_matched";
      [k: string]: unknown;
    }
  | {
      agent_status?: AgentStatus | null;
      pane_id: string;
      type: "pane.agent_status_changed";
      [k: string]: unknown;
    }
  | {
      pane_id: string;
      type: "pane.scroll_changed";
      [k: string]: unknown;
    }
  | {
      type: "layout.updated";
      [k: string]: unknown;
    };
export type OutputMatch =
  | {
      type: "substring";
      value: string;
      [k: string]: unknown;
    }
  | {
      type: "regex";
      value: string;
      [k: string]: unknown;
    };
export type EventMatch =
  | {
      event: "workspace_created";
      workspace_id?: string | null;
      [k: string]: unknown;
    }
  | {
      event: "workspace_updated";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      event: "workspace_closed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      event: "workspace_renamed";
      label?: string | null;
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      event: "workspace_moved";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      event: "workspace_focused";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      event: "tab_created";
      tab_id?: string | null;
      workspace_id?: string | null;
      [k: string]: unknown;
    }
  | {
      event: "tab_closed";
      tab_id: string;
      [k: string]: unknown;
    }
  | {
      event: "tab_renamed";
      label?: string | null;
      tab_id: string;
      [k: string]: unknown;
    }
  | {
      event: "tab_moved";
      tab_id: string;
      [k: string]: unknown;
    }
  | {
      event: "tab_focused";
      tab_id: string;
      [k: string]: unknown;
    }
  | {
      event: "pane_created";
      pane_id?: string | null;
      workspace_id?: string | null;
      [k: string]: unknown;
    }
  | {
      event: "pane_closed";
      pane_id: string;
      [k: string]: unknown;
    }
  | {
      event: "pane_focused";
      pane_id: string;
      [k: string]: unknown;
    }
  | {
      event: "pane_moved";
      pane_id: string;
      [k: string]: unknown;
    }
  | {
      event: "pane_output_changed";
      min_revision?: number | null;
      pane_id: string;
      [k: string]: unknown;
    }
  | {
      event: "pane_exited";
      pane_id: string;
      [k: string]: unknown;
    }
  | {
      agent?: string | null;
      event: "pane_agent_detected";
      pane_id: string;
      [k: string]: unknown;
    }
  | {
      agent_status: AgentStatus;
      event: "pane_agent_status_changed";
      pane_id: string;
      [k: string]: unknown;
    };
export type IntegrationTarget =
  | "pi"
  | "omp"
  | "claude"
  | "codex"
  | "copilot"
  | "devin"
  | "droid"
  | "kimi"
  | "opencode"
  | "kilo"
  | "hermes"
  | "qodercli"
  | "cursor"
  | "mastracode"
  | "grok";
export type PopupSize = number | string;
export type PluginPanePlacement = "overlay" | "popup" | "split" | "tab" | "zoomed";

export interface PingParams {
  [k: string]: unknown;
}
export interface EmptyParams {
  [k: string]: unknown;
}
export interface ServerLiveHandoffParams {
  expected_protocol?: number | null;
  expected_version?: string | null;
  import_exe?: string | null;
  [k: string]: unknown;
}
export interface NotificationShowParams {
  body?: string | null;
  position?: ToastHerdrPosition | null;
  sound?: NotificationShowSound;
  title: string;
  [k: string]: unknown;
}
export interface ClientWindowTitleSetParams {
  title: string;
  [k: string]: unknown;
}
export interface WorkspaceCreateParams {
  cwd?: string | null;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  label?: string | null;
  [k: string]: unknown;
}
export interface WorkspaceTarget {
  workspace_id: string;
  [k: string]: unknown;
}
export interface WorkspaceRenameParams {
  label: string;
  workspace_id: string;
  [k: string]: unknown;
}
export interface WorkspaceMoveParams {
  insert_index: number;
  workspace_id: string;
  [k: string]: unknown;
}
export interface WorkspaceMoveBlockParams {
  before_workspace_id?: string | null;
  workspace_ids: string[];
  [k: string]: unknown;
}
export interface WorkspaceReportMetadataParams {
  seq?: number | null;
  source: string;
  tokens: {
    [k: string]: string | null;
  };
  ttl_ms?: number | null;
  workspace_id: string;
  [k: string]: unknown;
}
export interface WorktreeListParams {
  cwd?: string | null;
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface WorktreeCreateParams {
  base?: string | null;
  branch?: string | null;
  cwd?: string | null;
  focus?: boolean;
  label?: string | null;
  path?: string | null;
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface WorktreeOpenParams {
  branch?: string | null;
  cwd?: string | null;
  focus?: boolean;
  label?: string | null;
  path?: string | null;
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface WorktreeRemoveParams {
  force?: boolean;
  workspace_id: string;
  [k: string]: unknown;
}
export interface TabCreateParams {
  cwd?: string | null;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  label?: string | null;
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface TabListParams {
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface TabTarget {
  tab_id: string;
  [k: string]: unknown;
}
export interface TabRenameParams {
  label: string;
  tab_id: string;
  [k: string]: unknown;
}
export interface TabMoveParams {
  insert_index: number;
  tab_id: string;
  [k: string]: unknown;
}
export interface AgentTarget {
  target: string;
  [k: string]: unknown;
}
export interface AgentReadParams {
  format?: "text" | "ansi";
  lines?: number | null;
  source: ReadSource;
  strip_ansi?: boolean;
  target: string;
  [k: string]: unknown;
}
export interface AgentSendKeysParams {
  keys: string[];
  target: string;
  [k: string]: unknown;
}
export interface AgentRenameParams {
  name?: string | null;
  target: string;
  [k: string]: unknown;
}
export interface AgentViewSetParams {
  filter?: AgentViewFilter | null;
  label?: string | null;
  sort?: AgentViewSort[];
  source: string;
  [k: string]: unknown;
}
export interface AgentViewSort {
  field: AgentViewSortField;
  order?: "asc" | "desc";
  [k: string]: unknown;
}
export interface AgentViewClearParams {
  source?: string | null;
  [k: string]: unknown;
}
export interface AgentStartParams {
  args?: string[];
  kind: string;
  name: string;
  pane_id: string;
  /**
   * Startup timeout in milliseconds. Values must be greater than 3000 and at most 300000.
   */
  timeout_ms?: number | null;
  [k: string]: unknown;
}
export interface AgentPromptParams {
  target: string;
  text: string;
  wait?: AgentPromptWaitOptions | null;
  [k: string]: unknown;
}
export interface AgentPromptWaitOptions {
  timeout_ms?: number | null;
  until?: AgentStatus[];
  [k: string]: unknown;
}
export interface AgentWaitParams {
  target: string;
  timeout_ms?: number | null;
  until?: AgentStatus[];
  [k: string]: unknown;
}
export interface PaneSplitParams {
  cwd?: string | null;
  direction: SplitDirection;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  ratio?: number | null;
  target_pane_id?: string | null;
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface PaneSwapParams {
  direction?: PaneDirection | null;
  pane_id?: string | null;
  source_pane_id?: string | null;
  target_pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneMoveParams {
  destination: PaneMoveDestination;
  focus?: boolean;
  pane_id: string;
  [k: string]: unknown;
}
export interface PaneZoomParams {
  mode?: "toggle" | "on" | "off";
  pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneLayoutParams {
  pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneProcessInfoParams {
  pane_id?: string | null;
  [k: string]: unknown;
}
export interface LayoutExportParams {
  pane_id?: string | null;
  tab_id?: string | null;
  [k: string]: unknown;
}
export interface LayoutApplyParams {
  focus?: boolean;
  root: LayoutNode;
  tab_id?: string | null;
  tab_label?: string | null;
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface LayoutSetSplitRatioParams {
  pane_id?: string | null;
  path: boolean[];
  ratio: number;
  tab_id?: string | null;
  [k: string]: unknown;
}
export interface PaneNeighborParams {
  direction: PaneDirection;
  pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneEdgesParams {
  pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneFocusDirectionParams {
  direction: PaneDirection;
  pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneResizeParams {
  amount?: number | null;
  direction: PaneDirection;
  pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneListParams {
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface PaneCurrentParams {
  caller_pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneTarget {
  pane_id: string;
  [k: string]: unknown;
}
export interface PaneRenameParams {
  label?: string | null;
  pane_id: string;
  [k: string]: unknown;
}
export interface PaneSendTextParams {
  pane_id: string;
  text: string;
  [k: string]: unknown;
}
export interface PaneSendKeysParams {
  keys: string[];
  pane_id: string;
  [k: string]: unknown;
}
export interface PaneSendInputParams {
  keys?: string[];
  pane_id: string;
  text?: string;
  [k: string]: unknown;
}
export interface PaneReadParams {
  format?: "text" | "ansi";
  lines?: number | null;
  pane_id: string;
  source: ReadSource;
  strip_ansi?: boolean;
  [k: string]: unknown;
}
export interface PaneGraphicsSetParams {
  data_base64?: string;
  format: PaneGraphicsFormat;
  image_height: number;
  image_width: number;
  pane_id: string;
  placement?: PaneGraphicsPlacementParams;
  [k: string]: unknown;
}
export interface PaneGraphicsPlacementParams {
  grid_cols?: number;
  grid_rows?: number;
  viewport_col?: number;
  viewport_row?: number;
  [k: string]: unknown;
}
export interface PaneGraphicsClearParams {
  pane_id: string;
  [k: string]: unknown;
}
export interface PaneReportAgentParams {
  agent: string;
  agent_session_id?: string | null;
  agent_session_path?: string | null;
  message?: string | null;
  pane_id: string;
  seq?: number | null;
  source: string;
  state: PaneAgentState;
  [k: string]: unknown;
}
export interface PaneReportAgentSessionParams {
  agent: string;
  agent_session_id?: string | null;
  agent_session_path?: string | null;
  pane_id: string;
  seq?: number | null;
  session_start_source?: string | null;
  source: string;
  [k: string]: unknown;
}
export interface PaneReportMetadataParams {
  agent?: string | null;
  applies_to_source?: string | null;
  clear_display_agent?: boolean;
  clear_state_labels?: boolean;
  clear_title?: boolean;
  display_agent?: string | null;
  pane_id: string;
  seq?: number | null;
  source: string;
  state_labels?: {
    [k: string]: string;
  };
  title?: string | null;
  tokens?: {
    [k: string]: string | null;
  };
  ttl_ms?: number | null;
  [k: string]: unknown;
}
export interface PaneClearAgentAuthorityParams {
  pane_id: string;
  seq?: number | null;
  source?: string | null;
  [k: string]: unknown;
}
export interface PaneReleaseAgentParams {
  agent: string;
  pane_id: string;
  seq?: number | null;
  source: string;
  [k: string]: unknown;
}
export interface EventsSubscribeParams {
  subscriptions: Subscription[];
  [k: string]: unknown;
}
export interface EventsWaitParams {
  match_event: EventMatch;
  timeout_ms?: number | null;
  [k: string]: unknown;
}
export interface PaneWaitForOutputParams {
  lines?: number | null;
  match: OutputMatch;
  pane_id: string;
  source: ReadSource;
  strip_ansi?: boolean;
  timeout_ms?: number | null;
  [k: string]: unknown;
}
export interface IntegrationInstallParams {
  target: IntegrationTarget;
  [k: string]: unknown;
}
export interface IntegrationUninstallParams {
  target: IntegrationTarget;
  [k: string]: unknown;
}
export interface PluginLinkParams {
  enabled?: boolean;
  path: string;
  source?: PluginSourceInfo | null;
  [k: string]: unknown;
}
export interface PluginSourceInfo {
  installed_unix_ms?: number | null;
  kind?: "local" | "github";
  managed_path?: string | null;
  owner?: string | null;
  repo?: string | null;
  requested_ref?: string | null;
  resolved_commit?: string | null;
  subdir?: string | null;
  [k: string]: unknown;
}
export interface PluginListParams {
  plugin_id?: string | null;
  [k: string]: unknown;
}
export interface PluginUnlinkParams {
  plugin_id: string;
  [k: string]: unknown;
}
export interface PluginSetEnabledParams {
  plugin_id: string;
  [k: string]: unknown;
}
export interface PluginActionListParams {
  plugin_id?: string | null;
  [k: string]: unknown;
}
export interface PluginActionInvokeParams {
  action_id: string;
  context?: PluginInvocationContext | null;
  plugin_id?: string | null;
  [k: string]: unknown;
}
export interface PluginInvocationContext {
  clicked_url?: string | null;
  correlation_id?: string | null;
  focused_pane_agent?: string | null;
  focused_pane_cwd?: string | null;
  focused_pane_id?: string | null;
  focused_pane_status?: AgentStatus | null;
  invocation_source?: string | null;
  link_handler_id?: string | null;
  selected_text?: string | null;
  tab_id?: string | null;
  tab_label?: string | null;
  workspace_cwd?: string | null;
  workspace_id?: string | null;
  workspace_label?: string | null;
  worktree?: WorkspaceWorktreeInfo | null;
  [k: string]: unknown;
}
export interface WorkspaceWorktreeInfo {
  checkout_path: string;
  is_linked_worktree: boolean;
  repo_key: string;
  repo_name: string;
  repo_root: string;
  [k: string]: unknown;
}
export interface PluginLogListParams {
  limit?: number | null;
  plugin_id?: string | null;
  [k: string]: unknown;
}
export interface PluginPaneOpenParams {
  cwd?: string | null;
  direction?: SplitDirection | null;
  entrypoint: string;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  height?: PopupSize | null;
  placement?: PluginPanePlacement | null;
  plugin_id: string;
  target_pane_id?: string | null;
  width?: PopupSize | null;
  workspace_id?: string | null;
  [k: string]: unknown;
}
export interface PluginPaneFocusParams {
  pane_id: string;
  [k: string]: unknown;
}
export interface PluginPaneCloseParams {
  pane_id: string;
  [k: string]: unknown;
}
