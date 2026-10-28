/**
 * Invokes endpoint-issued custom commands with explicit workspace, tab, or pane targets.
 * Command execution can change focus and is never retried automatically.
 * @since 0.9.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import {
  type HerdrCommandId,
  type PaneId,
  type TabId,
  WorkspaceId,
  TabId as TabIdSchema,
} from "./herdr-domain.ts";
import { PaneSelectionReadInput } from "./herdr-pane-interaction-models.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import { decodeHerdrInput } from "./herdr-schema-boundary.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

/** Optional parent assertion for a tab-scoped command. @category schemas @since 0.9.0 */
export const CommandTabInput = Schema.Struct({
  expectedWorkspaceId: Schema.optionalKey(WorkspaceId),
});
/** Parsed tab-scoped command input. @category models @since 0.9.0 */
export interface CommandTabInput extends Schema.Schema.Type<typeof CommandTabInput> {}
/** Caller-supplied tab parent assertion. @category inputs @since 0.9.0 */
export type CommandTabInputEncoded = typeof CommandTabInput.Encoded;
/** Pane command selection always belongs to the positional pane target. @category schemas @since 0.9.0 */
export const CommandPaneInput = Schema.Struct({
  expectedWorkspaceId: Schema.optionalKey(WorkspaceId),
  expectedTabId: Schema.optionalKey(TabIdSchema),
  selection: Schema.optionalKey(PaneSelectionReadInput),
});
/** Parsed pane-scoped command input. @category models @since 0.9.0 */
export interface CommandPaneInput extends Schema.Schema.Type<typeof CommandPaneInput> {}
/** Caller-supplied pane command selection and parent assertions. @category inputs @since 0.9.0 */
export type CommandPaneInputEncoded = typeof CommandPaneInput.Encoded;
const parseCommandTab = Schema.decodeEffect(CommandTabInput, { onExcessProperty: "error" });
const parseCommandPane = Schema.decodeEffect(CommandPaneInput, { onExcessProperty: "error" });

/** Custom command execution by opaque ID, never arbitrary shell text. @category services @since 0.9.0 */
export interface ICommandService {
  /** Invokes a command in current server context. */
  readonly invoke: (
    commandId: HerdrCommandId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Invokes a command in an explicit workspace. */
  readonly invokeInWorkspace: (
    commandId: HerdrCommandId,
    workspaceId: WorkspaceId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Invokes a command in a tab with an optional workspace assertion. */
  readonly invokeInTab: (
    commandId: HerdrCommandId,
    tabId: TabId,
    input?: CommandTabInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Invokes a command in a pane; selection text is resolved on the server. */
  readonly invokeInPane: (
    commandId: HerdrCommandId,
    paneId: PaneId,
    input?: CommandPaneInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
}
/** Yieldable custom-command capability. @category services @since 0.9.0 */
export class CommandService extends Context.Service<CommandService, ICommandService>()(
  "herdr-sdk/CommandService",
) {}
/** Constructs commands using the shared socket transport. @category constructors @since 0.9.0 */
export const makeCommandService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return CommandService.of({
    invoke: defineHerdrOperation("CommandService.invoke", (commandId, options = {}) =>
      transport.request("command.invoke", { commandId }, options).pipe(Effect.asVoid),
    ),
    invokeInWorkspace: defineHerdrOperation(
      "CommandService.invokeInWorkspace",
      (commandId, workspaceId, options = {}) =>
        transport
          .request("command.invoke", { commandId, workspaceId }, options)
          .pipe(Effect.asVoid),
    ),
    invokeInTab: defineHerdrOperation(
      "CommandService.invokeInTab",
      (commandId, tabId, input = {}, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "CommandService.invokeInTab",
            parseCommandTab,
            input,
          );
          yield* transport.request(
            "command.invoke",
            {
              commandId,
              tabId,
              ...(parsed.expectedWorkspaceId === undefined
                ? {}
                : { workspaceId: parsed.expectedWorkspaceId }),
            },
            options,
          );
        }),
    ),
    invokeInPane: defineHerdrOperation(
      "CommandService.invokeInPane",
      (commandId, paneId, input = {}, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "CommandService.invokeInPane",
            parseCommandPane,
            input,
          );
          yield* transport.request(
            "command.invoke",
            {
              commandId,
              paneId,
              ...(parsed.expectedWorkspaceId === undefined
                ? {}
                : { workspaceId: parsed.expectedWorkspaceId }),
              ...(parsed.expectedTabId === undefined ? {} : { tabId: parsed.expectedTabId }),
              ...(parsed.selection === undefined
                ? {}
                : { selection: { paneId, ...parsed.selection } }),
            },
            options,
          );
        }),
    ),
  });
});
/** Provides commands while preserving the transport requirement. @category layers @since 0.9.0 */
export const commandServiceLayerWithoutDependencies = Layer.effect(
  CommandService,
  makeCommandService,
);
/** Production custom-command service Layer. @category layers @since 0.9.0 */
export const commandServiceLayer = commandServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
