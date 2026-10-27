/**
 * Models the generation-1 client-shell projection and presentation contract.
 * Endpoint, projection, surface, and terminal-content identities are intentionally distinct.
 * @since 0.9.0
 */
import { Schema, SchemaGetter, SchemaTransformation, Struct } from "effect";
import {
  AgentName,
  HerdrCommandId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from "./herdr-domain.ts";
import { AgentStatus, AgentViewSetInput, type AgentViewSetInputEncoded } from "./herdr-models.ts";
import { PaneContentRevision } from "./herdr-pane-interaction-models.ts";

const U16 = Schema.Natural.check(Schema.isLessThanOrEqualTo(65535));
const U32 = Schema.Natural.check(Schema.isLessThanOrEqualTo(0xffff_ffff));
const SafeNatural = Schema.Natural.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const optionalText = Schema.OptionFromOptionalNullOr(Schema.String);
const TextPairs = Schema.Array(Schema.Tuple([Schema.String, Schema.String]));
const unknownEndpointValue = Schema.String.pipe(
  Schema.decodeTo(Schema.Literal("unknown"), {
    decode: SchemaGetter.succeed("unknown"),
    encode: SchemaGetter.succeed("Unknown"),
  }),
);
const endpointAgentStatus = Schema.Union([AgentStatus, unknownEndpointValue]);

/** Identifies one endpoint process boot; changes on server restart. @category schemas @since 0.9.0 */
export const EndpointBootId = Schema.NonEmptyString.pipe(Schema.brand("EndpointBootId"));
/** Parsed endpoint boot identity. @category models @since 0.9.0 */
export type EndpointBootId = typeof EndpointBootId.Type;
/** Replacement projection revision within one boot. @category schemas @since 0.9.0 */
export const ProjectionRevision = SafeNatural.pipe(Schema.brand("ProjectionRevision"));
/** Parsed projection revision. @category models @since 0.9.0 */
export type ProjectionRevision = typeof ProjectionRevision.Type;
/** Complete or incremental surface revision within one connection. @category schemas @since 0.9.0 */
export const SurfaceRevision = SafeNatural.pipe(Schema.brand("SurfaceRevision"));
/** Parsed surface revision. @category models @since 0.9.0 */
export type SurfaceRevision = typeof SurfaceRevision.Type;

/** Endpoint-owned linked-worktree display metadata. @category schemas @since 0.9.0 */
export const ClientShellWorktree = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  isLinkedWorktree: Schema.Boolean,
}).pipe(Schema.encodeKeys({ isLinkedWorktree: "is_linked_worktree" }));
/** Parsed shell worktree metadata. @category models @since 0.9.0 */
export type ClientShellWorktree = typeof ClientShellWorktree.Type;
/** Client-shell workspace projection, not an ordinary socket Workspace. @category schemas @since 0.9.0 */
export const ClientShellWorkspace = Schema.Struct({
  workspaceId: WorkspaceId,
  activeTabId: TabId,
  newWorkspaceCwd: Schema.String,
  number: SafeNatural,
  label: Schema.String,
  customLabel: Schema.Boolean,
  branch: optionalText,
  gitAheadBehind: Schema.OptionFromNullOr(Schema.Tuple([SafeNatural, SafeNatural])),
  tokens: TextPairs,
  worktree: Schema.OptionFromNullOr(ClientShellWorktree),
  focused: Schema.Boolean,
  agentStatus: endpointAgentStatus,
}).pipe(
  Schema.encodeKeys({
    workspaceId: "workspace_id",
    activeTabId: "active_tab_id",
    newWorkspaceCwd: "new_workspace_cwd",
    customLabel: "custom_label",
    gitAheadBehind: "git_ahead_behind",
    agentStatus: "agent_status",
  }),
);
/** Parsed shell workspace projection. @category models @since 0.9.0 */
export type ClientShellWorkspace = typeof ClientShellWorkspace.Type;
/** Tab metadata in a client-shell projection. @category schemas @since 0.9.0 */
export const ClientShellTab = Schema.Struct({
  tabId: TabId,
  workspaceId: WorkspaceId,
  number: SafeNatural,
  label: Schema.String,
  customLabel: Schema.Boolean,
  zoomed: Schema.Boolean,
  focused: Schema.Boolean,
  agentStatus: endpointAgentStatus,
}).pipe(
  Schema.encodeKeys({
    tabId: "tab_id",
    workspaceId: "workspace_id",
    customLabel: "custom_label",
    agentStatus: "agent_status",
  }),
);
/** Parsed shell tab projection. @category models @since 0.9.0 */
export type ClientShellTab = typeof ClientShellTab.Type;
/** Pane metadata in a client-shell projection. @category schemas @since 0.9.0 */
export const ClientShellPane = Schema.Struct({
  paneId: PaneId,
  workspaceId: WorkspaceId,
  tabId: TabId,
  label: optionalText,
  cwd: optionalText,
  foregroundCwd: optionalText,
  focused: Schema.Boolean,
  rightClickPassthrough: Schema.Boolean,
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    workspaceId: "workspace_id",
    tabId: "tab_id",
    foregroundCwd: "foreground_cwd",
    rightClickPassthrough: "right_click_passthrough",
  }),
);
/** Parsed shell pane projection. @category models @since 0.9.0 */
export type ClientShellPane = typeof ClientShellPane.Type;
/** Agent display state; each client owns its viewed-completion presentation. @category schemas @since 0.9.0 */
export const ClientShellAgent = Schema.Struct({
  paneId: PaneId,
  workspaceId: WorkspaceId,
  tabId: TabId,
  name: Schema.OptionFromOptionalNullOr(AgentName),
  displayAgent: optionalText,
  agent: optionalText,
  title: optionalText,
  terminalTitle: optionalText,
  terminalTitleStripped: optionalText,
  agentStatus: endpointAgentStatus,
  stateChangeSeq: SafeNatural,
  /**
   * Set when the current idle transition completed work (equal to that transition's
   * `stateChangeSeq`), from the endpoint's revision-bound completion companion.
   */
  completionSeq: Schema.OptionFromOptionalKey(SafeNatural),
  stateLabels: TextPairs,
  tokens: TextPairs,
  focused: Schema.Boolean,
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    workspaceId: "workspace_id",
    tabId: "tab_id",
    displayAgent: "display_agent",
    terminalTitle: "terminal_title",
    terminalTitleStripped: "terminal_title_stripped",
    agentStatus: "agent_status",
    stateChangeSeq: "state_change_seq",
    completionSeq: "completion_seq",
    stateLabels: "state_labels",
  }),
);
/** Parsed shell agent projection. @category models @since 0.9.0 */
export type ClientShellAgent = typeof ClientShellAgent.Type;
/** Extensible endpoint command action; unfamiliar actions remain unknown. @category schemas @since 0.9.0 */
export const ClientShellCommandAction = Schema.Union([
  Schema.Literal("Shell").transform("shell"),
  Schema.Literal("Pane").transform("pane"),
  Schema.Literal("Popup").transform("popup"),
  Schema.Literal("PluginAction").transform("pluginAction"),
  unknownEndpointValue,
]);
/** Parsed endpoint command action. @category models @since 0.9.0 */
export type ClientShellCommandAction = typeof ClientShellCommandAction.Type;
/** Opaque command identity and display labels; never executable command text. @category schemas @since 0.9.0 */
export const ClientShellCommand = Schema.Struct({
  commandId: HerdrCommandId,
  bindingLabel: Schema.String,
  bindingLabels: Schema.Array(Schema.String),
  action: ClientShellCommandAction,
  description: optionalText,
}).pipe(
  Schema.encodeKeys({
    commandId: "command_id",
    bindingLabel: "binding_label",
    bindingLabels: "binding_labels",
  }),
);
/** Parsed discovered command. @category models @since 0.9.0 */
export type ClientShellCommand = typeof ClientShellCommand.Type;
/** Current endpoint-owned product announcement. @category schemas @since 0.9.0 */
export const ClientShellProductAnnouncement = Schema.Struct({
  version: Schema.String,
  id: Schema.NonEmptyString,
  title: Schema.String,
  body: Schema.String,
  preview: Schema.Boolean,
});
/** Parsed current announcement. @category models @since 0.9.0 */
export type ClientShellProductAnnouncement = typeof ClientShellProductAnnouncement.Type;
/** Current endpoint-owned release notes. @category schemas @since 0.9.0 */
export const ClientShellReleaseNotes = Schema.Struct({
  version: Schema.String,
  body: Schema.String,
  preview: Schema.Boolean,
});
/** Parsed endpoint release notes. @category models @since 0.9.0 */
export type ClientShellReleaseNotes = typeof ClientShellReleaseNotes.Type;
/** Completed-work sequences by pane, bound to the projection with the same boot and revision. @category schemas @since 0.9.5 */
export const ClientShellAgentCompletions = Schema.Struct({
  bootId: EndpointBootId,
  revision: ProjectionRevision,
  completions: Schema.Record(Schema.String, SafeNatural),
}).pipe(Schema.encodeKeys({ bootId: "boot_id" }));
/** Parsed agent-completion companion. @category models @since 0.9.5 */
export type ClientShellAgentCompletions = typeof ClientShellAgentCompletions.Type;
/**
 * Agent-view companion envelope (`endpoint.agent-view.v1`) bound to the projection with the same
 * boot and revision. The view stays opaque JSON here; missing or null means the view was cleared.
 * @category schemas @since 0.9.5
 */
export const ClientShellAgentViewProjection = Schema.Struct({
  bootId: EndpointBootId,
  revision: ProjectionRevision,
  view: Schema.OptionFromOptionalNullOr(Schema.Json),
}).pipe(Schema.encodeKeys({ bootId: "boot_id" }));
/** Parsed agent-view companion envelope. @category models @since 0.9.5 */
export type ClientShellAgentViewProjection = typeof ClientShellAgentViewProjection.Type;
/**
 * Active agent view (filter and sort definition) for one projection: `none` when no view is set,
 * `active` with the decoded definition, or `unrecognized` when the server sent a view this SDK
 * cannot decode (for example a newer view-language addition).
 * @category schemas @since 0.9.5
 */
export const ClientShellAgentView: Schema.Codec<ClientShellAgentView, ClientShellAgentViewEncoded> =
  Schema.Union([
    Schema.Struct({ status: Schema.Literal("none") }),
    Schema.Struct({ status: Schema.Literal("active"), view: AgentViewSetInput }),
    Schema.Struct({ status: Schema.Literal("unrecognized") }),
  ]);
/** Parsed projection agent view. @category models @since 0.9.5 */
export type ClientShellAgentView =
  | { readonly status: "none" }
  | { readonly status: "active"; readonly view: AgentViewSetInput }
  | { readonly status: "unrecognized" };
/** Encoded projection agent view; the active view uses Herdr's wire agent-view keys. @category models @since 0.9.5 */
export type ClientShellAgentViewEncoded =
  | { readonly status: "none" }
  | { readonly status: "active"; readonly view: AgentViewSetInputEncoded }
  | { readonly status: "unrecognized" };
const noClientShellAgentView = (): ClientShellAgentView => ({ status: "none" });
// Mandatory `shell.snapshot.v1` payload only; companion-derived fields are attached afterwards.
const ClientShellSnapshotPayload = Schema.Struct({
  bootId: EndpointBootId,
  revision: ProjectionRevision,
  configDiagnostic: optionalText,
  productAnnouncement: Schema.OptionFromNullOr(ClientShellProductAnnouncement),
  updateAvailable: optionalText,
  updateInstallCommand: Schema.String,
  serverKeybindingsToml: optionalText,
  latestReleaseNotesAvailable: Schema.Boolean,
  integrationUpdatesAvailable: Schema.Boolean,
  worktreeDirectory: Schema.String,
  releaseNotes: Schema.OptionFromNullOr(ClientShellReleaseNotes),
  focusedWorkspaceId: Schema.OptionFromNullOr(WorkspaceId),
  focusedTabId: Schema.OptionFromNullOr(TabId),
  focusedPaneId: Schema.OptionFromNullOr(PaneId),
  tabBarRight: Schema.Array(Schema.Struct({ text: Schema.String, accent: Schema.Boolean })),
  tabBarRightSeparator: Schema.String,
  agentViewLabel: optionalText,
  agentOrder: Schema.Array(Schema.String),
  workspaces: Schema.Array(ClientShellWorkspace),
  tabs: Schema.Array(ClientShellTab),
  panes: Schema.Array(ClientShellPane),
  agents: Schema.Array(ClientShellAgent),
  commands: Schema.Array(ClientShellCommand),
}).pipe(
  Schema.encodeKeys({
    bootId: "boot_id",
    configDiagnostic: "config_diagnostic",
    productAnnouncement: "product_announcement",
    updateAvailable: "update_available",
    updateInstallCommand: "update_install_command",
    serverKeybindingsToml: "server_keybindings_toml",
    latestReleaseNotesAvailable: "latest_release_notes_available",
    integrationUpdatesAvailable: "integration_updates_available",
    worktreeDirectory: "worktree_directory",
    releaseNotes: "release_notes",
    focusedWorkspaceId: "focused_workspace_id",
    focusedTabId: "focused_tab_id",
    focusedPaneId: "focused_pane_id",
    tabBarRight: "tab_bar_right",
    tabBarRightSeparator: "tab_bar_right_separator",
    agentViewLabel: "agent_view_label",
    agentOrder: "agent_order",
  }),
);
/**
 * Whole replacement projection for one endpoint boot. Decoding a `shell.snapshot.v1` payload yields
 * `agentView: { status: "none" }`; the endpoint service attaches the snapshot's revision-bound
 * `endpoint.agent-view.v1` companion. `agentView` is SDK-derived: it is never read from or written
 * to the snapshot wire payload.
 * @category schemas @since 0.9.0
 */
export const ClientShellProjection = ClientShellSnapshotPayload.pipe(
  Schema.decodeTo(
    Schema.toType(
      ClientShellSnapshotPayload.to.mapFields(Struct.assign({ agentView: ClientShellAgentView })),
    ),
    SchemaTransformation.transform({
      decode: (snapshot) => ({ ...snapshot, agentView: noClientShellAgentView() }),
      encode: ({ agentView: _agentView, ...snapshot }) => snapshot,
    }),
  ),
);
/** Parsed immutable shell projection; commands remain meaningful only for its live boot. @category models @since 0.9.0 */
export type ClientShellProjection = typeof ClientShellProjection.Type;

/** Surface-relative rectangle measured in terminal cells. @category schemas @since 0.9.0 */
export const SurfaceRect = Schema.Struct({ x: U16, y: U16, width: U16, height: U16 });
/** Parsed cell rectangle. @category models @since 0.9.0 */
export type SurfaceRect = typeof SurfaceRect.Type;
/** One terminal cell with packed colors and an optional hyperlink index. @category schemas @since 0.9.0 */
export const ClientShellCell = Schema.Struct({
  symbol: Schema.String,
  fg: U32,
  bg: U32,
  modifier: U16,
  skip: Schema.Boolean,
  hyperlink: Schema.OptionFromNullOr(U32),
});
/** Parsed terminal cell. @category models @since 0.9.0 */
export type ClientShellCell = typeof ClientShellCell.Type;
/** Surface-relative cursor; shape is a DECSCUSR parameter. @category schemas @since 0.9.0 */
export const ClientShellCursor = Schema.Struct({
  x: U16,
  y: U16,
  visible: Schema.Boolean,
  shape: Schema.Natural.check(Schema.isLessThanOrEqualTo(255)),
});
/** Parsed terminal cursor. @category models @since 0.9.0 */
export type ClientShellCursor = typeof ClientShellCursor.Type;
/** Full row-major terminal frame, never applied to the host terminal automatically. @category schemas @since 0.9.0 */
export const ClientShellFrame = Schema.Struct({
  cells: Schema.Array(ClientShellCell),
  width: U16,
  height: U16,
  cursor: Schema.OptionFromNullOr(ClientShellCursor),
  hyperlinks: Schema.Array(Schema.String),
  graphics: Schema.Uint8Array,
}).check(
  Schema.makeFilter(
    (frame) =>
      frame.cells.length === frame.width * frame.height ||
      "Client-shell frame dimensions do not match cell count",
  ),
);
/** Parsed complete terminal frame. @category models @since 0.9.0 */
export type ClientShellFrame = typeof ClientShellFrame.Type;
/** Pane geometry and revision in one active surface. @category schemas @since 0.9.0 */
export const ClientShellSurfacePane = Schema.Struct({
  paneId: PaneId,
  contentRevision: PaneContentRevision,
  rect: SurfaceRect,
  innerRect: SurfaceRect,
  scrollbarRect: Schema.OptionFromNullOr(SurfaceRect),
  scroll: Schema.OptionFromNullOr(
    Schema.Struct({
      offsetFromBottom: SafeNatural,
      maxOffsetFromBottom: SafeNatural,
      viewportRows: SafeNatural,
    }),
  ),
  focused: Schema.Boolean,
  mouseReporting: Schema.Boolean,
  sgrPixelMouse: Schema.Boolean,
  alternateScreenActive: Schema.Boolean,
  pixelWidth: U32,
  pixelHeight: U32,
});
/** Parsed pane surface metadata. @category models @since 0.9.0 */
export type ClientShellSurfacePane = typeof ClientShellSurfacePane.Type;
/** Surface BSP split handle. @category schemas @since 0.9.0 */
export const ClientShellSurfaceSplit = Schema.Struct({
  direction: Schema.Literals(["horizontal", "vertical"]),
  pos: U16,
  area: SurfaceRect,
  hitRect: SurfaceRect,
  path: Schema.Array(Schema.Boolean),
});
/** Parsed surface split handle. @category models @since 0.9.0 */
export type ClientShellSurfaceSplit = typeof ClientShellSurfaceSplit.Type;
/** Graphics identity preserves the full 64-bit fingerprint as bigint. @category schemas @since 0.9.0 */
export const ClientShellGraphicsAssetKey = Schema.Struct({
  source: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("terminal"),
      target: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("pane"), paneId: PaneId }),
        Schema.Struct({ kind: Schema.Literal("popup"), terminalId: TerminalId }),
      ]),
      imageId: U32,
    }),
    Schema.Struct({ kind: Schema.Literal("paneLayer"), paneId: PaneId, layerId: Schema.String }),
  ]),
  imageWidth: U32,
  imageHeight: U32,
  format: Schema.Literals(["rgb", "rgba", "png"]),
  dataLength: SafeNatural,
  dataFingerprint: Schema.BigInt,
});
/** Parsed graphics asset identity. @category models @since 0.9.0 */
export type ClientShellGraphicsAssetKey = typeof ClientShellGraphicsAssetKey.Type;
/** Complete desired graphics scene with newly delivered bytes. @category schemas @since 0.9.0 */
export const ClientShellGraphicsScene = Schema.Struct({
  assets: Schema.Array(
    Schema.Struct({ key: ClientShellGraphicsAssetKey, data: Schema.Uint8Array }),
  ),
  placements: Schema.Array(
    Schema.Struct({
      asset: ClientShellGraphicsAssetKey,
      logicalPlacementId: U32,
      x: U16,
      y: U16,
      cols: U32,
      rows: U32,
      sourceX: U32,
      sourceY: U32,
      sourceWidth: U32,
      sourceHeight: U32,
      xOffset: U32,
      yOffset: U32,
      z: Schema.Int.check(Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 })),
      scrollbackOffset: U32,
    }),
  ),
  retainedAssets: Schema.Array(ClientShellGraphicsAssetKey),
});
/** Parsed graphics scene; consumers retain assets referenced by subsequent scenes. @category models @since 0.9.0 */
export type ClientShellGraphicsScene = typeof ClientShellGraphicsScene.Type;
const PopupSize = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("cells"), value: U16 }),
  Schema.Struct({
    kind: Schema.Literal("percent"),
    value: Schema.Natural.check(Schema.isLessThanOrEqualTo(255)),
  }),
]);
/** Popup terminal surface nested in an active client surface. @category schemas @since 0.9.0 */
export const ClientShellPopupSurface = Schema.Struct({
  terminalId: TerminalId,
  title: Schema.String,
  width: Schema.OptionFromNullOr(PopupSize),
  height: Schema.OptionFromNullOr(PopupSize),
  frame: ClientShellFrame,
  mouseReporting: Schema.Boolean,
  sgrPixelMouse: Schema.Boolean,
  pixelWidth: U32,
  pixelHeight: U32,
});
/** Parsed popup surface. @category models @since 0.9.0 */
export type ClientShellPopupSurface = typeof ClientShellPopupSurface.Type;
/** Complete active-tab surface tied to boot, projection, and surface revisions. @category schemas @since 0.9.0 */
export const ClientShellSurface = Schema.Struct({
  bootId: EndpointBootId,
  projectionRevision: ProjectionRevision,
  surfaceRevision: SurfaceRevision,
  frame: ClientShellFrame,
  panes: Schema.Array(ClientShellSurfacePane),
  splits: Schema.Array(ClientShellSurfaceSplit),
  popup: Schema.OptionFromNullOr(ClientShellPopupSurface),
  graphics: ClientShellGraphicsScene,
});
/** Parsed active-tab surface. @category models @since 0.9.0 */
export type ClientShellSurface = typeof ClientShellSurface.Type;
/** Incremental update requiring an exact previously accepted base surface. @category schemas @since 0.9.0 */
export const ClientShellSurfacePatch = Schema.Struct({
  bootId: EndpointBootId,
  projectionRevision: ProjectionRevision,
  baseSurfaceRevision: SurfaceRevision,
  surfaceRevision: SurfaceRevision,
  rows: Schema.Array(Schema.Struct({ x: U16, y: U16, cells: Schema.Array(ClientShellCell) })),
  panes: Schema.Array(ClientShellSurfacePane),
  cursor: Schema.OptionFromNullOr(ClientShellCursor),
});
/** Parsed incremental surface update. @category models @since 0.9.0 */
export type ClientShellSurfacePatch = typeof ClientShellSurfacePatch.Type;
/** Surface-interest acknowledgement is not a presentation-delivery acknowledgement. @category schemas @since 0.9.0 */
export const ClientShellSurfaceAcknowledgement = Schema.Struct({
  active: Schema.Boolean,
  projectionRevision: ProjectionRevision,
}).pipe(Schema.encodeKeys({ projectionRevision: "projection_revision" }));
/** Parsed surface-interest acknowledgement. @category models @since 0.9.0 */
export type ClientShellSurfaceAcknowledgement = typeof ClientShellSurfaceAcknowledgement.Type;

/** Observable surface lifecycle; acknowledgement and presentation readiness are distinct. @category schemas @since 0.9.0 */
export const ClientShellSurfaceState = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["inactive", "activating", "deactivating", "closed"]) }),
  Schema.Struct({
    status: Schema.Literal("awaitingSurface"),
    bootId: EndpointBootId,
    projectionFloor: ProjectionRevision,
  }),
  Schema.Struct({
    status: Schema.Literal("active"),
    bootId: EndpointBootId,
    projectionFloor: ProjectionRevision,
    surface: ClientShellSurface,
  }),
]);
/** Parsed surface lifecycle state. @category models @since 0.9.0 */
export type ClientShellSurfaceState = typeof ClientShellSurfaceState.Type;

/** Ephemeral host presentation instructions; the SDK never executes clipboard, sound, or terminal effects itself. @category schemas @since 0.9.0 */
export const ClientShellPresentationEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("graphics"), bytes: Schema.Uint8Array }),
  Schema.Struct({
    kind: Schema.Literal("notify"),
    delivery: Schema.Literals(["sound", "toast", "systemToast"]),
    message: Schema.String,
    body: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("clipboard"), data: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("windowTitle"), title: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("reloadSoundConfig") }),
  Schema.Struct({
    kind: Schema.Literal("mouseCapture"),
    enabled: Schema.Boolean,
    sgrPixels: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("terminalBell"), count: U16 }),
  Schema.Struct({
    kind: Schema.Literal("keyboardProtocol"),
    flags: U16,
    modifyOtherKeysLevel: U16,
  }),
  Schema.Struct({ kind: Schema.Literal("keyboardReportAll"), enabled: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("notification"),
    notification: Schema.Struct({
      kind: Schema.Literals(["needsAttention", "finished", "updateInstalled", "custom"]),
      title: Schema.String,
      body: Schema.NullOr(Schema.String),
      sound: Schema.NullOr(Schema.Literals(["done", "request"])),
      agent: Schema.NullOr(Schema.String),
      workspaceId: Schema.NullOr(WorkspaceId),
      tabId: Schema.NullOr(TabId),
      paneId: Schema.NullOr(PaneId),
      position: Schema.NullOr(
        Schema.Literals(["topLeft", "topRight", "bottomLeft", "bottomRight"]),
      ),
    }),
  }),
]);
/** Parsed live host-presentation event. @category models @since 0.9.0 */
export type ClientShellPresentationEvent = typeof ClientShellPresentationEvent.Type;
