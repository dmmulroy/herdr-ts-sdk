import { createServer } from "node:http";
import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { runSdkEvidence, snapshotSdkEvidenceTraces } from "./sdk-evidence-runner.mjs";
import { readSdkEvidenceBundle, sdkEvidenceBookmarkUrl } from "./sdk-evidence-bundle.mjs";
import { verificationNodeLayer } from "./sdk-verification-process.mjs";

const mainTraceId = "a".repeat(32);
const linkedTraceId = "b".repeat(32);
const mainSpanId = "1".repeat(16);
const linkedSpanId = "2".repeat(16);
const parseViewerAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));
const parseViewerRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      method: Schema.Literals(["searchTraces", "searchSpans"]),
      params: Schema.Struct({ traceID: Schema.optionalKey(Schema.String) }),
    }),
  ),
);
type ViewerRequest = ReturnType<typeof parseViewerRequest>;

// This fixture speaks the actual read-only viewer RPC boundary, not a module mock.
function acquireEvidenceReviewViewer<Result>(
  reply: (request: ViewerRequest) => Result,
  rpcErrors: ReadonlyArray<number> = [],
) {
  return Effect.gen(function* () {
    const requests: ViewerRequest[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (Buffer.byteLength(body) > 65536) request.destroy();
      });
      request.on("end", () => {
        const parsed = parseViewerRequest(body);
        requests.push(parsed);
        response.writeHead(200, { "content-type": "application/json" });
        const code = rpcErrors[requests.length - 1];
        response.end(
          JSON.stringify(
            code === undefined
              ? { jsonrpc: "2.0", id: 1, result: reply(parsed) }
              : {
                  jsonrpc: "2.0",
                  id: 1,
                  error: { code, message: "Fixture viewer trace response" },
                },
          ),
        );
      });
    });
    yield* Effect.acquireRelease(
      Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)));
        server.listen(0, "127.0.0.1", () => resume(Effect.void));
      }),
      () =>
        Effect.callback<void>((resume) => {
          server.closeAllConnections();
          server.close(() => resume(Effect.void));
        }),
    );
    const { port } = parseViewerAddress(server.address());
    return { endpoint: `http://127.0.0.1:${port}`, requests };
  });
}

function evidenceReviewSpan(traceID = mainTraceId, spanID = mainSpanId) {
  return {
    traceID,
    traceStart: "1788630424281000000",
    unplacedSpanCount: 0,
    spans: [
      {
        depth: 0,
        matched: true,
        spanData: {
          spanID,
          parentSpanID: null,
          name: "sdk.execution",
          start: 0,
          dur: 10,
          statusCode: "Unset",
          attributes: [],
          r: 1,
          s: 1,
          links: [],
          events: [],
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        },
      },
    ],
  };
}

const summary = (traceID: string) => ({
  traceID,
  hasRootSpan: true,
  rootSpan: { name: "sdk.execution", serviceName: "herdr-sdk-development" },
  startTime: "1788630424281000000",
  durationNs: "10",
  spanCount: 1,
  errorCount: 0,
});

describe("evidence review across viewer and bundle boundaries", () => {
  it(
    "keeps malicious narrative inert and rejects a replaced artifact during offline inspection",
    (context) =>
      runSdkToolingTest(
        context,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const parent = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-evidence-review-" });
          const claim = '<script>alert("fixture-review")</script>';
          const result = yield* runSdkEvidence({
            scenarioId: "compatibility-recovery",
            claim,
            out: parent,
          });
          expect(result.manifest.outcomes.product.status).toBe("passed");
          expect(result.manifest.outcomes.recording.status).toBe("not-requested");
          expect(result.manifest.outcomes.viewer.status).toBe("not-requested");
          const inspected = yield* readSdkEvidenceBundle(result.directory);
          expect(inspected.claim).toBe(claim);
          expect(inspected.executionKind ?? "fixture").toBe("fixture");
          const html = yield* fs.readFileString(join(result.directory, "review.html"));
          expect(html).not.toContain("<script>");
          expect(html).toContain("&lt;script&gt;");
          expect(html).toContain("not an assertion");
          expect(html).toContain("Fixture evidence only; live Herdr UI was not exercised.");
          expect(html).not.toContain("Isolated Herdr execution");
          const artifact = inspected.artifacts[0];
          if (!artifact) return yield* Effect.die("Evidence review fixture produced no artifact");
          const outside = join(parent, "private-fixture.txt");
          yield* fs.writeFileString(outside, "fixture-private-sentinel");
          yield* fs.remove(join(result.directory, artifact.path));
          yield* fs.symlink(outside, join(result.directory, artifact.path));
          const failure = yield* readSdkEvidenceBundle(result.directory).pipe(Effect.flip);
          expect(failure.reason).toBe("unsafe-path");
        }).pipe(Effect.scoped, Effect.provide(verificationNodeLayer)),
      ),
    // Includes a real Vitest child process; match the other evidence integration-test budgets.
    15000,
  );
  it(
    "never treats an HTTP-accepted zero-span query as observed evidence",
    (context) =>
      runSdkToolingTest(
        context,
        Effect.gen(function* () {
          const viewer = yield* acquireEvidenceReviewViewer(() => ({
            ...evidenceReviewSpan(),
            spans: [],
          }));
          const result = yield* snapshotSdkEvidenceTraces({
            traceIds: [mainTraceId],
            runIds: [],
            endpoint: viewer.endpoint,
          });
          expect(result.outcome.status).toBe("unavailable");
          expect(result.bookmarks).toHaveLength(0);
          expect(result.warnings.length).toBeGreaterThan(0);
          expect(viewer.requests.length).toBeLessThanOrEqual(16);
        }).pipe(Effect.scoped),
      ),
    10000,
  );

  it(
    "bounds attempted trace queries even when every trace is unavailable",
    (context) =>
      runSdkToolingTest(
        context,
        Effect.gen(function* () {
          const viewer = yield* acquireEvidenceReviewViewer((request) => ({
            ...evidenceReviewSpan(request.params.traceID),
            spans: [],
          }));
          const traceIds = Array.from({ length: 17 }, (_, index) =>
            index.toString(16).padStart(32, "0"),
          );
          const result = yield* snapshotSdkEvidenceTraces({
            traceIds,
            runIds: [],
            endpoint: viewer.endpoint,
          });
          expect(result.outcome.status).toBe("unavailable");
          expect(viewer.requests.length).toBeLessThanOrEqual(31);
          expect(
            new Set(viewer.requests.map((request) => request.params.traceID)).size,
          ).toBeLessThanOrEqual(16);
        }).pipe(Effect.scoped),
      ),
    10000,
  );

  it("retries the real viewer not-found RPC envelope before discovering run roots", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const viewer = yield* acquireEvidenceReviewViewer(
          (request) =>
            request.method === "searchTraces" ? [summary(mainTraceId)] : evidenceReviewSpan(),
          [-32001, -32001],
        );
        const result = yield* snapshotSdkEvidenceTraces({
          traceIds: [mainTraceId],
          runIds: ["rpc-delayed-fixture-run"],
          endpoint: viewer.endpoint,
        });
        expect(result.outcome.status).toBe("passed");
        expect(result.snapshots.map((snapshot) => snapshot.traceID)).toEqual([mainTraceId]);
        expect(
          viewer.requests.slice(0, 3).every((request) => request.method === "searchSpans"),
        ).toBe(true);
      }).pipe(Effect.scoped),
    ));

  it("does not amplify an unexpected RPC error as an ingestion retry", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const viewer = yield* acquireEvidenceReviewViewer(() => evidenceReviewSpan(), [-32000]);
        const result = yield* snapshotSdkEvidenceTraces({
          traceIds: [mainTraceId],
          runIds: [],
          endpoint: viewer.endpoint,
        });
        expect(result.outcome.status).toBe("unavailable");
        expect(viewer.requests).toHaveLength(1);
      }).pipe(Effect.scoped),
    ));

  it("keeps missing-parent evidence partial even when query partial is false", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const detail = evidenceReviewSpan();
        const viewer = yield* acquireEvidenceReviewViewer(() => ({
          ...detail,
          spans: detail.spans.map((span) => ({
            ...span,
            spanData: { ...span.spanData, parentSpanID: linkedSpanId },
          })),
        }));
        const result = yield* snapshotSdkEvidenceTraces({
          traceIds: [mainTraceId],
          runIds: [],
          endpoint: viewer.endpoint,
        });
        expect(result.outcome.status).toBe("partial");
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.snapshots[0]?.partial).toBe(false);
        expect(result.snapshots[0]?.spans[0]?.incompleteParent).toBe(true);
      }).pipe(Effect.scoped),
    ));

  it("does not invent an observable bookmark for unavailable linked compatibility work", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const root = evidenceReviewSpan();
        const viewer = yield* acquireEvidenceReviewViewer((request) =>
          request.params.traceID === linkedTraceId
            ? { ...evidenceReviewSpan(linkedTraceId), spans: [] }
            : {
                ...root,
                spans: root.spans.map((span) => ({
                  ...span,
                  spanData: {
                    ...span.spanData,
                    links: [{ traceID: linkedTraceId, spanID: linkedSpanId }],
                  },
                })),
              },
        );
        const result = yield* snapshotSdkEvidenceTraces({
          traceIds: [mainTraceId],
          runIds: [],
          endpoint: viewer.endpoint,
        });
        expect(result.outcome.status).toBe("partial");
        expect(result.snapshots.map((snapshot) => snapshot.traceID)).toEqual([mainTraceId]);
        expect(result.bookmarks.some((bookmark) => bookmark.traceId === linkedTraceId)).toBe(false);
        expect(
          viewer.requests.filter((request) => request.params.traceID === linkedTraceId),
        ).toHaveLength(1);
      }).pipe(Effect.scoped),
    ));

  it("waits for emitted-root visibility before discovering independent run roots", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        let rootQueries = 0;
        let rootVisible = false;
        const viewer = yield* acquireEvidenceReviewViewer((request) => {
          if (request.method === "searchTraces")
            return rootVisible ? [summary(mainTraceId), summary(linkedTraceId)] : [];
          if (request.params.traceID === linkedTraceId)
            return evidenceReviewSpan(linkedTraceId, linkedSpanId);
          rootQueries++;
          rootVisible = rootQueries >= 3;
          return rootVisible ? evidenceReviewSpan() : { ...evidenceReviewSpan(), spans: [] };
        });
        const result = yield* snapshotSdkEvidenceTraces({
          traceIds: [mainTraceId],
          runIds: ["delayed-fixture-run"],
          endpoint: viewer.endpoint,
        });
        expect(result.snapshots.map((snapshot) => snapshot.traceID)).toEqual(
          expect.arrayContaining([mainTraceId, linkedTraceId]),
        );
        expect(
          viewer.requests.slice(0, 3).every((request) => request.method === "searchSpans"),
        ).toBe(true);
        expect(result.outcome.status).toBe("passed");
      }).pipe(Effect.scoped),
    ));

  it("discovers independent roots by run identity and uses actual span IDs in bookmarks", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const viewer = yield* acquireEvidenceReviewViewer((request) =>
          request.method === "searchTraces"
            ? [summary(mainTraceId), summary(linkedTraceId)]
            : request.params.traceID === linkedTraceId
              ? evidenceReviewSpan(linkedTraceId, linkedSpanId)
              : evidenceReviewSpan(),
        );
        const result = yield* snapshotSdkEvidenceTraces({
          traceIds: [mainTraceId],
          runIds: ["fixture-review-run"],
          endpoint: viewer.endpoint,
        });
        expect(result.snapshots.map((snapshot) => snapshot.traceID)).toEqual(
          expect.arrayContaining([mainTraceId, linkedTraceId]),
        );
        expect(result.bookmarks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              traceId: linkedTraceId,
              spanId: linkedSpanId,
              viewerUrl: viewer.endpoint,
            }),
          ]),
        );
        expect(
          result.bookmarks.map((bookmark) =>
            sdkEvidenceBookmarkUrl({ ...bookmark, id: "fixture-bookmark", label: "Fixture trace" }),
          ),
        ).toContain(`${viewer.endpoint}/traces/${linkedTraceId}?span=${linkedSpanId}`);
        expect(result.bookmarks.every((bookmark) => !bookmark.viewerUrl.includes("event="))).toBe(
          true,
        );
      }).pipe(Effect.scoped),
    ));
});
