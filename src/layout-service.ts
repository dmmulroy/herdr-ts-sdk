/**
 * Exports, applies, and resizes declarative Herdr pane layouts.
 *
 * Recursive layout values let callers reproduce terminal arrangements without scripting a sequence of focus and split gestures.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { HerdrAbsolutePath, HerdrEnvironment, PaneId } from "./herdr-domain.ts";
import {
  LayoutApplyInput,
  type LayoutApplyInputEncoded,
  LayoutDescription,
  LayoutSetSplitRatioInput,
  type LayoutSetSplitRatioInputEncoded,
  LayoutTarget,
  type LayoutTarget as LayoutTargetValue,
  type LayoutTargetEncoded,
  type SplitDirection,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseLayoutApplyInput = Schema.decodeUnknownEffect(LayoutApplyInput);
const parseLayoutDescription = Schema.decodeUnknownEffect(LayoutDescription);
const parseLayoutSetSplitRatioInput = Schema.decodeUnknownEffect(LayoutSetSplitRatioInput);
const parseLayoutTarget = Schema.decodeUnknownEffect(LayoutTarget);

/**
 * Declarative layout export, application, and split-ratio capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface ILayoutService {
  /** Exports a tab layout selected by tab, pane, or foreground focus. */
  readonly export: (
    target?: LayoutTargetEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<LayoutDescription, HerdrTransportRequestError>;
  /** Applies a recursive declarative layout. */
  readonly apply: (
    input: LayoutApplyInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<LayoutDescription, HerdrTransportRequestError>;
  /** Updates one split ratio addressed by a boolean tree path. */
  readonly setSplitRatio: (
    target: LayoutTargetEncoded | undefined,
    input: LayoutSetSplitRatioInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<LayoutDescription, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for Herdr declarative layout operations.
 *
 * @category services
 * @since 0.8.2
 */
export class LayoutService extends Context.Service<LayoutService, ILayoutService>()(
  "@rudironsoni/sdk/LayoutService",
) {}

/**
 * Constructs layout operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeLayoutService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  return LayoutService.of({
    export: defineHerdrOperation("LayoutService.export", (target, options = {}) =>
      Effect.gen(function* () {
        const parsedTarget =
          target === undefined
            ? undefined
            : yield* decodeHerdrInput("LayoutService.export", parseLayoutTarget, target);
        const parameters = encodeLayoutTarget(parsedTarget);
        const response = yield* transport.request("layout.export", parameters, options);
        return yield* decodeHerdrWire(
          parseLayoutDescription,
          response.result.layout,
          response.requestId,
        );
      }),
    ),
    apply: defineHerdrOperation("LayoutService.apply", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("LayoutService.apply", parseLayoutApplyInput, input);
        const root = encodeLayoutNode(parsed.root);
        const base = {
          workspaceId: Option.getOrNull(parsed.workspaceId),
          tabId: Option.getOrNull(parsed.replaceTabId),
          tabLabel: Option.getOrNull(parsed.tabLabel),
          root,
        };
        const parameters = Option.match(parsed.focus, {
          onNone: () => base,
          onSome: (focus) => ({ ...base, focus }),
        });
        const response = yield* transport.request("layout.apply", parameters, options);
        return yield* decodeHerdrWire(
          parseLayoutDescription,
          response.result.layout,
          response.requestId,
        );
      }),
    ),
    setSplitRatio: defineHerdrOperation(
      "LayoutService.setSplitRatio",
      (target, input, options = {}) =>
        Effect.gen(function* () {
          const parsedTarget =
            target === undefined
              ? undefined
              : yield* decodeHerdrInput(
                  "LayoutService.setSplitRatio.target",
                  parseLayoutTarget,
                  target,
                );
          const parsed = yield* decodeHerdrInput(
            "LayoutService.setSplitRatio",
            parseLayoutSetSplitRatioInput,
            input,
          );
          const selected = encodeLayoutTarget(parsedTarget);
          const response = yield* transport.request(
            "layout.set_split_ratio",
            { ...selected, path: parsed.path, ratio: parsed.ratio },
            options,
          );
          return yield* decodeHerdrWire(
            parseLayoutDescription,
            response.result.layout,
            response.requestId,
          );
        }),
    ),
  });
});

/**
 * Provides layout operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const layoutServiceLayerWithoutDependencies: Layer.Layer<
  LayoutService,
  never,
  HerdrTransport
> = Layer.effect(LayoutService, makeLayoutService);

/**
 * Production layout-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const layoutServiceLayer = layoutServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);

function encodeLayoutNode(node: LayoutApplyInput["root"]):
  | {
      readonly type: "pane";
      readonly paneId: PaneId | null;
      readonly label: string | null;
      readonly cwd: HerdrAbsolutePath | null;
      readonly command: readonly string[] | null;
      readonly env?: HerdrEnvironment;
    }
  | {
      readonly type: "split";
      readonly direction: SplitDirection;
      readonly ratio: number;
      readonly first: ReturnType<typeof encodeLayoutNode>;
      readonly second: ReturnType<typeof encodeLayoutNode>;
    } {
  if (node.type === "split") {
    return {
      type: node.type,
      direction: node.direction,
      ratio: node.ratio,
      first: encodeLayoutNode(node.first),
      second: encodeLayoutNode(node.second),
    };
  }
  const base = {
    type: node.type,
    paneId: Option.getOrNull(node.paneId),
    label: Option.getOrNull(node.label),
    cwd: Option.getOrNull(node.cwd),
    command: Option.getOrNull(node.command),
  };
  return Option.match(node.env, {
    onNone: () => base,
    onSome: (env) => ({ ...base, env }),
  });
}

function encodeLayoutTarget(target: LayoutTargetValue | undefined) {
  return target === undefined
    ? { paneId: null, tabId: null }
    : "tabId" in target
      ? { paneId: null, tabId: target.tabId }
      : { paneId: target.paneId, tabId: null };
}
