/** Generated from schema/herdr-api.schema.json; do not edit. */

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
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type AgentSessionRefKind = "id" | "path";
export type SplitDirection = "right" | "down";
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

export interface EventEnvelope {
  data: EventData;
  event: EventKind;
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
export interface AgentSessionInfo {
  agent: string;
  kind: AgentSessionRefKind;
  source: string;
  value: string;
  [k: string]: unknown;
}
export interface PaneScrollInfo {
  max_offset_from_bottom: number;
  offset_from_bottom: number;
  viewport_rows: number;
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
