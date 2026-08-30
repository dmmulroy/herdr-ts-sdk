import { isAbsolute } from "node:path";
import { Schema } from "effect";

const NonEmptyHerdrIdentifier = Schema.String.check(Schema.isMinLength(1));
const HerdrNaturalNumber = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

/** Environment variables supplied to a newly created Herdr process. */
export const HerdrEnvironment = Schema.Record(Schema.String, Schema.String);

/** Environment variables supplied to a newly created Herdr process. */
export type HerdrEnvironment = typeof HerdrEnvironment.Type;

/** String metadata tokens reported by a Herdr resource owner. */
export const HerdrMetadataTokens = Schema.Record(Schema.String, Schema.String);

/** String metadata tokens reported by a Herdr resource owner. */
export type HerdrMetadataTokens = typeof HerdrMetadataTokens.Type;

/** Metadata token updates where null removes the named token. */
export const HerdrMetadataTokenPatch = Schema.Record(Schema.String, Schema.NullOr(Schema.String));

/** Metadata token updates where null removes the named token. */
export type HerdrMetadataTokenPatch = typeof HerdrMetadataTokenPatch.Type;

/** Immutable named-key sequence accepted by pane and agent input operations. */
export const HerdrKeySequence = Schema.Array(Schema.String);

/** Immutable named-key sequence accepted by pane and agent input operations. */
export type HerdrKeySequence = typeof HerdrKeySequence.Type;

/** Non-empty identifier for a Herdr workspace. */
export const WorkspaceId = NonEmptyHerdrIdentifier.pipe(Schema.brand("WorkspaceId"));

/** Non-empty identifier for a Herdr workspace. */
export type WorkspaceId = typeof WorkspaceId.Type;

/** Parses an external workspace identifier before it enters SDK services. */
export const parseWorkspaceId = Schema.decodeUnknownEffect(WorkspaceId);

/** Non-empty identifier for a Herdr tab. */
export const TabId = NonEmptyHerdrIdentifier.pipe(Schema.brand("TabId"));

/** Non-empty identifier for a Herdr tab. */
export type TabId = typeof TabId.Type;

/** Parses an external tab identifier before it enters SDK services. */
export const parseTabId = Schema.decodeUnknownEffect(TabId);

/** Non-empty identifier for a Herdr pane. */
export const PaneId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PaneId"));

/** Non-empty identifier for a Herdr pane. */
export type PaneId = typeof PaneId.Type;

/** Parses an external pane identifier before it enters SDK services. */
export const parsePaneId = Schema.decodeUnknownEffect(PaneId);

/** Non-empty identifier for a Herdr terminal. */
export const TerminalId = NonEmptyHerdrIdentifier.pipe(Schema.brand("TerminalId"));

/** Non-empty identifier for a Herdr terminal. */
export type TerminalId = typeof TerminalId.Type;

/** Parses an external terminal identifier before it enters SDK services. */
export const parseTerminalId = Schema.decodeUnknownEffect(TerminalId);

/** Non-empty identifier for an installed Herdr plugin. */
export const PluginId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PluginId"));

/** Non-empty identifier for an installed Herdr plugin. */
export type PluginId = typeof PluginId.Type;

/** Parses an external plugin identifier before it enters SDK services. */
export const parsePluginId = Schema.decodeUnknownEffect(PluginId);

/** Non-empty identifier for a Herdr plugin action. */
export const PluginActionId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PluginActionId"));

/** Non-empty identifier for a Herdr plugin action. */
export type PluginActionId = typeof PluginActionId.Type;

/** Parses an external plugin action identifier before it enters SDK services. */
export const parsePluginActionId = Schema.decodeUnknownEffect(PluginActionId);

/** Non-empty identifier for a Herdr plugin command log. */
export const PluginLogId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PluginLogId"));

/** Non-empty identifier for a Herdr plugin command log. */
export type PluginLogId = typeof PluginLogId.Type;

/** Parses an external plugin command-log identifier before it enters SDK services. */
export const parsePluginLogId = Schema.decodeUnknownEffect(PluginLogId);

/** Non-empty caller-assigned name for a Herdr agent. */
export const AgentName = NonEmptyHerdrIdentifier.pipe(Schema.brand("AgentName"));

/** Non-empty caller-assigned name for a Herdr agent. */
export type AgentName = typeof AgentName.Type;

/** Parses an external agent name before it enters SDK services. */
export const parseAgentName = Schema.decodeUnknownEffect(AgentName);

/** Absolute filesystem path accepted by Herdr SDK operations and configuration. */
export const HerdrAbsolutePath = Schema.String.check(
  Schema.makeFilter((value) => (isAbsolute(value) ? undefined : "must be an absolute path")),
).pipe(Schema.brand("HerdrAbsolutePath"));

/** Absolute filesystem path accepted by Herdr SDK operations and configuration. */
export type HerdrAbsolutePath = typeof HerdrAbsolutePath.Type;

/** Parses an external absolute path before it enters SDK services. */
export const parseHerdrAbsolutePath = Schema.decodeUnknownEffect(HerdrAbsolutePath);

/** Herdr session name that cannot escape its session directory. */
export const HerdrSessionName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) =>
    value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\")
      ? undefined
      : "must not be '.', '..', or contain path separators",
  ),
).pipe(Schema.brand("HerdrSessionName"));

/** Herdr session name that cannot escape its session directory. */
export type HerdrSessionName = typeof HerdrSessionName.Type;

/** Parses an external session name before socket-path resolution. */
export const parseHerdrSessionName = Schema.decodeUnknownEffect(HerdrSessionName);

/** Finite, non-negative integer duration measured in milliseconds. */
export const HerdrMilliseconds = HerdrNaturalNumber.pipe(Schema.brand("HerdrMilliseconds"));

/** Finite, non-negative integer duration measured in milliseconds. */
export type HerdrMilliseconds = typeof HerdrMilliseconds.Type;

/** Parses an external millisecond duration before it enters SDK services. */
export const parseHerdrMilliseconds = Schema.decodeUnknownEffect(HerdrMilliseconds);

/** Finite, non-negative Unix timestamp measured in milliseconds. */
export const HerdrUnixMilliseconds = HerdrNaturalNumber.pipe(Schema.brand("HerdrUnixMilliseconds"));

/** Finite, non-negative Unix timestamp measured in milliseconds. */
export type HerdrUnixMilliseconds = typeof HerdrUnixMilliseconds.Type;

/** Parses an external Unix millisecond timestamp. */
export const parseHerdrUnixMilliseconds = Schema.decodeUnknownEffect(HerdrUnixMilliseconds);

/** Finite, non-negative Unix timestamp measured in seconds. */
export const HerdrUnixSeconds = HerdrNaturalNumber.pipe(Schema.brand("HerdrUnixSeconds"));

/** Finite, non-negative Unix timestamp measured in seconds. */
export type HerdrUnixSeconds = typeof HerdrUnixSeconds.Type;

/** Parses an external Unix second timestamp. */
export const parseHerdrUnixSeconds = Schema.decodeUnknownEffect(HerdrUnixSeconds);

/** Finite, non-negative pane-output revision. */
export const HerdrRevision = HerdrNaturalNumber.pipe(Schema.brand("HerdrRevision"));

/** Finite, non-negative pane-output revision. */
export type HerdrRevision = typeof HerdrRevision.Type;

/** Parses an external pane-output revision. */
export const parseHerdrRevision = Schema.decodeUnknownEffect(HerdrRevision);

/** Finite, non-negative sequence used to order reported agent state. */
export const HerdrStateChangeSequence = HerdrNaturalNumber.pipe(
  Schema.brand("HerdrStateChangeSequence"),
);

/** Finite, non-negative sequence used to order reported agent state. */
export type HerdrStateChangeSequence = typeof HerdrStateChangeSequence.Type;

/** Parses an external agent state-change sequence. */
export const parseHerdrStateChangeSequence = Schema.decodeUnknownEffect(HerdrStateChangeSequence);

/** Finite split ratio strictly between zero and one. */
export const HerdrSplitRatio = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true, exclusiveMaximum: true }),
).pipe(Schema.brand("HerdrSplitRatio"));

/** Finite split ratio strictly between zero and one. */
export type HerdrSplitRatio = typeof HerdrSplitRatio.Type;

/** Parses an external split ratio before it enters layout or pane services. */
export const parseHerdrSplitRatio = Schema.decodeUnknownEffect(HerdrSplitRatio);

/** Metadata time-to-live between one millisecond and one day, inclusive. */
export const HerdrMetadataTtl = Schema.Finite.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 86_400_000 }),
).pipe(Schema.brand("HerdrMetadataTtl"));

/** Metadata time-to-live between one millisecond and one day, inclusive. */
export type HerdrMetadataTtl = typeof HerdrMetadataTtl.Type;

/** Parses an external metadata time-to-live before report operations. */
export const parseHerdrMetadataTtl = Schema.decodeUnknownEffect(HerdrMetadataTtl);

/** Non-negative insertion index used by ordered workspace and tab operations. */
export const HerdrInsertIndex = HerdrNaturalNumber.pipe(Schema.brand("HerdrInsertIndex"));

/** Non-negative insertion index used by ordered workspace and tab operations. */
export type HerdrInsertIndex = typeof HerdrInsertIndex.Type;

/** Parses an external insertion index before it enters ordering services. */
export const parseHerdrInsertIndex = Schema.decodeUnknownEffect(HerdrInsertIndex);

/** Positive integer image dimension measured in pixels. */
export const HerdrImageDimension = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
).pipe(Schema.brand("HerdrImageDimension"));

/** Positive integer image dimension measured in pixels. */
export type HerdrImageDimension = typeof HerdrImageDimension.Type;

/** Parses an external image dimension before graphics I/O. */
export const parseHerdrImageDimension = Schema.decodeUnknownEffect(HerdrImageDimension);

/** Non-negative image payload size measured in bytes. */
export const HerdrByteLength = HerdrNaturalNumber.pipe(Schema.brand("HerdrByteLength"));

/** Non-negative image payload size measured in bytes. */
export type HerdrByteLength = typeof HerdrByteLength.Type;

/** Parses an external byte length before graphics I/O. */
export const parseHerdrByteLength = Schema.decodeUnknownEffect(HerdrByteLength);

/** Popup size in terminal cells or an integer percentage from one through one hundred. */
export const HerdrPopupSize = Schema.Union([
  Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 65_535 })),
  Schema.String.check(Schema.isPattern(/^(100|[1-9][0-9]?)%$/)),
]);

/** Popup size in terminal cells or an integer percentage from one through one hundred. */
export type HerdrPopupSize = typeof HerdrPopupSize.Type;

/** Parses an external popup size before plugin pane operations. */
export const parseHerdrPopupSize = Schema.decodeUnknownEffect(HerdrPopupSize);

/** Pure schema-owned helpers for constructing branded Herdr identifiers and paths. */
export interface IHerdrIds {
  /** Constructs a non-empty workspace identifier. */
  readonly workspace: (value: string) => WorkspaceId;
  /** Constructs a non-empty tab identifier. */
  readonly tab: (value: string) => TabId;
  /** Constructs a non-empty pane identifier. */
  readonly pane: (value: string) => PaneId;
  /** Constructs a non-empty terminal identifier. */
  readonly terminal: (value: string) => TerminalId;
  /** Constructs a non-empty plugin identifier. */
  readonly plugin: (value: string) => PluginId;
  /** Constructs a non-empty plugin action identifier. */
  readonly pluginAction: (value: string) => PluginActionId;
  /** Constructs a non-empty plugin command-log identifier. */
  readonly pluginLog: (value: string) => PluginLogId;
  /** Constructs a non-empty agent name. */
  readonly agentName: (value: string) => AgentName;
  /** Constructs an absolute filesystem path. */
  readonly absolutePath: (value: string) => HerdrAbsolutePath;
}

/** Pure schema-owned constructors exposed as `herdr.ids`. */
export const herdrIds: IHerdrIds = {
  workspace: Schema.decodeUnknownSync(WorkspaceId),
  tab: Schema.decodeUnknownSync(TabId),
  pane: Schema.decodeUnknownSync(PaneId),
  terminal: Schema.decodeUnknownSync(TerminalId),
  plugin: Schema.decodeUnknownSync(PluginId),
  pluginAction: Schema.decodeUnknownSync(PluginActionId),
  pluginLog: Schema.decodeUnknownSync(PluginLogId),
  agentName: Schema.decodeUnknownSync(AgentName),
  absolutePath: Schema.decodeUnknownSync(HerdrAbsolutePath),
};
