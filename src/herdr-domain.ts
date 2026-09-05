/**
 * Defines schema-owned primitive values used throughout the Herdr SDK.
 *
 * Branded identifiers, paths, units, sizes, metadata, and parser functions keep external primitives from entering services without normalization.
 *
 * @since 0.8.2
 */
import { isAbsolute } from "node:path";
import { Schema } from "effect";

const NonEmptyHerdrIdentifier = Schema.String.check(Schema.isMinLength(1));
const HerdrNaturalNumber = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

/**
 * Environment variables supplied to a newly created Herdr process.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrEnvironment = Schema.Record(Schema.String, Schema.String);

/**
 * Environment variables supplied to a newly created Herdr process.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrEnvironment = typeof HerdrEnvironment.Type;

/**
 * String metadata tokens reported by a Herdr resource owner.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrMetadataTokens = Schema.Record(Schema.String, Schema.String);

/**
 * String metadata tokens reported by a Herdr resource owner.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrMetadataTokens = typeof HerdrMetadataTokens.Type;

/**
 * Metadata token updates where null removes the named token.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrMetadataTokenPatch = Schema.Record(Schema.String, Schema.NullOr(Schema.String));

/**
 * Metadata token updates where null removes the named token.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrMetadataTokenPatch = typeof HerdrMetadataTokenPatch.Type;

/**
 * Immutable named-key sequence accepted by pane and agent input operations.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrKeySequence = Schema.Array(Schema.String);

/**
 * Immutable named-key sequence accepted by pane and agent input operations.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrKeySequence = typeof HerdrKeySequence.Type;

/**
 * Non-empty identifier for a Herdr workspace.
 *
 * @category schemas
 * @since 0.8.2
 */
export const WorkspaceId = NonEmptyHerdrIdentifier.pipe(Schema.brand("WorkspaceId"));

/**
 * Non-empty identifier for a Herdr workspace.
 *
 * @category models
 * @since 0.8.2
 */
export type WorkspaceId = typeof WorkspaceId.Type;

/**
 * Parses an external workspace identifier before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseWorkspaceId = Schema.decodeUnknownEffect(WorkspaceId);

/**
 * Non-empty identifier for a Herdr tab.
 *
 * @category schemas
 * @since 0.8.2
 */
export const TabId = NonEmptyHerdrIdentifier.pipe(Schema.brand("TabId"));

/**
 * Non-empty identifier for a Herdr tab.
 *
 * @category models
 * @since 0.8.2
 */
export type TabId = typeof TabId.Type;

/**
 * Parses an external tab identifier before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseTabId = Schema.decodeUnknownEffect(TabId);

/**
 * Non-empty identifier for a Herdr pane.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PaneId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PaneId"));

/**
 * Non-empty identifier for a Herdr pane.
 *
 * @category models
 * @since 0.8.2
 */
export type PaneId = typeof PaneId.Type;

/**
 * Parses an external pane identifier before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parsePaneId = Schema.decodeUnknownEffect(PaneId);

/**
 * Non-empty identifier for a Herdr terminal.
 *
 * @category schemas
 * @since 0.8.2
 */
export const TerminalId = NonEmptyHerdrIdentifier.pipe(Schema.brand("TerminalId"));

/**
 * Non-empty identifier for a Herdr terminal.
 *
 * @category models
 * @since 0.8.2
 */
export type TerminalId = typeof TerminalId.Type;

/**
 * Parses an external terminal identifier before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseTerminalId = Schema.decodeUnknownEffect(TerminalId);

/**
 * Non-empty identifier for an installed Herdr plugin.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PluginId"));

/**
 * Non-empty identifier for an installed Herdr plugin.
 *
 * @category models
 * @since 0.8.2
 */
export type PluginId = typeof PluginId.Type;

/**
 * Parses an external plugin identifier before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parsePluginId = Schema.decodeUnknownEffect(PluginId);

/**
 * Non-empty identifier for a Herdr plugin action.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginActionId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PluginActionId"));

/**
 * Non-empty identifier for a Herdr plugin action.
 *
 * @category models
 * @since 0.8.2
 */
export type PluginActionId = typeof PluginActionId.Type;

/**
 * Parses an external plugin action identifier before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parsePluginActionId = Schema.decodeUnknownEffect(PluginActionId);

/**
 * Non-empty identifier for a Herdr plugin command log.
 *
 * @category schemas
 * @since 0.8.2
 */
export const PluginLogId = NonEmptyHerdrIdentifier.pipe(Schema.brand("PluginLogId"));

/**
 * Non-empty identifier for a Herdr plugin command log.
 *
 * @category models
 * @since 0.8.2
 */
export type PluginLogId = typeof PluginLogId.Type;

/**
 * Parses an external plugin command-log identifier before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parsePluginLogId = Schema.decodeUnknownEffect(PluginLogId);

/**
 * Non-empty caller-assigned name for a Herdr agent.
 *
 * @category schemas
 * @since 0.8.2
 */
export const AgentName = NonEmptyHerdrIdentifier.pipe(Schema.brand("AgentName"));

/**
 * Non-empty caller-assigned name for a Herdr agent.
 *
 * @category models
 * @since 0.8.2
 */
export type AgentName = typeof AgentName.Type;

/**
 * Parses an external agent name before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseAgentName = Schema.decodeUnknownEffect(AgentName);

/**
 * Absolute filesystem path accepted by Herdr SDK operations and configuration.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrAbsolutePath = Schema.String.check(
  Schema.makeFilter((value) =>
    isAbsolute(value) && !value.includes("\0")
      ? undefined
      : "must be an absolute path without NUL bytes",
  ),
).pipe(Schema.brand("HerdrAbsolutePath"));

/**
 * Absolute filesystem path accepted by Herdr SDK operations and configuration.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrAbsolutePath = typeof HerdrAbsolutePath.Type;

/**
 * Parses an external absolute path before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrAbsolutePath = Schema.decodeUnknownEffect(HerdrAbsolutePath);

/**
 * Herdr session name that cannot escape its session directory.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrSessionName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) =>
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
      ? undefined
      : "must not be '.', '..', or contain path separators or NUL bytes",
  ),
).pipe(Schema.brand("HerdrSessionName"));

/**
 * Herdr session name that cannot escape its session directory.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrSessionName = typeof HerdrSessionName.Type;

/**
 * Parses an external session name before socket-path resolution.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrSessionName = Schema.decodeUnknownEffect(HerdrSessionName);

/**
 * Finite, non-negative integer duration measured in milliseconds.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrMilliseconds = HerdrNaturalNumber.pipe(Schema.brand("HerdrMilliseconds"));

/**
 * Finite, non-negative integer duration measured in milliseconds.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrMilliseconds = typeof HerdrMilliseconds.Type;

/**
 * Parses an external millisecond duration before it enters SDK services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrMilliseconds = Schema.decodeUnknownEffect(HerdrMilliseconds);

/**
 * Finite, non-negative Unix timestamp measured in milliseconds.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrUnixMilliseconds = HerdrNaturalNumber.pipe(Schema.brand("HerdrUnixMilliseconds"));

/**
 * Finite, non-negative Unix timestamp measured in milliseconds.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrUnixMilliseconds = typeof HerdrUnixMilliseconds.Type;

/**
 * Parses an external Unix millisecond timestamp.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrUnixMilliseconds = Schema.decodeUnknownEffect(HerdrUnixMilliseconds);

/**
 * Finite, non-negative Unix timestamp measured in seconds.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrUnixSeconds = HerdrNaturalNumber.pipe(Schema.brand("HerdrUnixSeconds"));

/**
 * Finite, non-negative Unix timestamp measured in seconds.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrUnixSeconds = typeof HerdrUnixSeconds.Type;

/**
 * Parses an external Unix second timestamp.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrUnixSeconds = Schema.decodeUnknownEffect(HerdrUnixSeconds);

/**
 * Finite, non-negative pane-output revision.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrRevision = HerdrNaturalNumber.pipe(Schema.brand("HerdrRevision"));

/**
 * Finite, non-negative pane-output revision.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrRevision = typeof HerdrRevision.Type;

/**
 * Parses an external pane-output revision.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrRevision = Schema.decodeUnknownEffect(HerdrRevision);

/**
 * Finite, non-negative sequence used to order reported agent state.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrStateChangeSequence = HerdrNaturalNumber.pipe(
  Schema.brand("HerdrStateChangeSequence"),
);

/**
 * Finite, non-negative sequence used to order reported agent state.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrStateChangeSequence = typeof HerdrStateChangeSequence.Type;

/**
 * Parses an external agent state-change sequence.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrStateChangeSequence = Schema.decodeUnknownEffect(HerdrStateChangeSequence);

/**
 * Finite split ratio strictly between zero and one.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrSplitRatio = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true, exclusiveMaximum: true }),
).pipe(Schema.brand("HerdrSplitRatio"));

/**
 * Finite split ratio strictly between zero and one.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrSplitRatio = typeof HerdrSplitRatio.Type;

/**
 * Parses an external split ratio before it enters layout or pane services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrSplitRatio = Schema.decodeUnknownEffect(HerdrSplitRatio);

/**
 * Metadata time-to-live between one millisecond and one day, inclusive.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrMetadataTtl = Schema.Finite.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 86_400_000 }),
).pipe(Schema.brand("HerdrMetadataTtl"));

/**
 * Metadata time-to-live between one millisecond and one day, inclusive.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrMetadataTtl = typeof HerdrMetadataTtl.Type;

/**
 * Parses an external metadata time-to-live before report operations.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrMetadataTtl = Schema.decodeUnknownEffect(HerdrMetadataTtl);

/**
 * Non-negative insertion index used by ordered workspace and tab operations.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrInsertIndex = HerdrNaturalNumber.pipe(Schema.brand("HerdrInsertIndex"));

/**
 * Non-negative insertion index used by ordered workspace and tab operations.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrInsertIndex = typeof HerdrInsertIndex.Type;

/**
 * Parses an external insertion index before it enters ordering services.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrInsertIndex = Schema.decodeUnknownEffect(HerdrInsertIndex);

/**
 * Positive integer image dimension measured in pixels.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrImageDimension = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
).pipe(Schema.brand("HerdrImageDimension"));

/**
 * Positive integer image dimension measured in pixels.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrImageDimension = typeof HerdrImageDimension.Type;

/**
 * Parses an external image dimension before graphics I/O.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrImageDimension = Schema.decodeUnknownEffect(HerdrImageDimension);

/**
 * Non-negative image payload size measured in bytes.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrByteLength = HerdrNaturalNumber.pipe(Schema.brand("HerdrByteLength"));

/**
 * Non-negative image payload size measured in bytes.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrByteLength = typeof HerdrByteLength.Type;

/**
 * Parses an external byte length before graphics I/O.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrByteLength = Schema.decodeUnknownEffect(HerdrByteLength);

/**
 * Popup size in terminal cells or an integer percentage from one through one hundred.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrPopupSize = Schema.Union([
  Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 65_535 })),
  Schema.String.check(Schema.isPattern(/^(100|[1-9][0-9]?)%$/)),
]);

/**
 * Popup size in terminal cells or an integer percentage from one through one hundred.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrPopupSize = typeof HerdrPopupSize.Type;

/**
 * Parses an external popup size before plugin pane operations.
 *
 * @category decoding
 * @since 0.8.2
 */
export const parseHerdrPopupSize = Schema.decodeUnknownEffect(HerdrPopupSize);

/**
 * Pure schema-owned helpers for constructing branded Herdr identifiers and paths.
 *
 * @category models
 * @since 0.8.2
 */
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

/**
 * Pure schema-owned constructors exposed as `herdr.ids`.
 *
 * @category constructors
 * @since 0.8.2
 */
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
