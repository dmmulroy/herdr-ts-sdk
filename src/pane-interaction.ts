/**
 * Implements pane text navigation and viewport interactions owned by PaneService.
 * Revision failures are returned without retrying coordinates against different text.
 * @since 0.9.0
 */
import { Effect, Schema } from "effect";
import type { PaneId } from "./herdr-domain.ts";
import { Pane } from "./herdr-models.ts";
import {
  PaneScrollInput,
  type PaneScrollInputEncoded,
  PaneSelectionReadInput,
  type PaneSelectionReadInputEncoded,
  PaneSelectionResult,
  PaneCopyMotionInput,
  type PaneCopyMotionInputEncoded,
  PaneCopyMotionResult,
  PaneCopySearchInput,
  type PaneCopySearchInputEncoded,
  PaneCopySearchResult,
  PaneLinkActivateInput,
  type PaneLinkActivateInputEncoded,
  PaneLinkActivatedResult,
  PaneLinkResolveInput,
  type PaneLinkResolveInputEncoded,
  PaneLinkResolvedResult,
} from "./herdr-pane-interaction-models.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import type {
  IHerdrTransport,
  HerdrTransportRequestError,
  HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseScroll = Schema.decodeEffect(PaneScrollInput);
const parseSelection = Schema.decodeEffect(PaneSelectionReadInput);
const parseMotion = Schema.decodeEffect(PaneCopyMotionInput);
const parseSearch = Schema.decodeEffect(PaneCopySearchInput);
const parseLink = Schema.decodeEffect(PaneLinkActivateInput);
const parsePane = Schema.decodeUnknownEffect(Pane);
const parseSelectionResult = Schema.decodeUnknownEffect(PaneSelectionResult);
const parseMotionResult = Schema.decodeUnknownEffect(PaneCopyMotionResult);
const parseSearchResult = Schema.decodeUnknownEffect(PaneCopySearchResult);
const parseLinkResult = Schema.decodeUnknownEffect(PaneLinkActivatedResult);
const parseLinkResolve = Schema.decodeEffect(PaneLinkResolveInput);
const parseLinkResolvedResult = Schema.decodeUnknownEffect(PaneLinkResolvedResult);
const wireCopyMotions = {
  lineEnd: "line_end",
  firstNonBlank: "first_non_blank",
  nextWordStart: "next_word_start",
  previousWordStart: "previous_word_start",
  nextWordEnd: "next_word_end",
  nextBigWordStart: "next_big_word_start",
  previousBigWordStart: "previous_big_word_start",
  nextBigWordEnd: "next_big_word_end",
  previousParagraph: "previous_paragraph",
  nextParagraph: "next_paragraph",
} as const;

/** PaneService's text navigation, screen clearing, and visible-link capability. @category services @since 0.9.0 */
export interface IPaneInteraction {
  /** Clears the pane's screen and scrollback, keeping the current prompt line; full-screen apps are left alone. */
  readonly clear: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Scrolls the server terminal and returns its pane information. */
  readonly scroll: (
    id: PaneId,
    input: PaneScrollInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Pane, HerdrTransportRequestError>;
  /** Opens the focused pane's scrollback in its configured editor; never focuses implicitly. */
  readonly editScrollback: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Absolute selection reads do not change the system clipboard. */
  readonly selection: {
    /** Reads terminal selection text; stale revisions are not retried. */
    readonly read: (
      id: PaneId,
      input: PaneSelectionReadInputEncoded,
      options?: HerdrTransportRequestOptionsEncoded,
    ) => Effect.Effect<PaneSelectionResult, HerdrTransportRequestError>;
  };
  /** Calculates a copy-mode cursor without sending input. */
  readonly copyMotion: (
    id: PaneId,
    input: PaneCopyMotionInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneCopyMotionResult, HerdrTransportRequestError>;
  /** Searches an exact revision; total can exceed the bounded match window. */
  readonly copySearch: (
    id: PaneId,
    input: PaneCopySearchInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneCopySearchResult, HerdrTransportRequestError>;
  /** Visible-link resolution and plugin activation. */
  readonly link: {
    /** Reports the viewport cells covered by the link under a cell without activating it. */
    readonly resolve: (
      id: PaneId,
      input: PaneLinkResolveInputEncoded,
      options?: HerdrTransportRequestOptionsEncoded,
    ) => Effect.Effect<PaneLinkResolvedResult, HerdrTransportRequestError>;
    /** Invokes a matching plugin link handler; does not open a browser. */
    readonly activate: (
      id: PaneId,
      input: PaneLinkActivateInputEncoded,
      options?: HerdrTransportRequestOptionsEncoded,
    ) => Effect.Effect<PaneLinkActivatedResult, HerdrTransportRequestError>;
  };
}

/** Constructs parent-owned pane interaction operations using the shared transport. @category constructors @since 0.9.0 */
export function makePaneInteraction(transport: IHerdrTransport): IPaneInteraction {
  return {
    clear: defineHerdrOperation("PaneService.clear", (id, options = {}) =>
      transport.request("pane.clear", { paneId: id }, options).pipe(Effect.asVoid),
    ),
    scroll: defineHerdrOperation("PaneService.scroll", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.scroll", parseScroll, input);
        const response = yield* transport.request(
          "pane.scroll",
          { paneId: id, ...parsed },
          options,
        );
        return yield* decodeHerdrWire(parsePane, response.result.pane, response.requestId);
      }),
    ),
    editScrollback: defineHerdrOperation("PaneService.editScrollback", (id, options = {}) =>
      transport.request("pane.edit_scrollback", { paneId: id }, options).pipe(Effect.asVoid),
    ),
    selection: {
      read: defineHerdrOperation("PaneService.selection.read", (id, input, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "PaneService.selection.read",
            parseSelection,
            input,
          );
          const response = yield* transport.request(
            "pane.selection.read",
            { paneId: id, ...parsed },
            options,
          );
          return yield* decodeHerdrWire(parseSelectionResult, response.result, response.requestId);
        }),
      ),
    },
    copyMotion: defineHerdrOperation("PaneService.copyMotion", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.copyMotion", parseMotion, input);
        const response = yield* transport.request(
          "pane.copy_motion",
          { paneId: id, ...parsed, motion: wireCopyMotions[parsed.motion] },
          options,
        );
        return yield* decodeHerdrWire(parseMotionResult, response.result, response.requestId);
      }),
    ),
    copySearch: defineHerdrOperation("PaneService.copySearch", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.copySearch", parseSearch, input);
        const response = yield* transport.request(
          "pane.copy_search",
          { paneId: id, ...parsed },
          options,
        );
        return yield* decodeHerdrWire(parseSearchResult, response.result, response.requestId);
      }),
    ),
    link: {
      resolve: defineHerdrOperation("PaneService.link.resolve", (id, input, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "PaneService.link.resolve",
            parseLinkResolve,
            input,
          );
          const response = yield* transport.request(
            "pane.link.resolve",
            { paneId: id, ...parsed },
            options,
          );
          return yield* decodeHerdrWire(
            parseLinkResolvedResult,
            response.result,
            response.requestId,
          );
        }),
      ),
      activate: defineHerdrOperation("PaneService.link.activate", (id, input, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput("PaneService.link.activate", parseLink, input);
          const response = yield* transport.request(
            "pane.link.activate",
            { paneId: id, ...parsed },
            options,
          );
          return yield* decodeHerdrWire(parseLinkResult, response.result, response.requestId);
        }),
      ),
    },
  };
}
