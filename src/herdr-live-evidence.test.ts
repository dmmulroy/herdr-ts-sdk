import { join } from "node:path";
import { Cause, Duration, Effect, Exit, FileSystem, Option, Schedule, Schema } from "effect";
import { expect, test } from "vite-plus/test";
import { HerdrAbsolutePath, herdrSdkLayerFromOptions } from "./index.ts";
import { executeHerdrLiveEvidence } from "./herdr-live-evidence.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";
import type { PaneInfo, TabInfo, WorkspaceInfo } from "./generated/wire-success-response.ts";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import {
  parseSdkLiveEvidenceConfig,
  publishSdkLiveEvidenceJson,
  sdkLiveEvidenceStepSchema,
  type SdkLiveEvidenceResult,
  type SdkLiveEvidenceStep,
} from "../scripts/sdk-live-evidence.mjs";
import { traceSdkExecution } from "../scripts/sdk-telemetry.mjs";
import { verificationNodeLayer } from "../scripts/sdk-verification-process.mjs";

const parseLiveWorkflowStep = Schema.decodeUnknownEffect(sdkLiveEvidenceStepSchema);

// The only live TS loading boundary: normal test runs skip it, and the bridge supplies a clean environment.
test("sdk isolated live evidence execution", (context) => {
  const configText = process.env.HERDR_LIVE_EVIDENCE_CONFIG;
  if (!configText) {
    context.skip();
    return;
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* parseSdkLiveEvidenceConfig(configText);
      const fs = yield* FileSystem.FileSystem;
      const checks: Array<SdkLiveEvidenceResult["checks"][number]> = [];
      const chapters: Array<SdkLiveEvidenceResult["chapters"][number]> = [];
      let index = 0;
      const onStep = (step: SdkLiveEvidenceStep) =>
        Effect.gen(function* () {
          const current = index++;
          if (step.phase === "before")
            chapters.push({
              id: step.id,
              title: step.caption,
              caption: step.caption,
              checkIds: [],
            });
          yield* publishSdkLiveEvidenceJson(
            join(config.directory, `step-${current}.json`),
            JSON.stringify(step),
          );
          yield* fs
            .exists(join(config.directory, `ack-${current}.json`))
            .pipe(
              Effect.repeat({ schedule: Schedule.spaced("20 millis"), until: (ready) => ready }),
              Effect.timeout("20 seconds"),
            );
        });
      const execution = yield* traceSdkExecution(
        {
          kind: "lab",
          name: "sdk isolated Herdr workflow",
          file: "src/herdr-live-evidence.ts",
          enabled: config.trace,
        },
        executeHerdrLiveEvidence(checks, onStep).pipe(
          Effect.provide(
            herdrSdkLayerFromOptions({
              socketPath: HerdrAbsolutePath.make(config.socketPath),
              requestTimeout: Duration.seconds(8),
            }),
          ),
        ),
      );
      const failure = Exit.isFailure(execution.tracedExit)
        ? Cause.findErrorOption(execution.tracedExit.cause)
        : Option.none();
      const errorTag = Option.isSome(failure) ? failure.value._tag : "WorkflowDefect";
      const result: SdkLiveEvidenceResult = {
        scenarioId: "herdr-sdk-workflow",
        title: "Real Herdr SDK workflow",
        defaultClaim:
          "The SDK creates, splits, runs commands, reads output and removes its demo resources in an isolated Herdr session.",
        checks,
        chapters: chapters.map((chapter) => ({
          ...chapter,
          checkIds: checks
            .filter((check) => check.chapterId === chapter.id)
            .map((check) => check.id),
        })),
        product: Exit.isSuccess(execution.tracedExit)
          ? { status: "passed" }
          : {
              status: Cause.hasInterruptsOnly(execution.tracedExit.cause)
                ? "interrupted"
                : "failed",
              errorTag: checks.some((check) => check.status === "failed")
                ? "AssertionFailure"
                : errorTag,
            },
        runId: execution.runId,
        traceIds: execution.traceId ? [execution.traceId] : [],
        telemetry: execution.telemetry,
        limitations: [
          "SDK assertions establish topology and output; recorder UI observations are independent.",
          "Trace bookmarks identify the execution root, not frame-accurate action spans.",
          "Export acknowledgement does not establish viewer ingestion.",
          ...(Option.isSome(failure) && failure.value._tag === "HerdrUnsupportedProtocol"
            ? [
                `Compatibility blocked before workflow actions: server protocol ${failure.value.actualProtocol}; SDK requires ${failure.value.supportedProtocol}. Install compatible Herdr and SDK versions; do not bypass the handshake.`,
              ]
            : []),
        ],
      };
      yield* publishSdkLiveEvidenceJson(
        join(config.directory, "result.json"),
        JSON.stringify(result),
      );
    }).pipe(Effect.provide(verificationNodeLayer)),
    { signal: context.signal },
  );
});

const workspace: WorkspaceInfo = {
  workspace_id: "w1",
  active_tab_id: "w1:t1",
  agent_status: "idle",
  focused: true,
  label: "Landing",
  number: 1,
  pane_count: 1,
  tab_count: 1,
};
const tab = (id: string, focused: boolean): TabInfo => ({
  tab_id: id,
  workspace_id: "w1",
  focused,
  label: id === "w1:t1" ? "SDK Landing" : "SDK Workflow",
  pane_count: 1,
  position: 0,
  agent_status: "idle",
  number: 1,
});
const pane = (id: string, tabId: string): PaneInfo => ({
  pane_id: id,
  workspace_id: "w1",
  tab_id: tabId,
  focused: true,
  is_zoomed: false,
  terminal_id: `term-${id}`,
  agent_status: "idle",
  revision: 1,
});

function liveWorkflowFixture(missingOutput = false) {
  let demo = false;
  let split = false;
  return startHerdrTestServer((request) =>
    Effect.sync(() => {
      const left = pane("w1:p2", "w1:t2");
      const right = pane("w1:p3", "w1:t2");
      switch (request.method) {
        case "workspace.list":
          return { id: request.id, result: { type: "workspace_list", workspaces: [workspace] } };
        case "workspace.rename":
          return { id: request.id, result: { type: "workspace_info", workspace } };
        case "tab.list":
          return {
            id: request.id,
            result: {
              type: "tab_list",
              tabs: demo ? [tab("w1:t1", false), tab("w1:t2", true)] : [tab("w1:t1", true)],
            },
          };
        case "tab.create":
          demo = true;
          return {
            id: request.id,
            result: { type: "tab_created", tab: tab("w1:t2", true), root_pane: left },
          };
        case "tab.focus":
        case "tab.rename":
          return {
            id: request.id,
            result: { type: "tab_info", tab: tab(String(request.params.tab_id), true) },
          };
        case "tab.close":
          demo = false;
          break;
        case "pane.split":
          split = true;
          return { id: request.id, result: { type: "pane_info", pane: right } };
        case "pane.focus":
        case "pane.rename":
          return {
            id: request.id,
            result: { type: "pane_info", pane: request.params.pane_id === "w1:p3" ? right : left },
          };
        case "pane.list":
          return {
            id: request.id,
            result: {
              type: "pane_list",
              panes: [pane("w1:p1", "w1:t1"), ...(demo ? [left] : []), ...(split ? [right] : [])],
            },
          };
        case "pane.close":
          split = false;
          break;
        case "pane.read": {
          const response = makeHerdrSuccessResponse(request);
          if (response.result.type === "pane_read")
            response.result.read.text = missingOutput
              ? "no output"
              : request.params.pane_id === "w1:p3"
                ? "SDK right: ready\n"
                : "SDK left: ready\n";
          return response;
        }
      }
      return makeHerdrSuccessResponse(request);
    }),
  );
}

test("live workflow asserts real SDK observations and gates each action once", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* liveWorkflowFixture();
        const checks: Array<SdkLiveEvidenceResult["checks"][number]> = [];
        const steps: Array<SdkLiveEvidenceStep> = [];
        yield* executeHerdrLiveEvidence(checks, (step) =>
          Effect.gen(function* () {
            // Exercise every actual recipe caption against the recorder-facing boundary.
            steps.push(yield* parseLiveWorkflowStep(step));
          }),
        ).pipe(
          Effect.provide(
            herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
          ),
        );
        expect(checks).toHaveLength(8);
        expect(checks.every((check) => check.status === "passed")).toBe(true);
        expect(steps.map((step) => step.phase)).toEqual(
          Array.from({ length: 7 }, () => ["before", "observed"]).flat(),
        );
        expect(server.requests.filter((request) => request.method === "tab.create")).toHaveLength(
          1,
        );
        expect(server.requests.filter((request) => request.method === "pane.split")).toHaveLength(
          1,
        );
      }),
    ),
  ));

test("missing command output fails a check and never proceeds to the next command", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* liveWorkflowFixture(true);
        const checks: Array<SdkLiveEvidenceResult["checks"][number]> = [];
        const result = yield* Effect.exit(
          executeHerdrLiveEvidence(checks, () => Effect.void).pipe(
            Effect.provide(
              herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
            ),
          ),
        );
        expect(Exit.isFailure(result)).toBe(true);
        expect(checks.at(-1)).toMatchObject({ id: "run-left-output", status: "failed" });
        expect(
          server.requests.filter((request) => request.method === "pane.send_input"),
        ).toHaveLength(1);
      }),
    ),
  ));

test("failed UI gate prevents the next SDK action without replay", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* liveWorkflowFixture();
        const checks: Array<SdkLiveEvidenceResult["checks"][number]> = [];
        const steps: Array<string> = [];
        const result = yield* Effect.exit(
          executeHerdrLiveEvidence(checks, (step) =>
            Effect.gen(function* () {
              steps.push(`${step.id}:${step.phase}`);
              if (step.id === "split-pane" && step.phase === "observed")
                return yield* Effect.fail("UiObservationFailed");
            }),
          ).pipe(
            Effect.provide(
              herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
            ),
          ),
        );
        expect(Exit.isFailure(result)).toBe(true);
        expect(steps.at(-1)).toBe("split-pane:observed");
        expect(
          server.requests.filter((request) => request.method === "pane.send_input"),
        ).toHaveLength(0);
        expect(server.requests.filter((request) => request.method === "pane.split")).toHaveLength(
          1,
        );
      }),
    ),
  ));
