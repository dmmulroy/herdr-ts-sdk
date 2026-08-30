/**
 * Defines public Herdr resource, input, result, event, and graphics schemas.
 *
 * Each schema owns runtime decoding and its corresponding TypeScript model so protocol data becomes normalized domain values at SDK boundaries.
 *
 * @since 0.8.2
 */
import { Effect, Option, Schema, SchemaGetter } from "effect";
import {
  AgentName,
  HerdrAbsolutePath,
  HerdrEnvironment,
  HerdrImageDimension,
  HerdrInsertIndex,
  HerdrMetadataTokenPatch,
  HerdrMetadataTokens,
  HerdrMetadataTtl,
  HerdrMilliseconds,
  HerdrPopupSize,
  HerdrRevision,
  HerdrSplitRatio,
  HerdrStateChangeSequence,
  HerdrUnixMilliseconds,
  HerdrUnixSeconds,
  PaneId,
  PluginActionId,
  PluginId,
  PluginLogId,
  TabId,
  TerminalId,
  WorkspaceId,
} from "./herdr-domain.ts";

const optionalString = Schema.OptionFromOptionalNullOr(Schema.String);
const optionalAbsolutePath = Schema.OptionFromOptionalNullOr(HerdrAbsolutePath);

/**
 * Agent lifecycle status reported by Herdr resources.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentStatus = Schema.Literals(["idle", "working", "blocked", "done", "unknown"]);

/**
 * Agent lifecycle status reported by Herdr resources.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentStatus = typeof AgentStatus.Type;

/**
 * Agent state accepted by pane reporting operations.
 *
 * @category schemas
 * @since 0.8.2
 */
export const ReportedAgentState = Schema.Literals(["idle", "working", "blocked", "unknown"]);

/**
 * Agent state accepted by pane reporting operations.
 *
 * @category models
 * @since 0.8.2
 */
export type ReportedAgentState = typeof ReportedAgentState.Type;

/**
 * How an agent session reference identifies the upstream session.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentSessionReferenceKind = Schema.Literals(["id", "path"]);

/**
 * How an agent session reference identifies the upstream session.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentSessionReferenceKind = typeof AgentSessionReferenceKind.Type;

/**
 * Stable reference to an upstream agent session.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentSessionReference = Schema.Struct({
  source: Schema.String,
  agent: Schema.String,
  kind: AgentSessionReferenceKind,
  value: Schema.String,
});

/**
 * Stable reference to an upstream agent session.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentSessionReference extends Schema.Schema.Type<typeof AgentSessionReference> {}

/**
 * Optional server capabilities reported by the compatibility handshake.
 *
 * @category schemas
 * @since 0.8.2
 */
export const ServerCapabilities = Schema.Struct({
  liveHandoff: Schema.Boolean,
  detachedServerDaemon: Schema.optionalKey(Schema.Boolean).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
}).pipe(
  Schema.encodeKeys({
    liveHandoff: "live_handoff",
    detachedServerDaemon: "detached_server_daemon",
  }),
);

/**
 * Optional server capabilities reported by the compatibility handshake.
 *
 * @category models
 * @since 0.8.2
 */
export interface ServerCapabilities extends Schema.Schema.Type<typeof ServerCapabilities> {}

/**
 * Successful Herdr compatibility handshake.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PingResult = Schema.Struct({
  version: Schema.String,
  protocol: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  capabilities: Schema.OptionFromOptionalNullOr(ServerCapabilities),
});

/**
 * Successful Herdr compatibility handshake.
 *
 * @category models
 * @since 0.8.2
 */
export interface PingResult extends Schema.Schema.Type<typeof PingResult> {}

/**
 * Server configuration reload status and diagnostics.
 *
 * @category schemas
 * @since 0.8.2
 */
export const ConfigReloadResult = Schema.Struct({
  status: Schema.Literals(["applied", "partial", "failed"]),
  diagnostics: Schema.Array(Schema.String),
});

/**
 * Server configuration reload status and diagnostics.
 *
 * @category models
 * @since 0.8.2
 */
export interface ConfigReloadResult extends Schema.Schema.Type<typeof ConfigReloadResult> {}

/**
 * One discovered agent manifest and its update state.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentManifest = Schema.Struct({
  agent: Schema.String,
  source: Schema.String,
  sourceKind: Schema.String,
  activeVersion: optionalString,
  cachedRemoteVersion: optionalString,
  localOverrideShadowingRemote: Schema.Boolean,
  remoteUpdateResult: optionalString,
  remoteUpdateError: optionalString,
  remoteLastCheckedUnix: Schema.OptionFromOptionalNullOr(HerdrUnixSeconds),
  warning: optionalString,
}).pipe(
  Schema.encodeKeys({
    sourceKind: "source_kind",
    activeVersion: "active_version",
    cachedRemoteVersion: "cached_remote_version",
    localOverrideShadowingRemote: "local_override_shadowing_remote",
    remoteUpdateResult: "remote_update_result",
    remoteUpdateError: "remote_update_error",
    remoteLastCheckedUnix: "remote_last_checked_unix",
  }),
);

/**
 * One discovered agent manifest and its update state.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentManifest extends Schema.Schema.Type<typeof AgentManifest> {}

/**
 * Current agent-manifest cache and refresh state.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentManifestStatus = Schema.Struct({
  lastCheckUnix: Schema.OptionFromOptionalNullOr(HerdrUnixSeconds),
  lastResult: optionalString,
  manifests: Schema.Array(AgentManifest),
}).pipe(
  Schema.encodeKeys({
    lastCheckUnix: "last_check_unix",
    lastResult: "last_result",
  }),
);

/**
 * Current agent-manifest cache and refresh state.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentManifestStatus extends Schema.Schema.Type<typeof AgentManifestStatus> {}

/**
 * Result of showing a foreground notification.
 *
 * @category schemas
 * @since 0.8.2
 */
export const NotificationShowResult = Schema.Struct({
  shown: Schema.Boolean,
  reason: Schema.Literals(["shown", "disabled", "rate_limited", "no_foreground_client", "busy"]),
});

/**
 * Result of showing a foreground notification.
 *
 * @category models
 * @since 0.8.2
 */
export interface NotificationShowResult extends Schema.Schema.Type<typeof NotificationShowResult> {}

/**
 * Result of changing the foreground client's window title.
 *
 * @category schemas
 * @since 0.8.2
 */
export const ClientWindowTitleResult = Schema.Struct({
  changed: Schema.Boolean,
  reason: Schema.Literals(["set", "cleared", "no_foreground_client"]),
});

/**
 * Result of changing the foreground client's window title.
 *
 * @category models
 * @since 0.8.2
 */
export interface ClientWindowTitleResult extends Schema.Schema.Type<
  typeof ClientWindowTitleResult
> {}

/**
 * Worktree information attached to an open workspace.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorkspaceWorktree = Schema.Struct({
  repoKey: Schema.String,
  repoName: Schema.String,
  repoRoot: HerdrAbsolutePath,
  checkoutPath: HerdrAbsolutePath,
  isLinkedWorktree: Schema.Boolean,
}).pipe(
  Schema.encodeKeys({
    repoKey: "repo_key",
    repoName: "repo_name",
    repoRoot: "repo_root",
    checkoutPath: "checkout_path",
    isLinkedWorktree: "is_linked_worktree",
  }),
);

/**
 * Worktree information attached to an open workspace.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceWorktree extends Schema.Schema.Type<typeof WorkspaceWorktree> {}

/**
 * Herdr workspace normalized from the private wire representation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const Workspace = Schema.Struct({
  id: WorkspaceId,
  number: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  label: Schema.String,
  focused: Schema.Boolean,
  paneCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  tabCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  activeTabId: TabId,
  agentStatus: AgentStatus,
  tokens: Schema.optionalKey(HerdrMetadataTokens).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({}), { encodingStrategy: "omit" }),
  ),
  worktree: Schema.OptionFromOptionalNullOr(WorkspaceWorktree),
}).pipe(
  Schema.encodeKeys({
    id: "workspace_id",
    paneCount: "pane_count",
    tabCount: "tab_count",
    activeTabId: "active_tab_id",
    agentStatus: "agent_status",
  }),
);

/**
 * Herdr workspace normalized from the private wire representation.
 *
 * @category models
 * @since 0.8.2
 */
export interface Workspace extends Schema.Schema.Type<typeof Workspace> {}

/**
 * Herdr tab normalized from the private wire representation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const Tab = Schema.Struct({
  id: TabId,
  workspaceId: WorkspaceId,
  number: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  label: Schema.String,
  focused: Schema.Boolean,
  paneCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  agentStatus: AgentStatus,
}).pipe(
  Schema.encodeKeys({
    id: "tab_id",
    workspaceId: "workspace_id",
    paneCount: "pane_count",
    agentStatus: "agent_status",
  }),
);

/**
 * Herdr tab normalized from the private wire representation.
 *
 * @category models
 * @since 0.8.2
 */
export interface Tab extends Schema.Schema.Type<typeof Tab> {}

/**
 * Scroll position attached to a pane snapshot.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneScroll = Schema.Struct({
  offsetFromBottom: Schema.Finite,
  maxOffsetFromBottom: Schema.Finite,
  viewportRows: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
}).pipe(
  Schema.encodeKeys({
    offsetFromBottom: "offset_from_bottom",
    maxOffsetFromBottom: "max_offset_from_bottom",
    viewportRows: "viewport_rows",
  }),
);

/**
 * Scroll position attached to a pane snapshot.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneScroll extends Schema.Schema.Type<typeof PaneScroll> {}

/**
 * Herdr pane normalized from the private wire representation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const Pane = Schema.Struct({
  id: PaneId,
  terminalId: TerminalId,
  workspaceId: WorkspaceId,
  tabId: TabId,
  focused: Schema.Boolean,
  cwd: optionalAbsolutePath,
  foregroundCwd: optionalAbsolutePath,
  label: optionalString,
  agent: optionalString,
  title: optionalString,
  terminalTitle: optionalString,
  terminalTitleStripped: optionalString,
  displayAgent: optionalString,
  agentStatus: AgentStatus,
  stateLabels: Schema.optionalKey(HerdrMetadataTokens).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({}), { encodingStrategy: "omit" }),
  ),
  tokens: Schema.optionalKey(HerdrMetadataTokens).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({}), { encodingStrategy: "omit" }),
  ),
  agentSession: Schema.OptionFromOptionalNullOr(AgentSessionReference),
  scroll: Schema.OptionFromOptionalNullOr(PaneScroll),
  revision: HerdrRevision,
}).pipe(
  Schema.encodeKeys({
    id: "pane_id",
    terminalId: "terminal_id",
    workspaceId: "workspace_id",
    tabId: "tab_id",
    foregroundCwd: "foreground_cwd",
    terminalTitle: "terminal_title",
    terminalTitleStripped: "terminal_title_stripped",
    displayAgent: "display_agent",
    agentStatus: "agent_status",
    stateLabels: "state_labels",
    agentSession: "agent_session",
  }),
);

/**
 * Herdr pane normalized from the private wire representation.
 *
 * @category models
 * @since 0.8.2
 */
export interface Pane extends Schema.Schema.Type<typeof Pane> {}

/**
 * Herdr agent normalized from the private wire representation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const Agent = Schema.Struct({
  terminalId: TerminalId,
  name: Schema.OptionFromOptionalNullOr(AgentName),
  agent: optionalString,
  title: optionalString,
  terminalTitle: optionalString,
  terminalTitleStripped: optionalString,
  displayAgent: optionalString,
  status: AgentStatus,
  screenDetectionSkipped: Schema.optionalKey(Schema.Boolean).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
  stateLabels: Schema.optionalKey(HerdrMetadataTokens).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({}), { encodingStrategy: "omit" }),
  ),
  tokens: Schema.optionalKey(HerdrMetadataTokens).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({}), { encodingStrategy: "omit" }),
  ),
  agentSession: Schema.OptionFromOptionalNullOr(AgentSessionReference),
  workspaceId: WorkspaceId,
  tabId: TabId,
  paneId: PaneId,
  focused: Schema.Boolean,
  launchPending: Schema.optionalKey(Schema.Boolean).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
  interactiveReady: Schema.optionalKey(Schema.Boolean).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
  stateChangeSequence: Schema.optionalKey(HerdrStateChangeSequence).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(HerdrStateChangeSequence.make(0)), {
      encodingStrategy: "omit",
    }),
  ),
  cwd: optionalAbsolutePath,
  foregroundCwd: optionalAbsolutePath,
  revision: HerdrRevision,
}).pipe(
  Schema.encodeKeys({
    terminalId: "terminal_id",
    terminalTitle: "terminal_title",
    terminalTitleStripped: "terminal_title_stripped",
    displayAgent: "display_agent",
    status: "agent_status",
    screenDetectionSkipped: "screen_detection_skipped",
    stateLabels: "state_labels",
    agentSession: "agent_session",
    workspaceId: "workspace_id",
    tabId: "tab_id",
    paneId: "pane_id",
    launchPending: "launch_pending",
    interactiveReady: "interactive_ready",
    stateChangeSequence: "state_change_seq",
    foregroundCwd: "foreground_cwd",
  }),
);

/**
 * Herdr agent normalized from the private wire representation.
 *
 * @category models
 * @since 0.8.2
 */
export interface Agent extends Schema.Schema.Type<typeof Agent> {}

/**
 * Input accepted when creating a workspace.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorkspaceCreateInput = Schema.Struct({
  cwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
  label: Schema.OptionFromOptionalKey(Schema.String),
  env: Schema.OptionFromOptionalKey(HerdrEnvironment),
});

/**
 * Normalized input accepted when creating a workspace.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceCreateInput extends Schema.Schema.Type<typeof WorkspaceCreateInput> {}

/**
 * Ergonomic external representation accepted by workspace creation.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceCreateInputEncoded extends Schema.Codec.Encoded<
  typeof WorkspaceCreateInput
> {}

/**
 * Workspace, initial tab, and root pane created atomically by Herdr.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorkspaceCreateResult = Schema.Struct({
  workspace: Workspace,
  tab: Tab,
  rootPane: Pane,
}).pipe(Schema.encodeKeys({ rootPane: "root_pane" }));

/**
 * Workspace, initial tab, and root pane created atomically by Herdr.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceCreateResult extends Schema.Schema.Type<typeof WorkspaceCreateResult> {}

/**
 * Metadata patch reported for a workspace.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorkspaceMetadataReportInput = Schema.Struct({
  source: Schema.String,
  tokens: HerdrMetadataTokenPatch,
  sequence: Schema.OptionFromOptionalKey(HerdrStateChangeSequence),
  ttlMs: Schema.OptionFromOptionalKey(HerdrMetadataTtl),
});

/**
 * Normalized workspace metadata patch.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceMetadataReportInput extends Schema.Schema.Type<
  typeof WorkspaceMetadataReportInput
> {}

/**
 * Ergonomic external workspace metadata patch.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceMetadataReportInputEncoded extends Schema.Codec.Encoded<
  typeof WorkspaceMetadataReportInput
> {}

/**
 * Ordered destination for moving one workspace.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorkspaceMoveInput = Schema.Struct({
  insertIndex: HerdrInsertIndex,
});

/**
 * Ordered destination for moving one workspace.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceMoveInput extends Schema.Schema.Type<typeof WorkspaceMoveInput> {}

/**
 * External ordered destination accepted by workspace movement.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceMoveInputEncoded extends Schema.Codec.Encoded<
  typeof WorkspaceMoveInput
> {}

/**
 * Optional anchor used when moving a contiguous workspace block.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorkspaceMoveBlockInput = Schema.Struct({
  beforeWorkspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
});

/**
 * Normalized workspace-block move anchor.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceMoveBlockInput extends Schema.Schema.Type<
  typeof WorkspaceMoveBlockInput
> {}

/**
 * External workspace-block move anchor.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorkspaceMoveBlockInputEncoded extends Schema.Codec.Encoded<
  typeof WorkspaceMoveBlockInput
> {}

/**
 * Optional compatibility expectations for a live server handoff.
 *
 * @category schemas
 * @since 0.8.2
 */
export const ServerLiveHandoffInput = Schema.Struct({
  importExe: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  expectedProtocol: Schema.OptionFromOptionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  expectedVersion: Schema.OptionFromOptionalKey(Schema.String),
});

/**
 * Normalized live-handoff expectations.
 *
 * @category models
 * @since 0.8.2
 */
export interface ServerLiveHandoffInput extends Schema.Schema.Type<typeof ServerLiveHandoffInput> {}

/**
 * Ergonomic live-handoff expectations accepted by the server service.
 *
 * @category models
 * @since 0.8.2
 */
export interface ServerLiveHandoffInputEncoded extends Schema.Codec.Encoded<
  typeof ServerLiveHandoffInput
> {}

/**
 * Foreground notification request.
 *
 * @category schemas
 * @since 0.8.2
 */
export const NotificationShowInput = Schema.Struct({
  title: Schema.String,
  body: Schema.OptionFromOptionalKey(Schema.String),
  position: Schema.OptionFromOptionalKey(
    Schema.Literals(["top-left", "top-right", "bottom-left", "bottom-right"]),
  ),
  sound: Schema.OptionFromOptionalKey(Schema.Literals(["none", "done", "request"])),
});

/**
 * Normalized foreground notification request.
 *
 * @category models
 * @since 0.8.2
 */
export interface NotificationShowInput extends Schema.Schema.Type<typeof NotificationShowInput> {}

/**
 * Ergonomic foreground notification request.
 *
 * @category models
 * @since 0.8.2
 */
export interface NotificationShowInputEncoded extends Schema.Codec.Encoded<
  typeof NotificationShowInput
> {}

/**
 * Built-in terminal-agent integration managed by Herdr.
 *
 * @category schemas
 * @since 0.8.2
 */
export const IntegrationTarget = Schema.Literals([
  "pi",
  "omp",
  "claude",
  "codex",
  "copilot",
  "devin",
  "droid",
  "kimi",
  "opencode",
  "kilo",
  "hermes",
  "qodercli",
  "cursor",
  "mastracode",
  "grok",
  "qwen",
  "antigravity_cli",
]);

/**
 * Built-in terminal-agent integration managed by Herdr.
 *
 * @category models
 * @since 0.8.2
 */
export type IntegrationTarget = typeof IntegrationTarget.Type;

/**
 * Result of installing or uninstalling a built-in integration.
 *
 * @category schemas
 * @since 0.8.2
 */
export const IntegrationChangeResult = Schema.Struct({
  target: IntegrationTarget,
  messages: Schema.Array(Schema.String),
});

/**
 * Result of installing or uninstalling a built-in integration.
 *
 * @category models
 * @since 0.8.2
 */
export interface IntegrationChangeResult extends Schema.Schema.Type<
  typeof IntegrationChangeResult
> {}

/**
 * Source repository resolved for worktree operations.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeSourceInfo = Schema.Struct({
  repoKey: Schema.String,
  repoName: Schema.String,
  repoRoot: HerdrAbsolutePath,
  sourceCheckoutPath: HerdrAbsolutePath,
  sourceWorkspaceId: Schema.OptionFromOptionalNullOr(WorkspaceId),
}).pipe(
  Schema.encodeKeys({
    repoKey: "repo_key",
    repoName: "repo_name",
    repoRoot: "repo_root",
    sourceCheckoutPath: "source_checkout_path",
    sourceWorkspaceId: "source_workspace_id",
  }),
);

/**
 * Source repository resolved for worktree operations.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeSourceInfo extends Schema.Schema.Type<typeof WorktreeSourceInfo> {}

/**
 * Git worktree discovered by Herdr.
 *
 * @category schemas
 * @since 0.8.2
 */
export const Worktree = Schema.Struct({
  path: HerdrAbsolutePath,
  branch: optionalString,
  isBare: Schema.Boolean,
  isDetached: Schema.Boolean,
  isPrunable: Schema.Boolean,
  isLinkedWorktree: Schema.Boolean,
  openWorkspaceId: Schema.OptionFromOptionalNullOr(WorkspaceId),
  label: Schema.String,
}).pipe(
  Schema.encodeKeys({
    isBare: "is_bare",
    isDetached: "is_detached",
    isPrunable: "is_prunable",
    isLinkedWorktree: "is_linked_worktree",
    openWorkspaceId: "open_workspace_id",
  }),
);

/**
 * Git worktree discovered by Herdr.
 *
 * @category models
 * @since 0.8.2
 */
export interface Worktree extends Schema.Schema.Type<typeof Worktree> {}

/**
 * Resolved source and worktrees returned by listing.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeListResult = Schema.Struct({
  source: WorktreeSourceInfo,
  worktrees: Schema.Array(Worktree),
});

/**
 * Resolved source and worktrees returned by listing.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeListResult extends Schema.Schema.Type<typeof WorktreeListResult> {}

/**
 * Worktree created together with its initial workspace resources.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeCreateResult = Schema.Struct({
  worktree: Worktree,
  workspace: Workspace,
  tab: Tab,
  rootPane: Pane,
}).pipe(Schema.encodeKeys({ rootPane: "root_pane" }));

/**
 * Worktree created together with its initial workspace resources.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeCreateResult extends Schema.Schema.Type<typeof WorktreeCreateResult> {}

/**
 * Worktree opened together with its initial workspace resources.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeOpenResult = Schema.Struct({
  worktree: Worktree,
  workspace: Workspace,
  tab: Tab,
  rootPane: Pane,
  alreadyOpen: Schema.Boolean,
}).pipe(
  Schema.encodeKeys({
    rootPane: "root_pane",
    alreadyOpen: "already_open",
  }),
);

/**
 * Worktree opened together with its initial workspace resources.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeOpenResult extends Schema.Schema.Type<typeof WorktreeOpenResult> {}

/**
 * Worktree removal outcome.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeRemoveResult = Schema.Struct({
  workspaceId: WorkspaceId,
  path: HerdrAbsolutePath,
  forced: Schema.Boolean,
}).pipe(Schema.encodeKeys({ workspaceId: "workspace_id" }));

/**
 * Worktree removal outcome.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeRemoveResult extends Schema.Schema.Type<typeof WorktreeRemoveResult> {}

const WorktreeSourceInputFields = {
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  cwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  trustRepository: Schema.OptionFromOptionalKey(Schema.Boolean),
};

/**
 * Optional workspace or directory selecting a repository for worktree listing.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeListInput = Schema.Struct(WorktreeSourceInputFields).check(
  Schema.makeFilter((value) =>
    Option.isSome(value.workspaceId) && Option.isSome(value.cwd)
      ? "workspaceId and cwd are mutually exclusive"
      : undefined,
  ),
);

/**
 * Normalized worktree-list source selection.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeListInput extends Schema.Schema.Type<typeof WorktreeListInput> {}

/**
 * Ergonomic worktree-list source selection.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeListInputEncoded extends Schema.Codec.Encoded<typeof WorktreeListInput> {}

/**
 * Parameters accepted when creating a worktree and workspace.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeCreateInput = Schema.Struct({
  ...WorktreeSourceInputFields,
  branch: Schema.OptionFromOptionalKey(Schema.String),
  base: Schema.OptionFromOptionalKey(Schema.String),
  path: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  label: Schema.OptionFromOptionalKey(Schema.String),
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((value) =>
    Option.isSome(value.workspaceId) && Option.isSome(value.cwd)
      ? "workspaceId and cwd are mutually exclusive"
      : undefined,
  ),
);

/**
 * Normalized worktree-creation parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeCreateInput extends Schema.Schema.Type<typeof WorktreeCreateInput> {}

/**
 * Ergonomic worktree-creation parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeCreateInputEncoded extends Schema.Codec.Encoded<
  typeof WorktreeCreateInput
> {}

/**
 * Parameters accepted when opening an existing worktree.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeOpenInput = Schema.Struct({
  ...WorktreeSourceInputFields,
  path: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  branch: Schema.OptionFromOptionalKey(Schema.String),
  label: Schema.OptionFromOptionalKey(Schema.String),
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((value) => {
    if (Option.isSome(value.workspaceId) && Option.isSome(value.cwd)) {
      return "workspaceId and cwd are mutually exclusive";
    }
    return Option.isSome(value.path) === Option.isSome(value.branch)
      ? "exactly one of path or branch is required"
      : undefined;
  }),
);

/**
 * Normalized worktree-open parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeOpenInput extends Schema.Schema.Type<typeof WorktreeOpenInput> {}

/**
 * Ergonomic worktree-open parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeOpenInputEncoded extends Schema.Codec.Encoded<typeof WorktreeOpenInput> {}

/**
 * Optional force flag for worktree removal.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorktreeRemoveInput = Schema.Struct({
  force: Schema.OptionFromOptionalKey(Schema.Boolean),
  trustRepository: Schema.OptionFromOptionalKey(Schema.Boolean),
});

/**
 * Normalized worktree-removal input.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeRemoveInput extends Schema.Schema.Type<typeof WorktreeRemoveInput> {}

/**
 * Ergonomic worktree-removal input.
 *
 * @category models
 * @since 0.8.2
 */
export interface WorktreeRemoveInputEncoded extends Schema.Codec.Encoded<
  typeof WorktreeRemoveInput
> {}

/**
 * Input accepted when creating a tab and root pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const TabCreateInput = Schema.Struct({
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  cwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
  label: Schema.OptionFromOptionalKey(Schema.String),
  env: Schema.OptionFromOptionalKey(HerdrEnvironment),
});

/**
 * Normalized input accepted when creating a tab.
 *
 * @category models
 * @since 0.8.2
 */
export interface TabCreateInput extends Schema.Schema.Type<typeof TabCreateInput> {}

/**
 * Ergonomic input accepted when creating a tab.
 *
 * @category models
 * @since 0.8.2
 */
export interface TabCreateInputEncoded extends Schema.Codec.Encoded<typeof TabCreateInput> {}

/**
 * Tab and root pane created together.
 *
 * @category schemas
 * @since 0.8.2
 */
export const TabCreateResult = Schema.Struct({
  tab: Tab,
  rootPane: Pane,
}).pipe(Schema.encodeKeys({ rootPane: "root_pane" }));

/**
 * Tab and root pane created together.
 *
 * @category models
 * @since 0.8.2
 */
export interface TabCreateResult extends Schema.Schema.Type<typeof TabCreateResult> {}

/**
 * Optional workspace filter for tab listing.
 *
 * @category schemas
 * @since 0.8.2
 */
export const TabListInput = Schema.Struct({
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
});

/**
 * Normalized tab-list filter.
 *
 * @category models
 * @since 0.8.2
 */
export interface TabListInput extends Schema.Schema.Type<typeof TabListInput> {}

/**
 * Ergonomic tab-list filter.
 *
 * @category models
 * @since 0.8.2
 */
export interface TabListInputEncoded extends Schema.Codec.Encoded<typeof TabListInput> {}

/**
 * Ordered destination for moving one tab.
 *
 * @category schemas
 * @since 0.8.2
 */
export const TabMoveInput = Schema.Struct({
  insertIndex: HerdrInsertIndex,
});

/**
 * Ordered destination for moving one tab.
 *
 * @category models
 * @since 0.8.2
 */
export interface TabMoveInput extends Schema.Schema.Type<typeof TabMoveInput> {}

/**
 * External ordered destination accepted by tab movement.
 *
 * @category models
 * @since 0.8.2
 */
export interface TabMoveInputEncoded extends Schema.Codec.Encoded<typeof TabMoveInput> {}

/**
 * Cardinal pane direction.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneDirection = Schema.Literals(["left", "right", "up", "down"]);

/**
 * Cardinal pane direction.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneDirection = typeof PaneDirection.Type;

/**
 * Direction accepted when constructing a binary split.
 *
 * @category schemas
 * @since 0.8.2
 */
export const SplitDirection = Schema.Literals(["right", "down"]);

/**
 * Direction accepted when constructing a binary split.
 *
 * @category models
 * @since 0.8.2
 */
export type SplitDirection = typeof SplitDirection.Type;

/**
 * Pane-output source selected for reading or waiting.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneReadSource = Schema.Literals([
  "visible",
  "recent",
  "recent_unwrapped",
  "detection",
]);

/**
 * Pane-output source selected for reading or waiting.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneReadSource = typeof PaneReadSource.Type;

/**
 * Pane-output representation returned by a read.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneReadFormat = Schema.Literals(["text", "ansi"]);

/**
 * Pane-output representation returned by a read.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneReadFormat = typeof PaneReadFormat.Type;

/**
 * Rectangle in terminal-cell layout coordinates.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneLayoutRect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

/**
 * Rectangle in terminal-cell layout coordinates.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneLayoutRect extends Schema.Schema.Type<typeof PaneLayoutRect> {}

/**
 * Pane layout snapshot returned by geometry operations.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneLayoutSnapshot = Schema.Struct({
  workspaceId: WorkspaceId,
  tabId: TabId,
  zoomed: Schema.Boolean,
  area: PaneLayoutRect,
  focusedPaneId: PaneId,
  panes: Schema.Array(
    Schema.Struct({
      paneId: PaneId,
      focused: Schema.Boolean,
      rect: PaneLayoutRect,
    }).pipe(Schema.encodeKeys({ paneId: "pane_id" })),
  ),
  splits: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      direction: SplitDirection,
      ratio: Schema.Finite,
      rect: PaneLayoutRect,
    }),
  ),
}).pipe(
  Schema.encodeKeys({
    workspaceId: "workspace_id",
    tabId: "tab_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Pane layout snapshot returned by geometry operations.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneLayoutSnapshot extends Schema.Schema.Type<typeof PaneLayoutSnapshot> {}

/**
 * Pane output read result.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneReadResult = Schema.Struct({
  paneId: PaneId,
  workspaceId: WorkspaceId,
  tabId: TabId,
  source: PaneReadSource,
  format: PaneReadFormat,
  text: Schema.String,
  revision: HerdrRevision,
  truncated: Schema.Boolean,
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    workspaceId: "workspace_id",
    tabId: "tab_id",
  }),
);

/**
 * Pane output read result.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneReadResult extends Schema.Schema.Type<typeof PaneReadResult> {}

/**
 * Pane output wait result and the read that contained the match.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneOutputMatchResult = Schema.Struct({
  paneId: PaneId,
  revision: HerdrRevision,
  matchedLine: optionalString,
  read: PaneReadResult,
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    matchedLine: "matched_line",
  }),
);

/**
 * Pane output wait result and the read that contained the match.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneOutputMatchResult extends Schema.Schema.Type<typeof PaneOutputMatchResult> {}

/**
 * Result of swapping two panes.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneSwapResult = Schema.Struct({
  changed: Schema.Boolean,
  reason: Schema.OptionFromOptionalNullOr(
    Schema.Literals(["no_neighbor", "same_pane", "not_found", "cross_tab"]),
  ),
  sourcePaneId: PaneId,
  targetPaneId: Schema.OptionFromOptionalNullOr(PaneId),
  focusedPaneId: PaneId,
  layout: PaneLayoutSnapshot,
}).pipe(
  Schema.encodeKeys({
    sourcePaneId: "source_pane_id",
    targetPaneId: "target_pane_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Result of swapping two panes.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneSwapResult extends Schema.Schema.Type<typeof PaneSwapResult> {}

/**
 * Result of moving a pane between tabs or workspaces.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneMoveResult = Schema.Struct({
  changed: Schema.Boolean,
  reason: Schema.OptionFromOptionalNullOr(Schema.Literals(["same_tab", "zoomed_tab"])),
  previousPaneId: PaneId,
  previousWorkspaceId: WorkspaceId,
  previousTabId: TabId,
  pane: Pane,
  sourceLayout: Schema.OptionFromOptionalNullOr(PaneLayoutSnapshot),
  targetLayout: PaneLayoutSnapshot,
  createdWorkspace: Schema.OptionFromOptionalNullOr(Workspace),
  createdTab: Schema.OptionFromOptionalNullOr(Tab),
  closedWorkspaceId: Schema.OptionFromOptionalNullOr(WorkspaceId),
  closedTabId: Schema.OptionFromOptionalNullOr(TabId),
  focusedPaneId: PaneId,
}).pipe(
  Schema.encodeKeys({
    previousPaneId: "previous_pane_id",
    previousWorkspaceId: "previous_workspace_id",
    previousTabId: "previous_tab_id",
    sourceLayout: "source_layout",
    targetLayout: "target_layout",
    createdWorkspace: "created_workspace",
    createdTab: "created_tab",
    closedWorkspaceId: "closed_workspace_id",
    closedTabId: "closed_tab_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Result of moving a pane between tabs or workspaces.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneMoveResult extends Schema.Schema.Type<typeof PaneMoveResult> {}

/**
 * Result of changing pane zoom or focus state.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneZoomResult = Schema.Struct({
  changed: Schema.Boolean,
  zoomChanged: Schema.Boolean,
  focusChanged: Schema.Boolean,
  reason: Schema.OptionFromOptionalNullOr(
    Schema.Literals(["single_pane", "already_zoomed", "already_unzoomed"]),
  ),
  paneId: PaneId,
  focusedPaneId: PaneId,
  zoomed: Schema.Boolean,
  layout: PaneLayoutSnapshot,
}).pipe(
  Schema.encodeKeys({
    zoomChanged: "zoom_changed",
    focusChanged: "focus_changed",
    paneId: "pane_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Result of changing pane zoom or focus state.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneZoomResult extends Schema.Schema.Type<typeof PaneZoomResult> {}

/**
 * Foreground process reported for a pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneProcess = Schema.Struct({
  pid: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  name: Schema.String,
  argv0: optionalString,
  argv: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  cmdline: optionalString,
  cwd: optionalAbsolutePath,
});

/**
 * Foreground process reported for a pane.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneProcess extends Schema.Schema.Type<typeof PaneProcess> {}

/**
 * Operating-system process information for one pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneProcessInfo = Schema.Struct({
  paneId: PaneId,
  shellPid: Schema.OptionFromOptionalNullOr(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  foregroundProcessGroupId: Schema.OptionFromOptionalNullOr(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  tty: optionalString,
  foregroundProcesses: Schema.optionalKey(Schema.Array(PaneProcess)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    shellPid: "shell_pid",
    foregroundProcessGroupId: "foreground_process_group_id",
    foregroundProcesses: "foreground_processes",
  }),
);

/**
 * Operating-system process information for one pane.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneProcessInfo extends Schema.Schema.Type<typeof PaneProcessInfo> {}

/**
 * Neighbor lookup result for one pane and direction.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneNeighborResult = Schema.Struct({
  paneId: PaneId,
  direction: PaneDirection,
  neighborPaneId: Schema.OptionFromOptionalNullOr(PaneId),
  layout: PaneLayoutSnapshot,
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    neighborPaneId: "neighbor_pane_id",
  }),
);

/**
 * Neighbor lookup result for one pane and direction.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneNeighborResult extends Schema.Schema.Type<typeof PaneNeighborResult> {}

/**
 * Edge membership result for one pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneEdgesResult = Schema.Struct({
  paneId: PaneId,
  left: Schema.Boolean,
  right: Schema.Boolean,
  up: Schema.Boolean,
  down: Schema.Boolean,
  layout: PaneLayoutSnapshot,
}).pipe(Schema.encodeKeys({ paneId: "pane_id" }));

/**
 * Edge membership result for one pane.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneEdgesResult extends Schema.Schema.Type<typeof PaneEdgesResult> {}

/**
 * Directional focus outcome.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneFocusDirectionResult = Schema.Struct({
  changed: Schema.Boolean,
  reason: Schema.OptionFromOptionalNullOr(Schema.Literal("no_neighbor")),
  sourcePaneId: PaneId,
  focusedPaneId: Schema.OptionFromOptionalNullOr(PaneId),
  layout: PaneLayoutSnapshot,
}).pipe(
  Schema.encodeKeys({
    sourcePaneId: "source_pane_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Directional focus outcome.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneFocusDirectionResult extends Schema.Schema.Type<
  typeof PaneFocusDirectionResult
> {}

/**
 * Pane resize outcome.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneResizeResult = Schema.Struct({
  changed: Schema.Boolean,
  reason: Schema.OptionFromOptionalNullOr(Schema.Literal("unchanged")),
  paneId: PaneId,
  focusedPaneId: PaneId,
  layout: PaneLayoutSnapshot,
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Pane resize outcome.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneResizeResult extends Schema.Schema.Type<typeof PaneResizeResult> {}

/**
 * Direct-file pixel formats advertised and accepted by Herdr graphics streams.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsFileFormat = Schema.Literals(["rgba", "bgra"]);

/**
 * Direct-file pixel formats advertised and accepted by Herdr graphics streams.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneGraphicsFileFormat = typeof PaneGraphicsFileFormat.Type;

/**
 * Pane graphics rendering and file-frame capabilities.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsInfo = Schema.Struct({
  cellWidthPx: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  cellHeightPx: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  paneVisible: Schema.Boolean,
  fileFrameDirectory: Schema.OptionFromOptionalNullOr(HerdrAbsolutePath),
  fileFrameFormats: Schema.optionalKey(Schema.Array(PaneGraphicsFileFormat)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  fileFrameMaxBytes: Schema.OptionFromOptionalNullOr(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  fileFrameDirectMaxBytes: Schema.OptionFromOptionalNullOr(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  fileFrameDamage: Schema.optionalKey(Schema.Boolean).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
  maxLayersPerPane: Schema.optionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(0), { encodingStrategy: "omit" })),
  pixelMouse: Schema.optionalKey(Schema.Boolean).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
  fileFrameTransport: Schema.OptionFromOptionalNullOr(Schema.String),
}).pipe(
  Schema.encodeKeys({
    cellWidthPx: "cell_width_px",
    cellHeightPx: "cell_height_px",
    paneVisible: "pane_visible",
    fileFrameDirectory: "file_frame_directory",
    fileFrameFormats: "file_frame_formats",
    fileFrameMaxBytes: "file_frame_max_bytes",
    fileFrameDirectMaxBytes: "file_frame_direct_max_bytes",
    fileFrameDamage: "file_frame_damage",
    maxLayersPerPane: "max_layers_per_pane",
    pixelMouse: "pixel_mouse",
    fileFrameTransport: "file_frame_transport",
  }),
);

/**
 * Pane graphics rendering and file-frame capabilities.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsInfo extends Schema.Schema.Type<typeof PaneGraphicsInfo> {}

/**
 * Destination for right-click input handled by a pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneRightClickTarget = Schema.Literals(["herdr", "pane"]);

/**
 * Destination for right-click input handled by a pane.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneRightClickTarget = typeof PaneRightClickTarget.Type;

/**
 * Pane input-routing update.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneInputRoutingInput = Schema.Struct({
  rightClick: PaneRightClickTarget,
});

/**
 * Normalized pane input-routing update.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneInputRoutingInput extends Schema.Schema.Type<typeof PaneInputRoutingInput> {}

/**
 * Ergonomic pane input-routing update.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneInputRoutingInputEncoded extends Schema.Codec.Encoded<
  typeof PaneInputRoutingInput
> {}

/**
 * Parameters for splitting a pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneSplitInput = Schema.Struct({
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  direction: SplitDirection,
  ratio: Schema.OptionFromOptionalKey(HerdrSplitRatio),
  cwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
  env: Schema.OptionFromOptionalKey(HerdrEnvironment),
  rightClick: Schema.OptionFromOptionalKey(PaneRightClickTarget),
});

/**
 * Normalized pane-split parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneSplitInput extends Schema.Schema.Type<typeof PaneSplitInput> {}

/**
 * Ergonomic pane-split parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneSplitInputEncoded extends Schema.Codec.Encoded<typeof PaneSplitInput> {}

/**
 * Parameters for swapping a pane with a neighbor or explicit pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneSwapInput = Schema.Union([
  Schema.Struct({
    paneId: Schema.OptionFromOptionalKey(PaneId),
    direction: PaneDirection,
  }),
  Schema.Struct({
    sourcePaneId: PaneId,
    targetPaneId: PaneId,
  }),
]);

/**
 * Normalized pane-swap parameters.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneSwapInput = typeof PaneSwapInput.Type;

/**
 * Ergonomic pane-swap parameters.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneSwapInputEncoded = typeof PaneSwapInput.Encoded;

/**
 * Destination used when moving a pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneMoveDestination = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tab"),
    tabId: TabId,
    targetPaneId: Schema.OptionFromOptionalKey(PaneId),
    split: SplitDirection,
    ratio: Schema.OptionFromOptionalKey(HerdrSplitRatio),
  }),
  Schema.Struct({
    type: Schema.Literal("new_tab"),
    workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
    label: Schema.OptionFromOptionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("new_workspace"),
    label: Schema.OptionFromOptionalKey(Schema.String),
    tabLabel: Schema.OptionFromOptionalKey(Schema.String),
  }),
]);

/**
 * Destination used when moving a pane.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneMoveDestination = typeof PaneMoveDestination.Type;

/**
 * Pane move request.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneMoveInput = Schema.Struct({
  destination: PaneMoveDestination,
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
});

/**
 * Normalized pane move request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneMoveInput extends Schema.Schema.Type<typeof PaneMoveInput> {}

/**
 * Ergonomic pane move request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneMoveInputEncoded extends Schema.Codec.Encoded<typeof PaneMoveInput> {}

/**
 * Pane zoom mode.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneZoomMode = Schema.Literals(["toggle", "on", "off"]);

/**
 * Pane zoom mode.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneZoomMode = typeof PaneZoomMode.Type;

/**
 * Optional mode for a pane zoom operation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneZoomInput = Schema.Struct({
  mode: Schema.OptionFromOptionalKey(PaneZoomMode),
});

/**
 * Normalized pane zoom input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneZoomInput extends Schema.Schema.Type<typeof PaneZoomInput> {}

/**
 * Ergonomic pane zoom input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneZoomInputEncoded extends Schema.Codec.Encoded<typeof PaneZoomInput> {}

/**
 * Optional pane origin for directional focus.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneFocusDirectionInput = Schema.Struct({
  paneId: Schema.OptionFromOptionalKey(PaneId),
});

/**
 * Ergonomic directional-focus input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneFocusDirectionInputEncoded extends Schema.Codec.Encoded<
  typeof PaneFocusDirectionInput
> {}

/**
 * Optional pane origin and cell amount for directional resize.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneResizeInput = Schema.Struct({
  paneId: Schema.OptionFromOptionalKey(PaneId),
  amount: Schema.OptionFromOptionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
});

/**
 * Ergonomic directional-resize input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneResizeInputEncoded extends Schema.Codec.Encoded<typeof PaneResizeInput> {}

/**
 * Optional workspace selector for pane listing.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneListInput = Schema.Struct({
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
});

/**
 * Ergonomic pane-list input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneListInputEncoded extends Schema.Codec.Encoded<typeof PaneListInput> {}

/**
 * Optional caller identity used to resolve the current pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneCurrentInput = Schema.Struct({
  callerPaneId: Schema.OptionFromOptionalKey(PaneId),
});

/**
 * Ergonomic current-pane input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneCurrentInputEncoded extends Schema.Codec.Encoded<typeof PaneCurrentInput> {}

/**
 * Pane output read parameters.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneReadInput = Schema.Struct({
  source: PaneReadSource,
  lines: Schema.OptionFromOptionalKey(Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0))),
  format: Schema.OptionFromOptionalKey(PaneReadFormat),
  stripAnsi: Schema.OptionFromOptionalKey(Schema.Boolean),
});

/**
 * Normalized pane output read parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneReadInput extends Schema.Schema.Type<typeof PaneReadInput> {}

/**
 * Ergonomic pane output read parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneReadInputEncoded extends Schema.Codec.Encoded<typeof PaneReadInput> {}

/**
 * Combined text and key input sent to one pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneInput = Schema.Union([
  Schema.Struct({
    text: Schema.String,
    keys: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    text: Schema.optionalKey(Schema.String),
    keys: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  }),
]);

/**
 * Normalized combined pane input.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneInput = typeof PaneInput.Type;

/**
 * Ergonomic combined pane input.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneInputEncoded = typeof PaneInput.Encoded;

/**
 * Text or regular-expression output matcher.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneOutputMatch = Schema.Union([
  Schema.Struct({ type: Schema.Literal("substring"), value: Schema.String }),
  Schema.Struct({ type: Schema.Literal("regex"), value: Schema.String }),
]);

/**
 * Text or regular-expression output matcher.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneOutputMatch = typeof PaneOutputMatch.Type;

/**
 * Pane output wait parameters.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneWaitForOutputInput = Schema.Struct({
  source: PaneReadSource,
  lines: Schema.OptionFromOptionalKey(Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0))),
  match: PaneOutputMatch,
  timeoutMs: Schema.OptionFromOptionalKey(HerdrMilliseconds),
  stripAnsi: Schema.OptionFromOptionalKey(Schema.Boolean),
});

/**
 * Normalized pane output wait parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneWaitForOutputInput extends Schema.Schema.Type<typeof PaneWaitForOutputInput> {}

/**
 * Ergonomic pane output wait parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneWaitForOutputInputEncoded extends Schema.Codec.Encoded<
  typeof PaneWaitForOutputInput
> {}

/**
 * Agent-state report attached to one pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneAgentReportInput = Schema.Struct({
  source: Schema.String,
  agent: Schema.String,
  state: ReportedAgentState,
  message: Schema.OptionFromOptionalKey(Schema.String),
  sequence: Schema.OptionFromOptionalKey(HerdrStateChangeSequence),
  sessionId: Schema.OptionFromOptionalKey(Schema.String),
  sessionPath: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
}).check(
  Schema.makeFilter((value) =>
    Option.isSome(value.sessionId) && Option.isSome(value.sessionPath)
      ? "sessionId and sessionPath are mutually exclusive"
      : undefined,
  ),
);

/**
 * Normalized agent-state report.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneAgentReportInput extends Schema.Schema.Type<typeof PaneAgentReportInput> {}

/**
 * Ergonomic agent-state report.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneAgentReportInputEncoded extends Schema.Codec.Encoded<
  typeof PaneAgentReportInput
> {}

/**
 * Agent-session report attached to one pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneAgentSessionReportInput = Schema.Struct({
  source: Schema.String,
  agent: Schema.String,
  sequence: Schema.OptionFromOptionalKey(HerdrStateChangeSequence),
  sessionStartSource: Schema.OptionFromOptionalKey(Schema.String),
  sessionId: Schema.OptionFromOptionalKey(Schema.String),
  sessionPath: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
}).check(
  Schema.makeFilter((value) =>
    Option.isSome(value.sessionId) && Option.isSome(value.sessionPath)
      ? "sessionId and sessionPath are mutually exclusive"
      : undefined,
  ),
);

/**
 * Normalized agent-session report.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneAgentSessionReportInput extends Schema.Schema.Type<
  typeof PaneAgentSessionReportInput
> {}

/**
 * Ergonomic agent-session report.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneAgentSessionReportInputEncoded extends Schema.Codec.Encoded<
  typeof PaneAgentSessionReportInput
> {}

/**
 * Metadata patch reported for one pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneMetadataReportInput = Schema.Struct({
  source: Schema.String,
  agent: Schema.OptionFromOptionalKey(Schema.String),
  appliesToSource: Schema.OptionFromOptionalKey(Schema.String),
  title: Schema.OptionFromOptionalKey(Schema.String),
  displayAgent: Schema.OptionFromOptionalKey(Schema.String),
  stateLabels: Schema.OptionFromOptionalKey(Schema.Record(AgentStatus, Schema.String)),
  tokens: Schema.OptionFromOptionalKey(HerdrMetadataTokenPatch),
  clearTitle: Schema.OptionFromOptionalKey(Schema.Boolean),
  clearDisplayAgent: Schema.OptionFromOptionalKey(Schema.Boolean),
  clearStateLabels: Schema.OptionFromOptionalKey(Schema.Boolean),
  sequence: Schema.OptionFromOptionalKey(HerdrStateChangeSequence),
  ttlMs: Schema.OptionFromOptionalKey(HerdrMetadataTtl),
});

/**
 * Normalized pane metadata patch.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneMetadataReportInput extends Schema.Schema.Type<
  typeof PaneMetadataReportInput
> {}

/**
 * Ergonomic pane metadata patch.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneMetadataReportInputEncoded extends Schema.Codec.Encoded<
  typeof PaneMetadataReportInput
> {}

/**
 * Optional authority version used when clearing an agent report.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneClearAgentAuthorityInput = Schema.Struct({
  source: Schema.OptionFromOptionalKey(Schema.String),
  sequence: Schema.OptionFromOptionalKey(HerdrStateChangeSequence),
});

/**
 * Normalized clear-agent-authority request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneClearAgentAuthorityInput extends Schema.Schema.Type<
  typeof PaneClearAgentAuthorityInput
> {}

/**
 * Ergonomic clear-agent-authority request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneClearAgentAuthorityInputEncoded extends Schema.Codec.Encoded<
  typeof PaneClearAgentAuthorityInput
> {}

/**
 * Authority release request for one pane agent.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneReleaseAgentInput = Schema.Struct({
  source: Schema.String,
  agent: Schema.String,
  sequence: Schema.OptionFromOptionalKey(HerdrStateChangeSequence),
});

/**
 * Normalized pane agent release request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneReleaseAgentInput extends Schema.Schema.Type<typeof PaneReleaseAgentInput> {}

/**
 * Ergonomic pane agent release request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneReleaseAgentInputEncoded extends Schema.Codec.Encoded<
  typeof PaneReleaseAgentInput
> {}

/**
 * Placement coordinates for a pane graphics frame.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsPlacement = Schema.Struct({
  viewportCol: Schema.OptionFromOptionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  viewportRow: Schema.OptionFromOptionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  gridCols: Schema.OptionFromOptionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
  gridRows: Schema.OptionFromOptionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
});

/**
 * Normalized placement coordinates for a pane graphics frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsPlacement extends Schema.Schema.Type<typeof PaneGraphicsPlacement> {}

/**
 * Pane graphics pixel representation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsFormat = Schema.Literals(["png", "rgb", "rgba", "bgra"]);

/**
 * Pane graphics pixel representation.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneGraphicsFormat = typeof PaneGraphicsFormat.Type;

const PaneGraphicsFrameFields = {
  format: PaneGraphicsFormat,
  imageWidth: HerdrImageDimension,
  imageHeight: HerdrImageDimension,
  data: Schema.Uint8Array,
  placement: Schema.OptionFromOptionalKey(PaneGraphicsPlacement),
};

/**
 * Image frame accepted by a scoped pane graphics stream.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsFrame = Schema.Struct(PaneGraphicsFrameFields);

/**
 * Normalized pane graphics image frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsFrame extends Schema.Schema.Type<typeof PaneGraphicsFrame> {}

/**
 * Ergonomic pane graphics image frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsFrameEncoded extends Schema.Codec.Encoded<typeof PaneGraphicsFrame> {}

/**
 * One-shot image frame with optional layer placement controls.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsSetFrame = Schema.Struct({
  ...PaneGraphicsFrameFields,
  layerId: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
  zIndex: Schema.OptionFromOptionalKey(Schema.Finite.check(Schema.isInt())),
});

/**
 * Normalized one-shot pane graphics frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsSetFrame extends Schema.Schema.Type<typeof PaneGraphicsSetFrame> {}

/**
 * Ergonomic one-shot pane graphics frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsSetFrameEncoded extends Schema.Codec.Encoded<
  typeof PaneGraphicsSetFrame
> {}

/**
 * Optional layer selected by a graphics operation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsLayerInput = Schema.Struct({
  layerId: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
});

/**
 * Ergonomic graphics-layer selection.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsLayerInputEncoded extends Schema.Codec.Encoded<
  typeof PaneGraphicsLayerInput
> {}

/**
 * Layer and z-index selected for a scoped graphics stream.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsStreamInput = Schema.Struct({
  layerId: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
  zIndex: Schema.OptionFromOptionalKey(Schema.Finite.check(Schema.isInt())),
});

/**
 * Ergonomic scoped graphics-stream selection.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsStreamInputEncoded extends Schema.Codec.Encoded<
  typeof PaneGraphicsStreamInput
> {}

/**
 * Immutable direct-file frame accepted by a scoped graphics stream.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsFileFrame = Schema.Struct({
  format: PaneGraphicsFileFormat,
  imageWidth: HerdrImageDimension,
  imageHeight: HerdrImageDimension,
  filePath: HerdrAbsolutePath,
  sequence: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  revision: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  placement: Schema.OptionFromOptionalKey(PaneGraphicsPlacement),
});

/**
 * Normalized direct-file pane graphics frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsFileFrame extends Schema.Schema.Type<typeof PaneGraphicsFileFrame> {}

/**
 * Ergonomic direct-file pane graphics frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsFileFrameEncoded extends Schema.Codec.Encoded<
  typeof PaneGraphicsFileFrame
> {}

/**
 * Herdr acknowledgement for an accepted direct-file graphics frame.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneGraphicsFrameAcknowledgement = Schema.Struct({
  sequence: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  revision: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

/**
 * Herdr acknowledgement for an accepted direct-file graphics frame.
 *
 * @category models
 * @since 0.8.2
 */
export interface PaneGraphicsFrameAcknowledgement extends Schema.Schema.Type<
  typeof PaneGraphicsFrameAcknowledgement
> {}

interface LayoutPaneNodeValue {
  readonly type: "pane";
  readonly paneId: Option.Option<PaneId>;
  readonly label: Option.Option<string>;
  readonly cwd: Option.Option<HerdrAbsolutePath>;
  readonly command: Option.Option<readonly string[]>;
  readonly env: Option.Option<HerdrEnvironment>;
}

interface LayoutSplitNodeValue {
  readonly type: "split";
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly first: LayoutNodeValue;
  readonly second: LayoutNodeValue;
}

type LayoutNodeValue = LayoutPaneNodeValue | LayoutSplitNodeValue;

interface LayoutPaneNodeInputEncoded {
  readonly type: "pane";
  readonly paneId?: string | undefined;
  readonly label?: string | undefined;
  readonly cwd?: string | undefined;
  readonly command?: readonly string[] | undefined;
  readonly env?: { readonly [key: string]: string } | undefined;
}

interface LayoutSplitNodeInputEncoded {
  readonly type: "split";
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly first: LayoutNodeInputEncoded;
  readonly second: LayoutNodeInputEncoded;
}

type LayoutNodeInputEncoded = LayoutPaneNodeInputEncoded | LayoutSplitNodeInputEncoded;

interface LayoutPaneNodeWireEncoded {
  readonly type: "pane";
  readonly pane_id?: string | null | undefined;
  readonly label?: string | null | undefined;
  readonly cwd?: string | null | undefined;
  readonly command?: readonly string[] | null | undefined;
  readonly env?: { readonly [key: string]: string } | undefined;
}

interface LayoutSplitNodeWireEncoded {
  readonly type: "split";
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly first: LayoutNodeWireEncoded;
  readonly second: LayoutNodeWireEncoded;
}

type LayoutNodeWireEncoded = LayoutPaneNodeWireEncoded | LayoutSplitNodeWireEncoded;

/**
 * Recursive declarative pane or split layout node.
 *
 * @category schemas
 * @since 0.8.2
 */
export const LayoutNode: Schema.Codec<LayoutNodeValue, LayoutNodeInputEncoded> = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pane"),
    paneId: Schema.OptionFromOptionalKey(PaneId),
    label: Schema.OptionFromOptionalKey(Schema.String),
    cwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
    command: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
    env: Schema.OptionFromOptionalKey(HerdrEnvironment),
  }),
  Schema.Struct({
    type: Schema.Literal("split"),
    direction: SplitDirection,
    ratio: HerdrSplitRatio,
    first: Schema.suspend((): Schema.Codec<LayoutNodeValue, LayoutNodeInputEncoded> => LayoutNode),
    second: Schema.suspend((): Schema.Codec<LayoutNodeValue, LayoutNodeInputEncoded> => LayoutNode),
  }),
]);

const LayoutWireNode: Schema.Codec<LayoutNodeValue, LayoutNodeWireEncoded> = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pane"),
    paneId: Schema.OptionFromOptionalNullOr(PaneId),
    label: Schema.OptionFromOptionalNullOr(Schema.String),
    cwd: Schema.OptionFromOptionalNullOr(HerdrAbsolutePath),
    command: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
    env: Schema.OptionFromOptionalKey(HerdrEnvironment),
  }).pipe(Schema.encodeKeys({ paneId: "pane_id" })),
  Schema.Struct({
    type: Schema.Literal("split"),
    direction: SplitDirection,
    ratio: HerdrSplitRatio,
    first: Schema.suspend(
      (): Schema.Codec<LayoutNodeValue, LayoutNodeWireEncoded> => LayoutWireNode,
    ),
    second: Schema.suspend(
      (): Schema.Codec<LayoutNodeValue, LayoutNodeWireEncoded> => LayoutWireNode,
    ),
  }),
]);

/**
 * Recursive declarative pane or split layout node.
 *
 * @category models
 * @since 0.8.2
 */
export type LayoutNode = typeof LayoutNode.Type;

/**
 * Tab or pane selecting a layout.
 *
 * @category schemas
 * @since 0.8.2
 */
export const LayoutTarget = Schema.Union([
  Schema.Struct({ tabId: TabId }),
  Schema.Struct({ paneId: PaneId }),
]);

/**
 * Tab or pane selecting a layout.
 *
 * @category models
 * @since 0.8.2
 */
export type LayoutTarget = typeof LayoutTarget.Type;

/**
 * Ergonomic tab or pane selecting a layout.
 *
 * @category models
 * @since 0.8.2
 */
export type LayoutTargetEncoded = typeof LayoutTarget.Encoded;

/**
 * Declarative layout apply request.
 *
 * @category schemas
 * @since 0.8.2
 */
export const LayoutApplyInput = Schema.Struct({
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  replaceTabId: Schema.OptionFromOptionalKey(TabId),
  tabLabel: Schema.OptionFromOptionalKey(Schema.String),
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
  root: LayoutNode,
});

/**
 * Normalized declarative layout apply request.
 *
 * @category models
 * @since 0.8.2
 */
export interface LayoutApplyInput extends Schema.Schema.Type<typeof LayoutApplyInput> {}

/**
 * Ergonomic declarative layout apply request.
 *
 * @category models
 * @since 0.8.2
 */
export interface LayoutApplyInputEncoded extends Schema.Codec.Encoded<typeof LayoutApplyInput> {}

/**
 * Split path and ratio used to resize a declarative layout node.
 *
 * @category schemas
 * @since 0.8.2
 */
export const LayoutSetSplitRatioInput = Schema.Struct({
  path: Schema.Array(Schema.Boolean),
  ratio: HerdrSplitRatio,
});

/**
 * Normalized split-ratio update.
 *
 * @category models
 * @since 0.8.2
 */
export interface LayoutSetSplitRatioInput extends Schema.Schema.Type<
  typeof LayoutSetSplitRatioInput
> {}

/**
 * Ergonomic split-ratio update.
 *
 * @category models
 * @since 0.8.2
 */
export interface LayoutSetSplitRatioInputEncoded extends Schema.Codec.Encoded<
  typeof LayoutSetSplitRatioInput
> {}

/**
 * Exported or applied declarative layout.
 *
 * @category schemas
 * @since 0.8.2
 */
export const LayoutDescription = Schema.Struct({
  workspaceId: WorkspaceId,
  tabId: TabId,
  zoomed: Schema.Boolean,
  focusedPaneId: PaneId,
  root: LayoutWireNode,
}).pipe(
  Schema.encodeKeys({
    workspaceId: "workspace_id",
    tabId: "tab_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Exported or applied declarative layout.
 *
 * @category models
 * @since 0.8.2
 */
export interface LayoutDescription extends Schema.Schema.Type<typeof LayoutDescription> {}

interface HerdrJsonObjectValue {
  readonly [key: string]: HerdrJsonValue;
}

/**
 * JSON value returned by currently schema-less Herdr protocol fields.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly HerdrJsonValue[]
  | HerdrJsonObjectValue;

/**
 * JSON value returned by currently schema-less Herdr protocol fields.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrJsonValue: Schema.Codec<HerdrJsonValue> = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.suspend((): Schema.Codec<HerdrJsonValue> => HerdrJsonValue)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<HerdrJsonValue> => HerdrJsonValue),
  ),
]);

/**
 * Pane identifier or assigned name selecting one agent.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentTarget = Schema.Union([
  Schema.Struct({ paneId: PaneId }),
  Schema.Struct({ name: AgentName }),
]);

/**
 * Pane identifier or assigned name selecting one agent.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentTarget = typeof AgentTarget.Type;

/**
 * Ergonomic pane identifier or assigned name selecting one agent.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentTargetEncoded = typeof AgentTarget.Encoded;

/**
 * Parameters for launching a named agent in one pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentStartInput = Schema.Struct({
  name: AgentName,
  kind: Schema.NonEmptyString,
  paneId: PaneId,
  args: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
  timeoutMs: Schema.OptionFromOptionalKey(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 3_000, maximum: 300_000, exclusiveMinimum: true }),
    ),
  ),
});

/**
 * Normalized agent launch parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentStartInput extends Schema.Schema.Type<typeof AgentStartInput> {}

/**
 * Ergonomic agent launch parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentStartInputEncoded extends Schema.Codec.Encoded<typeof AgentStartInput> {}

/**
 * Agent and command line created by an agent launch.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentStartResult = Schema.Struct({
  agent: Agent,
  argv: Schema.Array(Schema.String),
});

/**
 * Agent and command line created by an agent launch.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentStartResult extends Schema.Schema.Type<typeof AgentStartResult> {}

/**
 * Agent status and server-owned timeout used by wait operations.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentWaitInput = Schema.Struct({
  until: Schema.OptionFromOptionalKey(Schema.Array(AgentStatus)),
  timeoutMs: Schema.OptionFromOptionalKey(HerdrMilliseconds),
});

/**
 * Normalized agent wait parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentWaitInput extends Schema.Schema.Type<typeof AgentWaitInput> {}

/**
 * Ergonomic agent wait parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentWaitInputEncoded extends Schema.Codec.Encoded<typeof AgentWaitInput> {}

/**
 * Prompt and optional wait policy sent to one agent.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentPromptInput = Schema.Struct({
  text: Schema.String,
  wait: Schema.OptionFromOptionalKey(AgentWaitInput),
});

/**
 * Normalized agent prompt parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentPromptInput extends Schema.Schema.Type<typeof AgentPromptInput> {}

/**
 * Ergonomic agent prompt parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentPromptInputEncoded extends Schema.Codec.Encoded<typeof AgentPromptInput> {}

/**
 * Active agent-view state.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewState = Schema.Struct({
  active: Schema.Boolean,
  source: optionalString,
  label: optionalString,
});

/**
 * Active agent-view state.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentViewState extends Schema.Schema.Type<typeof AgentViewState> {}

/**
 * Agent-view field selected by name or metadata token.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewField = Schema.Union([
  Schema.Literals([
    "status",
    "workspace_id",
    "tab_id",
    "pane_id",
    "agent",
    "seen",
    "state_change_seq",
  ]),
  Schema.Struct({ token: Schema.String }),
]);

/**
 * Agent-view field selected by name or metadata token.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentViewField = typeof AgentViewField.Type;

/**
 * Literal or contextual value used by an agent-view filter.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewValue = Schema.Union([
  Schema.String,
  Schema.Boolean,
  Schema.Finite,
  Schema.Struct({
    context: Schema.Literals(["current_workspace_id", "current_tab_id"]),
  }),
]);

/**
 * Literal or contextual value used by an agent-view filter.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentViewValue = typeof AgentViewValue.Type;

interface AgentViewFilterAllValue {
  readonly op: "all" | "any";
  readonly filters: readonly AgentViewFilterValue[];
}

interface AgentViewFilterNotValue {
  readonly op: "not";
  readonly filter: AgentViewFilterValue;
}

interface AgentViewFilterEqualValue {
  readonly op: "eq";
  readonly field: AgentViewField;
  readonly value: AgentViewValue;
}

interface AgentViewFilterInValue {
  readonly op: "in";
  readonly field: AgentViewField;
  readonly values: readonly AgentViewValue[];
}

interface AgentViewFilterExistsValue {
  readonly op: "exists";
  readonly field: AgentViewField;
}

type AgentViewFilterValue =
  | AgentViewFilterAllValue
  | AgentViewFilterNotValue
  | AgentViewFilterEqualValue
  | AgentViewFilterInValue
  | AgentViewFilterExistsValue;

/**
 * Recursive boolean filter used by the agent view.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewFilter: Schema.Codec<AgentViewFilterValue> = Schema.Union([
  Schema.Struct({
    op: Schema.Literals(["all", "any"]),
    filters: Schema.Array(
      Schema.suspend((): Schema.Codec<AgentViewFilterValue> => AgentViewFilter),
    ),
  }),
  Schema.Struct({
    op: Schema.Literal("not"),
    filter: Schema.suspend((): Schema.Codec<AgentViewFilterValue> => AgentViewFilter),
  }),
  Schema.Struct({
    op: Schema.Literal("eq"),
    field: AgentViewField,
    value: AgentViewValue,
  }),
  Schema.Struct({
    op: Schema.Literal("in"),
    field: AgentViewField,
    values: Schema.Array(AgentViewValue),
  }),
  Schema.Struct({
    op: Schema.Literal("exists"),
    field: AgentViewField,
  }),
]);

/**
 * Recursive boolean filter used by the agent view.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentViewFilter = typeof AgentViewFilter.Type;

/**
 * Agent-view sorting field.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewSortField = Schema.Union([
  Schema.Literals([
    "workspace_order",
    "tab_order",
    "pane_order",
    "attention",
    "status",
    "agent",
    "seen",
    "state_change_seq",
  ]),
  Schema.Struct({ token: Schema.String }),
]);

/**
 * Agent-view sorting field.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentViewSortField = typeof AgentViewSortField.Type;

/**
 * One agent-view sort term.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewSort = Schema.Struct({
  field: AgentViewSortField,
  order: Schema.OptionFromOptionalKey(Schema.Literals(["asc", "desc"])),
});

/**
 * One agent-view sort term.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentViewSort extends Schema.Schema.Type<typeof AgentViewSort> {}

/**
 * Agent-view activation parameters.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewSetInput = Schema.Struct({
  source: Schema.String,
  label: Schema.OptionFromOptionalKey(Schema.String),
  filter: Schema.OptionFromOptionalKey(AgentViewFilter),
  sort: Schema.OptionFromOptionalKey(Schema.Array(AgentViewSort)),
});

/**
 * Normalized agent-view activation parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentViewSetInput extends Schema.Schema.Type<typeof AgentViewSetInput> {}

/**
 * Ergonomic agent-view activation parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentViewSetInputEncoded extends Schema.Codec.Encoded<typeof AgentViewSetInput> {}

/**
 * Optional source used to clear an agent view.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentViewClearInput = Schema.Struct({
  source: Schema.OptionFromOptionalKey(Schema.String),
});

/**
 * Normalized agent-view clear parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentViewClearInput extends Schema.Schema.Type<typeof AgentViewClearInput> {}

/**
 * Ergonomic agent-view clear parameters.
 *
 * @category models
 * @since 0.8.2
 */
export interface AgentViewClearInputEncoded extends Schema.Codec.Encoded<
  typeof AgentViewClearInput
> {}

/**
 * Complete immutable snapshot of the active Herdr session.
 *
 * @category schemas
 * @since 0.8.2
 */
export const SessionSnapshot = Schema.Struct({
  version: Schema.String,
  protocol: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  focusedWorkspaceId: Schema.OptionFromOptionalNullOr(WorkspaceId),
  focusedTabId: Schema.OptionFromOptionalNullOr(TabId),
  focusedPaneId: Schema.OptionFromOptionalNullOr(PaneId),
  workspaces: Schema.Array(Workspace),
  tabs: Schema.Array(Tab),
  panes: Schema.Array(Pane),
  layouts: Schema.Array(PaneLayoutSnapshot),
  agents: Schema.Array(Agent),
}).pipe(
  Schema.encodeKeys({
    focusedWorkspaceId: "focused_workspace_id",
    focusedTabId: "focused_tab_id",
    focusedPaneId: "focused_pane_id",
  }),
);

/**
 * Complete immutable snapshot of the active Herdr session.
 *
 * @category models
 * @since 0.8.2
 */
export interface SessionSnapshot extends Schema.Schema.Type<typeof SessionSnapshot> {}

const herdrEventType = <const Encoded extends string, const Decoded extends string>(
  encoded: Encoded,
  decoded: Decoded,
) =>
  Schema.Literal(encoded).pipe(
    Schema.decodeTo(Schema.Literal(decoded), {
      decode: SchemaGetter.transform(() => decoded),
      encode: SchemaGetter.transform(() => encoded),
    }),
  );

const WorkspaceEvent = <
  const Encoded extends "workspace_created" | "workspace_updated" | "workspace_metadata_updated",
  const Decoded extends "workspace.created" | "workspace.updated" | "workspace.metadata_updated",
>(
  type: Encoded,
  decoded: Decoded,
) => Schema.Struct({ type: herdrEventType(type, decoded), workspace: Workspace });

/**
 * Schema-owned union of every normalized Herdr event.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrEvent = Schema.Union([
  WorkspaceEvent("workspace_created", "workspace.created"),
  WorkspaceEvent("workspace_updated", "workspace.updated"),
  WorkspaceEvent("workspace_metadata_updated", "workspace.metadata_updated"),
  Schema.Struct({
    type: herdrEventType("workspace_closed", "workspace.closed"),
    workspaceId: WorkspaceId,
    workspace: Schema.OptionFromOptionalNullOr(Workspace),
  }).pipe(Schema.encodeKeys({ workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("workspace_renamed", "workspace.renamed"),
    workspaceId: WorkspaceId,
    label: Schema.String,
  }).pipe(Schema.encodeKeys({ workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("workspace_moved", "workspace.moved"),
    workspaceId: WorkspaceId,
    insertIndex: HerdrInsertIndex,
    workspaces: Schema.Array(Workspace),
  }).pipe(
    Schema.encodeKeys({
      workspaceId: "workspace_id",
      insertIndex: "insert_index",
    }),
  ),
  Schema.Struct({
    type: herdrEventType("workspace_reordered", "workspace.reordered"),
    workspaceIds: Schema.Array(WorkspaceId),
    beforeWorkspaceId: Schema.OptionFromOptionalNullOr(WorkspaceId),
    workspaces: Schema.Array(Workspace),
  }).pipe(
    Schema.encodeKeys({
      workspaceIds: "workspace_ids",
      beforeWorkspaceId: "before_workspace_id",
    }),
  ),
  Schema.Struct({
    type: herdrEventType("workspace_focused", "workspace.focused"),
    workspaceId: WorkspaceId,
  }).pipe(Schema.encodeKeys({ workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("worktree_created", "worktree.created"),
    workspace: Workspace,
    worktree: Worktree,
  }),
  Schema.Struct({
    type: herdrEventType("worktree_opened", "worktree.opened"),
    workspace: Workspace,
    worktree: Worktree,
    alreadyOpen: Schema.Boolean,
  }).pipe(Schema.encodeKeys({ alreadyOpen: "already_open" })),
  Schema.Struct({
    type: herdrEventType("worktree_removed", "worktree.removed"),
    workspaceId: WorkspaceId,
    workspace: Schema.OptionFromOptionalNullOr(Workspace),
    worktree: Worktree,
    forced: Schema.Boolean,
  }).pipe(Schema.encodeKeys({ workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("tab_created", "tab.created"),
    tab: Tab,
  }),
  Schema.Struct({
    type: herdrEventType("tab_closed", "tab.closed"),
    tabId: TabId,
    workspaceId: WorkspaceId,
  }).pipe(Schema.encodeKeys({ tabId: "tab_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("tab_renamed", "tab.renamed"),
    tabId: TabId,
    workspaceId: WorkspaceId,
    label: Schema.String,
  }).pipe(Schema.encodeKeys({ tabId: "tab_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("tab_moved", "tab.moved"),
    tabId: TabId,
    workspaceId: WorkspaceId,
    insertIndex: HerdrInsertIndex,
    tabs: Schema.Array(Tab),
  }).pipe(
    Schema.encodeKeys({
      tabId: "tab_id",
      workspaceId: "workspace_id",
      insertIndex: "insert_index",
    }),
  ),
  Schema.Struct({
    type: herdrEventType("tab_focused", "tab.focused"),
    tabId: TabId,
    workspaceId: WorkspaceId,
  }).pipe(Schema.encodeKeys({ tabId: "tab_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("pane_created", "pane.created"),
    pane: Pane,
  }),
  Schema.Struct({
    type: herdrEventType("pane_closed", "pane.closed"),
    paneId: PaneId,
    workspaceId: WorkspaceId,
  }).pipe(Schema.encodeKeys({ paneId: "pane_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("pane_updated", "pane.updated"),
    pane: Pane,
  }),
  Schema.Struct({
    type: herdrEventType("pane_focused", "pane.focused"),
    paneId: PaneId,
    workspaceId: WorkspaceId,
  }).pipe(Schema.encodeKeys({ paneId: "pane_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("pane_moved", "pane.moved"),
    previousPaneId: PaneId,
    previousWorkspaceId: WorkspaceId,
    previousTabId: TabId,
    pane: Pane,
    createdWorkspace: Schema.OptionFromOptionalNullOr(Workspace),
    createdTab: Schema.OptionFromOptionalNullOr(Tab),
    closedWorkspaceId: Schema.OptionFromOptionalNullOr(WorkspaceId),
    closedTabId: Schema.OptionFromOptionalNullOr(TabId),
  }).pipe(
    Schema.encodeKeys({
      previousPaneId: "previous_pane_id",
      previousWorkspaceId: "previous_workspace_id",
      previousTabId: "previous_tab_id",
      createdWorkspace: "created_workspace",
      createdTab: "created_tab",
      closedWorkspaceId: "closed_workspace_id",
      closedTabId: "closed_tab_id",
    }),
  ),
  Schema.Struct({
    type: herdrEventType("pane_output_changed", "pane.output_changed"),
    paneId: PaneId,
    workspaceId: WorkspaceId,
    revision: HerdrRevision,
  }).pipe(Schema.encodeKeys({ paneId: "pane_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("pane_exited", "pane.exited"),
    paneId: PaneId,
    workspaceId: WorkspaceId,
  }).pipe(Schema.encodeKeys({ paneId: "pane_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("pane_agent_detected", "pane.agent_detected"),
    paneId: PaneId,
    workspaceId: WorkspaceId,
    agent: optionalString,
    released: Schema.optionalKey(Schema.Boolean).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(false), { encodingStrategy: "omit" }),
    ),
    finalStatus: Schema.OptionFromOptionalNullOr(AgentStatus),
  }).pipe(
    Schema.encodeKeys({
      paneId: "pane_id",
      workspaceId: "workspace_id",
      finalStatus: "final_status",
    }),
  ),
  Schema.Struct({
    type: herdrEventType("pane_agent_status_changed", "pane.agent_status_changed"),
    paneId: PaneId,
    workspaceId: WorkspaceId,
    agentStatus: AgentStatus,
    agent: optionalString,
    title: optionalString,
    displayAgent: optionalString,
    stateLabels: Schema.optionalKey(HerdrMetadataTokens).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed({}), { encodingStrategy: "omit" }),
    ),
  }).pipe(
    Schema.encodeKeys({
      paneId: "pane_id",
      workspaceId: "workspace_id",
      agentStatus: "agent_status",
      displayAgent: "display_agent",
      stateLabels: "state_labels",
    }),
  ),
  Schema.Struct({
    type: herdrEventType("pane_scroll_changed", "pane.scroll_changed"),
    paneId: PaneId,
    workspaceId: WorkspaceId,
    scroll: PaneScroll,
  }).pipe(Schema.encodeKeys({ paneId: "pane_id", workspaceId: "workspace_id" })),
  Schema.Struct({
    type: herdrEventType("pane_output_matched", "pane.output_matched"),
    paneId: PaneId,
    matchedLine: Schema.String,
    read: PaneReadResult,
  }).pipe(
    Schema.encodeKeys({
      paneId: "pane_id",
      matchedLine: "matched_line",
    }),
  ),
  Schema.Struct({
    type: herdrEventType("layout_updated", "layout.updated"),
    layout: PaneLayoutSnapshot,
  }),
]);

/**
 * Schema-owned union of every normalized Herdr event.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrEvent = typeof HerdrEvent.Type;

/**
 * Event emitted for one subscription specification.
 *
 * @category models
 * @since 0.8.2
 */
export type EventForSubscription<Spec extends { readonly type: string }> = Extract<
  HerdrEvent,
  { readonly type: Spec["type"] }
>;

/**
 * Event emitted for one wait matcher.
 *
 * @category models
 * @since 0.8.2
 */
export type EventForMatch<Match extends { readonly type: string }> = Extract<
  HerdrEvent,
  { readonly type: Match["type"] }
>;

/**
 * Lifecycle event kinds accepted by a simple subscription.
 *
 * @category schemas
 * @since 0.8.2
 */
export const LifecycleSubscriptionType = Schema.Literals([
  "workspace.created",
  "workspace.updated",
  "workspace.metadata_updated",
  "workspace.renamed",
  "workspace.moved",
  "workspace.reordered",
  "workspace.closed",
  "workspace.focused",
  "worktree.created",
  "worktree.opened",
  "worktree.removed",
  "tab.created",
  "tab.closed",
  "tab.focused",
  "tab.renamed",
  "tab.moved",
  "pane.created",
  "pane.closed",
  "pane.updated",
  "pane.focused",
  "pane.moved",
  "pane.exited",
  "pane.agent_detected",
  "layout.updated",
]);

/**
 * Lifecycle event kinds accepted by a simple subscription.
 *
 * @category models
 * @since 0.8.2
 */
export type LifecycleSubscriptionType = typeof LifecycleSubscriptionType.Type;

/**
 * Event subscription specification sent during stream acquisition.
 *
 * @category schemas
 * @since 0.8.2
 */
export const EventSubscriptionSpec = Schema.Union([
  Schema.Struct({ type: LifecycleSubscriptionType }),
  Schema.Struct({
    type: Schema.Literal("pane.output_matched"),
    paneId: PaneId,
    source: PaneReadSource,
    lines: Schema.OptionFromOptionalKey(
      Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)),
    ),
    match: PaneOutputMatch,
    stripAnsi: Schema.OptionFromOptionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("pane.agent_status_changed"),
    paneId: PaneId,
    agentStatus: Schema.OptionFromOptionalKey(AgentStatus),
  }),
  Schema.Struct({
    type: Schema.Literal("pane.scroll_changed"),
    paneId: PaneId,
  }),
]);

/**
 * Normalized event subscription specification.
 *
 * @category models
 * @since 0.8.2
 */
export type EventSubscriptionSpec = typeof EventSubscriptionSpec.Type;

/**
 * Ergonomic event subscription specification.
 *
 * @category models
 * @since 0.8.2
 */
export type EventSubscriptionSpecEncoded = typeof EventSubscriptionSpec.Encoded;

/**
 * Event matcher used by a one-shot wait.
 *
 * @category schemas
 * @since 0.8.2
 */
export const EventMatch = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("workspace.created"),
    workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  }),
  Schema.Struct({ type: Schema.Literal("workspace.updated"), workspaceId: WorkspaceId }),
  Schema.Struct({ type: Schema.Literal("workspace.closed"), workspaceId: WorkspaceId }),
  Schema.Struct({
    type: Schema.Literal("workspace.renamed"),
    workspaceId: WorkspaceId,
    label: Schema.OptionFromOptionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("workspace.moved"), workspaceId: WorkspaceId }),
  Schema.Struct({ type: Schema.Literal("workspace.focused"), workspaceId: WorkspaceId }),
  Schema.Struct({
    type: Schema.Literal("tab.created"),
    tabId: Schema.OptionFromOptionalKey(TabId),
    workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  }),
  Schema.Struct({ type: Schema.Literal("tab.closed"), tabId: TabId }),
  Schema.Struct({
    type: Schema.Literal("tab.renamed"),
    tabId: TabId,
    label: Schema.OptionFromOptionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("tab.moved"), tabId: TabId }),
  Schema.Struct({ type: Schema.Literal("tab.focused"), tabId: TabId }),
  Schema.Struct({
    type: Schema.Literal("pane.created"),
    paneId: Schema.OptionFromOptionalKey(PaneId),
    workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  }),
  Schema.Struct({ type: Schema.Literal("pane.closed"), paneId: PaneId }),
  Schema.Struct({ type: Schema.Literal("pane.focused"), paneId: PaneId }),
  Schema.Struct({ type: Schema.Literal("pane.moved"), paneId: PaneId }),
  Schema.Struct({
    type: Schema.Literal("pane.output_changed"),
    paneId: PaneId,
    minRevision: Schema.OptionFromOptionalKey(HerdrRevision),
  }),
  Schema.Struct({ type: Schema.Literal("pane.exited"), paneId: PaneId }),
  Schema.Struct({
    type: Schema.Literal("pane.agent_detected"),
    paneId: PaneId,
    agent: Schema.OptionFromOptionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("pane.agent_status_changed"),
    paneId: PaneId,
    agentStatus: AgentStatus,
  }),
]);

/**
 * Normalized event matcher used by a one-shot wait.
 *
 * @category models
 * @since 0.8.2
 */
export type EventMatch = typeof EventMatch.Type;

/**
 * Ergonomic event matcher used by a one-shot wait.
 *
 * @category models
 * @since 0.8.2
 */
export type EventMatchEncoded = typeof EventMatch.Encoded;

/**
 * Optional server-owned timeout for a one-shot event wait.
 *
 * @category schemas
 * @since 0.8.2
 */
export const EventWaitInput = Schema.Struct({
  timeoutMs: Schema.OptionFromOptionalKey(HerdrMilliseconds),
});

/**
 * Normalized server-owned event wait options.
 *
 * @category models
 * @since 0.8.2
 */
export interface EventWaitInput extends Schema.Schema.Type<typeof EventWaitInput> {}

/**
 * Ergonomic server-owned event wait options.
 *
 * @category models
 * @since 0.8.2
 */
export interface EventWaitInputEncoded extends Schema.Codec.Encoded<typeof EventWaitInput> {}

/**
 * Operating system supported by a plugin command.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginPlatform = Schema.Literals(["linux", "macos", "windows"]);

/**
 * Operating system supported by a plugin command.
 *
 * @category models
 * @since 0.8.2
 */
export type PluginPlatform = typeof PluginPlatform.Type;

/**
 * Invocation context supported by a plugin action.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginActionContext = Schema.Literals([
  "global",
  "workspace",
  "tab",
  "pane",
  "selection",
]);

/**
 * Invocation context supported by a plugin action.
 *
 * @category models
 * @since 0.8.2
 */
export type PluginActionContext = typeof PluginActionContext.Type;

/**
 * Placement used by a plugin-owned pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginPanePlacement = Schema.Literals(["overlay", "popup", "split", "tab", "zoomed"]);

/**
 * Placement used by a plugin-owned pane.
 *
 * @category models
 * @since 0.8.2
 */
export type PluginPanePlacement = typeof PluginPanePlacement.Type;

/**
 * Managed or local source metadata for an installed plugin.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginSource = Schema.Struct({
  kind: Schema.optionalKey(Schema.Literals(["local", "github"])).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("local"), {
      encodingStrategy: "omit",
    }),
  ),
  owner: optionalString,
  repo: optionalString,
  subdir: optionalString,
  requestedRef: optionalString,
  resolvedCommit: optionalString,
  managedPath: optionalAbsolutePath,
  installedUnixMs: Schema.OptionFromOptionalNullOr(HerdrUnixMilliseconds),
}).pipe(
  Schema.encodeKeys({
    requestedRef: "requested_ref",
    resolvedCommit: "resolved_commit",
    managedPath: "managed_path",
    installedUnixMs: "installed_unix_ms",
  }),
);

/**
 * Managed or local source metadata for an installed plugin.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginSource extends Schema.Schema.Type<typeof PluginSource> {}

/**
 * Platform-scoped command declared by a plugin manifest.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginManifestCommand = Schema.Struct({
  platforms: Schema.OptionFromOptionalNullOr(Schema.Array(PluginPlatform)),
  command: Schema.Array(Schema.String),
});

/**
 * Platform-scoped command declared by a plugin manifest.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginManifestCommand extends Schema.Schema.Type<typeof PluginManifestCommand> {}

/**
 * Action declared by a plugin manifest.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginManifestAction = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: optionalString,
  contexts: Schema.Array(PluginActionContext),
  platforms: Schema.OptionFromOptionalNullOr(Schema.Array(PluginPlatform)),
  command: Schema.Array(Schema.String),
});

/**
 * Action declared by a plugin manifest.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginManifestAction extends Schema.Schema.Type<typeof PluginManifestAction> {}

/**
 * Event hook declared by a plugin manifest.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginManifestEventHook = Schema.Struct({
  on: Schema.String,
  platforms: Schema.OptionFromOptionalNullOr(Schema.Array(PluginPlatform)),
  command: Schema.Array(Schema.String),
});

/**
 * Event hook declared by a plugin manifest.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginManifestEventHook extends Schema.Schema.Type<
  typeof PluginManifestEventHook
> {}

/**
 * Pane entrypoint declared by a plugin manifest.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginManifestPane = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: optionalString,
  platforms: Schema.OptionFromOptionalNullOr(Schema.Array(PluginPlatform)),
  placement: PluginPanePlacement,
  width: Schema.OptionFromOptionalNullOr(HerdrPopupSize),
  height: Schema.OptionFromOptionalNullOr(HerdrPopupSize),
  command: Schema.Array(Schema.String),
});

/**
 * Pane entrypoint declared by a plugin manifest.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginManifestPane extends Schema.Schema.Type<typeof PluginManifestPane> {}

/**
 * URL link handler declared by a plugin manifest.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginManifestLinkHandler = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  pattern: Schema.String,
  action: Schema.String,
  platforms: Schema.OptionFromOptionalNullOr(Schema.Array(PluginPlatform)),
});

/**
 * URL link handler declared by a plugin manifest.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginManifestLinkHandler extends Schema.Schema.Type<
  typeof PluginManifestLinkHandler
> {}

/**
 * Fully resolved installed plugin.
 *
 * @category schemas
 * @since 0.8.2
 */
export const InstalledPlugin = Schema.Struct({
  id: PluginId,
  name: Schema.String,
  version: Schema.String,
  minHerdrVersion: Schema.optionalKey(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(""), { encodingStrategy: "omit" }),
  ),
  description: optionalString,
  manifestPath: HerdrAbsolutePath,
  root: HerdrAbsolutePath,
  enabled: Schema.Boolean,
  platforms: Schema.OptionFromOptionalNullOr(Schema.Array(PluginPlatform)),
  build: Schema.optionalKey(Schema.Array(PluginManifestCommand)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  startup: Schema.optionalKey(Schema.Array(PluginManifestCommand)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  actions: Schema.optionalKey(Schema.Array(PluginManifestAction)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  events: Schema.optionalKey(Schema.Array(PluginManifestEventHook)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  panes: Schema.optionalKey(Schema.Array(PluginManifestPane)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  linkHandlers: Schema.optionalKey(Schema.Array(PluginManifestLinkHandler)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  source: Schema.optionalKey(PluginSource).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ kind: "local" }), { encodingStrategy: "omit" }),
  ),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
}).pipe(
  Schema.encodeKeys({
    id: "plugin_id",
    minHerdrVersion: "min_herdr_version",
    manifestPath: "manifest_path",
    root: "plugin_root",
    linkHandlers: "link_handlers",
  }),
);

/**
 * Fully resolved installed plugin.
 *
 * @category models
 * @since 0.8.2
 */
export interface InstalledPlugin extends Schema.Schema.Type<typeof InstalledPlugin> {}

/**
 * Resolved plugin action.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginAction = Schema.Struct({
  pluginId: PluginId,
  id: PluginActionId,
  title: Schema.String,
  description: optionalString,
  contexts: Schema.optionalKey(Schema.Array(PluginActionContext)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]), { encodingStrategy: "omit" }),
  ),
  command: Schema.Array(Schema.String),
  platforms: Schema.OptionFromOptionalNullOr(Schema.Array(PluginPlatform)),
}).pipe(Schema.encodeKeys({ pluginId: "plugin_id", id: "action_id" }));

/**
 * Resolved plugin action.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginAction extends Schema.Schema.Type<typeof PluginAction> {}

/**
 * Runtime context passed to a plugin action.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginInvocationContext = Schema.Struct({
  workspaceId: Schema.OptionFromOptionalNullOr(WorkspaceId),
  workspaceLabel: optionalString,
  workspaceCwd: optionalAbsolutePath,
  worktree: Schema.OptionFromOptionalNullOr(WorkspaceWorktree),
  tabId: Schema.OptionFromOptionalNullOr(TabId),
  tabLabel: optionalString,
  focusedPaneId: Schema.OptionFromOptionalNullOr(PaneId),
  focusedPaneCwd: optionalAbsolutePath,
  focusedPaneAgent: optionalString,
  focusedPaneStatus: Schema.OptionFromOptionalNullOr(AgentStatus),
  selectedText: optionalString,
  invocationSource: optionalString,
  correlationId: optionalString,
  clickedUrl: optionalString,
  linkHandlerId: optionalString,
}).pipe(
  Schema.encodeKeys({
    workspaceId: "workspace_id",
    workspaceLabel: "workspace_label",
    workspaceCwd: "workspace_cwd",
    tabId: "tab_id",
    tabLabel: "tab_label",
    focusedPaneId: "focused_pane_id",
    focusedPaneCwd: "focused_pane_cwd",
    focusedPaneAgent: "focused_pane_agent",
    focusedPaneStatus: "focused_pane_status",
    selectedText: "selected_text",
    invocationSource: "invocation_source",
    correlationId: "correlation_id",
    clickedUrl: "clicked_url",
    linkHandlerId: "link_handler_id",
  }),
);

/**
 * Runtime context passed to a plugin action.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginInvocationContext extends Schema.Schema.Type<
  typeof PluginInvocationContext
> {}

/**
 * Camel-case plugin invocation context accepted from SDK callers.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginInvocationContextInput = Schema.Struct({
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  workspaceLabel: Schema.OptionFromOptionalKey(Schema.String),
  workspaceCwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  worktree: Schema.OptionFromOptionalKey(WorkspaceWorktree),
  tabId: Schema.OptionFromOptionalKey(TabId),
  tabLabel: Schema.OptionFromOptionalKey(Schema.String),
  focusedPaneId: Schema.OptionFromOptionalKey(PaneId),
  focusedPaneCwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  focusedPaneAgent: Schema.OptionFromOptionalKey(Schema.String),
  focusedPaneStatus: Schema.OptionFromOptionalKey(AgentStatus),
  selectedText: Schema.OptionFromOptionalKey(Schema.String),
  invocationSource: Schema.OptionFromOptionalKey(Schema.String),
  correlationId: Schema.OptionFromOptionalKey(Schema.String),
  clickedUrl: Schema.OptionFromOptionalKey(Schema.String),
  linkHandlerId: Schema.OptionFromOptionalKey(Schema.String),
});

/**
 * Normalized camel-case plugin invocation context.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginInvocationContextInput extends Schema.Schema.Type<
  typeof PluginInvocationContextInput
> {}

/**
 * One plugin command execution log.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginCommandLog = Schema.Struct({
  id: PluginLogId,
  pluginId: PluginId,
  actionId: Schema.OptionFromOptionalNullOr(PluginActionId),
  event: optionalString,
  command: Schema.Array(Schema.String),
  status: Schema.Literals(["running", "succeeded", "failed"]),
  startedUnixMs: HerdrUnixMilliseconds,
  finishedUnixMs: Schema.OptionFromOptionalNullOr(HerdrUnixMilliseconds),
  exitCode: Schema.OptionFromOptionalNullOr(Schema.Finite.check(Schema.isInt())),
  stdout: optionalString,
  stderr: optionalString,
  error: optionalString,
}).pipe(
  Schema.encodeKeys({
    id: "log_id",
    pluginId: "plugin_id",
    actionId: "action_id",
    startedUnixMs: "started_unix_ms",
    finishedUnixMs: "finished_unix_ms",
    exitCode: "exit_code",
  }),
);

/**
 * One plugin command execution log.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginCommandLog extends Schema.Schema.Type<typeof PluginCommandLog> {}

/**
 * Completed plugin action invocation.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginActionInvocation = Schema.Struct({
  action: PluginAction,
  context: PluginInvocationContext,
  log: PluginCommandLog,
});

/**
 * Completed plugin action invocation.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginActionInvocation extends Schema.Schema.Type<typeof PluginActionInvocation> {}

/**
 * Open plugin pane and its owning entrypoint.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginPane = Schema.Struct({
  pluginId: PluginId,
  entrypoint: Schema.String,
  pane: Pane,
}).pipe(Schema.encodeKeys({ pluginId: "plugin_id" }));

/**
 * Open plugin pane and its owning entrypoint.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginPane extends Schema.Schema.Type<typeof PluginPane> {}

/**
 * Plugin link source supplied by the caller.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginSourceInput = Schema.Struct({
  kind: Schema.OptionFromOptionalKey(Schema.Literals(["local", "github"])),
  owner: Schema.OptionFromOptionalKey(Schema.String),
  repo: Schema.OptionFromOptionalKey(Schema.String),
  subdir: Schema.OptionFromOptionalKey(Schema.String),
  requestedRef: Schema.OptionFromOptionalKey(Schema.String),
  resolvedCommit: Schema.OptionFromOptionalKey(Schema.String),
  managedPath: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  installedUnixMs: Schema.OptionFromOptionalKey(HerdrUnixMilliseconds),
});

/**
 * Normalized plugin link source.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginSourceInput extends Schema.Schema.Type<typeof PluginSourceInput> {}

/**
 * Plugin link request.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginLinkInput = Schema.Struct({
  path: HerdrAbsolutePath,
  enabled: Schema.OptionFromOptionalKey(Schema.Boolean),
  source: Schema.OptionFromOptionalKey(PluginSourceInput),
});

/**
 * Normalized plugin link request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginLinkInput extends Schema.Schema.Type<typeof PluginLinkInput> {}

/**
 * Ergonomic plugin link request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginLinkInputEncoded extends Schema.Codec.Encoded<typeof PluginLinkInput> {}

/**
 * Optional plugin filter.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginFilterInput = Schema.Struct({
  pluginId: Schema.OptionFromOptionalKey(PluginId),
});

/**
 * Normalized plugin filter.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginFilterInput extends Schema.Schema.Type<typeof PluginFilterInput> {}

/**
 * Ergonomic plugin filter.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginFilterInputEncoded extends Schema.Codec.Encoded<typeof PluginFilterInput> {}

/**
 * Optional plugin and invocation context for an action.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginActionInvokeInput = Schema.Struct({
  pluginId: Schema.OptionFromOptionalKey(PluginId),
  context: Schema.OptionFromOptionalKey(PluginInvocationContextInput),
});

/**
 * Normalized plugin action invocation input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginActionInvokeInput extends Schema.Schema.Type<
  typeof PluginActionInvokeInput
> {}

/**
 * Ergonomic plugin action invocation input.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginActionInvokeInputEncoded extends Schema.Codec.Encoded<
  typeof PluginActionInvokeInput
> {}

/**
 * Plugin command-log list filter.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginLogListInput = Schema.Struct({
  pluginId: Schema.OptionFromOptionalKey(PluginId),
  limit: Schema.OptionFromOptionalKey(Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

/**
 * Normalized plugin command-log list filter.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginLogListInput extends Schema.Schema.Type<typeof PluginLogListInput> {}

/**
 * Ergonomic plugin command-log list filter.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginLogListInputEncoded extends Schema.Codec.Encoded<
  typeof PluginLogListInput
> {}

/**
 * Plugin pane open request.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginPaneOpenInput = Schema.Struct({
  entrypoint: Schema.String,
  placement: Schema.OptionFromOptionalKey(PluginPanePlacement),
  width: Schema.OptionFromOptionalKey(HerdrPopupSize),
  height: Schema.OptionFromOptionalKey(HerdrPopupSize),
  workspaceId: Schema.OptionFromOptionalKey(WorkspaceId),
  targetPaneId: Schema.OptionFromOptionalKey(PaneId),
  direction: Schema.OptionFromOptionalKey(SplitDirection),
  cwd: Schema.OptionFromOptionalKey(HerdrAbsolutePath),
  focus: Schema.OptionFromOptionalKey(Schema.Boolean),
  env: Schema.OptionFromOptionalKey(HerdrEnvironment),
});

/**
 * Normalized plugin pane open request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginPaneOpenInput extends Schema.Schema.Type<typeof PluginPaneOpenInput> {}

/**
 * Ergonomic plugin pane open request.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginPaneOpenInputEncoded extends Schema.Codec.Encoded<
  typeof PluginPaneOpenInput
> {}

/**
 * Plugin unlink outcome.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginUnlinkResult = Schema.Struct({
  pluginId: PluginId,
  removed: Schema.Boolean,
}).pipe(Schema.encodeKeys({ pluginId: "plugin_id" }));

/**
 * Plugin unlink outcome.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginUnlinkResult extends Schema.Schema.Type<typeof PluginUnlinkResult> {}

/**
 * Closed plugin pane identifier.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginPaneCloseResult = Schema.Struct({
  paneId: PaneId,
}).pipe(Schema.encodeKeys({ paneId: "pane_id" }));

/**
 * Closed plugin pane identifier.
 *
 * @category models
 * @since 0.8.2
 */
export interface PluginPaneCloseResult extends Schema.Schema.Type<typeof PluginPaneCloseResult> {}
