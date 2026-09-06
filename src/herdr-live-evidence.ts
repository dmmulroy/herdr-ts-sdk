/**
 * Assertion-bearing workflow for explicitly owned isolated Herdr evidence sessions.
 * This development recipe is not part of the published SDK entrypoint.
 * @since 0.8.2
 */
import { Effect, Schema } from "effect";
import { HerdrSdk } from "./index.ts";
import type { HerdrTransportRequestError } from "./herdr-transport.ts";
import type { SdkLiveEvidenceResult, SdkLiveEvidenceStep } from "../scripts/sdk-live-evidence.mjs";

/**
 * Assertion failure records a bounded check identity, never raw terminal diagnostics.
 * @category errors
 * @since 0.8.2
 */
export class HerdrLiveEvidenceAssertion extends Schema.TaggedError<HerdrLiveEvidenceAssertion>()(
  "HerdrLiveEvidenceAssertion",
  { checkId: Schema.String, message: Schema.String },
) {}

/** Execute only in a caller-owned disposable session. UI gates authorize each action exactly once.
 * SDK assertions establish topology and output, while the caller independently observes actual UI paint.
 * Failure cleanup belongs to the owning sandbox, including uncertain create outcomes.
 * @category workflows
 * @since 0.8.2
 */
export function executeHerdrLiveEvidence<E, R>(
  checks: Array<SdkLiveEvidenceResult["checks"][number]>,
  onStep: (step: SdkLiveEvidenceStep) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E | HerdrTransportRequestError | HerdrLiveEvidenceAssertion, R | HerdrSdk> {
  return Effect.gen(function* () {
    const sdk = yield* HerdrSdk;
    const check = (
      chapterId: SdkLiveEvidenceStep["id"],
      id: string,
      label: string,
      expected: string,
      observed: string,
      passed: boolean,
    ) =>
      Effect.gen(function* () {
        checks.push({
          id,
          chapterId,
          label,
          expected,
          observed,
          status: passed ? "passed" : "failed",
        });
        if (!passed)
          return yield* Effect.fail(
            new HerdrLiveEvidenceAssertion({
              checkId: id,
              message:
                "Herdr live evidence assertion failed: inspect the owned session and partial checks before rerunning.",
            }),
          );
      });
    const gate = (
      id: SdkLiveEvidenceStep["id"],
      phase: SdkLiveEvidenceStep["phase"],
      caption: string,
      expectedText: ReadonlyArray<string>,
      absentText: ReadonlyArray<string> = [],
    ) => onStep({ id, phase, caption, expectedText, absentText });

    const workspaces = yield* sdk.workspaces.list();
    yield* check(
      "landing",
      "isolated-workspace",
      "One isolated workspace",
      "1",
      String(workspaces.length),
      workspaces.length === 1,
    );
    const workspace = workspaces[0];
    if (!workspace)
      return yield* Effect.fail(
        new HerdrLiveEvidenceAssertion({
          checkId: "isolated-workspace",
          message: "Herdr live evidence requires one owned workspace; inspect sandbox startup.",
        }),
      );
    const tabs = yield* sdk.tabs.list({ workspaceId: workspace.id });
    yield* check(
      "landing",
      "isolated-tab",
      "One initial landing tab",
      "1",
      String(tabs.length),
      tabs.length === 1,
    );
    const landing = tabs[0];
    if (!landing)
      return yield* Effect.fail(
        new HerdrLiveEvidenceAssertion({
          checkId: "isolated-tab",
          message: "Herdr live evidence requires one owned landing tab; inspect sandbox startup.",
        }),
      );
    yield* gate("landing", "before", "Prepare isolated SDK landing", []);
    yield* sdk.workspaces.rename(workspace.id, "SDK Sandbox");
    yield* sdk.tabs.rename(landing.id, "SDK Landing");
    yield* sdk.tabs.focus(landing.id);
    yield* gate("landing", "observed", "Fresh isolated Herdr session", [
      "SDK Sandbox",
      "SDK Landing",
    ]);

    yield* gate("create-tab", "before", "SDK creates demo tab", []);
    const demo = yield* sdk.tabs.create({
      workspaceId: workspace.id,
      label: "SDK Workflow",
      focus: true,
    });
    yield* sdk.tabs.focus(demo.tab.id);
    const demoTabs = yield* sdk.tabs.list({ workspaceId: workspace.id });
    yield* check(
      "create-tab",
      "demo-tab-created",
      "SDK tab exists and is focused",
      "2 tabs; demo focused",
      `${demoTabs.length} tabs; demo ${demoTabs.some((tab) => tab.id === demo.tab.id && tab.focused) ? "focused" : "not focused"}`,
      demoTabs.length === 2 && demoTabs.some((tab) => tab.id === demo.tab.id && tab.focused),
    );
    yield* gate("create-tab", "observed", "SDK-created tab is visible", ["SDK Workflow"]);

    yield* gate("split-pane", "before", "SDK splits demo pane", []);
    const right = yield* sdk.panes.split(demo.rootPane.id, { direction: "right", focus: true });
    yield* sdk.panes.rename(demo.rootPane.id, "SDK Left");
    yield* sdk.panes.rename(right.id, "SDK Right");
    const splitPanes = yield* sdk.panes.list({ workspaceId: workspace.id });
    const demoPanes = splitPanes.filter((pane) => pane.tabId === demo.tab.id);
    yield* check(
      "split-pane",
      "split-topology",
      "Demo tab contains both returned panes",
      "2 distinct panes",
      `${demoPanes.length} panes`,
      demoPanes.length === 2 &&
        right.id !== demo.rootPane.id &&
        demoPanes.some((pane) => pane.id === right.id) &&
        demoPanes.some((pane) => pane.id === demo.rootPane.id),
    );
    yield* gate("split-pane", "observed", "Two SDK-created panes", ["SDK Left", "SDK Right"]);

    for (const target of [
      {
        id: "run-left",
        pane: demo.rootPane.id,
        marker: "SDK left: ready",
        command: "printf '\\033[2J\\033[H'; printf 'SDK left: %s\\n' 'ready'",
      },
      {
        id: "run-right",
        pane: right.id,
        marker: "SDK right: ready",
        command: "printf '\\033[2J\\033[H'; printf 'SDK right: %s\\n' 'ready'",
      },
    ] as const) {
      yield* gate(
        target.id,
        "before",
        target.id === "run-left" ? "SDK runs left command" : "SDK runs right command",
        [],
      );
      yield* sdk.panes.focus(target.pane);
      yield* sdk.panes.sendInput(target.pane, { text: target.command, keys: ["enter"] });
      yield* sdk.panes.waitForOutput(target.pane, {
        source: "recent_unwrapped",
        match: { type: "substring", value: target.marker },
        timeoutMs: 5000,
      });
      const output = yield* sdk.panes.read(target.pane, { source: "recent_unwrapped", lines: 30 });
      const found = output.text.split(/\r?\n/).some((line) => line.trim() === target.marker);
      yield* check(
        target.id,
        `${target.id}-output`,
        "Actual command output read through SDK",
        target.marker,
        found ? target.marker : "Expected output line absent",
        found,
      );
      yield* gate(
        target.id,
        "observed",
        target.id === "run-left" ? "SDK output in left pane" : "SDK output in both panes",
        target.id === "run-right" ? ["SDK left: ready", "SDK right: ready"] : [target.marker],
      );
    }

    yield* gate("close-split", "before", "SDK closes only its split pane", []);
    yield* sdk.panes.close(right.id);
    const remaining = (yield* sdk.panes.list({ workspaceId: workspace.id })).filter(
      (pane) => pane.tabId === demo.tab.id,
    );
    yield* check(
      "close-split",
      "split-removed",
      "Only original demo pane remains",
      "1 original pane",
      `${remaining.length} panes`,
      remaining.length === 1 && remaining[0]?.id === demo.rootPane.id,
    );
    yield* gate(
      "close-split",
      "observed",
      "SDK closes split",
      ["SDK left: ready"],
      ["SDK Right", "SDK right: ready"],
    );

    yield* gate("close-tab", "before", "SDK closes demo tab", []);
    yield* sdk.tabs.close(demo.tab.id);
    yield* sdk.tabs.focus(landing.id);
    const finalTabs = yield* sdk.tabs.list({ workspaceId: workspace.id });
    const finalPanes = yield* sdk.panes.list({ workspaceId: workspace.id });
    yield* check(
      "close-tab",
      "landing-restored",
      "Demo resources removed; landing remains",
      "1 landing tab and pane",
      `${finalTabs.length} tabs; ${finalPanes.length} panes`,
      finalTabs.length === 1 &&
        finalTabs[0]?.id === landing.id &&
        finalPanes.length === 1 &&
        finalPanes[0]?.tabId === landing.id,
    );
    yield* gate(
      "close-tab",
      "observed",
      "SDK restores landing",
      ["SDK Landing"],
      ["SDK Workflow", "SDK Left", "SDK Right", "SDK left: ready", "SDK right: ready"],
    );
  }).pipe(Effect.withSpan("HerdrLiveEvidence.workflow"));
}
