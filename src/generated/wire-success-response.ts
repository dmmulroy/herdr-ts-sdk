/** Generated from schema/herdr-api.schema.json; do not edit. */

export type ResponseResult =
  | {
      capabilities?: ServerCapabilities | null;
      protocol: number;
      type: "pong";
      version: string;
      [k: string]: unknown;
    }
  | {
      snapshot: SessionSnapshot;
      type: "session_snapshot";
      [k: string]: unknown;
    }
  | {
      type: "workspace_info";
      workspace: WorkspaceInfo;
      [k: string]: unknown;
    }
  | {
      root_pane: PaneInfo;
      tab: TabInfo;
      type: "workspace_created";
      workspace: WorkspaceInfo;
      [k: string]: unknown;
    }
  | {
      type: "workspace_list";
      workspaces: WorkspaceInfo[];
      [k: string]: unknown;
    }
  | {
      source: WorktreeSourceInfo;
      type: "worktree_list";
      worktrees: WorktreeInfo[];
      [k: string]: unknown;
    }
  | {
      root_pane: PaneInfo;
      tab: TabInfo;
      type: "worktree_created";
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
      [k: string]: unknown;
    }
  | {
      already_open: boolean;
      root_pane: PaneInfo;
      tab: TabInfo;
      type: "worktree_opened";
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
      [k: string]: unknown;
    }
  | {
      forced: boolean;
      path: string;
      type: "worktree_removed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      tab: TabInfo;
      type: "tab_info";
      [k: string]: unknown;
    }
  | {
      root_pane: PaneInfo;
      tab: TabInfo;
      type: "tab_created";
      [k: string]: unknown;
    }
  | {
      tabs: TabInfo[];
      type: "tab_list";
      [k: string]: unknown;
    }
  | {
      agent: AgentInfo;
      type: "agent_info";
      [k: string]: unknown;
    }
  | {
      agent: AgentInfo;
      argv: string[];
      type: "agent_started";
      [k: string]: unknown;
    }
  | {
      agent: AgentInfo;
      type: "agent_prompted";
      [k: string]: unknown;
    }
  | {
      agents: AgentInfo[];
      type: "agent_list";
      [k: string]: unknown;
    }
  | {
      active: boolean;
      label?: string | null;
      source?: string | null;
      type: "agent_view";
      [k: string]: unknown;
    }
  | {
      pane: PaneInfo;
      type: "pane_info";
      [k: string]: unknown;
    }
  | {
      panes: PaneInfo[];
      type: "pane_list";
      [k: string]: unknown;
    }
  | {
      pane: PaneInfo;
      type: "pane_current";
      [k: string]: unknown;
    }
  | {
      swap: PaneSwapResult;
      type: "pane_swap";
      [k: string]: unknown;
    }
  | {
      move_result: PaneMoveResult;
      type: "pane_move";
      [k: string]: unknown;
    }
  | {
      type: "pane_zoom";
      zoom: PaneZoomResult;
      [k: string]: unknown;
    }
  | {
      layout: PaneLayoutSnapshot;
      type: "pane_layout";
      [k: string]: unknown;
    }
  | {
      process_info: PaneProcessInfo;
      type: "pane_process_info";
      [k: string]: unknown;
    }
  | {
      layout: LayoutDescription;
      type: "layout_export";
      [k: string]: unknown;
    }
  | {
      layout: LayoutDescription;
      type: "layout_apply";
      [k: string]: unknown;
    }
  | {
      layout: LayoutDescription;
      type: "layout_split_ratio_set";
      [k: string]: unknown;
    }
  | {
      neighbor: PaneNeighborResult;
      type: "pane_neighbor";
      [k: string]: unknown;
    }
  | {
      edges: PaneEdgesResult;
      type: "pane_edges";
      [k: string]: unknown;
    }
  | {
      focus: PaneFocusDirectionResult;
      type: "pane_focus_direction";
      [k: string]: unknown;
    }
  | {
      resize: PaneResizeResult;
      type: "pane_resize";
      [k: string]: unknown;
    }
  | {
      read: PaneReadResult;
      type: "pane_read";
      [k: string]: unknown;
    }
  | {
      revision: number;
      sequence: number;
      type: "pane_graphics_frame_ack";
      [k: string]: unknown;
    }
  | {
      cell_height_px: number;
      cell_width_px: number;
      /**
       * Accepts damage metadata while still consuming a complete canonical file.
       */
      file_frame_damage?: boolean;
      file_frame_direct_max_bytes?: number | null;
      file_frame_directory?: string | null;
      file_frame_formats?: string[];
      file_frame_max_bytes?: number | null;
      file_frame_transport?: string | null;
      max_layers_per_pane?: number;
      /**
       * True only when this pane is on the currently rendered terminal surface.
       */
      pane_visible: boolean;
      pixel_mouse?: boolean;
      type: "pane_graphics_info";
      [k: string]: unknown;
    }
  | {
      explain: unknown;
      type: "agent_explain";
      [k: string]: unknown;
    }
  | {
      type: "subscription_started";
      [k: string]: unknown;
    }
  | {
      event: EventEnvelope;
      type: "wait_matched";
      [k: string]: unknown;
    }
  | {
      matched_line?: string | null;
      pane_id: string;
      read: PaneReadResult;
      revision: number;
      type: "output_matched";
      [k: string]: unknown;
    }
  | {
      reason: NotificationShowReason;
      shown: boolean;
      type: "notification_show";
      [k: string]: unknown;
    }
  | {
      changed: boolean;
      reason: ClientWindowTitleReason;
      type: "client_window_title";
      [k: string]: unknown;
    }
  | {
      details: IntegrationInstallResult;
      target: IntegrationTarget;
      type: "integration_install";
      [k: string]: unknown;
    }
  | {
      details: IntegrationUninstallResult;
      target: IntegrationTarget;
      type: "integration_uninstall";
      [k: string]: unknown;
    }
  | {
      manifests: AgentManifestInfo[];
      type: "agent_manifest_reload";
      [k: string]: unknown;
    }
  | {
      last_check_unix?: number | null;
      last_result?: string | null;
      manifests: AgentManifestInfo[];
      type: "agent_manifest_status";
      [k: string]: unknown;
    }
  | {
      plugin: InstalledPluginInfo;
      type: "plugin_linked";
      [k: string]: unknown;
    }
  | {
      plugins: InstalledPluginInfo[];
      type: "plugin_list";
      [k: string]: unknown;
    }
  | {
      plugin_id: string;
      removed: boolean;
      type: "plugin_unlinked";
      [k: string]: unknown;
    }
  | {
      plugin: InstalledPluginInfo;
      type: "plugin_enabled";
      [k: string]: unknown;
    }
  | {
      plugin: InstalledPluginInfo;
      type: "plugin_disabled";
      [k: string]: unknown;
    }
  | {
      actions: PluginActionInfo[];
      type: "plugin_action_list";
      [k: string]: unknown;
    }
  | {
      action: PluginActionInfo;
      context: PluginInvocationContext;
      log: PluginCommandLogInfo;
      type: "plugin_action_invoked";
      [k: string]: unknown;
    }
  | {
      logs: PluginCommandLogInfo[];
      type: "plugin_log_list";
      [k: string]: unknown;
    }
  | {
      plugin_pane: PluginPaneInfo;
      type: "plugin_pane_opened";
      [k: string]: unknown;
    }
  | {
      plugin_pane: PluginPaneInfo;
      type: "plugin_pane_focused";
      [k: string]: unknown;
    }
  | {
      pane_id: string;
      type: "plugin_pane_closed";
      [k: string]: unknown;
    }
  | {
      diagnostics: string[];
      status: ConfigReloadStatus;
      type: "config_reload";
      [k: string]: unknown;
    }
  | {
      type: "ok";
      [k: string]: unknown;
    };
export type AgentSessionRefKind = "id" | "path";
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type SplitDirection = "right" | "down";
export type PaneSwapReason = "no_neighbor" | "same_pane" | "not_found" | "cross_tab";
export type PaneMoveReason = "same_tab" | "zoomed_tab";
export type PaneZoomReason = "single_pane" | "already_zoomed" | "already_unzoomed";
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
export type PaneDirection = "left" | "right" | "up" | "down";
export type PaneFocusDirectionReason = "no_neighbor";
export type PaneResizeReason = "unchanged";
export type ReadFormat = "text" | "ansi";
export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";
export type EventData =
  | {
      type: "workspace_created";
      workspace: WorkspaceInfo;
      [k: string]: unknown;
    }
  | {
      type: "workspace_updated";
      workspace: WorkspaceInfo;
      [k: string]: unknown;
    }
  | {
      type: "workspace_metadata_updated";
      workspace: WorkspaceInfo;
      [k: string]: unknown;
    }
  | {
      type: "workspace_closed";
      workspace?: WorkspaceInfo | null;
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      label: string;
      type: "workspace_renamed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      insert_index: number;
      type: "workspace_moved";
      workspace_id: string;
      workspaces: WorkspaceInfo[];
      [k: string]: unknown;
    }
  | {
      before_workspace_id?: string | null;
      type: "workspace_reordered";
      workspace_ids: string[];
      workspaces: WorkspaceInfo[];
      [k: string]: unknown;
    }
  | {
      type: "workspace_focused";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      type: "worktree_created";
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
      [k: string]: unknown;
    }
  | {
      already_open: boolean;
      type: "worktree_opened";
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
      [k: string]: unknown;
    }
  | {
      forced: boolean;
      type: "worktree_removed";
      workspace?: WorkspaceInfo | null;
      workspace_id: string;
      worktree: WorktreeInfo;
      [k: string]: unknown;
    }
  | {
      tab: TabInfo;
      type: "tab_created";
      [k: string]: unknown;
    }
  | {
      tab_id: string;
      type: "tab_closed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      label: string;
      tab_id: string;
      type: "tab_renamed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      insert_index: number;
      tab_id: string;
      tabs: TabInfo[];
      type: "tab_moved";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      tab_id: string;
      type: "tab_focused";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      pane: PaneInfo;
      type: "pane_created";
      [k: string]: unknown;
    }
  | {
      pane_id: string;
      type: "pane_closed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      pane: PaneInfo;
      type: "pane_updated";
      [k: string]: unknown;
    }
  | {
      pane_id: string;
      type: "pane_focused";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      closed_tab_id?: string | null;
      closed_workspace_id?: string | null;
      created_tab?: TabInfo | null;
      created_workspace?: WorkspaceInfo | null;
      pane: PaneInfo;
      previous_pane_id: string;
      previous_tab_id: string;
      previous_workspace_id: string;
      type: "pane_moved";
      [k: string]: unknown;
    }
  | {
      pane_id: string;
      revision: number;
      type: "pane_output_changed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      pane_id: string;
      type: "pane_exited";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      agent?: string | null;
      final_status?: AgentStatus | null;
      pane_id: string;
      released?: boolean;
      type: "pane_agent_detected";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      agent?: string | null;
      agent_status: AgentStatus;
      display_agent?: string | null;
      pane_id: string;
      state_labels?: {
        [k: string]: string;
      };
      title?: string | null;
      type: "pane_agent_status_changed";
      workspace_id: string;
      [k: string]: unknown;
    }
  | {
      layout: PaneLayoutSnapshot;
      type: "layout_updated";
      [k: string]: unknown;
    };
export type EventKind =
  | "workspace_created"
  | "workspace_updated"
  | "workspace_metadata_updated"
  | "workspace_closed"
  | "workspace_renamed"
  | "workspace_moved"
  | "workspace_reordered"
  | "workspace_focused"
  | "worktree_created"
  | "worktree_opened"
  | "worktree_removed"
  | "tab_created"
  | "tab_closed"
  | "tab_renamed"
  | "tab_moved"
  | "tab_focused"
  | "pane_created"
  | "pane_closed"
  | "pane_updated"
  | "pane_focused"
  | "pane_moved"
  | "pane_output_changed"
  | "pane_exited"
  | "pane_agent_detected"
  | "pane_agent_status_changed"
  | "layout_updated";
export type NotificationShowReason =
  | "shown"
  | "disabled"
  | "rate_limited"
  | "no_foreground_client"
  | "busy";
export type ClientWindowTitleReason = "set" | "cleared" | "no_foreground_client";
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
  | "qwen"
  | "cursor"
  | "mastracode"
  | "antigravity_cli"
  | "grok";
export type PluginActionContext = "global" | "workspace" | "tab" | "pane" | "selection";
export type PluginPlatform = "linux" | "macos" | "windows";
export type PopupSize = number | string;
export type PluginCommandStatus = "running" | "succeeded" | "failed";
export type ConfigReloadStatus = "applied" | "partial" | "failed";

export interface SuccessResponse {
  id: string;
  result: ResponseResult;
  [k: string]: unknown;
}
export interface ServerCapabilities {
  detached_server_daemon?: boolean;
  live_handoff: boolean;
  [k: string]: unknown;
}
export interface SessionSnapshot {
  agents: AgentInfo[];
  focused_pane_id?: string | null;
  focused_tab_id?: string | null;
  focused_workspace_id?: string | null;
  layouts: PaneLayoutSnapshot[];
  panes: PaneInfo[];
  protocol: number;
  tabs: TabInfo[];
  version: string;
  workspaces: WorkspaceInfo[];
  [k: string]: unknown;
}
export interface AgentInfo {
  agent?: string | null;
  agent_session?: AgentSessionInfo | null;
  agent_status: AgentStatus;
  cwd?: string | null;
  display_agent?: string | null;
  focused: boolean;
  foreground_cwd?: string | null;
  interactive_ready?: boolean;
  launch_pending?: boolean;
  name?: string | null;
  pane_id: string;
  revision: number;
  screen_detection_skipped?: boolean;
  state_change_seq?: number;
  state_labels?: {
    [k: string]: string;
  };
  tab_id: string;
  terminal_id: string;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  title?: string | null;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
  [k: string]: unknown;
}
export interface AgentSessionInfo {
  agent: string;
  kind: AgentSessionRefKind;
  source: string;
  value: string;
  [k: string]: unknown;
}
export interface PaneLayoutSnapshot {
  area: PaneLayoutRect;
  focused_pane_id: string;
  panes: PaneLayoutPane[];
  splits: PaneLayoutSplit[];
  tab_id: string;
  workspace_id: string;
  zoomed: boolean;
  [k: string]: unknown;
}
export interface PaneLayoutRect {
  height: number;
  width: number;
  x: number;
  y: number;
  [k: string]: unknown;
}
export interface PaneLayoutPane {
  focused: boolean;
  pane_id: string;
  rect: PaneLayoutRect;
  [k: string]: unknown;
}
export interface PaneLayoutSplit {
  direction: SplitDirection;
  id: string;
  ratio: number;
  rect: PaneLayoutRect;
  [k: string]: unknown;
}
export interface PaneInfo {
  agent?: string | null;
  agent_session?: AgentSessionInfo | null;
  agent_status: AgentStatus;
  cwd?: string | null;
  display_agent?: string | null;
  focused: boolean;
  foreground_cwd?: string | null;
  label?: string | null;
  pane_id: string;
  revision: number;
  scroll?: PaneScrollInfo | null;
  state_labels?: {
    [k: string]: string;
  };
  tab_id: string;
  terminal_id: string;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  title?: string | null;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
  [k: string]: unknown;
}
export interface PaneScrollInfo {
  max_offset_from_bottom: number;
  offset_from_bottom: number;
  viewport_rows: number;
  [k: string]: unknown;
}
export interface TabInfo {
  agent_status: AgentStatus;
  focused: boolean;
  label: string;
  number: number;
  pane_count: number;
  tab_id: string;
  workspace_id: string;
  [k: string]: unknown;
}
export interface WorkspaceInfo {
  active_tab_id: string;
  agent_status: AgentStatus;
  focused: boolean;
  label: string;
  number: number;
  pane_count: number;
  tab_count: number;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
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
export interface WorktreeSourceInfo {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  source_checkout_path: string;
  source_workspace_id?: string | null;
  [k: string]: unknown;
}
export interface WorktreeInfo {
  branch?: string | null;
  is_bare: boolean;
  is_detached: boolean;
  is_linked_worktree: boolean;
  is_prunable: boolean;
  label: string;
  open_workspace_id?: string | null;
  path: string;
  [k: string]: unknown;
}
export interface PaneSwapResult {
  changed: boolean;
  focused_pane_id: string;
  layout: PaneLayoutSnapshot;
  reason?: PaneSwapReason | null;
  source_pane_id: string;
  target_pane_id?: string | null;
  [k: string]: unknown;
}
export interface PaneMoveResult {
  changed: boolean;
  closed_tab_id?: string | null;
  closed_workspace_id?: string | null;
  created_tab?: TabInfo | null;
  created_workspace?: WorkspaceInfo | null;
  focused_pane_id: string;
  pane: PaneInfo;
  previous_pane_id: string;
  previous_tab_id: string;
  previous_workspace_id: string;
  reason?: PaneMoveReason | null;
  source_layout?: PaneLayoutSnapshot | null;
  target_layout: PaneLayoutSnapshot;
  [k: string]: unknown;
}
export interface PaneZoomResult {
  changed: boolean;
  focus_changed: boolean;
  focused_pane_id: string;
  layout: PaneLayoutSnapshot;
  pane_id: string;
  reason?: PaneZoomReason | null;
  zoom_changed: boolean;
  zoomed: boolean;
  [k: string]: unknown;
}
export interface PaneProcessInfo {
  foreground_process_group_id?: number | null;
  foreground_processes?: PaneProcessInfoProcess[];
  pane_id: string;
  shell_pid?: number | null;
  tty?: string | null;
  [k: string]: unknown;
}
export interface PaneProcessInfoProcess {
  argv?: string[] | null;
  argv0?: string | null;
  cmdline?: string | null;
  cwd?: string | null;
  name: string;
  pid: number;
  [k: string]: unknown;
}
export interface LayoutDescription {
  focused_pane_id: string;
  root: LayoutNode;
  tab_id: string;
  workspace_id: string;
  zoomed: boolean;
  [k: string]: unknown;
}
export interface PaneNeighborResult {
  direction: PaneDirection;
  layout: PaneLayoutSnapshot;
  neighbor_pane_id?: string | null;
  pane_id: string;
  [k: string]: unknown;
}
export interface PaneEdgesResult {
  down: boolean;
  layout: PaneLayoutSnapshot;
  left: boolean;
  pane_id: string;
  right: boolean;
  up: boolean;
  [k: string]: unknown;
}
export interface PaneFocusDirectionResult {
  changed: boolean;
  focused_pane_id?: string | null;
  layout: PaneLayoutSnapshot;
  reason?: PaneFocusDirectionReason | null;
  source_pane_id: string;
  [k: string]: unknown;
}
export interface PaneResizeResult {
  changed: boolean;
  focused_pane_id: string;
  layout: PaneLayoutSnapshot;
  pane_id: string;
  reason?: PaneResizeReason | null;
  [k: string]: unknown;
}
export interface PaneReadResult {
  format: ReadFormat;
  pane_id: string;
  revision: number;
  source: ReadSource;
  tab_id: string;
  text: string;
  truncated: boolean;
  workspace_id: string;
  [k: string]: unknown;
}
export interface EventEnvelope {
  data: EventData;
  event: EventKind;
  [k: string]: unknown;
}
export interface IntegrationInstallResult {
  messages: string[];
  [k: string]: unknown;
}
export interface IntegrationUninstallResult {
  messages: string[];
  [k: string]: unknown;
}
export interface AgentManifestInfo {
  active_version?: string | null;
  agent: string;
  cached_remote_version?: string | null;
  local_override_shadowing_remote: boolean;
  remote_last_checked_unix?: number | null;
  remote_update_error?: string | null;
  remote_update_result?: string | null;
  source: string;
  source_kind: string;
  warning?: string | null;
  [k: string]: unknown;
}
export interface InstalledPluginInfo {
  actions?: PluginManifestAction[];
  build?: PluginManifestBuild[];
  description?: string | null;
  enabled: boolean;
  events?: PluginManifestEventHook[];
  link_handlers?: PluginManifestLinkHandler[];
  manifest_path: string;
  min_herdr_version?: string;
  name: string;
  panes?: PluginManifestPane[];
  platforms?: PluginPlatform[] | null;
  plugin_id: string;
  plugin_root: string;
  source?: PluginSourceInfo;
  startup?: PluginManifestStartup[];
  version: string;
  /**
   * Warnings collected at link time or on registry load (e.g. unknown event names,
   * missing manifest file). Non-fatal — the entry is kept and surfaced by plugin.list.
   */
  warnings?: string[];
  [k: string]: unknown;
}
export interface PluginManifestAction {
  command: string[];
  contexts?: PluginActionContext[];
  description?: string | null;
  id: string;
  platforms?: PluginPlatform[] | null;
  title: string;
  [k: string]: unknown;
}
export interface PluginManifestBuild {
  command: string[];
  platforms?: PluginPlatform[] | null;
  [k: string]: unknown;
}
export interface PluginManifestEventHook {
  command: string[];
  on: string;
  platforms?: PluginPlatform[] | null;
  [k: string]: unknown;
}
export interface PluginManifestLinkHandler {
  action: string;
  id: string;
  pattern: string;
  platforms?: PluginPlatform[] | null;
  title: string;
  [k: string]: unknown;
}
export interface PluginManifestPane {
  command: string[];
  description?: string | null;
  height?: PopupSize | null;
  id: string;
  placement?: "overlay" | "popup" | "split" | "tab" | "zoomed";
  platforms?: PluginPlatform[] | null;
  title: string;
  width?: PopupSize | null;
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
export interface PluginManifestStartup {
  command: string[];
  platforms?: PluginPlatform[] | null;
  [k: string]: unknown;
}
export interface PluginActionInfo {
  action_id: string;
  command: string[];
  contexts?: PluginActionContext[];
  description?: string | null;
  platforms?: PluginPlatform[] | null;
  plugin_id: string;
  title: string;
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
export interface PluginCommandLogInfo {
  action_id?: string | null;
  command: string[];
  error?: string | null;
  event?: string | null;
  exit_code?: number | null;
  finished_unix_ms?: number | null;
  log_id: string;
  plugin_id: string;
  started_unix_ms: number;
  status: PluginCommandStatus;
  stderr?: string | null;
  stdout?: string | null;
  [k: string]: unknown;
}
export interface PluginPaneInfo {
  entrypoint: string;
  pane: PaneInfo;
  plugin_id: string;
  [k: string]: unknown;
}
