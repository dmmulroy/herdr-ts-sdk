/** Generated from schema/herdr-api.schema.json; do not edit. */

export type SubscriptionEventData =
  | PaneOutputMatchedEvent
  | PaneAgentStatusChangedEvent
  | PaneScrollChangedEvent;
export type ReadFormat = "text" | "ansi";
export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type SubscriptionEventKind =
  | "pane.output_matched"
  | "pane.agent_status_changed"
  | "pane.scroll_changed";

export interface SubscriptionEventEnvelope {
  data: SubscriptionEventData;
  event: SubscriptionEventKind;
  [k: string]: unknown;
}
export interface PaneOutputMatchedEvent {
  matched_line: string;
  pane_id: string;
  read: PaneReadResult;
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
export interface PaneAgentStatusChangedEvent {
  agent?: string | null;
  agent_status: AgentStatus;
  display_agent?: string | null;
  pane_id: string;
  state_labels?: {
    [k: string]: string;
  };
  title?: string | null;
  workspace_id: string;
  [k: string]: unknown;
}
export interface PaneScrollChangedEvent {
  pane_id: string;
  scroll: PaneScrollInfo;
  workspace_id: string;
  [k: string]: unknown;
}
export interface PaneScrollInfo {
  max_offset_from_bottom: number;
  offset_from_bottom: number;
  viewport_rows: number;
  [k: string]: unknown;
}
