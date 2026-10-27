/**
 * Models revision-guarded pane selection, copy navigation, scrolling, and link resolution/activation.
 * Coordinates and content revisions refer to server terminal content, not a client's projection.
 * @since 0.9.0
 */
import { Buffer } from "node:buffer";
import { Schema } from "effect";
import { PaneId } from "./herdr-domain.ts";

const PaneRow = Schema.Natural.check(Schema.isLessThanOrEqualTo(0xffff_ffff));
const PaneColumn = Schema.Natural.check(Schema.isLessThanOrEqualTo(0xffff));
const SafeUnsignedInteger = Schema.Natural.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

/** Content revision guards selection against terminal mutation; distinct from surface revisions. @category schemas @since 0.9.0 */
export const PaneContentRevision = SafeUnsignedInteger.pipe(Schema.brand("PaneContentRevision"));
/** Parsed terminal content revision. @category models @since 0.9.0 */
export type PaneContentRevision = typeof PaneContentRevision.Type;
/** Scroll offset measured in rows from the terminal's bottom. @category schemas @since 0.9.0 */
export const PaneScrollOffset = SafeUnsignedInteger.pipe(Schema.brand("PaneScrollOffset"));
/** Parsed scroll offset in rows. @category models @since 0.9.0 */
export type PaneScrollOffset = typeof PaneScrollOffset.Type;

/** Absolute terminal text coordinates, not viewport coordinates. @category schemas @since 0.9.0 */
export const PaneTextPoint = Schema.Struct({ row: PaneRow, col: PaneColumn });
/** Absolute terminal text point. @category models @since 0.9.0 */
export interface PaneTextPoint extends Schema.Schema.Type<typeof PaneTextPoint> {}
/** Caller-supplied terminal text coordinates. @category inputs @since 0.9.0 */
export type PaneTextPointEncoded = typeof PaneTextPoint.Encoded;
/** Terminal text match range returned by copy search. @category schemas @since 0.9.0 */
export const PaneTextRange = Schema.Struct({ start: PaneTextPoint, end: PaneTextPoint });
/** Terminal text match range. @category models @since 0.9.0 */
export interface PaneTextRange extends Schema.Schema.Type<typeof PaneTextRange> {}
/** Caller-supplied previous match range. @category inputs @since 0.9.0 */
export type PaneTextRangeEncoded = typeof PaneTextRange.Encoded;

/** Sets a terminal scroll offset; the server clamps it to available history. @category schemas @since 0.9.0 */
export const PaneScrollInput = Schema.Struct({ offsetFromBottom: PaneScrollOffset });
/** Parsed pane scroll input. @category models @since 0.9.0 */
export interface PaneScrollInput extends Schema.Schema.Type<typeof PaneScrollInput> {}
/** Caller-supplied scroll offset. @category inputs @since 0.9.0 */
export type PaneScrollInputEncoded = typeof PaneScrollInput.Encoded;

/** Reads absolute selection coordinates, optionally rejecting changed content. @category schemas @since 0.9.0 */
export const PaneSelectionReadInput = Schema.Struct({
  anchor: PaneTextPoint,
  cursor: PaneTextPoint,
  contentRevision: Schema.optionalKey(PaneContentRevision),
});
/** Parsed pane selection input. @category models @since 0.9.0 */
export interface PaneSelectionReadInput extends Schema.Schema.Type<typeof PaneSelectionReadInput> {}
/** Caller-supplied selection coordinates and optional revision. @category inputs @since 0.9.0 */
export type PaneSelectionReadInputEncoded = typeof PaneSelectionReadInput.Encoded;
/** Selected text returned without changing the system clipboard. @category schemas @since 0.9.0 */
export const PaneSelectionResult = Schema.Struct({ paneId: PaneId, text: Schema.String }).pipe(
  Schema.encodeKeys({ paneId: "pane_id" }),
);
/** Selected terminal text. @category models @since 0.9.0 */
export interface PaneSelectionResult extends Schema.Schema.Type<typeof PaneSelectionResult> {}

/** Navigation motion evaluated against server-owned terminal text. @category schemas @since 0.9.0 */
export const PaneCopyMotion = Schema.Literals([
  "lineEnd",
  "firstNonBlank",
  "nextWordStart",
  "previousWordStart",
  "nextWordEnd",
  "nextBigWordStart",
  "previousBigWordStart",
  "nextBigWordEnd",
  "previousParagraph",
  "nextParagraph",
]);
/** Supported terminal copy motion. @category models @since 0.9.0 */
export type PaneCopyMotion = typeof PaneCopyMotion.Type;
/** Calculates a cursor target without typing terminal input. @category schemas @since 0.9.0 */
export const PaneCopyMotionInput = Schema.Struct({
  cursor: PaneTextPoint,
  motion: PaneCopyMotion,
  contentRevision: Schema.optionalKey(PaneContentRevision),
});
/** Parsed copy motion request. @category models @since 0.9.0 */
export interface PaneCopyMotionInput extends Schema.Schema.Type<typeof PaneCopyMotionInput> {}
/** Caller-supplied copy motion request. @category inputs @since 0.9.0 */
export type PaneCopyMotionInputEncoded = typeof PaneCopyMotionInput.Encoded;
/** Cursor and content revision observed by copy motion. @category schemas @since 0.9.0 */
export const PaneCopyMotionResult = Schema.Struct({
  paneId: PaneId,
  cursor: PaneTextPoint,
  contentRevision: PaneContentRevision,
}).pipe(Schema.encodeKeys({ paneId: "pane_id", contentRevision: "content_revision" }));
/** Copy motion result. @category models @since 0.9.0 */
export interface PaneCopyMotionResult extends Schema.Schema.Type<typeof PaneCopyMotionResult> {}

/** Search against an exact content revision; the query is at most 4096 UTF-8 bytes. @category schemas @since 0.9.0 */
export const PaneCopySearchInput = Schema.Struct({
  query: Schema.String.check(
    Schema.makeFilter(
      (query) =>
        Buffer.byteLength(query, "utf8") <= 4096 ||
        "Pane copy search query exceeds 4096 UTF-8 bytes",
    ),
  ),
  direction: Schema.Literals(["forward", "backward"]),
  cursor: PaneTextPoint,
  contentRevision: PaneContentRevision,
  previous: Schema.optionalKey(PaneTextRange),
});
/** Parsed pane copy search request. @category models @since 0.9.0 */
export interface PaneCopySearchInput extends Schema.Schema.Type<typeof PaneCopySearchInput> {}
/** Caller-supplied pane copy search request. @category inputs @since 0.9.0 */
export type PaneCopySearchInputEncoded = typeof PaneCopySearchInput.Encoded;
/** Bounded match window; total may exceed the returned range count. @category schemas @since 0.9.0 */
export const PaneCopySearchResult = Schema.Struct({
  paneId: PaneId,
  contentRevision: PaneContentRevision,
  matches: Schema.Array(PaneTextRange).check(Schema.isMaxLength(1024)),
  total: SafeUnsignedInteger,
  current: Schema.OptionFromOptionalKey(PaneRow),
  currentGlobal: Schema.OptionFromOptionalKey(SafeUnsignedInteger),
}).pipe(
  Schema.encodeKeys({
    paneId: "pane_id",
    contentRevision: "content_revision",
    currentGlobal: "current_global",
  }),
);
/** Copy search match window and total count. @category models @since 0.9.0 */
export interface PaneCopySearchResult extends Schema.Schema.Type<typeof PaneCopySearchResult> {}

/** Activates a visible pane link with optional content and viewport guards. @category schemas @since 0.9.0 */
export const PaneLinkActivateInput = Schema.Struct({
  viewportRow: PaneColumn,
  col: PaneColumn,
  contentRevision: Schema.optionalKey(PaneContentRevision),
  offsetFromBottom: Schema.optionalKey(PaneScrollOffset),
});
/** Parsed visible-link activation. @category models @since 0.9.0 */
export interface PaneLinkActivateInput extends Schema.Schema.Type<typeof PaneLinkActivateInput> {}
/** Caller-supplied link activation coordinates. @category inputs @since 0.9.0 */
export type PaneLinkActivateInputEncoded = typeof PaneLinkActivateInput.Encoded;
/** Resolves the visible link under a viewport cell with the same guards as activation; has no side effects. @category schemas @since 0.9.5 */
export const PaneLinkResolveInput = PaneLinkActivateInput;
/** Parsed visible-link resolution. @category models @since 0.9.5 */
export interface PaneLinkResolveInput extends Schema.Schema.Type<typeof PaneLinkResolveInput> {}
/** Caller-supplied link resolution coordinates. @category inputs @since 0.9.5 */
export type PaneLinkResolveInputEncoded = typeof PaneLinkResolveInput.Encoded;
/** One viewport row's inclusive display-cell column span covered by a link. @category schemas @since 0.9.5 */
export const PaneLinkRegion = Schema.Struct({
  row: PaneColumn,
  startCol: PaneColumn,
  endCol: PaneColumn,
}).pipe(Schema.encodeKeys({ startCol: "start_col", endCol: "end_col" }));
/** Viewport cells covered by a resolved link. @category models @since 0.9.5 */
export interface PaneLinkRegion extends Schema.Schema.Type<typeof PaneLinkRegion> {}
/** Regions of the link under the requested cell; empty when no link is there. Wrapped links span several rows. @category schemas @since 0.9.5 */
export const PaneLinkResolvedResult = Schema.Struct({ regions: Schema.Array(PaneLinkRegion) });
/** Visible-link resolution result. @category models @since 0.9.5 */
export interface PaneLinkResolvedResult extends Schema.Schema.Type<typeof PaneLinkResolvedResult> {}
/** Plugin handling result; an unhandled URL does not mean a browser was opened. @category schemas @since 0.9.0 */
export const PaneLinkActivatedResult = Schema.Struct({
  url: Schema.OptionFromOptionalKey(Schema.String),
  handled: Schema.Boolean,
});
/** Visible-link activation result. @category models @since 0.9.0 */
export interface PaneLinkActivatedResult extends Schema.Schema.Type<
  typeof PaneLinkActivatedResult
> {}
