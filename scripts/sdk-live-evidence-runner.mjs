import { join } from "node:path";
import { Effect, Exit, Ref, Schedule, Schema } from "effect";
import { startSdkHerdrSandbox } from "./sdk-herdr-sandbox.mjs";
import { runSdkLiveEvidence } from "./sdk-live-evidence.mjs";
import { checkSdkTerminalControl, startSdkHerdrTerminalSession } from "./sdk-terminal-control.mjs";
import { writeSdkEvidenceArtifact } from "./sdk-evidence-bundle.mjs";

/** Selecting this primary scenario explicitly consents to one fresh isolated real Herdr session. */
export const sdkLiveEvidenceScenario = {
  id: "herdr-sdk-workflow",
  executionKind: /** @type {const} */ ("isolated-herdr"),
  title: "Real Herdr SDK workflow (fresh isolated session; requires --record)",
  defaultClaim:
    "Public SDK calls create, split, run controlled commands, and close an isolated Herdr demo while its real TUI is recorded.",
};

/** UI observation failure is independent of socket assertions; never replay uncertain actions. */
export const SdkLiveEvidenceObservationError = Schema.TaggedStruct(
  "SdkLiveEvidenceObservationError",
  {
    reason: Schema.Literals(["StateNotObserved"]),
    message: Schema.String,
  },
);

/** @typedef {import('./sdk-evidence-runner.mjs').EvidenceManifest} EvidenceManifest */

/** Acquire only owned resources and execute once; unavailable prerequisites never run a fixture fallback.
 * @param {{trace?:boolean,herdrExecutable?:string|undefined}} options
 * @param {string} directory
 */
export const executeSdkLiveEvidence = (options, directory) =>
  Effect.gen(function* () {
    /** @type {EvidenceManifest['artifacts'][number][]} */
    const artifacts = [];
    /** @type {{from:string,to:string,caption:string,chapterId:string}[]} */
    const clips = [];
    /** @type {Effect.Success<ReturnType<typeof runSdkLiveEvidence>> | undefined} */
    let report;
    /** @type {EvidenceManifest['outcomes']['recording']} */
    let recording = {
      status: "unavailable",
      detail: "Real recorder not acquired; SDK workflow was not executed.",
    };
    const terminalCleanup = yield* Ref.make(
      /** @type {import('./sdk-terminal-control.mjs').TerminalCleanup} */ ({ status: "pending" }),
    );
    /** @type {Effect.Success<ReturnType<typeof startSdkHerdrSandbox>> | undefined} */
    let sandbox;
    let workflowStarted = false;
    let terminalStarted = false;
    let terminalAttempted = false;
    let sandboxAttempted = false;
    const sandboxCleanup = yield* Ref.make(
      /** @type {import('./sdk-herdr-sandbox.mjs').SdkHerdrSandboxCleanup} */ ({
        status: "pending",
      }),
    );
    const preflight = yield* Effect.exit(checkSdkTerminalControl());
    const attempt = Exit.isFailure(preflight)
      ? preflight
      : yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              sandboxAttempted = true;
              /** @type {Parameters<typeof startSdkHerdrSandbox>[0]} */
              const sandboxOptions = { onCleanup: (outcome) => Ref.set(sandboxCleanup, outcome) };
              if (options.herdrExecutable !== undefined)
                sandboxOptions.executable = options.herdrExecutable;
              sandbox = yield* startSdkHerdrSandbox(sandboxOptions);
              yield* writeSdkEvidenceArtifact({
                directory,
                path: "sandbox-status.json",
                content: JSON.stringify(sandbox.metadata, null, 2),
              });
              artifacts.push({ id: "sandbox-status", kind: "other", path: "sandbox-status.json" });
              terminalAttempted = true;
              const session = yield* startSdkHerdrTerminalSession({
                client: sandbox.client,
                recordingPath: join(directory, "source.termctrl"),
                timeoutMs: 60000,
                cols: 140,
                onCleanup: (outcome) => Ref.set(terminalCleanup, outcome),
              });
              terminalStarted = true;
              yield* session.mark("execution-start");
              workflowStarted = true;
              const execution = yield* Effect.exit(
                runSdkLiveEvidence({
                  socketPath: sandbox.socketPath,
                  root: sandbox.root,
                  trace: options.trace === true,
                  onStep: (step) =>
                    Effect.gen(function* () {
                      if (step.phase === "before") {
                        yield* session.mark(`step-${step.id}-start`);
                        return;
                      }
                      const screen = yield* session.readScreen().pipe(
                        Effect.repeat({
                          schedule: Schedule.spaced("100 millis"),
                          while: (text) =>
                            !step.expectedText.every((expected) => text.includes(expected)) ||
                            step.absentText.some((absent) => text.includes(absent)),
                        }),
                        Effect.timeout("10 seconds"),
                        Effect.catchTag("TimeoutError", () =>
                          Effect.fail(
                            SdkLiveEvidenceObservationError.make({
                              reason: "StateNotObserved",
                              message:
                                "Isolated Herdr UI state was not observed within its deadline. Inspect partial source recording; SDK actions were not replayed.",
                            }),
                          ),
                        ),
                      );
                      const path = `step-${step.id}.txt`;
                      yield* writeSdkEvidenceArtifact({ directory, path, content: screen });
                      artifacts.push({ id: `step-${step.id}`, kind: "transcript", path });
                      yield* session.mark(`step-${step.id}-observed`);
                      yield* Effect.sleep("750 millis");
                      yield* session.mark(`step-${step.id}-end`);
                      clips.push({
                        from: `step-${step.id}-start`,
                        to: `step-${step.id}-end`,
                        caption: step.caption,
                        chapterId: step.id,
                      });
                    }),
                }),
              );
              if (Exit.hasInterrupts(execution)) return yield* Effect.failCause(execution.cause);
              if (Exit.isSuccess(execution)) report = execution.value;
              yield* session.mark("execution-complete");
              yield* session.stop();
              const captured = yield* session.recording();
              recording = {
                status:
                  captured.status === "recorded" && Exit.isSuccess(execution) ? "passed" : "failed",
                detail:
                  captured.status === "recorded" && Exit.isSuccess(execution)
                    ? clips.length > 0
                      ? `Actual isolated Herdr TUI captured; ${clips.length} SDK workflow states independently observed. Product assertions remain separate.`
                      : "Actual isolated Herdr TUI attempt captured; no SDK workflow transitions were confirmed."
                    : "Real UI observation or source capture failed; SDK actions were not replayed.",
              };
              if (captured.status === "recorded")
                artifacts.push({ id: "recording", kind: "recording", path: "source.termctrl" });
            }),
          ),
        );
    if (Exit.hasInterrupts(attempt)) return yield* Effect.failCause(attempt.cause);
    if (Exit.isFailure(attempt) && terminalStarted)
      recording = {
        status: "failed",
        detail: "Real recording interrupted or failed; uncertain SDK actions were not replayed.",
      };
    const terminal = yield* Ref.get(terminalCleanup);
    const owned = yield* Ref.get(sandboxCleanup);
    /** @type {EvidenceManifest['outcomes']['cleanup']} */
    const cleanup = {
      status:
        (!sandboxAttempted || owned.status === "stopped") &&
        (!terminalAttempted || terminal.status === "stopped")
          ? "passed"
          : owned.status === "failed" || terminal.status === "failed"
            ? "failed"
            : "unavailable",
      detail: sandboxAttempted
        ? "Owned sandbox and terminal cleanup callbacks checked independently, including partial acquisition."
        : "Recorder preflight failed before resource acquisition.",
    };
    if (clips.length) {
      yield* writeSdkEvidenceArtifact({
        directory,
        path: "recording-plan.json",
        content: JSON.stringify(clips, null, 2),
      });
      artifacts.push({ id: "recording-plan", kind: "edit", path: "recording-plan.json" });
    }
    return {
      result: report ?? {
        scenarioId: sdkLiveEvidenceScenario.id,
        title: sdkLiveEvidenceScenario.title,
        defaultClaim: sdkLiveEvidenceScenario.defaultClaim,
        checks: [],
        chapters: [],
        product: {
          status: /** @type {const} */ ("unavailable"),
          errorTag: workflowStarted
            ? "LiveScenarioReportUnavailable"
            : "LivePrerequisiteUnavailable",
        },
        runId: "",
        traceIds: /** @type {string[]} */ ([]),
        telemetry: { status: /** @type {const} */ ("unavailable"), exported: 0, dropped: 0 },
        limitations: [
          workflowStarted
            ? "Workflow report unavailable; no product assertions established. UI gate failure can discard accumulated subprocess checks. No action was replayed."
            : "Required isolated session or recorder unavailable; SDK workflow not executed.",
        ],
      },
      recording,
      cleanup,
      artifacts,
      limitations: [
        clips.length > 0
          ? "Completed source chapters surround actual SDK actions and observed real TUI states. Edited reading holds are not SDK latency. Normal tests remain fixture-only."
          : "No real UI transition chapters were observed. A captured attempt alone does not establish SDK workflow success.",
      ],
    };
  });
