/** Public camel-cased Herdr SDK types. */
declare const herdrBrand: unique symbol;

type Brand<Value, Name extends string> = Value & {
  readonly [herdrBrand]: Name;
};

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type TabId = Brand<string, "TabId">;
export type PaneId = Brand<string, "PaneId">;
export type TerminalId = Brand<string, "TerminalId">;
export type PluginId = Brand<string, "PluginId">;
export type PluginActionId = Brand<string, "PluginActionId">;
export type PluginLogId = Brand<string, "PluginLogId">;
export type AgentName = Brand<string, "AgentName">;
export type AbsolutePath = Brand<string, "AbsolutePath">;

/** Millisecond duration. Runtime validation requires a finite, non-negative integer. */
export type Milliseconds = number;
/** Unix timestamp in milliseconds. */
export type UnixMilliseconds = number;
/** Unix timestamp in seconds. */
export type UnixSeconds = number;
export type Revision = number;
export type StateChangeSequence = number;
export type Environment = Readonly<Record<string, string>>;
export type MetadataTokens = Readonly<Record<string, string>>;
export type MetadataTokenPatch = Readonly<Record<string, string | null>>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface HerdrIdHelpers {
  workspace(value: string): WorkspaceId;
  tab(value: string): TabId;
  pane(value: string): PaneId;
  terminal(value: string): TerminalId;
  plugin(value: string): PluginId;
  pluginAction(value: string): PluginActionId;
  pluginLog(value: string): PluginLogId;
  agentName(value: string): AgentName;
  absolutePath(value: string): AbsolutePath;
}

export type HerdrSessionSelector =
  | { readonly session?: undefined; readonly socketPath?: undefined }
  | { readonly session: string; readonly socketPath?: never }
  | { readonly socketPath: AbsolutePath; readonly session?: never };

export type HerdrClientOptions = HerdrSessionSelector & {
  /** Default deadline for ordinary requests, not server-owned waits. */
  readonly requestTimeoutMs?: Milliseconds;
  readonly application?: {
    readonly name: string;
    readonly version?: string;
  };
};

export interface HerdrRequestOptions {
  /** Cancels the local request/stream; cancellation does not roll back server state. */
  readonly signal?: AbortSignal;
  /** Optional caller-supplied wire correlation ID. */
  readonly requestId?: string;
  /** Per-call transport deadline; distinct from a server-owned wait timeout. */
  readonly requestTimeoutMs?: Milliseconds;
}

export interface ServerNamespace {
  /** Wire: ping */
  ping(options?: HerdrRequestOptions): Promise<PingResult>;
  /** Wire: server.stop */
  stop(options?: HerdrRequestOptions): Promise<void>;
  /** Wire: server.live_handoff */
  liveHandoff(params?: ServerLiveHandoffParams, options?: HerdrRequestOptions): Promise<void>;
  /** Wire: server.reload_config */
  reloadConfig(options?: HerdrRequestOptions): Promise<ConfigReloadResult>;
  /** Wire: server.agent_manifests */
  getAgentManifests(options?: HerdrRequestOptions): Promise<AgentManifestStatus>;
  /** Wire: server.reload_agent_manifests */
  reloadAgentManifests(options?: HerdrRequestOptions): Promise<readonly AgentManifest[]>;
}

export interface SessionNamespace {
  /** Wire: session.snapshot */
  snapshot(options?: HerdrRequestOptions): Promise<SessionSnapshot>;
}

export interface NotificationNamespace {
  /** Wire: notification.show */
  show(
    params: NotificationShowParams,
    options?: HerdrRequestOptions,
  ): Promise<NotificationShowResult>;
}

export interface ClientNamespace {
  readonly windowTitle: ClientWindowTitleNamespace;
}

export interface ClientWindowTitleNamespace {
  /** Wire: client.window_title.set */
  set(title: string, options?: HerdrRequestOptions): Promise<ClientWindowTitleResult>;
  /** Wire: client.window_title.clear */
  clear(options?: HerdrRequestOptions): Promise<ClientWindowTitleResult>;
}

export interface PingResult {
  readonly version: string;
  readonly protocol: number;
  readonly capabilities?: ServerCapabilities;
}

export interface ServerCapabilities {
  readonly liveHandoff: boolean;
  readonly detachedServerDaemon: boolean;
}

export interface ServerLiveHandoffParams {
  readonly importExe?: AbsolutePath;
  readonly expectedProtocol?: number;
  readonly expectedVersion?: string;
}

export interface ConfigReloadResult {
  readonly status: "applied" | "partial" | "failed";
  readonly diagnostics: readonly string[];
}

export interface AgentManifestStatus {
  readonly lastCheckUnix?: UnixSeconds;
  readonly lastResult?: string;
  readonly manifests: readonly AgentManifest[];
}

export interface AgentManifest {
  readonly agent: string;
  readonly source: string;
  readonly sourceKind: string;
  readonly activeVersion?: string;
  readonly cachedRemoteVersion?: string;
  readonly localOverrideShadowingRemote: boolean;
  readonly remoteUpdateResult?: string;
  readonly remoteUpdateError?: string;
  readonly remoteLastCheckedUnix?: UnixSeconds;
  readonly warning?: string;
}

export interface NotificationShowParams {
  readonly title: string;
  readonly body?: string;
  readonly position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  readonly sound?: "none" | "done" | "request";
}

export interface NotificationShowResult {
  readonly shown: boolean;
  readonly reason: "shown" | "disabled" | "rate_limited" | "no_foreground_client" | "busy";
}

export interface ClientWindowTitleResult {
  readonly changed: boolean;
  readonly reason: "set" | "cleared" | "no_foreground_client";
}

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type ReportedAgentState = "idle" | "working" | "blocked" | "unknown";
export type AgentSessionReferenceKind = "id" | "path";

export interface AgentSessionReference {
  readonly source: string;
  readonly agent: string;
  readonly kind: AgentSessionReferenceKind;
  readonly value: string;
}

export interface Workspace {
  readonly id: WorkspaceId;
  readonly number: number;
  readonly label: string;
  readonly focused: boolean;
  readonly paneCount: number;
  readonly tabCount: number;
  readonly activeTabId: TabId;
  readonly agentStatus: AgentStatus;
  readonly tokens: MetadataTokens;
  readonly worktree?: WorkspaceWorktree;
}

export interface WorkspaceWorktree {
  readonly repoKey: string;
  readonly repoName: string;
  readonly repoRoot: AbsolutePath;
  readonly checkoutPath: AbsolutePath;
  readonly isLinkedWorktree: boolean;
}

export interface Tab {
  readonly id: TabId;
  readonly workspaceId: WorkspaceId;
  readonly number: number;
  readonly label: string;
  readonly focused: boolean;
  readonly paneCount: number;
  readonly agentStatus: AgentStatus;
}

export interface Pane {
  readonly id: PaneId;
  readonly terminalId: TerminalId;
  readonly workspaceId: WorkspaceId;
  readonly tabId: TabId;
  readonly focused: boolean;
  readonly cwd?: AbsolutePath;
  readonly foregroundCwd?: AbsolutePath;
  readonly label?: string;
  readonly agent?: string;
  readonly title?: string;
  readonly terminalTitle?: string;
  readonly terminalTitleStripped?: string;
  readonly displayAgent?: string;
  readonly agentStatus: AgentStatus;
  readonly stateLabels: Readonly<Record<string, string>>;
  readonly tokens: MetadataTokens;
  readonly agentSession?: AgentSessionReference;
  readonly scroll?: PaneScroll;
  readonly revision: Revision;
}

export interface PaneScroll {
  readonly offsetFromBottom: number;
  readonly maxOffsetFromBottom: number;
  readonly viewportRows: number;
}

export interface Agent {
  readonly terminalId: TerminalId;
  readonly name?: AgentName;
  readonly agent?: string;
  readonly title?: string;
  readonly terminalTitle?: string;
  readonly terminalTitleStripped?: string;
  readonly displayAgent?: string;
  readonly status: AgentStatus;
  readonly screenDetectionSkipped: boolean;
  readonly stateLabels: Readonly<Record<string, string>>;
  readonly tokens: MetadataTokens;
  readonly agentSession?: AgentSessionReference;
  readonly workspaceId: WorkspaceId;
  readonly tabId: TabId;
  readonly paneId: PaneId;
  readonly focused: boolean;
  readonly launchPending: boolean;
  readonly interactiveReady: boolean;
  readonly stateChangeSequence: StateChangeSequence;
  readonly cwd?: AbsolutePath;
  readonly foregroundCwd?: AbsolutePath;
  readonly revision: Revision;
}

export interface SessionSnapshot {
  readonly version: string;
  readonly protocol: number;
  readonly focusedWorkspaceId?: WorkspaceId;
  readonly focusedTabId?: TabId;
  readonly focusedPaneId?: PaneId;
  readonly workspaces: readonly Workspace[];
  readonly tabs: readonly Tab[];
  readonly panes: readonly Pane[];
  readonly layouts: readonly PaneLayoutSnapshot[];
  readonly agents: readonly Agent[];
}

export interface WorkspaceNamespace {
  /** Wire: workspace.create */
  create(
    params?: WorkspaceCreateParams,
    options?: HerdrRequestOptions,
  ): Promise<WorkspaceCreateResult>;
  /** Wire: workspace.list */
  list(options?: HerdrRequestOptions): Promise<readonly Workspace[]>;
  /** Wire: workspace.get */
  get(id: WorkspaceId, options?: HerdrRequestOptions): Promise<Workspace>;
  /** Wire: workspace.focus */
  focus(id: WorkspaceId, options?: HerdrRequestOptions): Promise<Workspace>;
  /** Wire: workspace.rename */
  rename(id: WorkspaceId, label: string, options?: HerdrRequestOptions): Promise<Workspace>;
  /** Wire: workspace.move */
  move(
    id: WorkspaceId,
    params: { readonly insertIndex: number },
    options?: HerdrRequestOptions,
  ): Promise<readonly Workspace[]>;
  /** Wire: workspace.move_block */
  moveBlock(
    ids: readonly WorkspaceId[],
    params?: { readonly beforeWorkspaceId?: WorkspaceId },
    options?: HerdrRequestOptions,
  ): Promise<readonly Workspace[]>;
  /** Wire: workspace.report_metadata */
  reportMetadata(
    id: WorkspaceId,
    params: WorkspaceMetadataReport,
    options?: HerdrRequestOptions,
  ): Promise<void>;
  /** Wire: workspace.close */
  close(id: WorkspaceId, options?: HerdrRequestOptions): Promise<void>;
}

export interface WorkspaceCreateParams {
  readonly cwd?: AbsolutePath;
  readonly focus?: boolean;
  readonly label?: string;
  readonly env?: Environment;
}

export interface WorkspaceCreateResult {
  readonly workspace: Workspace;
  readonly tab: Tab;
  readonly rootPane: Pane;
}

export interface WorkspaceMetadataReport {
  readonly source: string;
  readonly tokens: MetadataTokenPatch;
  readonly sequence?: number;
  /** Must be between 1 and 86,400,000 milliseconds. */
  readonly ttlMs?: Milliseconds;
}

export type WorktreeSource =
  | { readonly workspaceId: WorkspaceId; readonly cwd?: never }
  | { readonly cwd: AbsolutePath; readonly workspaceId?: never }
  | { readonly workspaceId?: never; readonly cwd?: never };

export type WorktreeOpenTarget =
  | { readonly path: AbsolutePath; readonly branch?: never }
  | { readonly branch: string; readonly path?: never };

export type WorktreeListParams = WorktreeSource;

export type WorktreeCreateParams = WorktreeSource & {
  readonly branch?: string;
  readonly base?: string;
  readonly path?: AbsolutePath;
  readonly label?: string;
  readonly focus?: boolean;
};

export type WorktreeOpenParams = WorktreeSource &
  WorktreeOpenTarget & {
    readonly label?: string;
    readonly focus?: boolean;
  };

export interface WorktreeNamespace {
  /** Wire: worktree.list */
  list(params?: WorktreeListParams, options?: HerdrRequestOptions): Promise<WorktreeListResult>;
  /** Wire: worktree.create */
  create(
    params?: WorktreeCreateParams,
    options?: HerdrRequestOptions,
  ): Promise<WorktreeCreateResult>;
  /** Wire: worktree.open */
  open(params: WorktreeOpenParams, options?: HerdrRequestOptions): Promise<WorktreeOpenResult>;
  /** Wire: worktree.remove */
  remove(
    workspaceId: WorkspaceId,
    params?: { readonly force?: boolean },
    options?: HerdrRequestOptions,
  ): Promise<WorktreeRemoveResult>;
}

export interface WorktreeSourceInfo {
  readonly repoKey: string;
  readonly repoName: string;
  readonly repoRoot: AbsolutePath;
  readonly sourceCheckoutPath: AbsolutePath;
  readonly sourceWorkspaceId?: WorkspaceId;
}

export interface Worktree {
  readonly path: AbsolutePath;
  readonly branch?: string;
  readonly isBare: boolean;
  readonly isDetached: boolean;
  readonly isPrunable: boolean;
  readonly isLinkedWorktree: boolean;
  readonly openWorkspaceId?: WorkspaceId;
  readonly label: string;
}

export interface WorktreeListResult {
  readonly source: WorktreeSourceInfo;
  readonly worktrees: readonly Worktree[];
}

export interface WorktreeCreateResult extends WorkspaceCreateResult {
  readonly worktree: Worktree;
}

export interface WorktreeOpenResult extends WorkspaceCreateResult {
  readonly worktree: Worktree;
  readonly alreadyOpen: boolean;
}

export interface WorktreeRemoveResult {
  readonly workspaceId: WorkspaceId;
  readonly path: AbsolutePath;
  readonly forced: boolean;
}

export interface TabNamespace {
  /** Wire: tab.create */
  create(params?: TabCreateParams, options?: HerdrRequestOptions): Promise<TabCreateResult>;
  /** Wire: tab.list */
  list(
    params?: { readonly workspaceId?: WorkspaceId },
    options?: HerdrRequestOptions,
  ): Promise<readonly Tab[]>;
  /** Wire: tab.get */
  get(id: TabId, options?: HerdrRequestOptions): Promise<Tab>;
  /** Wire: tab.focus */
  focus(id: TabId, options?: HerdrRequestOptions): Promise<Tab>;
  /** Wire: tab.rename */
  rename(id: TabId, label: string, options?: HerdrRequestOptions): Promise<Tab>;
  /** Wire: tab.move */
  move(
    id: TabId,
    params: { readonly insertIndex: number },
    options?: HerdrRequestOptions,
  ): Promise<readonly Tab[]>;
  /** Wire: tab.close */
  close(id: TabId, options?: HerdrRequestOptions): Promise<void>;
}

export interface TabCreateParams {
  readonly workspaceId?: WorkspaceId;
  readonly cwd?: AbsolutePath;
  readonly focus?: boolean;
  readonly label?: string;
  readonly env?: Environment;
}

export interface TabCreateResult {
  readonly tab: Tab;
  readonly rootPane: Pane;
}

export type PaneDirection = "left" | "right" | "up" | "down";
export type SplitDirection = "right" | "down";
export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";
export type ReadFormat = "text" | "ansi";
export type PaneZoomMode = "toggle" | "on" | "off";

export interface PaneNamespace {
  readonly graphics: PaneGraphicsNamespace;

  /** Wire: pane.split */
  split(
    targetPaneId: PaneId | undefined,
    params: PaneSplitParams,
    options?: HerdrRequestOptions,
  ): Promise<Pane>;
  /** Wire: pane.swap */
  swap(params: PaneSwapParams, options?: HerdrRequestOptions): Promise<PaneSwapResult>;
  /** Wire: pane.move */
  move(
    paneId: PaneId,
    params: PaneMoveParams,
    options?: HerdrRequestOptions,
  ): Promise<PaneMoveResult>;
  /** Wire: pane.zoom */
  zoom(
    paneId?: PaneId,
    params?: { readonly mode?: PaneZoomMode },
    options?: HerdrRequestOptions,
  ): Promise<PaneZoomResult>;
  /** Wire: pane.layout */
  layout(paneId?: PaneId, options?: HerdrRequestOptions): Promise<PaneLayoutSnapshot>;
  /** Wire: pane.process_info */
  processInfo(paneId?: PaneId, options?: HerdrRequestOptions): Promise<PaneProcessInfo>;
  /** Wire: pane.neighbor */
  neighbor(
    paneId: PaneId | undefined,
    direction: PaneDirection,
    options?: HerdrRequestOptions,
  ): Promise<PaneNeighborResult>;
  /** Wire: pane.edges */
  edges(paneId?: PaneId, options?: HerdrRequestOptions): Promise<PaneEdgesResult>;
  /** Wire: pane.focus_direction */
  focusDirection(
    direction: PaneDirection,
    params?: { readonly paneId?: PaneId },
    options?: HerdrRequestOptions,
  ): Promise<PaneFocusDirectionResult>;
  /** Wire: pane.resize */
  resize(
    direction: PaneDirection,
    params?: { readonly paneId?: PaneId; readonly amount?: number },
    options?: HerdrRequestOptions,
  ): Promise<PaneResizeResult>;
  /** Wire: pane.list */
  list(
    params?: { readonly workspaceId?: WorkspaceId },
    options?: HerdrRequestOptions,
  ): Promise<readonly Pane[]>;
  /** Wire: pane.current */
  current(
    params?: { readonly callerPaneId?: PaneId },
    options?: HerdrRequestOptions,
  ): Promise<Pane>;
  /** Wire: pane.get */
  get(id: PaneId, options?: HerdrRequestOptions): Promise<Pane>;
  /** Wire: pane.focus */
  focus(id: PaneId, options?: HerdrRequestOptions): Promise<Pane>;
  /** Wire: pane.rename */
  rename(id: PaneId, label: string | null, options?: HerdrRequestOptions): Promise<Pane>;
  /** Wire: pane.send_text */
  sendText(id: PaneId, text: string, options?: HerdrRequestOptions): Promise<void>;
  /** Wire: pane.send_keys */
  sendKeys(id: PaneId, keys: readonly string[], options?: HerdrRequestOptions): Promise<void>;
  /** Wire: pane.send_input */
  sendInput(id: PaneId, input: PaneInput, options?: HerdrRequestOptions): Promise<void>;
  /** Wire: pane.read */
  read(id: PaneId, params: PaneReadParams, options?: HerdrRequestOptions): Promise<PaneReadResult>;
  /** Wire: pane.wait_for_output */
  waitForOutput(
    id: PaneId,
    params: PaneWaitForOutputParams,
    options?: HerdrRequestOptions,
  ): Promise<PaneOutputMatchResult>;
  /** Wire: pane.report_agent */
  reportAgent(id: PaneId, params: PaneAgentReport, options?: HerdrRequestOptions): Promise<void>;
  /** Wire: pane.report_agent_session */
  reportAgentSession(
    id: PaneId,
    params: PaneAgentSessionReport,
    options?: HerdrRequestOptions,
  ): Promise<void>;
  /** Wire: pane.report_metadata */
  reportMetadata(
    id: PaneId,
    params: PaneMetadataReport,
    options?: HerdrRequestOptions,
  ): Promise<void>;
  /** Wire: pane.clear_agent_authority */
  clearAgentAuthority(
    id: PaneId,
    params?: { readonly source?: string; readonly sequence?: number },
    options?: HerdrRequestOptions,
  ): Promise<void>;
  /** Wire: pane.release_agent */
  releaseAgent(
    id: PaneId,
    params: { readonly source: string; readonly agent: string; readonly sequence?: number },
    options?: HerdrRequestOptions,
  ): Promise<void>;
  /** Wire: pane.close */
  close(id: PaneId, options?: HerdrRequestOptions): Promise<void>;
}

export interface PaneSplitParams {
  readonly workspaceId?: WorkspaceId;
  readonly direction: SplitDirection;
  readonly ratio?: number;
  readonly cwd?: AbsolutePath;
  readonly focus?: boolean;
  readonly env?: Environment;
}

export type PaneSwapParams =
  | {
      readonly paneId?: PaneId;
      readonly direction: PaneDirection;
      readonly sourcePaneId?: never;
      readonly targetPaneId?: never;
    }
  | {
      readonly sourcePaneId: PaneId;
      readonly targetPaneId: PaneId;
      readonly paneId?: never;
      readonly direction?: never;
    };

export type PaneMoveDestination =
  | {
      readonly type: "tab";
      readonly tabId: TabId;
      readonly targetPaneId?: PaneId;
      readonly split: SplitDirection;
      readonly ratio?: number;
    }
  | {
      readonly type: "new_tab";
      readonly workspaceId?: WorkspaceId;
      readonly label?: string;
    }
  | {
      readonly type: "new_workspace";
      readonly label?: string;
      readonly tabLabel?: string;
    };

export interface PaneMoveParams {
  readonly destination: PaneMoveDestination;
  readonly focus?: boolean;
}

export type PaneInput =
  | { readonly text: string; readonly keys?: readonly string[] }
  | { readonly text?: string; readonly keys: readonly [string, ...string[]] };

export interface PaneReadParams {
  readonly source: ReadSource;
  readonly lines?: number;
  readonly format?: ReadFormat;
  readonly stripAnsi?: boolean;
}

export interface PaneReadResult {
  readonly paneId: PaneId;
  readonly workspaceId: WorkspaceId;
  readonly tabId: TabId;
  readonly source: ReadSource;
  readonly format: ReadFormat;
  readonly text: string;
  readonly revision: Revision;
  readonly truncated: boolean;
}

export type OutputMatch =
  | { readonly type: "substring"; readonly value: string }
  | { readonly type: "regex"; readonly value: string };

export interface PaneWaitForOutputParams {
  readonly source: ReadSource;
  readonly lines?: number;
  readonly match: OutputMatch;
  readonly timeoutMs?: Milliseconds;
  readonly stripAnsi?: boolean;
}

export interface PaneOutputMatchResult {
  readonly paneId: PaneId;
  readonly revision: Revision;
  readonly matchedLine?: string;
  readonly read: PaneReadResult;
}

export type AgentSessionReportReference =
  | { readonly sessionId: string; readonly sessionPath?: never }
  | { readonly sessionPath: AbsolutePath; readonly sessionId?: never }
  | { readonly sessionId?: never; readonly sessionPath?: never };

export type PaneAgentReport = AgentSessionReportReference & {
  readonly source: string;
  readonly agent: string;
  readonly state: ReportedAgentState;
  readonly message?: string;
  readonly sequence?: number;
};

export type PaneAgentSessionReport = AgentSessionReportReference & {
  readonly source: string;
  readonly agent: string;
  readonly sequence?: number;
  readonly sessionStartSource?: string;
};

export interface PaneMetadataReport {
  readonly source: string;
  readonly agent?: string;
  readonly appliesToSource?: string;
  readonly title?: string;
  readonly displayAgent?: string;
  readonly stateLabels?: Readonly<Partial<Record<AgentStatus, string>>>;
  readonly tokens?: MetadataTokenPatch;
  readonly clearTitle?: boolean;
  readonly clearDisplayAgent?: boolean;
  readonly clearStateLabels?: boolean;
  readonly sequence?: number;
  /** Must be between 1 and 86,400,000 milliseconds. */
  readonly ttlMs?: Milliseconds;
}

export interface PaneSwapResult {
  readonly changed: boolean;
  readonly reason?: "no_neighbor" | "same_pane" | "not_found" | "cross_tab";
  readonly sourcePaneId: PaneId;
  readonly targetPaneId?: PaneId;
  readonly focusedPaneId: PaneId;
  readonly layout: PaneLayoutSnapshot;
}

export interface PaneMoveResult {
  readonly changed: boolean;
  readonly reason?: "same_tab" | "zoomed_tab";
  readonly previousPaneId: PaneId;
  readonly previousWorkspaceId: WorkspaceId;
  readonly previousTabId: TabId;
  readonly pane: Pane;
  readonly sourceLayout?: PaneLayoutSnapshot;
  readonly targetLayout: PaneLayoutSnapshot;
  readonly createdWorkspace?: Workspace;
  readonly createdTab?: Tab;
  readonly closedWorkspaceId?: WorkspaceId;
  readonly closedTabId?: TabId;
  readonly focusedPaneId: PaneId;
}

export interface PaneZoomResult {
  readonly changed: boolean;
  readonly zoomChanged: boolean;
  readonly focusChanged: boolean;
  readonly reason?: "single_pane" | "already_zoomed" | "already_unzoomed";
  readonly paneId: PaneId;
  readonly focusedPaneId: PaneId;
  readonly zoomed: boolean;
  readonly layout: PaneLayoutSnapshot;
}

export interface PaneLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaneLayoutSnapshot {
  readonly workspaceId: WorkspaceId;
  readonly tabId: TabId;
  readonly zoomed: boolean;
  readonly area: PaneLayoutRect;
  readonly focusedPaneId: PaneId;
  readonly panes: readonly {
    readonly paneId: PaneId;
    readonly focused: boolean;
    readonly rect: PaneLayoutRect;
  }[];
  readonly splits: readonly {
    readonly id: string;
    readonly direction: SplitDirection;
    readonly ratio: number;
    readonly rect: PaneLayoutRect;
  }[];
}

export interface PaneProcessInfo {
  readonly paneId: PaneId;
  readonly shellPid?: number;
  readonly foregroundProcessGroupId?: number;
  readonly tty?: string;
  readonly foregroundProcesses: readonly PaneProcess[];
}

export interface PaneProcess {
  readonly pid: number;
  readonly name: string;
  readonly argv0?: string;
  readonly argv?: readonly string[];
  readonly cmdline?: string;
  readonly cwd?: AbsolutePath;
}

export interface PaneNeighborResult {
  readonly paneId: PaneId;
  readonly direction: PaneDirection;
  readonly neighborPaneId?: PaneId;
  readonly layout: PaneLayoutSnapshot;
}

export interface PaneEdgesResult {
  readonly paneId: PaneId;
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly layout: PaneLayoutSnapshot;
}

export interface PaneFocusDirectionResult {
  readonly changed: boolean;
  readonly reason?: "no_neighbor";
  readonly sourcePaneId: PaneId;
  readonly focusedPaneId?: PaneId;
  readonly layout: PaneLayoutSnapshot;
}

export interface PaneResizeResult {
  readonly changed: boolean;
  readonly reason?: "unchanged";
  readonly paneId: PaneId;
  readonly focusedPaneId: PaneId;
  readonly layout: PaneLayoutSnapshot;
}

export interface LayoutNamespace {
  /** Wire: layout.export */
  export(target?: LayoutTarget, options?: HerdrRequestOptions): Promise<LayoutDescription>;
  /** Wire: layout.apply */
  apply(params: LayoutApplyParams, options?: HerdrRequestOptions): Promise<LayoutDescription>;
  /** Wire: layout.set_split_ratio */
  setSplitRatio(
    target: LayoutTarget | undefined,
    params: { readonly path: readonly boolean[]; readonly ratio: number },
    options?: HerdrRequestOptions,
  ): Promise<LayoutDescription>;
}

export type LayoutTarget =
  | { readonly tabId: TabId; readonly paneId?: never }
  | { readonly paneId: PaneId; readonly tabId?: never };

export type LayoutNode = LayoutPaneNode | LayoutSplitNode;

export interface LayoutPaneNode {
  readonly type: "pane";
  readonly paneId?: PaneId;
  readonly label?: string;
  readonly cwd?: AbsolutePath;
  readonly command?: readonly string[];
  readonly env?: Environment;
}

export interface LayoutSplitNode {
  readonly type: "split";
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly first: LayoutNode;
  readonly second: LayoutNode;
}

export interface LayoutApplyParams {
  readonly workspaceId?: WorkspaceId;
  readonly replaceTabId?: TabId;
  readonly tabLabel?: string;
  readonly focus?: boolean;
  readonly root: LayoutNode;
}

export interface LayoutDescription {
  readonly workspaceId: WorkspaceId;
  readonly tabId: TabId;
  readonly zoomed: boolean;
  readonly focusedPaneId: PaneId;
  readonly root: LayoutNode;
}

export type PaneGraphicsFormat = "png" | "rgb" | "rgba";

export interface PaneGraphicsNamespace {
  /** Wire: pane.graphics.info */
  info(id: PaneId, options?: HerdrRequestOptions): Promise<PaneGraphicsInfo>;
  /** Wire: pane.graphics.set */
  set(id: PaneId, frame: PaneGraphicsFrame, options?: HerdrRequestOptions): Promise<void>;
  /** Wire: pane.graphics.clear */
  clear(id: PaneId, options?: HerdrRequestOptions): Promise<void>;
  /** Wire: pane.graphics.stream */
  openStream(id: PaneId, options?: HerdrRequestOptions): Promise<PaneGraphicsStream>;
}

export interface PaneGraphicsInfo {
  readonly cellWidthPx: number;
  readonly cellHeightPx: number;
}

export interface PaneGraphicsPlacement {
  readonly viewportCol?: number;
  readonly viewportRow?: number;
  readonly gridCols?: number;
  readonly gridRows?: number;
}

export interface PaneGraphicsFrame {
  readonly format: PaneGraphicsFormat;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly data: Uint8Array;
  readonly placement?: PaneGraphicsPlacement;
}

export interface PaneGraphicsStream {
  readonly paneId: PaneId;
  readonly closed: boolean;
  write(frame: PaneGraphicsFrame, options?: HerdrRequestOptions): Promise<void>;
  close(): Promise<void>;
}

export type AgentTarget =
  | { readonly paneId: PaneId; readonly name?: never }
  | { readonly name: AgentName; readonly paneId?: never };

export interface AgentNamespace {
  readonly view: AgentViewNamespace;

  /** Wire: agent.list */
  list(options?: HerdrRequestOptions): Promise<readonly Agent[]>;
  /** Wire: agent.get */
  get(target: AgentTarget, options?: HerdrRequestOptions): Promise<Agent>;
  /** Wire: agent.read */
  read(
    target: AgentTarget,
    params: PaneReadParams,
    options?: HerdrRequestOptions,
  ): Promise<PaneReadResult>;
  /** Wire: agent.explain */
  explain(target: AgentTarget, options?: HerdrRequestOptions): Promise<AgentDetectionExplain>;
  /** Wire: agent.send_keys */
  sendKeys(
    target: AgentTarget,
    keys: readonly string[],
    options?: HerdrRequestOptions,
  ): Promise<void>;
  /** Wire: agent.rename */
  rename(
    target: AgentTarget,
    name: AgentName | null,
    options?: HerdrRequestOptions,
  ): Promise<Agent>;
  /** Wire: agent.focus */
  focus(target: AgentTarget, options?: HerdrRequestOptions): Promise<Agent>;
  /** Wire: agent.start */
  start(params: AgentStartParams, options?: HerdrRequestOptions): Promise<AgentStartResult>;
  /** Wire: agent.prompt */
  prompt(
    target: AgentTarget,
    params: AgentPromptParams,
    options?: HerdrRequestOptions,
  ): Promise<Agent>;
  /** Wire: agent.wait */
  wait(
    target: AgentTarget,
    params?: AgentWaitParams,
    options?: HerdrRequestOptions,
  ): Promise<Agent>;
}

export interface AgentStartParams {
  readonly name: AgentName;
  /** Kept open because supported agent kinds can expand independently of the SDK. */
  readonly kind: string;
  readonly paneId: PaneId;
  readonly args?: readonly string[];
  /** Must be greater than 3,000 and at most 300,000 milliseconds. */
  readonly timeoutMs?: Milliseconds;
}

export interface AgentStartResult {
  readonly agent: Agent;
  readonly argv: readonly string[];
}

export interface AgentWaitParams {
  readonly until?: readonly AgentStatus[];
  readonly timeoutMs?: Milliseconds;
}

export interface AgentPromptParams {
  readonly text: string;
  readonly wait?: AgentWaitParams;
}

/** Currently schema-less JSON returned by agent.explain. */
export type AgentDetectionExplain = JsonValue;

export interface AgentViewNamespace {
  /** Wire: agent.view.set */
  set(params: AgentViewSetParams, options?: HerdrRequestOptions): Promise<AgentViewState>;
  /** Wire: agent.view.clear */
  clear(
    params?: { readonly source?: string },
    options?: HerdrRequestOptions,
  ): Promise<AgentViewState>;
}

export type AgentViewField =
  | "status"
  | "workspace_id"
  | "tab_id"
  | "pane_id"
  | "agent"
  | "seen"
  | "state_change_seq"
  | { readonly token: string };

export type AgentViewValue =
  | string
  | boolean
  | number
  | { readonly context: "current_workspace_id" | "current_tab_id" };

export type AgentViewFilter =
  | { readonly op: "all" | "any"; readonly filters: readonly AgentViewFilter[] }
  | { readonly op: "not"; readonly filter: AgentViewFilter }
  | { readonly op: "eq"; readonly field: AgentViewField; readonly value: AgentViewValue }
  | {
      readonly op: "in";
      readonly field: AgentViewField;
      readonly values: readonly AgentViewValue[];
    }
  | { readonly op: "exists"; readonly field: AgentViewField };

export type AgentViewSortField =
  | "workspace_order"
  | "tab_order"
  | "pane_order"
  | "attention"
  | "status"
  | "agent"
  | "seen"
  | "state_change_seq"
  | { readonly token: string };

export interface AgentViewSort {
  readonly field: AgentViewSortField;
  readonly order?: "asc" | "desc";
}

export interface AgentViewSetParams {
  readonly source: string;
  readonly label?: string;
  readonly filter?: AgentViewFilter;
  readonly sort?: readonly AgentViewSort[];
}

export interface AgentViewState {
  readonly active: boolean;
  readonly source?: string;
  readonly label?: string;
}

export interface EventNamespace {
  /** Wire: events.subscribe */
  subscribe<const Subscriptions extends readonly EventSubscriptionSpec[]>(
    subscriptions: Subscriptions,
    options?: HerdrRequestOptions,
  ): Promise<HerdrEventStream<EventForSubscription<Subscriptions[number]>>>;

  /** Wire: events.wait */
  wait<const Match extends EventMatch>(
    match: Match,
    params?: { readonly timeoutMs?: Milliseconds },
    options?: HerdrRequestOptions,
  ): Promise<EventForMatch<Match>>;
}

export interface HerdrEventStream<Event extends HerdrEvent> extends AsyncIterable<Event> {
  readonly closed: boolean;
  close(): Promise<void>;
}

export type LifecycleSubscriptionType =
  | "workspace.created"
  | "workspace.updated"
  | "workspace.metadata_updated"
  | "workspace.renamed"
  | "workspace.moved"
  | "workspace.reordered"
  | "workspace.closed"
  | "workspace.focused"
  | "worktree.created"
  | "worktree.opened"
  | "worktree.removed"
  | "tab.created"
  | "tab.closed"
  | "tab.focused"
  | "tab.renamed"
  | "tab.moved"
  | "pane.created"
  | "pane.closed"
  | "pane.updated"
  | "pane.focused"
  | "pane.moved"
  | "pane.exited"
  | "pane.agent_detected"
  | "layout.updated";

export type EventSubscriptionSpec =
  | { readonly type: LifecycleSubscriptionType }
  | {
      readonly type: "pane.output_matched";
      readonly paneId: PaneId;
      readonly source: ReadSource;
      readonly lines?: number;
      readonly match: OutputMatch;
      readonly stripAnsi?: boolean;
    }
  | {
      readonly type: "pane.agent_status_changed";
      readonly paneId: PaneId;
      readonly agentStatus?: AgentStatus;
    }
  | {
      readonly type: "pane.scroll_changed";
      readonly paneId: PaneId;
    };

export type HerdrEvent =
  | { readonly type: "workspace.created"; readonly workspace: Workspace }
  | { readonly type: "workspace.updated"; readonly workspace: Workspace }
  | { readonly type: "workspace.metadata_updated"; readonly workspace: Workspace }
  | {
      readonly type: "workspace.closed";
      readonly workspaceId: WorkspaceId;
      readonly workspace?: Workspace;
    }
  | {
      readonly type: "workspace.renamed";
      readonly workspaceId: WorkspaceId;
      readonly label: string;
    }
  | {
      readonly type: "workspace.moved";
      readonly workspaceId: WorkspaceId;
      readonly insertIndex: number;
      readonly workspaces: readonly Workspace[];
    }
  | {
      readonly type: "workspace.reordered";
      readonly workspaceIds: readonly WorkspaceId[];
      readonly beforeWorkspaceId?: WorkspaceId;
      readonly workspaces: readonly Workspace[];
    }
  | { readonly type: "workspace.focused"; readonly workspaceId: WorkspaceId }
  | {
      readonly type: "worktree.created";
      readonly workspace: Workspace;
      readonly worktree: Worktree;
    }
  | {
      readonly type: "worktree.opened";
      readonly workspace: Workspace;
      readonly worktree: Worktree;
      readonly alreadyOpen: boolean;
    }
  | {
      readonly type: "worktree.removed";
      readonly workspaceId: WorkspaceId;
      readonly workspace?: Workspace;
      readonly worktree: Worktree;
      readonly forced: boolean;
    }
  | { readonly type: "tab.created"; readonly tab: Tab }
  | { readonly type: "tab.closed"; readonly tabId: TabId; readonly workspaceId: WorkspaceId }
  | {
      readonly type: "tab.renamed";
      readonly tabId: TabId;
      readonly workspaceId: WorkspaceId;
      readonly label: string;
    }
  | {
      readonly type: "tab.moved";
      readonly tabId: TabId;
      readonly workspaceId: WorkspaceId;
      readonly insertIndex: number;
      readonly tabs: readonly Tab[];
    }
  | { readonly type: "tab.focused"; readonly tabId: TabId; readonly workspaceId: WorkspaceId }
  | { readonly type: "pane.created"; readonly pane: Pane }
  | { readonly type: "pane.closed"; readonly paneId: PaneId; readonly workspaceId: WorkspaceId }
  | { readonly type: "pane.updated"; readonly pane: Pane }
  | { readonly type: "pane.focused"; readonly paneId: PaneId; readonly workspaceId: WorkspaceId }
  | ({ readonly type: "pane.moved" } & PaneMovedEvent)
  | {
      readonly type: "pane.output_changed";
      readonly paneId: PaneId;
      readonly workspaceId: WorkspaceId;
      readonly revision: Revision;
    }
  | { readonly type: "pane.exited"; readonly paneId: PaneId; readonly workspaceId: WorkspaceId }
  | {
      readonly type: "pane.agent_detected";
      readonly paneId: PaneId;
      readonly workspaceId: WorkspaceId;
      readonly agent?: string;
      readonly released: boolean;
      readonly finalStatus?: AgentStatus;
    }
  | ({ readonly type: "pane.agent_status_changed" } & PaneAgentStatusChangedEvent)
  | {
      readonly type: "pane.scroll_changed";
      readonly paneId: PaneId;
      readonly workspaceId: WorkspaceId;
      readonly scroll: PaneScroll;
    }
  | {
      readonly type: "pane.output_matched";
      readonly paneId: PaneId;
      readonly matchedLine: string;
      readonly read: PaneReadResult;
    }
  | { readonly type: "layout.updated"; readonly layout: PaneLayoutSnapshot };

export interface PaneMovedEvent {
  readonly previousPaneId: PaneId;
  readonly previousWorkspaceId: WorkspaceId;
  readonly previousTabId: TabId;
  readonly pane: Pane;
  readonly createdWorkspace?: Workspace;
  readonly createdTab?: Tab;
  readonly closedWorkspaceId?: WorkspaceId;
  readonly closedTabId?: TabId;
}

export interface PaneAgentStatusChangedEvent {
  readonly paneId: PaneId;
  readonly workspaceId: WorkspaceId;
  readonly agentStatus: AgentStatus;
  readonly agent?: string;
  readonly title?: string;
  readonly displayAgent?: string;
  readonly stateLabels: Readonly<Record<string, string>>;
}

export type EventForSubscription<Spec extends EventSubscriptionSpec> = Extract<
  HerdrEvent,
  { readonly type: Spec["type"] }
>;

export type EventMatch =
  | { readonly type: "workspace.created"; readonly workspaceId?: WorkspaceId }
  | { readonly type: "workspace.updated"; readonly workspaceId: WorkspaceId }
  | { readonly type: "workspace.closed"; readonly workspaceId: WorkspaceId }
  | {
      readonly type: "workspace.renamed";
      readonly workspaceId: WorkspaceId;
      readonly label?: string;
    }
  | { readonly type: "workspace.moved"; readonly workspaceId: WorkspaceId }
  | { readonly type: "workspace.focused"; readonly workspaceId: WorkspaceId }
  | { readonly type: "tab.created"; readonly tabId?: TabId; readonly workspaceId?: WorkspaceId }
  | { readonly type: "tab.closed"; readonly tabId: TabId }
  | { readonly type: "tab.renamed"; readonly tabId: TabId; readonly label?: string }
  | { readonly type: "tab.moved"; readonly tabId: TabId }
  | { readonly type: "tab.focused"; readonly tabId: TabId }
  | { readonly type: "pane.created"; readonly paneId?: PaneId; readonly workspaceId?: WorkspaceId }
  | { readonly type: "pane.closed"; readonly paneId: PaneId }
  | { readonly type: "pane.focused"; readonly paneId: PaneId }
  | { readonly type: "pane.moved"; readonly paneId: PaneId }
  | {
      readonly type: "pane.output_changed";
      readonly paneId: PaneId;
      readonly minRevision?: Revision;
    }
  | { readonly type: "pane.exited"; readonly paneId: PaneId }
  | { readonly type: "pane.agent_detected"; readonly paneId: PaneId; readonly agent?: string }
  | {
      readonly type: "pane.agent_status_changed";
      readonly paneId: PaneId;
      readonly agentStatus: AgentStatus;
    };

export type EventForMatch<Match extends EventMatch> = Extract<
  HerdrEvent,
  { readonly type: Match["type"] }
>;

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

export interface IntegrationNamespace {
  /** Wire: integration.install */
  install(
    target: IntegrationTarget,
    options?: HerdrRequestOptions,
  ): Promise<IntegrationChangeResult>;
  /** Wire: integration.uninstall */
  uninstall(
    target: IntegrationTarget,
    options?: HerdrRequestOptions,
  ): Promise<IntegrationChangeResult>;
}

export interface IntegrationChangeResult {
  readonly target: IntegrationTarget;
  readonly messages: readonly string[];
}

export interface PluginNamespace {
  readonly actions: PluginActionNamespace;
  readonly logs: PluginLogNamespace;
  readonly panes: PluginPaneNamespace;

  /** Wire: plugin.link */
  link(params: PluginLinkParams, options?: HerdrRequestOptions): Promise<InstalledPlugin>;
  /** Wire: plugin.list */
  list(
    params?: { readonly pluginId?: PluginId },
    options?: HerdrRequestOptions,
  ): Promise<readonly InstalledPlugin[]>;
  /** Wire: plugin.unlink */
  unlink(
    id: PluginId,
    options?: HerdrRequestOptions,
  ): Promise<{ readonly pluginId: PluginId; readonly removed: boolean }>;
  /** Wire: plugin.enable */
  enable(id: PluginId, options?: HerdrRequestOptions): Promise<InstalledPlugin>;
  /** Wire: plugin.disable */
  disable(id: PluginId, options?: HerdrRequestOptions): Promise<InstalledPlugin>;
}

export interface PluginActionNamespace {
  /** Wire: plugin.action.list */
  list(
    params?: { readonly pluginId?: PluginId },
    options?: HerdrRequestOptions,
  ): Promise<readonly PluginAction[]>;
  /** Wire: plugin.action.invoke */
  invoke(
    id: PluginActionId,
    params?: PluginActionInvokeParams,
    options?: HerdrRequestOptions,
  ): Promise<PluginActionInvocation>;
}

export interface PluginLogNamespace {
  /** Wire: plugin.log.list */
  list(
    params?: { readonly pluginId?: PluginId; readonly limit?: number },
    options?: HerdrRequestOptions,
  ): Promise<readonly PluginCommandLog[]>;
}

export interface PluginPaneNamespace {
  /** Wire: plugin.pane.open; popup panes have no pane ID. */
  open(
    pluginId: PluginId,
    params: PluginPaneOpenParams & { readonly placement: "popup" },
    options?: HerdrRequestOptions,
  ): Promise<void>;
  open(
    pluginId: PluginId,
    params: PluginPaneOpenParams & {
      readonly placement: Exclude<PluginPanePlacement, "popup">;
    },
    options?: HerdrRequestOptions,
  ): Promise<PluginPane>;
  open(
    pluginId: PluginId,
    params: PluginPaneOpenParams & { readonly placement?: undefined },
    options?: HerdrRequestOptions,
  ): Promise<PluginPane | void>;
  /** Wire: plugin.pane.focus */
  focus(paneId: PaneId, options?: HerdrRequestOptions): Promise<PluginPane>;
  /** Wire: plugin.pane.close */
  close(paneId: PaneId, options?: HerdrRequestOptions): Promise<{ readonly paneId: PaneId }>;
}

export interface PopupNamespace {
  /** Wire: popup.close */
  close(options?: HerdrRequestOptions): Promise<void>;
}

export type PluginPlatform = "linux" | "macos" | "windows";
export type PluginActionContext = "global" | "workspace" | "tab" | "pane" | "selection";
export type PluginPanePlacement = "overlay" | "popup" | "split" | "tab" | "zoomed";
/** Number of cells or a percentage string such as "80%". */
export type PopupSize = number | `${number}%`;

export interface PluginLinkParams {
  readonly path: AbsolutePath;
  readonly enabled?: boolean;
  readonly source?: PluginSourceInput;
}

export interface PluginSourceInput {
  readonly kind?: "local" | "github";
  readonly owner?: string;
  readonly repo?: string;
  readonly subdir?: string;
  readonly requestedRef?: string;
  readonly resolvedCommit?: string;
  readonly managedPath?: AbsolutePath;
  readonly installedUnixMs?: UnixMilliseconds;
}

export interface PluginSource extends Omit<PluginSourceInput, "kind"> {
  readonly kind: "local" | "github";
}

export interface PluginManifestCommand {
  readonly platforms?: readonly PluginPlatform[];
  readonly command: readonly string[];
}

export interface PluginManifestAction {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly contexts: readonly PluginActionContext[];
  readonly platforms?: readonly PluginPlatform[];
  readonly command: readonly string[];
}

export interface PluginManifestEventHook {
  readonly on: string;
  readonly platforms?: readonly PluginPlatform[];
  readonly command: readonly string[];
}

export interface PluginManifestPane {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly platforms?: readonly PluginPlatform[];
  readonly placement: PluginPanePlacement;
  readonly width?: PopupSize;
  readonly height?: PopupSize;
  readonly command: readonly string[];
}

export interface PluginManifestLinkHandler {
  readonly id: string;
  readonly title: string;
  readonly pattern: string;
  readonly action: string;
  readonly platforms?: readonly PluginPlatform[];
}

export interface InstalledPlugin {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly minHerdrVersion: string;
  readonly description?: string;
  readonly manifestPath: AbsolutePath;
  readonly root: AbsolutePath;
  readonly enabled: boolean;
  readonly platforms?: readonly PluginPlatform[];
  readonly build: readonly PluginManifestCommand[];
  readonly startup: readonly PluginManifestCommand[];
  readonly actions: readonly PluginManifestAction[];
  readonly events: readonly PluginManifestEventHook[];
  readonly panes: readonly PluginManifestPane[];
  readonly linkHandlers: readonly PluginManifestLinkHandler[];
  readonly source: PluginSource;
  readonly warnings: readonly string[];
}

export interface PluginAction {
  readonly pluginId: PluginId;
  readonly id: PluginActionId;
  readonly title: string;
  readonly description?: string;
  readonly contexts: readonly PluginActionContext[];
  readonly command: readonly string[];
  readonly platforms?: readonly PluginPlatform[];
}

export interface PluginInvocationContext {
  readonly workspaceId?: WorkspaceId;
  readonly workspaceLabel?: string;
  readonly workspaceCwd?: AbsolutePath;
  readonly worktree?: WorkspaceWorktree;
  readonly tabId?: TabId;
  readonly tabLabel?: string;
  readonly focusedPaneId?: PaneId;
  readonly focusedPaneCwd?: AbsolutePath;
  readonly focusedPaneAgent?: string;
  readonly focusedPaneStatus?: AgentStatus;
  readonly selectedText?: string;
  readonly invocationSource?: string;
  readonly correlationId?: string;
  readonly clickedUrl?: string;
  readonly linkHandlerId?: string;
}

export interface PluginActionInvokeParams {
  /** Needed only when `id` is an unqualified action ID. */
  readonly pluginId?: PluginId;
  readonly context?: PluginInvocationContext;
}

export interface PluginActionInvocation {
  readonly action: PluginAction;
  readonly context: PluginInvocationContext;
  readonly log: PluginCommandLog;
}

export interface PluginCommandLog {
  readonly id: PluginLogId;
  readonly pluginId: PluginId;
  readonly actionId?: PluginActionId;
  readonly event?: string;
  readonly command: readonly string[];
  readonly status: "running" | "succeeded" | "failed";
  readonly startedUnixMs: UnixMilliseconds;
  readonly finishedUnixMs?: UnixMilliseconds;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: string;
}

export interface PluginPaneOpenParams {
  readonly entrypoint: string;
  readonly placement?: PluginPanePlacement;
  readonly width?: PopupSize;
  readonly height?: PopupSize;
  readonly workspaceId?: WorkspaceId;
  readonly targetPaneId?: PaneId;
  readonly direction?: SplitDirection;
  readonly cwd?: AbsolutePath;
  readonly focus?: boolean;
  readonly env?: Environment;
}

export interface PluginPane {
  readonly pluginId: PluginId;
  readonly entrypoint: string;
  readonly pane: Pane;
}
