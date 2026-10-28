/**
 * Controls Herdr panes, terminal input and output, geometry, and metadata.
 *
 * Images are not a socket API: applications draw them by writing standard Kitty graphics to their own pane's terminal output.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
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
import { makePaneInteraction, type IPaneInteraction } from "./pane-interaction.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import { encodePaneReadParameters } from "./herdr-wire-encoder.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parsePane = Schema.decodeUnknownEffect(Pane);
const parsePanes = Schema.decodeUnknownEffect(Schema.Array(Pane));
const parsePaneAgentReportInput = Schema.decodeEffect(PaneAgentReportInput);
const parsePaneAgentSessionReportInput = Schema.decodeEffect(PaneAgentSessionReportInput);
const parsePaneClearAgentAuthorityInput = Schema.decodeEffect(PaneClearAgentAuthorityInput);
const parsePaneCurrentInput = Schema.decodeEffect(PaneCurrentInput);
const parsePaneEdgesResult = Schema.decodeUnknownEffect(PaneEdgesResult);
const parsePaneFocusDirectionInput = Schema.decodeEffect(PaneFocusDirectionInput);
const parsePaneFocusDirectionResult = Schema.decodeUnknownEffect(PaneFocusDirectionResult);
const parsePaneInput = Schema.decodeEffect(PaneInput);
const parsePaneInputRoutingInput = Schema.decodeEffect(PaneInputRoutingInput);
const parsePaneKeySequence = Schema.decodeEffect(HerdrKeySequence);
const parsePaneLabel = Schema.decodeEffect(Schema.String);
const parsePaneLayoutSnapshot = Schema.decodeUnknownEffect(PaneLayoutSnapshot);
const parsePaneListInput = Schema.decodeEffect(PaneListInput);
const parsePaneMetadataReportInput = Schema.decodeEffect(PaneMetadataReportInput);
const parsePaneMoveInput = Schema.decodeEffect(PaneMoveInput);
const parsePaneMoveResult = Schema.decodeUnknownEffect(PaneMoveResult);
const parsePaneNeighborResult = Schema.decodeUnknownEffect(PaneNeighborResult);
const parsePaneOutputMatchResult = Schema.decodeUnknownEffect(PaneOutputMatchResult);
const parsePaneProcessInfo = Schema.decodeUnknownEffect(PaneProcessInfo);
const parsePaneReadInput = Schema.decodeEffect(PaneReadInput);
const parsePaneReadResult = Schema.decodeUnknownEffect(PaneReadResult);
const parsePaneReleaseAgentInput = Schema.decodeEffect(PaneReleaseAgentInput);
const parsePaneResizeInput = Schema.decodeEffect(PaneResizeInput);
const parsePaneResizeResult = Schema.decodeUnknownEffect(PaneResizeResult);
const parsePaneSplitInput = Schema.decodeEffect(PaneSplitInput);
const parsePaneSwapInput = Schema.decodeEffect(PaneSwapInput);
const parsePaneSwapResult = Schema.decodeUnknownEffect(PaneSwapResult);
const parsePaneText = Schema.decodeEffect(Schema.String);
const parsePaneWaitForOutputInput = Schema.decodeEffect(PaneWaitForOutputInput);
const parsePaneZoomInput = Schema.decodeEffect(PaneZoomInput);
const parsePaneZoomResult = Schema.decodeUnknownEffect(PaneZoomResult);
/**
 * Pane lifecycle, geometry, I/O, and reporting capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IPaneService extends IPaneInteraction {
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
  "herdr-sdk/PaneService",
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

  return PaneService.of({
    ...makePaneInteraction(transport),
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
          parsed.direction !== undefined
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
        const parameters = yield* encodePaneReadParameters(parsed).pipe(Effect.orDie);
        const response = yield* transport.request(
          "pane.read",
          { paneId: id, ...parameters },
          options,
        );
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
            resumeArgv: Option.getOrNull(parsed.resumeArgv),
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
              resumeArgv: Option.getOrNull(parsed.resumeArgv),
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
