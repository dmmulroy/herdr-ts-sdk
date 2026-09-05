/**
 * Controls Herdr panes, terminal input and output, geometry, metadata, and graphics.
 *
 * The nested graphics capability supports validated one-shot frames and scope-owned streaming writers whose sockets close on success, failure, or interruption.
 *
 * @since 0.8.2
 */
import { Buffer } from "node:buffer";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  HerdrKeySequence,
  type HerdrKeySequence as HerdrKeySequenceValue,
  type PaneId,
} from "./herdr-domain.ts";
import {
  Pane,
  PaneAgentReportInput,
  type PaneAgentReportInputEncoded,
  PaneAgentSessionReportInput,
  type PaneAgentSessionReportInputEncoded,
  PaneClearAgentAuthorityInput,
  type PaneClearAgentAuthorityInputEncoded,
  type PaneDirection,
  PaneEdgesResult,
  PaneFocusDirectionResult,
  PaneFocusDirectionInput,
  type PaneFocusDirectionInputEncoded,
  PaneGraphicsFrame,
  type PaneGraphicsFrameEncoded,
  PaneGraphicsFileFrame,
  type PaneGraphicsFileFrameEncoded,
  PaneGraphicsFrameAcknowledgement,
  type PaneGraphicsFrameAcknowledgement as PaneGraphicsFrameAcknowledgementValue,
  PaneGraphicsInfo,
  PaneGraphicsLayerInput,
  type PaneGraphicsLayerInputEncoded,
  type PaneGraphicsPlacement,
  PaneGraphicsSetFrame,
  type PaneGraphicsSetFrameEncoded,
  PaneGraphicsStreamInput,
  type PaneGraphicsStreamInputEncoded,
  PaneInput,
  type PaneInputEncoded,
  PaneInputRoutingInput,
  type PaneInputRoutingInputEncoded,
  PaneLayoutSnapshot,
  PaneMetadataReportInput,
  type PaneMetadataReportInputEncoded,
  PaneMoveInput,
  type PaneMoveInputEncoded,
  PaneMoveResult,
  PaneNeighborResult,
  PaneOutputMatchResult,
  PaneProcessInfo,
  PaneReadInput,
  type PaneReadInputEncoded,
  PaneReadResult,
  PaneResizeInput,
  type PaneResizeInputEncoded,
  PaneReleaseAgentInput,
  type PaneReleaseAgentInputEncoded,
  PaneResizeResult,
  PaneListInput,
  type PaneListInputEncoded,
  PaneCurrentInput,
  type PaneCurrentInputEncoded,
  PaneSplitInput,
  type PaneSplitInputEncoded,
  PaneSwapInput,
  type PaneSwapInputEncoded,
  PaneSwapResult,
  PaneWaitForOutputInput,
  type PaneWaitForOutputInputEncoded,
  PaneZoomInput,
  type PaneZoomInputEncoded,
  PaneZoomResult,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrGraphicsStreamClosed,
  HerdrImageTooLarge,
  HerdrInvalidFrame,
  HerdrInvalidResponse,
  HerdrServerError,
  type HerdrTransportError,
} from "./herdr-errors.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type IHerdrTransport,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parsePane = Schema.decodeUnknownEffect(Pane);
const parsePanes = Schema.decodeUnknownEffect(Schema.Array(Pane));
const parsePaneAgentReportInput = Schema.decodeUnknownEffect(PaneAgentReportInput);
const parsePaneAgentSessionReportInput = Schema.decodeUnknownEffect(PaneAgentSessionReportInput);
const parsePaneClearAgentAuthorityInput = Schema.decodeUnknownEffect(PaneClearAgentAuthorityInput);
const parsePaneCurrentInput = Schema.decodeUnknownEffect(PaneCurrentInput);
const parsePaneEdgesResult = Schema.decodeUnknownEffect(PaneEdgesResult);
const parsePaneFocusDirectionInput = Schema.decodeUnknownEffect(PaneFocusDirectionInput);
const parsePaneFocusDirectionResult = Schema.decodeUnknownEffect(PaneFocusDirectionResult);
const parsePaneGraphicsFrame = Schema.decodeUnknownEffect(PaneGraphicsFrame);
const parsePaneGraphicsFileFrame = Schema.decodeUnknownEffect(PaneGraphicsFileFrame);
const parsePaneGraphicsInfo = Schema.decodeUnknownEffect(PaneGraphicsInfo);
const parsePaneGraphicsLayerInput = Schema.decodeUnknownEffect(PaneGraphicsLayerInput);
const parsePaneGraphicsSetFrame = Schema.decodeUnknownEffect(PaneGraphicsSetFrame);
const parsePaneGraphicsStreamInput = Schema.decodeUnknownEffect(PaneGraphicsStreamInput);
const parsePaneInput = Schema.decodeUnknownEffect(PaneInput);
const parsePaneInputRoutingInput = Schema.decodeUnknownEffect(PaneInputRoutingInput);
const parsePaneKeySequence = Schema.decodeUnknownEffect(HerdrKeySequence);
const parsePaneLabel = Schema.decodeUnknownEffect(Schema.String);
const parsePaneLayoutSnapshot = Schema.decodeUnknownEffect(PaneLayoutSnapshot);
const parsePaneListInput = Schema.decodeUnknownEffect(PaneListInput);
const parsePaneMetadataReportInput = Schema.decodeUnknownEffect(PaneMetadataReportInput);
const parsePaneMoveInput = Schema.decodeUnknownEffect(PaneMoveInput);
const parsePaneMoveResult = Schema.decodeUnknownEffect(PaneMoveResult);
const parsePaneNeighborResult = Schema.decodeUnknownEffect(PaneNeighborResult);
const parsePaneOutputMatchResult = Schema.decodeUnknownEffect(PaneOutputMatchResult);
const parsePaneProcessInfo = Schema.decodeUnknownEffect(PaneProcessInfo);
const parsePaneReadInput = Schema.decodeUnknownEffect(PaneReadInput);
const parsePaneReadResult = Schema.decodeUnknownEffect(PaneReadResult);
const parsePaneReleaseAgentInput = Schema.decodeUnknownEffect(PaneReleaseAgentInput);
const parsePaneResizeInput = Schema.decodeUnknownEffect(PaneResizeInput);
const parsePaneResizeResult = Schema.decodeUnknownEffect(PaneResizeResult);
const parsePaneSplitInput = Schema.decodeUnknownEffect(PaneSplitInput);
const parsePaneSwapInput = Schema.decodeUnknownEffect(PaneSwapInput);
const parsePaneSwapResult = Schema.decodeUnknownEffect(PaneSwapResult);
const parsePaneText = Schema.decodeUnknownEffect(Schema.String);
const parsePaneWaitForOutputInput = Schema.decodeUnknownEffect(PaneWaitForOutputInput);
const parsePaneZoomInput = Schema.decodeUnknownEffect(PaneZoomInput);
const parsePaneZoomResult = Schema.decodeUnknownEffect(PaneZoomResult);
const MAX_GRAPHICS_ONE_SHOT_BYTES = 512 * 1024;
const MAX_GRAPHICS_STREAM_FRAME_BYTES = 16 * 1024 * 1024;

const PaneGraphicsStreamResponseEnvelope = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    result: Schema.Struct({
      type: Schema.Literal("pane_graphics_frame_ack"),
      ...PaneGraphicsFrameAcknowledgement.fields,
    }),
  }),
  Schema.Struct({
    id: Schema.String,
    error: Schema.Struct({ code: Schema.String, message: Schema.String }),
  }),
]);

const parsePaneGraphicsStreamResponseEnvelope = Schema.decodeUnknownEffect(
  PaneGraphicsStreamResponseEnvelope,
);

type PaneGraphicsStreamFailure = HerdrGraphicsStreamClosed | HerdrTransportRequestError;

type PaneGraphicsStreamMessage =
  | {
      readonly _tag: "Acknowledgement";
      readonly id: string;
      readonly value: PaneGraphicsFrameAcknowledgementValue;
    }
  | { readonly _tag: "Failure"; readonly error: PaneGraphicsStreamFailure };

/**
 * Scoped graphics writer whose socket is owned by the acquisition scope.
 *
 * @category services
 * @since 0.8.2
 */
export interface PaneGraphicsWriter {
  /** Pane receiving every frame written by this resource. */
  readonly paneId: PaneId;
  /** Writes one framed image to the acquired graphics socket. */
  readonly write: (
    frame: PaneGraphicsFrameEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<
    void,
    HerdrInvalidFrame | HerdrImageTooLarge | HerdrGraphicsStreamClosed | HerdrTransportRequestError
  >;
  /** Submits an immutable direct-file frame; the write deadline includes Herdr's acknowledgement. */
  readonly writeFile: (
    frame: PaneGraphicsFileFrameEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<
    PaneGraphicsFrameAcknowledgementValue,
    HerdrInvalidFrame | HerdrGraphicsStreamClosed | HerdrTransportRequestError
  >;
}

/**
 * Nested pane graphics capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPaneGraphics {
  /** Reads terminal-cell pixel dimensions for a pane. */
  readonly info: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneGraphicsInfo, HerdrTransportRequestError>;
  /** Replaces a pane graphics layer with one image. */
  readonly set: (
    id: PaneId,
    frame: PaneGraphicsSetFrameEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrInvalidFrame | HerdrImageTooLarge | HerdrTransportRequestError>;
  /** Clears a pane graphics layer. */
  readonly clear: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Clears one named pane graphics layer, or the primary layer when omitted. */
  readonly clearLayer: (
    id: PaneId,
    input?: PaneGraphicsLayerInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Acquires a scoped multi-frame graphics writer. */
  readonly openStream: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneGraphicsWriter, HerdrTransportRequestError, Scope.Scope>;
  /** Acquires a scoped writer for a named layer and z-index. */
  readonly openLayerStream: (
    id: PaneId,
    input?: PaneGraphicsStreamInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneGraphicsWriter, HerdrTransportRequestError, Scope.Scope>;
}

/**
 * Pane lifecycle, geometry, I/O, reporting, and graphics capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPaneService {
  /** Nested pane graphics operations. */
  readonly graphics: IPaneGraphics;
  /** Splits a pane or the focused pane. */
  readonly split: (
    targetPaneId: PaneId | undefined,
    input: PaneSplitInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Pane, HerdrTransportRequestError>;
  /** Swaps panes by direction or explicit identifiers. */
  readonly swap: (
    input: PaneSwapInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneSwapResult, HerdrTransportRequestError>;
  /** Moves one pane to another tab or a new container. */
  readonly move: (
    paneId: PaneId,
    input: PaneMoveInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneMoveResult, HerdrTransportRequestError>;
  /** Changes pane zoom state. */
  readonly zoom: (
    paneId?: PaneId,
    input?: PaneZoomInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneZoomResult, HerdrTransportRequestError>;
  /** Reads the layout containing a pane or the focused pane. */
  readonly layout: (
    paneId?: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneLayoutSnapshot, HerdrTransportRequestError>;
  /** Reads process information for a pane or the focused pane. */
  readonly processInfo: (
    paneId?: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneProcessInfo, HerdrTransportRequestError>;
  /** Finds a pane neighbor. */
  readonly neighbor: (
    paneId: PaneId | undefined,
    direction: PaneDirection,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneNeighborResult, HerdrTransportRequestError>;
  /** Reads which layout edges contain a pane. */
  readonly edges: (
    paneId?: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneEdgesResult, HerdrTransportRequestError>;
  /** Focuses a pane in one direction. */
  readonly focusDirection: (
    direction: PaneDirection,
    input?: PaneFocusDirectionInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneFocusDirectionResult, HerdrTransportRequestError>;
  /** Resizes a pane in one direction. */
  readonly resize: (
    direction: PaneDirection,
    input?: PaneResizeInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneResizeResult, HerdrTransportRequestError>;
  /** Lists panes, optionally within a workspace. */
  readonly list: (
    input?: PaneListInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly Pane[], HerdrTransportRequestError>;
  /** Resolves the current pane for a caller or foreground client. */
  readonly current: (
    input?: PaneCurrentInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Pane, HerdrTransportRequestError>;
  /** Reads one pane. */
  readonly get: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Pane, HerdrTransportRequestError>;
  /** Focuses one pane. */
  readonly focus: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Pane, HerdrTransportRequestError>;
  /** Replaces or clears a pane label. */
  readonly rename: (
    id: PaneId,
    label: string | null,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Pane, HerdrTransportRequestError>;
  /** Selects whether right-click input is handled by Herdr or the pane application. */
  readonly setInputRouting: (
    id: PaneId,
    input: PaneInputRoutingInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Sends literal text to one pane. */
  readonly sendText: (
    id: PaneId,
    text: string,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Sends named keys to one pane. */
  readonly sendKeys: (
    id: PaneId,
    keys: HerdrKeySequenceValue,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Sends combined text and key input to one pane. */
  readonly sendInput: (
    id: PaneId,
    input: PaneInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Reads pane output. */
  readonly read: (
    id: PaneId,
    input: PaneReadInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneReadResult, HerdrTransportRequestError>;
  /** Waits for matching pane output. */
  readonly waitForOutput: (
    id: PaneId,
    input: PaneWaitForOutputInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneOutputMatchResult, HerdrTransportRequestError>;
  /** Reports an agent state for one pane. */
  readonly reportAgent: (
    id: PaneId,
    input: PaneAgentReportInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Reports an agent session for one pane. */
  readonly reportAgentSession: (
    id: PaneId,
    input: PaneAgentSessionReportInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Reports pane labels and metadata tokens. */
  readonly reportMetadata: (
    id: PaneId,
    input: PaneMetadataReportInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Clears agent-report authority for one pane. */
  readonly clearAgentAuthority: (
    id: PaneId,
    input?: PaneClearAgentAuthorityInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Releases one agent report. */
  readonly releaseAgent: (
    id: PaneId,
    input: PaneReleaseAgentInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Closes one pane. */
  readonly close: (
    id: PaneId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for Herdr pane operations.
 *
 * @category services
 * @since 0.8.2
 */
export class PaneService extends Context.Service<PaneService, IPaneService>()(
  "@herdr/sdk/PaneService",
) {}

/**
 * Constructs pane operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makePaneService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  const decodePane = defineHerdrOperation(
    "PaneService.decodePane",
    (
      method: "pane.get" | "pane.focus" | "pane.rename",
      id: PaneId,
      label: string | null,
      options: HerdrTransportRequestOptionsEncoded,
    ) =>
      Effect.gen(function* () {
        const response =
          method === "pane.rename"
            ? yield* transport.request(method, { paneId: id, label }, options)
            : yield* transport.request(method, { paneId: id }, options);
        return yield* decodeHerdrWire(parsePane, response.result.pane, response.requestId);
      }),
  );

  const graphics: IPaneGraphics = {
    info: defineHerdrOperation("PaneService.graphics.info", (id, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("pane.graphics.info", { paneId: id }, options);
        return yield* decodeHerdrWire(parsePaneGraphicsInfo, response.result, response.requestId);
      }),
    ),
    set: defineHerdrOperation("PaneService.graphics.set", (id, frame, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeGraphicsSetFrame(
          frame,
          "graphics_set",
          MAX_GRAPHICS_ONE_SHOT_BYTES,
        );
        const placement = Option.match(parsed.placement, {
          onNone: () => undefined,
          onSome: encodeGraphicsPlacement,
        });
        const parametersWithoutPlacement = {
          paneId: id,
          format: parsed.format,
          imageWidth: parsed.imageWidth,
          imageHeight: parsed.imageHeight,
          dataBase64: Buffer.from(parsed.data).toString("base64"),
          layerId: Option.getOrNull(parsed.layerId),
        };
        const withPlacement =
          placement === undefined
            ? parametersWithoutPlacement
            : { ...parametersWithoutPlacement, placement };
        const parameters = Option.match(parsed.zIndex, {
          onNone: () => withPlacement,
          onSome: (zIndex) => ({ ...withPlacement, zIndex }),
        });
        yield* transport.request("pane.graphics.set", parameters, options);
      }),
    ),
    clear: defineHerdrOperation("PaneService.graphics.clear", (id, options = {}) =>
      transport.request("pane.graphics.clear", { paneId: id }, options).pipe(Effect.asVoid),
    ),
    clearLayer: defineHerdrOperation(
      "PaneService.graphics.clearLayer",
      (id, input = {}, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "PaneService.graphics.clearLayer",
            parsePaneGraphicsLayerInput,
            input,
          );
          yield* transport.request(
            "pane.graphics.clear",
            { paneId: id, layerId: Option.getOrNull(parsed.layerId) },
            options,
          );
        }),
    ),
    openStream: defineHerdrOperation("PaneService.graphics.openStream", (id, options = {}) =>
      makePaneGraphicsWriter(transport, id, {}, options),
    ),
    openLayerStream: defineHerdrOperation(
      "PaneService.graphics.openLayerStream",
      (id, input = {}, options = {}) => makePaneGraphicsWriter(transport, id, input, options),
    ),
  };

  return PaneService.of({
    graphics,
    split: defineHerdrOperation("PaneService.split", (targetPaneId, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.split", parsePaneSplitInput, input);
        const base = {
          targetPaneId: targetPaneId ?? null,
          workspaceId: Option.getOrNull(parsed.workspaceId),
          direction: parsed.direction,
          ratio: Option.getOrNull(parsed.ratio),
          cwd: Option.getOrNull(parsed.cwd),
        };
        const withEnv = Option.match(parsed.env, {
          onNone: () => base,
          onSome: (env) => ({ ...base, env }),
        });
        const parameters = Option.match(parsed.focus, {
          onNone: () => withEnv,
          onSome: (focus) => ({ ...withEnv, focus }),
        });
        const withRightClick = Option.match(parsed.rightClick, {
          onNone: () => parameters,
          onSome: (rightClick) => ({ ...parameters, rightClick }),
        });
        const response = yield* transport.request("pane.split", withRightClick, options);
        return yield* decodeHerdrWire(parsePane, response.result.pane, response.requestId);
      }),
    ),
    swap: defineHerdrOperation("PaneService.swap", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.swap", parsePaneSwapInput, input);
        const parameters =
          "direction" in parsed
            ? {
                paneId: Option.getOrNull(parsed.paneId),
                direction: parsed.direction,
                sourcePaneId: null,
                targetPaneId: null,
              }
            : {
                paneId: null,
                direction: null,
                sourcePaneId: parsed.sourcePaneId,
                targetPaneId: parsed.targetPaneId,
              };
        const response = yield* transport.request("pane.swap", parameters, options);
        return yield* decodeHerdrWire(
          parsePaneSwapResult,
          response.result.swap,
          response.requestId,
        );
      }),
    ),
    move: defineHerdrOperation("PaneService.move", (paneId, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.move", parsePaneMoveInput, input);
        const destination = encodePaneMoveDestination(parsed.destination);
        const parameters = Option.match(parsed.focus, {
          onNone: () => ({ paneId, destination }),
          onSome: (focus) => ({ paneId, destination, focus }),
        });
        const response = yield* transport.request("pane.move", parameters, options);
        return yield* decodeHerdrWire(
          parsePaneMoveResult,
          response.result.move_result,
          response.requestId,
        );
      }),
    ),
    zoom: defineHerdrOperation("PaneService.zoom", (paneId, input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.zoom", parsePaneZoomInput, input);
        const parameters = Option.match(parsed.mode, {
          onNone: () => ({ paneId: paneId ?? null }),
          onSome: (mode) => ({ paneId: paneId ?? null, mode }),
        });
        const response = yield* transport.request("pane.zoom", parameters, options);
        return yield* decodeHerdrWire(
          parsePaneZoomResult,
          response.result.zoom,
          response.requestId,
        );
      }),
    ),
    layout: defineHerdrOperation("PaneService.layout", (paneId, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request(
          "pane.layout",
          { paneId: paneId ?? null },
          options,
        );
        return yield* decodeHerdrWire(
          parsePaneLayoutSnapshot,
          response.result.layout,
          response.requestId,
        );
      }),
    ),
    processInfo: defineHerdrOperation("PaneService.processInfo", (paneId, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request(
          "pane.process_info",
          { paneId: paneId ?? null },
          options,
        );
        return yield* decodeHerdrWire(
          parsePaneProcessInfo,
          response.result.process_info,
          response.requestId,
        );
      }),
    ),
    neighbor: defineHerdrOperation("PaneService.neighbor", (paneId, direction, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request(
          "pane.neighbor",
          { paneId: paneId ?? null, direction },
          options,
        );
        return yield* decodeHerdrWire(
          parsePaneNeighborResult,
          response.result.neighbor,
          response.requestId,
        );
      }),
    ),
    edges: defineHerdrOperation("PaneService.edges", (paneId, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request(
          "pane.edges",
          { paneId: paneId ?? null },
          options,
        );
        return yield* decodeHerdrWire(
          parsePaneEdgesResult,
          response.result.edges,
          response.requestId,
        );
      }),
    ),
    focusDirection: defineHerdrOperation(
      "PaneService.focusDirection",
      (direction, input = {}, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "PaneService.focusDirection",
            parsePaneFocusDirectionInput,
            input,
          );
          const response = yield* transport.request(
            "pane.focus_direction",
            { direction, paneId: Option.getOrNull(parsed.paneId) },
            options,
          );
          return yield* decodeHerdrWire(
            parsePaneFocusDirectionResult,
            response.result.focus,
            response.requestId,
          );
        }),
    ),
    resize: defineHerdrOperation("PaneService.resize", (direction, input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.resize", parsePaneResizeInput, input);
        const response = yield* transport.request(
          "pane.resize",
          {
            direction,
            paneId: Option.getOrNull(parsed.paneId),
            amount: Option.getOrNull(parsed.amount),
          },
          options,
        );
        return yield* decodeHerdrWire(
          parsePaneResizeResult,
          response.result.resize,
          response.requestId,
        );
      }),
    ),
    list: defineHerdrOperation("PaneService.list", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.list", parsePaneListInput, input);
        const response = yield* transport.request(
          "pane.list",
          { workspaceId: Option.getOrNull(parsed.workspaceId) },
          options,
        );
        return yield* decodeHerdrWire(parsePanes, response.result.panes, response.requestId);
      }),
    ),
    current: defineHerdrOperation("PaneService.current", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.current", parsePaneCurrentInput, input);
        const response = yield* transport.request(
          "pane.current",
          { callerPaneId: Option.getOrNull(parsed.callerPaneId) },
          options,
        );
        return yield* decodeHerdrWire(parsePane, response.result.pane, response.requestId);
      }),
    ),
    get: defineHerdrOperation("PaneService.get", (id, options = {}) =>
      decodePane("pane.get", id, null, options),
    ),
    focus: defineHerdrOperation("PaneService.focus", (id, options = {}) =>
      decodePane("pane.focus", id, null, options),
    ),
    rename: defineHerdrOperation("PaneService.rename", (id, label, options = {}) =>
      Effect.gen(function* () {
        const parsedLabel =
          label === null
            ? null
            : yield* decodeHerdrInput("PaneService.rename", parsePaneLabel, label);
        return yield* decodePane("pane.rename", id, parsedLabel, options);
      }),
    ),
    setInputRouting: defineHerdrOperation(
      "PaneService.setInputRouting",
      (id, input, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "PaneService.setInputRouting",
            parsePaneInputRoutingInput,
            input,
          );
          yield* transport.request(
            "pane.input.set",
            { paneId: id, rightClick: parsed.rightClick },
            options,
          );
        }),
    ),
    sendText: defineHerdrOperation("PaneService.sendText", (id, text, options = {}) =>
      Effect.gen(function* () {
        const parsedText = yield* decodeHerdrInput("PaneService.sendText", parsePaneText, text);
        yield* transport.request("pane.send_text", { paneId: id, text: parsedText }, options);
      }),
    ),
    sendKeys: defineHerdrOperation("PaneService.sendKeys", (id, keys, options = {}) =>
      Effect.gen(function* () {
        const parsedKeys = yield* decodeHerdrInput(
          "PaneService.sendKeys",
          parsePaneKeySequence,
          keys,
        );
        yield* transport.request("pane.send_keys", { paneId: id, keys: parsedKeys }, options);
      }),
    ),
    sendInput: defineHerdrOperation("PaneService.sendInput", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.sendInput", parsePaneInput, input);
        if (parsed.text === undefined) {
          if (parsed.keys === undefined) {
            return yield* Effect.die(new Error("PaneInput schema produced neither text nor keys"));
          }
          yield* transport.request("pane.send_input", { paneId: id, keys: parsed.keys }, options);
          return;
        }
        if (parsed.keys === undefined) {
          yield* transport.request("pane.send_input", { paneId: id, text: parsed.text }, options);
          return;
        }
        yield* transport.request(
          "pane.send_input",
          { paneId: id, text: parsed.text, keys: parsed.keys },
          options,
        );
      }),
    ),
    read: defineHerdrOperation("PaneService.read", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("PaneService.read", parsePaneReadInput, input);
        const base = { paneId: id, source: parsed.source, lines: Option.getOrNull(parsed.lines) };
        const withFormat = Option.match(parsed.format, {
          onNone: () => base,
          onSome: (format) => ({ ...base, format }),
        });
        const parameters = Option.match(parsed.stripAnsi, {
          onNone: () => withFormat,
          onSome: (stripAnsi) => ({ ...withFormat, stripAnsi }),
        });
        const response = yield* transport.request("pane.read", parameters, options);
        return yield* decodeHerdrWire(
          parsePaneReadResult,
          response.result.read,
          response.requestId,
        );
      }),
    ),
    waitForOutput: defineHerdrOperation("PaneService.waitForOutput", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "PaneService.waitForOutput",
          parsePaneWaitForOutputInput,
          input,
        );
        const base = {
          paneId: id,
          source: parsed.source,
          lines: Option.getOrNull(parsed.lines),
          match: parsed.match,
          timeoutMs: Option.getOrNull(parsed.timeoutMs),
        };
        const parameters = Option.match(parsed.stripAnsi, {
          onNone: () => base,
          onSome: (stripAnsi) => ({ ...base, stripAnsi }),
        });
        const response = yield* transport.request("pane.wait_for_output", parameters, options);
        return yield* decodeHerdrWire(
          parsePaneOutputMatchResult,
          response.result,
          response.requestId,
        );
      }),
    ),
    reportAgent: defineHerdrOperation("PaneService.reportAgent", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "PaneService.reportAgent",
          parsePaneAgentReportInput,
          input,
        );
        yield* transport.request(
          "pane.report_agent",
          {
            paneId: id,
            source: parsed.source,
            agent: parsed.agent,
            state: parsed.state,
            message: Option.getOrNull(parsed.message),
            seq: Option.getOrNull(parsed.sequence),
            agentSessionId: Option.getOrNull(parsed.sessionId),
            agentSessionPath: Option.getOrNull(parsed.sessionPath),
          },
          options,
        );
      }),
    ),
    reportAgentSession: defineHerdrOperation(
      "PaneService.reportAgentSession",
      (id, input, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "PaneService.reportAgentSession",
            parsePaneAgentSessionReportInput,
            input,
          );
          yield* transport.request(
            "pane.report_agent_session",
            {
              paneId: id,
              source: parsed.source,
              agent: parsed.agent,
              seq: Option.getOrNull(parsed.sequence),
              sessionStartSource: Option.getOrNull(parsed.sessionStartSource),
              agentSessionId: Option.getOrNull(parsed.sessionId),
              agentSessionPath: Option.getOrNull(parsed.sessionPath),
            },
            options,
          );
        }),
    ),
    reportMetadata: defineHerdrOperation("PaneService.reportMetadata", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "PaneService.reportMetadata",
          parsePaneMetadataReportInput,
          input,
        );
        const base = {
          paneId: id,
          source: parsed.source,
          agent: Option.getOrNull(parsed.agent),
          appliesToSource: Option.getOrNull(parsed.appliesToSource),
          title: Option.getOrNull(parsed.title),
          displayAgent: Option.getOrNull(parsed.displayAgent),
          seq: Option.getOrNull(parsed.sequence),
          ttlMs: Option.getOrNull(parsed.ttlMs),
        };
        const withStateLabels = Option.match(parsed.stateLabels, {
          onNone: () => base,
          onSome: (stateLabels) => ({ ...base, stateLabels }),
        });
        const withTokens = Option.match(parsed.tokens, {
          onNone: () => withStateLabels,
          onSome: (tokens) => ({ ...withStateLabels, tokens }),
        });
        const withClearTitle = Option.match(parsed.clearTitle, {
          onNone: () => withTokens,
          onSome: (clearTitle) => ({ ...withTokens, clearTitle }),
        });
        const withClearDisplayAgent = Option.match(parsed.clearDisplayAgent, {
          onNone: () => withClearTitle,
          onSome: (clearDisplayAgent) => ({ ...withClearTitle, clearDisplayAgent }),
        });
        const parameters = Option.match(parsed.clearStateLabels, {
          onNone: () => withClearDisplayAgent,
          onSome: (clearStateLabels) => ({ ...withClearDisplayAgent, clearStateLabels }),
        });
        yield* transport.request("pane.report_metadata", parameters, options);
      }),
    ),
    clearAgentAuthority: defineHerdrOperation(
      "PaneService.clearAgentAuthority",
      (id, input = {}, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "PaneService.clearAgentAuthority",
            parsePaneClearAgentAuthorityInput,
            input,
          );
          yield* transport.request(
            "pane.clear_agent_authority",
            {
              paneId: id,
              source: Option.getOrNull(parsed.source),
              seq: Option.getOrNull(parsed.sequence),
            },
            options,
          );
        }),
    ),
    releaseAgent: defineHerdrOperation("PaneService.releaseAgent", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "PaneService.releaseAgent",
          parsePaneReleaseAgentInput,
          input,
        );
        yield* transport.request(
          "pane.release_agent",
          {
            paneId: id,
            source: parsed.source,
            agent: parsed.agent,
            seq: Option.getOrNull(parsed.sequence),
          },
          options,
        );
      }),
    ),
    close: defineHerdrOperation("PaneService.close", (id, options = {}) =>
      transport.request("pane.close", { paneId: id }, options).pipe(Effect.asVoid),
    ),
  });
});

function makePaneGraphicsWriter(
  transport: IHerdrTransport,
  paneId: PaneId,
  input: PaneGraphicsStreamInputEncoded,
  options: HerdrTransportRequestOptionsEncoded,
): Effect.Effect<PaneGraphicsWriter, HerdrTransportRequestError, Scope.Scope> {
  return Effect.gen(function* () {
    const parsedInput = yield* decodeHerdrInput(
      "PaneService.graphics.openLayerStream",
      parsePaneGraphicsStreamInput,
      input,
    );
    const baseParameters = {
      paneId,
      layerId: Option.getOrNull(parsedInput.layerId),
    };
    const parameters = Option.match(parsedInput.zIndex, {
      onNone: () => baseParameters,
      onSome: (zIndex) => ({ ...baseParameters, zIndex }),
    });
    const socketScope = yield* Scope.fork(yield* Scope.Scope);
    const stream = yield* transport.openStream("pane.graphics.stream", parameters, options).pipe(
      Scope.provide(socketScope),
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(socketScope, exit) : Effect.void,
      ),
    );
    const responses = yield* Queue.unbounded<PaneGraphicsStreamMessage>();
    const terminalFailure = yield* Ref.make<Option.Option<PaneGraphicsStreamFailure>>(
      Option.none(),
    );
    const writerSemaphore = yield* Semaphore.make(1);

    const finishReader = (error: PaneGraphicsStreamFailure): Effect.Effect<void> =>
      Ref.set(terminalFailure, Option.some(error)).pipe(
        Effect.andThen(Queue.offer(responses, { _tag: "Failure", error })),
        Effect.asVoid,
      );

    yield* decodePaneGraphicsResponseStream(stream.readBytes, stream.requestId).pipe(
      Stream.runForEach((message) => Queue.offer(responses, message)),
      Effect.matchEffect({
        onFailure: finishReader,
        onSuccess: () => finishReader(new HerdrGraphicsStreamClosed(stream.requestId)),
      }),
      Effect.forkIn(socketScope),
    );

    yield* Scope.addFinalizer(
      socketScope,
      finishReader(new HerdrGraphicsStreamClosed(stream.requestId)),
    );

    const failIfClosed = Effect.gen(function* () {
      const failure = yield* Ref.get(terminalFailure);
      if (Option.isSome(failure)) return yield* failure.value;
    });

    const closeWriter = Effect.gen(function* () {
      yield* Ref.set(terminalFailure, Option.some(new HerdrGraphicsStreamClosed(stream.requestId)));
      yield* Scope.close(socketScope, Exit.void);
    });

    const closeOnWriteFailure = <A, E extends PaneGraphicsStreamFailure, R>(
      effect: Effect.Effect<A, E, R>,
    ) =>
      effect.pipe(
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit)) return Effect.void;
          // Invalid request options fail before writing bytes and leave the writer usable.
          return exit.cause.reasons.every(
            (reason) => reason._tag === "Fail" && reason.error._tag === "HerdrInvalidInput",
          )
            ? Effect.void
            : closeWriter;
        }),
      );

    return {
      paneId,
      write: defineHerdrOperation("PaneService.graphics.write", (frame, writeOptions = {}) =>
        writerSemaphore.withPermit(
          Effect.gen(function* () {
            yield* failIfClosed;
            const parsed = yield* decodeGraphicsFrame(
              frame,
              "graphics_stream",
              MAX_GRAPHICS_STREAM_FRAME_BYTES,
              stream.requestId,
            );
            const header = {
              format: parsed.format,
              image_width: parsed.imageWidth,
              image_height: parsed.imageHeight,
              data_length: parsed.data.byteLength,
              placement: Option.match(parsed.placement, {
                onNone: () => undefined,
                onSome: encodeGraphicsStreamPlacement,
              }),
            };
            const bytes = Buffer.concat([
              Buffer.from(JSON.stringify(header) + "\n"),
              Buffer.from(parsed.data),
            ]);
            yield* transport
              .writeStreamBytes(stream, bytes, writeOptions)
              .pipe(closeOnWriteFailure);
          }),
        ),
      ),
      writeFile: defineHerdrOperation(
        "PaneService.graphics.writeFile",
        (frame, writeOptions = {}) =>
          writerSemaphore.withPermit(
            Effect.gen(function* () {
              yield* failIfClosed;
              const parsed = yield* parsePaneGraphicsFileFrame(frame).pipe(
                Effect.mapError(
                  () =>
                    new HerdrInvalidFrame("graphics_stream", "schema_mismatch", stream.requestId),
                ),
              );
              const header = {
                format: parsed.format,
                image_width: parsed.imageWidth,
                image_height: parsed.imageHeight,
                file: { path: parsed.filePath },
                sequence: parsed.sequence,
                revision: parsed.revision,
                placement: Option.match(parsed.placement, {
                  onNone: () => undefined,
                  onSome: encodeGraphicsStreamPlacement,
                }),
              };
              // Once submitted, interruption or an invalid acknowledgement makes the frame
              // outcome uncertain. Close before releasing the permit to prevent stale replies.
              const acknowledgement = Effect.gen(function* () {
                const response = yield* Queue.take(responses);
                if (response._tag === "Failure") return yield* response.error;
                const expectedId = `${stream.requestId}:file:${parsed.sequence}`;
                if (response.id !== expectedId || response.value.sequence !== parsed.sequence) {
                  return yield* new HerdrInvalidResponse(
                    "correlation_mismatch",
                    stream.requestId,
                    new Error(`Herdr returned graphics acknowledgement ID ${response.id}`),
                  );
                }
                return response.value;
              });
              return yield* transport
                .writeStreamBytes(
                  stream,
                  Buffer.from(JSON.stringify(header) + "\n"),
                  writeOptions,
                  acknowledgement,
                )
                .pipe(closeOnWriteFailure);
            }),
          ),
      ),
    };
  });
}

function decodePaneGraphicsResponseStream(
  bytes: Stream.Stream<Uint8Array, HerdrTransportError>,
  requestId: string,
): Stream.Stream<PaneGraphicsStreamMessage, PaneGraphicsStreamFailure> {
  return bytes.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.filter((line) => line.length > 0),
    Stream.mapEffect((line) => decodePaneGraphicsResponseLine(line, requestId)),
  );
}

function decodePaneGraphicsResponseLine(
  line: string,
  requestId: string,
): Effect.Effect<PaneGraphicsStreamMessage, HerdrInvalidResponse | HerdrServerError> {
  return Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => JSON.parse(line),
      catch: (cause) => new HerdrInvalidResponse("malformed_json", requestId, cause),
    });
    const response = yield* parsePaneGraphicsStreamResponseEnvelope(json).pipe(
      Effect.mapError((cause) => new HerdrInvalidResponse("schema_mismatch", requestId, cause)),
    );
    if ("error" in response) {
      return yield* new HerdrServerError(response.error.code, response.error.message, response.id);
    }
    return {
      _tag: "Acknowledgement",
      id: response.id,
      value: {
        sequence: response.result.sequence,
        revision: response.result.revision,
      },
    };
  });
}

/**
 * Provides pane operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const paneServiceLayerWithoutDependencies: Layer.Layer<PaneService, never, HerdrTransport> =
  Layer.effect(PaneService, makePaneService);

/**
 * Production pane-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const paneServiceLayer = paneServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);

function encodePaneMoveDestination(destination: PaneMoveInput["destination"]) {
  switch (destination.type) {
    case "tab":
      return {
        type: destination.type,
        tabId: destination.tabId,
        targetPaneId: Option.getOrNull(destination.targetPaneId),
        split: destination.split,
        ratio: Option.getOrNull(destination.ratio),
      };
    case "new_tab":
      return {
        type: destination.type,
        workspaceId: Option.getOrNull(destination.workspaceId),
        label: Option.getOrNull(destination.label),
      };
    case "new_workspace":
      return {
        type: destination.type,
        label: Option.getOrNull(destination.label),
        tabLabel: Option.getOrNull(destination.tabLabel),
      };
  }
}

function encodeGraphicsPlacement(placement: PaneGraphicsPlacement) {
  const a = Option.match(placement.viewportCol, {
    onNone: () => ({}),
    onSome: (viewportCol) => ({ viewportCol }),
  });
  const b = Option.match(placement.viewportRow, {
    onNone: () => a,
    onSome: (viewportRow) => ({ ...a, viewportRow }),
  });
  const c = Option.match(placement.gridCols, {
    onNone: () => b,
    onSome: (gridCols) => ({ ...b, gridCols }),
  });
  return Option.match(placement.gridRows, {
    onNone: () => c,
    onSome: (gridRows) => ({ ...c, gridRows }),
  });
}

function encodeGraphicsStreamPlacement(placement: PaneGraphicsPlacement) {
  const a = Option.match(placement.viewportCol, {
    onNone: () => ({}),
    onSome: (viewport_col) => ({ viewport_col }),
  });
  const b = Option.match(placement.viewportRow, {
    onNone: () => a,
    onSome: (viewport_row) => ({ ...a, viewport_row }),
  });
  const c = Option.match(placement.gridCols, {
    onNone: () => b,
    onSome: (grid_cols) => ({ ...b, grid_cols }),
  });
  return Option.match(placement.gridRows, {
    onNone: () => c,
    onSome: (grid_rows) => ({ ...c, grid_rows }),
  });
}

function decodeGraphicsFrame(
  frame: PaneGraphicsFrameEncoded,
  operation: "graphics_set" | "graphics_stream",
  maximumBytes: number,
  requestId?: string,
) {
  return Effect.gen(function* () {
    const parsed = yield* parsePaneGraphicsFrame(frame).pipe(
      Effect.mapError(() => new HerdrInvalidFrame(operation, "schema_mismatch", requestId)),
    );
    if (parsed.data.byteLength === 0) {
      return yield* new HerdrInvalidFrame(operation, "empty_data", requestId);
    }
    if (parsed.data.byteLength > maximumBytes) {
      return yield* new HerdrImageTooLarge(
        operation,
        parsed.data.byteLength,
        maximumBytes,
        requestId,
      );
    }
    return parsed;
  });
}

function decodeGraphicsSetFrame(
  frame: PaneGraphicsSetFrameEncoded,
  operation: "graphics_set",
  maximumBytes: number,
) {
  return Effect.gen(function* () {
    const parsed = yield* parsePaneGraphicsSetFrame(frame).pipe(
      Effect.mapError(() => new HerdrInvalidFrame(operation, "schema_mismatch")),
    );
    if (parsed.data.byteLength === 0) {
      return yield* new HerdrInvalidFrame(operation, "empty_data");
    }
    if (parsed.data.byteLength > maximumBytes) {
      return yield* new HerdrImageTooLarge(operation, parsed.data.byteLength, maximumBytes);
    }
    return parsed;
  });
}
