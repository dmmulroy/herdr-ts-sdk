/**
 * Controls Herdr tab lifecycle, focus, labels, and ordering.
 *
 * Tab creation returns its root pane atomically, while list and move operations preserve server display order.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import { type TabId } from "./herdr-domain.ts";
import {
  Tab,
  TabCreateInput,
  type TabCreateInputEncoded,
  TabCreateResult,
  TabListInput,
  type TabListInputEncoded,
  TabMoveInput,
  type TabMoveInputEncoded,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseTab = Schema.decodeUnknownEffect(Tab);
const parseTabs = Schema.decodeUnknownEffect(Schema.Array(Tab));
const parseTabCreateInput = Schema.decodeUnknownEffect(TabCreateInput);
const parseTabCreateResult = Schema.decodeUnknownEffect(TabCreateResult);
const parseTabLabel = Schema.decodeUnknownEffect(Schema.String);
const parseTabListInput = Schema.decodeUnknownEffect(TabListInput);
const parseTabMoveInput = Schema.decodeUnknownEffect(TabMoveInput);

/**
 * Tab lifecycle, ordering, and focus capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface ITabService {
  /** Creates a tab and root pane. */
  readonly create: (
    input?: TabCreateInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<TabCreateResult, HerdrTransportRequestError>;
  /** Lists tabs, optionally within one workspace. */
  readonly list: (
    input?: TabListInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly Tab[], HerdrTransportRequestError>;
  /** Reads one tab. */
  readonly get: (
    id: TabId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Tab, HerdrTransportRequestError>;
  /** Focuses one tab. */
  readonly focus: (
    id: TabId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Tab, HerdrTransportRequestError>;
  /** Renames one tab. */
  readonly rename: (
    id: TabId,
    label: string,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Tab, HerdrTransportRequestError>;
  /** Moves one tab to an insertion index. */
  readonly move: (
    id: TabId,
    input: TabMoveInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly Tab[], HerdrTransportRequestError>;
  /** Closes one tab. */
  readonly close: (
    id: TabId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for Herdr tab operations.
 *
 * @category services
 * @since 0.8.2
 */
export class TabService extends Context.Service<TabService, ITabService>()(
  "@rudironsoni/sdk/TabService",
) {}

/**
 * Constructs tab operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeTabService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  return TabService.of({
    create: defineHerdrOperation("TabService.create", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("TabService.create", parseTabCreateInput, input);
        const parametersWithoutEnvAndFocus = {
          workspaceId: Option.getOrNull(parsed.workspaceId),
          cwd: Option.getOrNull(parsed.cwd),
          label: Option.getOrNull(parsed.label),
        };
        const parametersWithoutFocus = Option.match(parsed.env, {
          onNone: () => parametersWithoutEnvAndFocus,
          onSome: (env) => ({ ...parametersWithoutEnvAndFocus, env }),
        });
        const parameters = Option.match(parsed.focus, {
          onNone: () => parametersWithoutFocus,
          onSome: (focus) => ({ ...parametersWithoutFocus, focus }),
        });
        const response = yield* transport.request("tab.create", parameters, options);
        return yield* decodeHerdrWire(parseTabCreateResult, response.result, response.requestId);
      }),
    ),
    list: defineHerdrOperation("TabService.list", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("TabService.list", parseTabListInput, input);
        const response = yield* transport.request(
          "tab.list",
          { workspaceId: Option.getOrNull(parsed.workspaceId) },
          options,
        );
        return yield* decodeHerdrWire(parseTabs, response.result.tabs, response.requestId);
      }),
    ),
    get: defineHerdrOperation("TabService.get", (id, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("tab.get", { tabId: id }, options);
        return yield* decodeHerdrWire(parseTab, response.result.tab, response.requestId);
      }),
    ),
    focus: defineHerdrOperation("TabService.focus", (id, options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("tab.focus", { tabId: id }, options);
        return yield* decodeHerdrWire(parseTab, response.result.tab, response.requestId);
      }),
    ),
    rename: defineHerdrOperation("TabService.rename", (id, label, options = {}) =>
      Effect.gen(function* () {
        const parsedLabel = yield* decodeHerdrInput("TabService.rename", parseTabLabel, label);
        const response = yield* transport.request(
          "tab.rename",
          { tabId: id, label: parsedLabel },
          options,
        );
        return yield* decodeHerdrWire(parseTab, response.result.tab, response.requestId);
      }),
    ),
    move: defineHerdrOperation("TabService.move", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("TabService.move", parseTabMoveInput, input);
        const response = yield* transport.request(
          "tab.move",
          { tabId: id, insertIndex: parsed.insertIndex },
          options,
        );
        return yield* decodeHerdrWire(parseTabs, response.result.tabs, response.requestId);
      }),
    ),
    close: defineHerdrOperation("TabService.close", (id, options = {}) =>
      transport.request("tab.close", { tabId: id }, options).pipe(Effect.asVoid),
    ),
  });
});

/**
 * Provides tab operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const tabServiceLayerWithoutDependencies: Layer.Layer<TabService, never, HerdrTransport> =
  Layer.effect(TabService, makeTabService);

/**
 * Production tab-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const tabServiceLayer = tabServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
