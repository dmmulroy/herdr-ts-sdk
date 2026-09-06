import { executeSdkLiveEvidence, sdkLiveEvidenceScenario } from "./sdk-live-evidence-runner.mjs";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { Cause, Effect, Exit, FileSystem, Option, Ref, Schedule, Schema } from "effect";
import { listSdkTraces, showSdkTrace } from "./sdk-trace-query.mjs";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  createSdkEvidenceBundle,
  fingerprintSdkEvidenceSource,
  finalizeSdkEvidenceBundle,
  readSdkEvidenceBundle,
  writeSdkEvidenceArtifact,
  resolveSdkEvidenceArtifact,
  sdkEvidenceBookmarkUrl,
  renderSdkEvidenceReview,
} from "./sdk-evidence-bundle.mjs";
import {
  sdkEvidenceScenarioCatalog,
  runSdkEvidenceScenario,
  prepareSdkEvidenceScenario,
  readSdkEvidenceScenarioResult,
} from "./sdk-evidence-scenario.mjs";
import {
  checkSdkTerminalControl,
  startSdkTerminalSession,
  renderSdkTerminalRecording,
  captureSdkTerminalFrame,
} from "./sdk-terminal-control.mjs";

/** Evidence orchestration failures carry only safe finite classifications. */
export const SdkEvidenceRunError = Schema.TaggedStruct("SdkEvidenceRunError", {
  reason: Schema.String,
  message: Schema.String,
});

/** @typedef {Effect.Success<ReturnType<typeof readSdkEvidenceBundle>>} EvidenceManifest */
/** @typedef {{scenarioId:string,claim?:string|undefined,record?:boolean,trace?:boolean,preset?:"review"|"walkthrough",out?:string|undefined,herdrExecutable?:string|undefined}} EvidenceRunOptions */
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const reviewClipSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  caption: Schema.String,
  chapterId: Schema.optionalKey(Schema.String),
});
const parseReviewClips = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(reviewClipSchema).check(Schema.isMaxLength(32))),
);
const sourceFiles = [
  "scripts/sdk-evidence.mjs",
  "scripts/sdk-live-evidence-runner.mjs",
  "scripts/sdk-herdr-sandbox.mjs",
  "scripts/sdk-live-evidence.mjs",
  "src/herdr-live-evidence.ts",
  "src/herdr-live-evidence.test.ts",
  "scripts/sdk-terminal-control.mjs",
  "src/herdr-evidence-scenarios.test.ts",
  "src/herdr-wire-parser.ts",
  "src/herdr-wire-encoder.ts",
  "src/herdr-test-runtime.ts",
  "scripts/sdk-telemetry.mjs",
  "scripts/sdk-trace-query.mjs",
  "src/herdr-evidence-scenarios.ts",
  "src/herdr-transport.ts",
  "src/event-service.ts",
  "src/pane-service.ts",
  "scripts/sdk-evidence-scenario.mjs",
  "scripts/sdk-evidence-runner.mjs",
  "scripts/sdk-evidence-bundle.mjs",
  "package.json",
];

/** Explicit live selection consents only to a fresh disposable session; other entries remain fixtures. */
export const sdkEvidenceRunCatalog = [
  sdkLiveEvidenceScenario,
  ...sdkEvidenceScenarioCatalog.map((scenario) => ({
    ...scenario,
    executionKind: /** @type {const} */ ("fixture"),
  })),
];

/** Execute one selected scenario and publish the manifest last; optional evidence never replaces assertions. @param {EvidenceRunOptions} options */
export const runSdkEvidence = (options) =>
  Effect.gen(function* () {
    const scenario = sdkEvidenceRunCatalog.find((entry) => entry.id === options.scenarioId);
    if (!scenario)
      return yield* Effect.fail(
        SdkEvidenceRunError.make({
          reason: "UnknownScenario",
          message: "Evidence scenario was not found. Use evidence list to select a scenario.",
        }),
      );
    const isolatedHerdr = scenario.id === sdkLiveEvidenceScenario.id;
    if (
      options.herdrExecutable !== undefined &&
      (!isolatedHerdr || !isAbsolute(options.herdrExecutable))
    )
      return yield* Effect.fail(
        SdkEvidenceRunError.make({
          reason: "InvalidHerdrExecutable",
          message:
            "Herdr executable override requires an absolute binary path and the isolated herdr-sdk-workflow scenario. No ambient target is accepted.",
        }),
      );
    if (isolatedHerdr && !options.record)
      return yield* Effect.fail(
        SdkEvidenceRunError.make({
          reason: "RecordingRequired",
          message:
            "Isolated Herdr evidence requires --record. Select herdr-sdk-workflow --record to consent to a fresh disposable real session.",
        }),
      );
    const bundle = yield* createSdkEvidenceBundle(
      options.out === undefined
        ? { repositoryRoot }
        : { parentDirectory: options.out, repositoryRoot },
    );
    const source = yield* fingerprintSdkEvidenceSource({ repositoryRoot, files: sourceFiles });
    const execution = yield* isolatedHerdr
      ? executeSdkLiveEvidence(options, bundle.directory)
      : executeSdkEvidence(options, bundle.directory);
    const result = execution.result;
    yield* writeSdkEvidenceArtifact({
      directory: bundle.directory,
      path: "scenario.json",
      content: JSON.stringify(result, null, 2),
    });
    const trace = options.trace
      ? yield* snapshotSdkEvidenceTraces({
          traceIds: result.traceIds,
          runIds: [result.runId],
          endpoint: process.env.HERDR_TRACE_VIEWER_URL ?? "http://127.0.0.1:8000",
        })
      : undefined;
    if (trace)
      yield* writeSdkEvidenceArtifact({
        directory: bundle.directory,
        path: "traces.json",
        content: JSON.stringify(trace, null, 2),
      });
    /** @type {EvidenceManifest} */
    const manifest = {
      version: 1,
      executionKind: isolatedHerdr ? "isolated-herdr" : "fixture",
      id: bundle.id,
      createdAt: bundle.createdAt,
      scenario: { id: scenario.id, title: scenario.title },
      claim: options.claim ?? scenario.defaultClaim,
      source,
      reproduction: {
        executable: "node",
        args: [
          "scripts/sdk-evidence.mjs",
          "run",
          scenario.id,
          ...(options.trace ? ["--trace"] : []),
          ...(options.herdrExecutable ? ["--herdr-executable", options.herdrExecutable] : []),
          ...(options.record ? ["--record", "--preset", options.preset ?? "review"] : []),
        ],
      },
      checks: result.checks,
      chapters: result.chapters,
      outcomes: {
        product: result.product,
        telemetry: {
          status:
            !options.trace || result.telemetry.status === "disabled"
              ? "not-requested"
              : result.telemetry.status === "exported"
                ? "passed"
                : result.telemetry.status,
          detail: `${result.telemetry.status}; exported=${result.telemetry.exported}; dropped=${result.telemetry.dropped}. HTTP acknowledgement is not viewer ingestion.`,
        },
        viewer: trace?.outcome ?? { status: "not-requested" },
        recording: execution.recording,
        render: { status: "not-requested" },
        cleanup: execution.cleanup,
      },
      traceIds: [
        ...new Set([
          ...result.traceIds,
          ...(trace?.snapshots.map((snapshot) => snapshot.traceID) ?? []),
        ]),
      ],
      traceBookmarks: trace
        ? [
            ...trace.bookmarks.map((bookmark, index) => ({
              ...bookmark,
              id: `trace-${index}`,
              label: "Observed execution trace",
            })),
            ...result.chapters.flatMap((chapter) => {
              const root = trace.bookmarks.find((bookmark) =>
                result.traceIds.includes(bookmark.traceId),
              );
              return root
                ? [
                    {
                      ...root,
                      id: `chapter-${chapter.id}`,
                      chapterId: chapter.id,
                      label: "Whole execution (not phase-specific)",
                    },
                  ]
                : [];
            }),
          ]
        : [],
      artifacts: [
        { id: "scenario", kind: "other", path: "scenario.json" },
        ...execution.artifacts,
        ...(trace
          ? [{ id: "traces", kind: /** @type {const} */ ("trace"), path: "traces.json" }]
          : []),
      ],
      limitations: [
        ...result.limitations,
        ...execution.limitations,
        ...(trace?.warnings ?? []),
        isolatedHerdr
          ? "Disposable isolated Herdr only; no ambient session was selected. UI capture and SDK assertions have independent outcomes."
          : "Fixture evidence only; this does not establish live Herdr UI behavior.",
        "User claim is untrusted narrative, not an assertion.",
        "Source fingerprint is a non-atomic snapshot of a concurrently editable checkout.",
      ],
      related: [],
    };
    const finalized = yield* finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest });
    if (execution.recording.status === "passed")
      return {
        directory: bundle.directory,
        manifest: yield* renderSdkEvidence(bundle.directory, options.preset ?? "review"),
      };
    return { directory: bundle.directory, manifest: finalized };
  });

/** @param {EvidenceRunOptions} options @param {string} directory */
const executeSdkEvidence = (options, directory) =>
  Effect.gen(function* () {
    /** @type {EvidenceManifest['outcomes']['recording']} */
    let recording = { status: "not-requested" };
    /** @type {EvidenceManifest['outcomes']['cleanup']} */
    let cleanup = { status: "passed" };
    /** @type {Array<EvidenceManifest['artifacts'][number]>} */
    const artifacts = [];
    const limitations = [];
    /** @type {Array<typeof reviewClipSchema.Type>} */
    const clips = [];
    const terminalCleanup = yield* Ref.make(
      /** @type {import('./sdk-terminal-control.mjs').TerminalCleanup} */ ({ status: "pending" }),
    );
    if (options.record) {
      const preflight = yield* Effect.exit(checkSdkTerminalControl());
      if (Exit.isFailure(preflight)) {
        recording = {
          status: "unavailable",
          detail: "Recorder preflight failed; product executed once without recording.",
        };
        limitations.push("Recording unavailable; unrecorded fallback execution only.");
      } else {
        const resultPath = join(directory, "recorded-scenario.json");
        const recordingPath = join(directory, "source.termctrl");
        const attempt = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const prepared = yield* prepareSdkEvidenceScenario({
                scenarioId: options.scenarioId,
                trace: options.trace === true,
                resultPath,
                gated: true,
              });
              const session = yield* startSdkTerminalSession({
                ...prepared,
                recordingPath,
                timeoutMs: 60000,
                onCleanup: (outcome) => Ref.set(terminalCleanup, outcome),
              });
              const observation = yield* Effect.exit(
                Effect.gen(function* () {
                  yield* session.waitForText("SDK_EVIDENCE_READY", 10000);
                  yield* session.mark("execution-start");
                  yield* session.pressKey("enter");
                  yield* session.waitForText("SDK_EVIDENCE_PAGE_intro", 40000);
                  const report = yield* readSdkEvidenceScenarioResult(resultPath);
                  const pages = [
                    { id: "intro", caption: "Observed fixture review" },
                    ...report.chapters,
                  ];
                  for (const page of pages) {
                    yield* session.waitForText(`SDK_EVIDENCE_PAGE_${page.id}`, 10000);
                    const from = `page-${page.id}-start`;
                    const to = `page-${page.id}-end`;
                    yield* session.mark(from);
                    const screen = yield* session.readScreen();
                    const transcriptPath = `page-${page.id}.txt`;
                    yield* writeSdkEvidenceArtifact({
                      directory,
                      path: transcriptPath,
                      content: screen,
                    });
                    artifacts.push({
                      id: `page-${page.id}`,
                      kind: "transcript",
                      path: transcriptPath,
                    });
                    yield* session.mark(to);
                    clips.push(
                      page.id === "intro"
                        ? { from, to, caption: page.caption }
                        : { from, to, caption: page.caption, chapterId: page.id },
                    );
                    yield* session.pressKey("enter");
                  }
                  yield* session.waitForText("SDK_EVIDENCE_COMPLETE", 10000);
                  yield* session.mark("execution-complete");
                }),
              );
              yield* session.stop();
              return { session, observation };
            }),
          ),
        );
        if (Exit.isSuccess(attempt)) {
          const stopped = yield* attempt.value.session.cleanup();
          cleanup = {
            status: stopped.status === "stopped" ? "passed" : "failed",
            detail:
              stopped.status === "stopped"
                ? "Owned terminal session stopped."
                : "Owned terminal cleanup unresolved.",
          };
          const captured = yield* attempt.value.session.recording();
          recording = {
            status:
              Exit.isSuccess(attempt.value.observation) && captured.status === "recorded"
                ? "passed"
                : "failed",
            detail:
              Exit.isSuccess(attempt.value.observation) && captured.status === "recorded"
                ? "Actual fixture execution followed by observed-result review pages captured."
                : "Terminal observation or recording failed; recorded scenario was not replayed.",
          };
          artifacts.push({ id: "recording", kind: "recording", path: "source.termctrl" });
        } else {
          recording = {
            status: "failed",
            detail: "Recording start failed; execution may have started and was not retried.",
          };
          const finalizedCleanup = yield* Ref.get(terminalCleanup);
          cleanup = {
            status:
              finalizedCleanup.status === "stopped"
                ? "passed"
                : finalizedCleanup.status === "failed"
                  ? "failed"
                  : "unavailable",
            detail: "Start failed; inspect incomplete recording ownership before retrying.",
          };
        }
        if (clips.length) {
          yield* writeSdkEvidenceArtifact({
            directory,
            path: "recording-plan.json",
            content: JSON.stringify(clips, null, 2),
          });
          artifacts.push({ id: "recording-plan", kind: "edit", path: "recording-plan.json" });
        }
        limitations.push(
          "Chapter source times describe recorded review pages AFTER one actual SDK execution, not SDK phase durations. Edited playback adds disclosed reading holds. PTY output is not Herdr UI capture.",
        );
        const observed = yield* Effect.exit(readSdkEvidenceScenarioResult(resultPath));
        if (Exit.isSuccess(observed))
          return { result: observed.value, recording, cleanup, artifacts, limitations };
        return {
          result: failedSdkEvidenceResult(options.scenarioId),
          recording,
          cleanup,
          artifacts,
          limitations,
        };
      }
    }
    const product = yield* Effect.exit(
      runSdkEvidenceScenario({ scenarioId: options.scenarioId, trace: options.trace === true }),
    );
    if (Exit.isFailure(product))
      cleanup = {
        status: "unavailable",
        detail: "Scenario report unavailable; subprocess cleanup is not independently established.",
      };
    return {
      result: Exit.isSuccess(product) ? product.value : failedSdkEvidenceResult(options.scenarioId),
      recording,
      cleanup,
      artifacts,
      limitations,
    };
  });

/** A missing report establishes no passed checks and no exporter acknowledgement. @param {string} scenarioId @returns {import('./sdk-evidence-scenario.mjs').SdkEvidenceScenarioResult} */
function failedSdkEvidenceResult(scenarioId) {
  const scenario =
    sdkEvidenceScenarioCatalog.find((entry) => entry.id === scenarioId) ??
    sdkEvidenceScenarioCatalog[0];
  return {
    scenarioId: scenario?.id ?? "compatibility-recovery",
    title: scenario?.title ?? "Fixture execution unavailable",
    defaultClaim: scenario?.defaultClaim ?? "No assertion result available.",
    checks: [],
    chapters: [],
    product: { status: "failed", errorTag: "ScenarioReportUnavailable" },
    runId: "",
    traceIds: [],
    telemetry: { status: "unavailable", exported: 0, dropped: 0 },
    limitations: ["Scenario report unavailable; no checks are established."],
  };
}

/** Snapshot only sanitized viewer projections; HTTP acceptance and empty successful queries are not ingestion evidence.
 * @param {{traceIds:ReadonlyArray<string>,runIds:ReadonlyArray<string>,endpoint:string}} options
 */
export const snapshotSdkEvidenceTraces = (options) =>
  Effect.gen(function* () {
    const query = {
      endpoint: options.endpoint,
      run: "",
      failed: false,
      limit: 500,
      offset: 0,
      maxResponseMb: 2,
    };
    const ids = new Set(options.traceIds);
    /** @type {string[]} */
    const warnings = [];
    /** @type {Array<Effect.Success<ReturnType<typeof showSdkTrace>>>} */
    const snapshots = [];
    /** @type {Array<{traceId:string,spanId:string,viewerUrl:string}>} */
    const bookmarks = [];
    const primaryId = options.traceIds[0];
    const primary =
      primaryId === undefined
        ? undefined
        : yield* Effect.exit(
            showSdkTrace(primaryId, query).pipe(
              Effect.flatMap((snapshot) =>
                snapshot.total === 0
                  ? Effect.fail(
                      SdkEvidenceRunError.make({
                        reason: "TraceAbsent",
                        message: "Evidence trace not yet observed.",
                      }),
                    )
                  : Effect.succeed(snapshot),
              ),
              Effect.retry({
                times: 9,
                schedule: Schedule.spaced("400 millis"),
                while: (error) =>
                  (error._tag === "SdkEvidenceRunError" && error.reason === "TraceAbsent") ||
                  (error._tag === "SdkTraceQueryError" && error.reason === "NotFound"),
              }),
              Effect.timeout("5 seconds"),
            ),
          );
    // Viewer batching may lag export acknowledgement. Discover shared roots only after visibility polling.
    if (options.runIds.length > 8) warnings.push("Run ID query budget exhausted.");
    for (const run of options.runIds.filter((run) => run !== "").slice(0, 8)) {
      const listed = yield* Effect.exit(listSdkTraces({ ...query, run }));
      if (Exit.isFailure(listed)) {
        warnings.push("Run trace query unavailable.");
        continue;
      }
      for (const trace of listed.value.traces) ids.add(trace.traceID);
      if (listed.value.traces.length === 0)
        warnings.push("Run trace listing empty; shared roots may be missing.");
      if (listed.value.truncated) warnings.push("Run trace listing truncated.");
    }
    let queried = 0;
    for (const id of ids) {
      if (++queried > 16) {
        warnings.push("Linked trace query budget exhausted.");
        break;
      }
      if (snapshots.length >= 16) {
        warnings.push("Linked trace query budget exhausted.");
        break;
      }
      const observed =
        id === primaryId && primary
          ? primary
          : yield* Effect.exit(
              showSdkTrace(id, query).pipe(
                Effect.flatMap((snapshot) =>
                  snapshot.total === 0
                    ? Effect.fail(
                        SdkEvidenceRunError.make({
                          reason: "TraceAbsent",
                          message: "Evidence trace not yet observed.",
                        }),
                      )
                    : Effect.succeed(snapshot),
                ),
              ),
            );
      if (Exit.isFailure(observed)) {
        warnings.push("Emitted or linked trace unavailable.");
        continue;
      }
      const snapshot = observed.value;
      snapshots.push(snapshot);
      if (
        snapshot.partial ||
        snapshot.truncated ||
        snapshot.unplacedSpanCount > 0 ||
        snapshot.spans.some(
          (span) =>
            span.incompleteParent ||
            span.parentOutsidePage ||
            span.cycle ||
            span.depthTruncated ||
            span.linksTruncated ||
            span.attributesTruncated ||
            span.eventsTruncated ||
            span.events.some((event) => event.attributesTruncated),
        )
      )
        warnings.push("Trace projection incomplete or truncated; inspect saved query warnings.");
      if (!snapshot.spans.some((span) => span.parentSpanID === null))
        warnings.push("Trace root not observed.");
      const root = snapshot.spans.find((span) => span.parentSpanID === null) ?? snapshot.spans[0];
      if (root) bookmarks.push({ traceId: id, spanId: root.spanID, viewerUrl: options.endpoint });
      for (const span of snapshot.spans) for (const link of span.links) ids.add(link.traceID);
    }
    if (ids.size === 0) warnings.push("No emitted trace IDs or matching run traces available.");
    /** @type {"passed"|"partial"|"unavailable"} */
    const status = snapshots.length === 0 ? "unavailable" : warnings.length ? "partial" : "passed";
    return {
      outcome: {
        status,
        detail:
          status === "passed"
            ? "Viewer presence observed; snapshots are not an OTLP archive."
            : "Missing or incomplete viewer evidence; not proof of product success.",
      },
      snapshots,
      warnings,
      bookmarks,
    };
  });

/** Rerender presentation without executing the recorded SDK scenario again. @param {string} directory @param {"review"|"walkthrough"} preset */
export const renderSdkEvidence = (directory, preset = "review") =>
  Effect.gen(function* () {
    let manifest = yield* readSdkEvidenceBundle(directory);
    const recording = manifest.artifacts.find((artifact) => artifact.kind === "recording");
    if (!recording)
      return yield* finalizeSdkEvidenceBundle({
        directory,
        manifest: {
          ...manifest,
          outcomes: {
            ...manifest.outcomes,
            render: {
              status: "unavailable",
              detail: "No source recording; scenario was not rerun.",
            },
          },
        },
      });
    const recordingPath = yield* resolveSdkEvidenceArtifact(directory, recording.path);
    const renderId = `render-${yield* Effect.sync(randomUUID)}`;
    const videoPath = `${renderId}.mp4`;
    const fs = yield* FileSystem.FileSystem;
    const bundleRoot = yield* fs.realPath(directory);
    const plan = manifest.artifacts.find((artifact) => artifact.id === "recording-plan");
    const planPath = plan ? yield* resolveSdkEvidenceArtifact(directory, plan.path) : undefined;
    if (planPath && (yield* fs.stat(planPath)).size > 65536)
      return yield* Effect.fail(
        SdkEvidenceRunError.make({
          reason: "InvalidEditPlan",
          message:
            "Evidence edit plan exceeds the safe size budget. Inspect the source recording instead.",
        }),
      );
    const clips = planPath
      ? yield* parseReviewClips(yield* fs.readFileString(planPath))
      : [
          {
            from: "execution-start",
            to: "execution-complete",
            caption:
              manifest.executionKind === "isolated-herdr"
                ? "Isolated Herdr SDK workflow"
                : "Fixture assertion results",
          },
        ];
    if (!manifest.artifacts.some((artifact) => artifact.id === "review-poster")) {
      const marker =
        manifest.executionKind === "isolated-herdr"
          ? (clips.find((clip) => "chapterId" in clip && clip.chapterId === "run-right")?.to ??
            clips.at(-1)?.to ??
            "execution-complete")
          : (clips.at(-1)?.to ?? "execution-complete");
      const posterPath = `${renderId}-poster.png`;
      const captured = yield* Effect.exit(
        captureSdkTerminalFrame({
          recordingPath,
          marker,
          outputPath: join(bundleRoot, posterPath),
        }),
      );
      const statusPath = `${renderId}-poster.json`;
      const frameStatus = Exit.isSuccess(captured)
        ? {
            status: captured.value.status,
            marker: captured.value.marker,
            sourceAtMs: captured.value.atMs,
          }
        : {
            status: "unavailable",
            marker,
            detail:
              "Poster capture failed independently of video rendering and product assertions.",
          };
      yield* writeSdkEvidenceArtifact({
        directory,
        path: statusPath,
        content: JSON.stringify(frameStatus, null, 2),
      });
      manifest = {
        ...manifest,
        artifacts: [
          ...manifest.artifacts,
          { id: `${renderId}-poster-status`, kind: "other", path: statusPath },
          ...(Exit.isSuccess(captured)
            ? [{ id: "review-poster", kind: /** @type {const} */ ("frame"), path: posterPath }]
            : []),
        ],
        limitations: Exit.isSuccess(captured)
          ? manifest.limitations
          : [
              ...manifest.limitations,
              "Poster capture unavailable; inspect transcripts or video. Product assertions are unchanged.",
            ],
      };
    }
    const presentation = yield* Effect.exit(
      renderSdkTerminalRecording({
        recordingPath,
        outputPath: join(bundleRoot, videoPath),
        preset,
        clips: clips.map(({ from, to, caption }) => ({ from, to, caption })),
      }).pipe(
        Effect.onInterrupt(() =>
          finalizeSdkEvidenceBundle({
            directory,
            manifest: {
              ...manifest,
              outcomes: {
                ...manifest.outcomes,
                render: {
                  status: "interrupted",
                  detail:
                    "Presentation interrupted; original product assertions unchanged. Partial presentation files may remain.",
                },
              },
            },
          }).pipe(Effect.asVoid),
        ),
      ),
    );
    if (Exit.isFailure(presentation)) {
      const failure = Cause.findErrorOption(presentation.cause);
      const reason =
        Option.isSome(failure) && failure.value._tag === "SdkTerminalControlError"
          ? failure.value.reason
          : "unavailable";
      return yield* finalizeSdkEvidenceBundle({
        directory,
        manifest: {
          ...manifest,
          outcomes: {
            ...manifest.outcomes,
            render: {
              status: "failed",
              detail: `Presentation failed (${reason}); inspect the recording edit plan and renderer prerequisites. Source recording and product assertions unchanged.`,
            },
          },
        },
      });
    }
    const metadataPath = `${renderId}.json`;
    const { outputPath: _output, editPath: _edit, ...metadata } = presentation.value;
    yield* writeSdkEvidenceArtifact({
      directory,
      path: metadataPath,
      content: JSON.stringify(metadata, null, 2),
    });
    let playbackMs = 0;
    const chapters = [...manifest.chapters];
    for (const clip of clips) {
      const start = metadata.markers.find((marker) => marker.name === clip.from)?.atMs;
      const end = metadata.markers.find((marker) => marker.name === clip.to)?.atMs;
      const chapterIndex =
        "chapterId" in clip ? chapters.findIndex((chapter) => chapter.id === clip.chapterId) : -1;
      const chapter = chapters[chapterIndex];
      if (start !== undefined && end !== undefined) {
        if (chapter)
          chapters[chapterIndex] = {
            ...chapter,
            sourceStartMs: start,
            sourceEndMs: end,
            playbackStartMs: playbackMs,
          };
        playbackMs +=
          end - start + (metadata.clips.find((entry) => entry.from === clip.from)?.holdMs ?? 0);
      }
    }
    return yield* finalizeSdkEvidenceBundle({
      directory,
      manifest: {
        ...manifest,
        chapters,
        artifacts: [
          ...manifest.artifacts,
          { id: renderId, kind: "video", path: videoPath },
          { id: `${renderId}-edit`, kind: "edit", path: `${videoPath}.edit.json` },
          { id: `${renderId}-timeline`, kind: "other", path: metadataPath },
        ],
        outcomes: {
          ...manifest.outcomes,
          render: {
            status: "passed",
            detail: `${preset} preset; speed 1; each observed state held ${preset === "review" ? 4000 : 6000} ms. Source timeline retained in edit metadata.`,
          },
        },
      },
    });
  });

/** Open only explicit offline evidence; never interpret a stored reproduction command. @param {string} directory @param {{trace?:boolean,chapterId?:string|undefined}} options */
export const openSdkEvidence = (directory, options = {}) =>
  Effect.gen(function* () {
    const manifest = yield* readSdkEvidenceBundle(directory);
    if (options.chapterId && !manifest.chapters.some((chapter) => chapter.id === options.chapterId))
      return yield* Effect.fail(
        SdkEvidenceRunError.make({
          reason: "UnknownChapter",
          message: "Evidence chapter was not found. Inspect the bundle before opening a chapter.",
        }),
      );
    let url;
    if (options.trace) {
      const bookmark = manifest.traceBookmarks?.find(
        (entry) => options.chapterId === undefined || entry.chapterId === options.chapterId,
      );
      if (!bookmark)
        return yield* Effect.fail(
          SdkEvidenceRunError.make({
            reason: "TraceUnavailable",
            message:
              "Evidence trace bookmark is unavailable. Inspect the saved trace projection; viewer storage is ephemeral.",
          }),
        );
      const observed = yield* showSdkTrace(bookmark.traceId, {
        endpoint: bookmark.viewerUrl,
        run: "",
        failed: false,
        limit: 500,
        offset: 0,
      });
      if (
        observed.total === 0 ||
        (bookmark.spanId && !observed.spans.some((span) => span.spanID === bookmark.spanId))
      )
        return yield* Effect.fail(
          SdkEvidenceRunError.make({
            reason: "TraceUnavailable",
            message:
              "Evidence bookmarked trace or span is not currently observable. Inspect the saved projection or reproduce the run.",
          }),
        );
      url = sdkEvidenceBookmarkUrl(bookmark);
    } else {
      // Imported HTML is untrusted even when its path is contained; regenerate from the parsed manifest.
      yield* writeSdkEvidenceArtifact({
        directory,
        path: "review.html",
        content: renderSdkEvidenceReview(manifest).html,
      });
      const artifactPath = yield* resolveSdkEvidenceArtifact(directory, "review.html");
      url = pathToFileURL(artifactPath).href + (options.chapterId ? `#${options.chapterId}` : "");
    }
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command =
      process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : "";
    if (!command)
      return yield* Effect.fail(
        SdkEvidenceRunError.make({
          reason: "OpenUnsupported",
          message: "Evidence opening is unsupported on this platform. Open review.html explicitly.",
        }),
      );
    const handle = yield* spawner.spawn(
      ChildProcess.make(command, [url], {
        shell: false,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
    const code = yield* handle.exitCode;
    if (code !== 0)
      return yield* Effect.fail(
        SdkEvidenceRunError.make({
          reason: "OpenFailed",
          message: "Evidence opener failed. Open review.html explicitly.",
        }),
      );
    return { opened: true };
  }).pipe(Effect.scoped, Effect.timeout(5000));
