import type { Duration, Effect, Option, Stream } from "effect";
import type {
  AgentTarget,
  AgentTargetEncoded,
  HerdrAbsolutePath,
  HerdrRequestDeadline,
  HerdrSplitRatio,
  IHerdrSdk,
  LayoutNode,
  LayoutTargetEncoded,
  PaneAgentSessionReportInput,
  PaneMetadataReportInputEncoded,
  PaneSwapInputEncoded,
  WorktreeOpenInput,
  WorkspaceId,
} from "./index.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;
type Success<Value> = Value extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;
type Emitted<Value> = Value extends Stream.Stream<infer A, infer _E, infer _R> ? A : never;

type WorktreeSelectionFixture = {
  workspaceId: Option.None<WorkspaceId>;
  cwd: Option.None<HerdrAbsolutePath>;
  trustRepository: Option.None<boolean>;
  path: Option.None<HerdrAbsolutePath>;
  branch: Option.Some<string>;
  label: Option.None<string>;
  focus: Option.None<boolean>;
};
type AgentSessionFixture = {
  source: string;
  agent: string;
  sequence: Option.None<never>;
  sessionStartSource: Option.None<string>;
  sessionId: Option.Some<string>;
  sessionPath: Option.None<HerdrAbsolutePath>;
};

declare const sdk: IHerdrSdk;
const wait = sdk.events.wait({ type: "workspace.created" });
const subscription = sdk.events.subscribe([
  { type: "workspace.created" },
  { type: "pane.closed", paneId: "pane-1" },
]);
sdk.agents.get({ kind: "pane", paneId: "pane-1" });
sdk.agents.get({ kind: "agent", name: "worker" });
sdk.agents.get({ paneId: "pane-1" });
sdk.agents.get({ name: "worker" });
sdk.layouts.export({ tabId: "tab-1" });
sdk.layouts.export({ paneId: "pane-1" });
sdk.panes.swap({ direction: "right" });
sdk.panes.swap({ sourcePaneId: "pane-1", targetPaneId: "pane-2" });

// @ts-expect-error Agent targets cannot select both pane and name.
sdk.agents.get({ paneId: "pane-1", name: "worker" });
// @ts-expect-error The discriminator must agree with the selector.
sdk.agents.get({ kind: "agent", paneId: "pane-1" });
// @ts-expect-error Explicit undefined does not erase a competing selector.
sdk.agents.get({ paneId: "pane-1", name: undefined });
// @ts-expect-error Layout targets cannot select both tab and pane.
sdk.layouts.export({ tabId: "tab-1", paneId: "pane-1" });
// @ts-expect-error Pane swaps cannot select both directional and explicit-ID modes.
sdk.panes.swap({ direction: "right", sourcePaneId: "pane-1", targetPaneId: "pane-2" });

/** Compile-time contracts for boundary inference, exclusive targets, and retained domain evidence. */
export type SchemaContracts = [
  Assert<Equal<Success<typeof wait>["type"], "workspace.created">>,
  Assert<Equal<Emitted<typeof subscription>["type"], "workspace.created" | "pane.closed">>,
  Assert<Equal<AgentTarget["kind"], "pane" | "agent">>,
  Assert<Equal<{ paneId: string; name: string } extends AgentTargetEncoded ? true : false, false>>,
  Assert<
    Equal<{ paneId: string; tabId: string } extends LayoutTargetEncoded ? true : false, false>
  >,
  Assert<
    Equal<
      {
        direction: "right";
        sourcePaneId: string;
        targetPaneId: string;
      } extends PaneSwapInputEncoded
        ? true
        : false,
      false
    >
  >,
  Assert<Equal<Extract<LayoutNode, { type: "split" }>["ratio"], HerdrSplitRatio>>,
  Assert<Equal<Duration.Duration extends HerdrRequestDeadline ? true : false, false>>,
  Assert<
    Equal<
      NonNullable<PaneMetadataReportInputEncoded["stateLabels"]>,
      {
        readonly idle?: string;
        readonly working?: string;
        readonly blocked?: string;
        readonly done?: string;
        readonly unknown?: string;
      }
    >
  >,
  Assert<Equal<WorktreeSelectionFixture extends WorktreeOpenInput ? true : false, true>>,
  Assert<Equal<AgentSessionFixture extends PaneAgentSessionReportInput ? true : false, true>>,
  Assert<
    Equal<
      Omit<WorktreeSelectionFixture, "branch"> & {
        branch: Option.None<string>;
      } extends WorktreeOpenInput
        ? true
        : false,
      false
    >
  >,
  Assert<
    Equal<
      Omit<WorktreeSelectionFixture, "workspaceId" | "cwd"> & {
        workspaceId: Option.Some<WorkspaceId>;
        cwd: Option.Some<HerdrAbsolutePath>;
      } extends WorktreeOpenInput
        ? true
        : false,
      false
    >
  >,
  Assert<
    Equal<
      Omit<AgentSessionFixture, "sessionPath"> & {
        sessionPath: Option.Some<HerdrAbsolutePath>;
      } extends PaneAgentSessionReportInput
        ? true
        : false,
      false
    >
  >,
];
