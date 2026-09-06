import { createServer } from "node:http";
import { Effect, Fiber, Deferred, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { listSdkTraces, showSdkTrace, runSdkTraceQueryCli } from "./sdk-trace-query.mjs";

const traceID = "a".repeat(32);
const spanID = "1".repeat(16);
const summary = {
  traceID,
  hasRootSpan: true,
  rootSpan: { name: "sdk.execution", serviceName: "herdr-sdk-development" },
  startTime: "1788630424281000000",
  durationNs: "10",
  spanCount: 1,
  errorCount: 0,
};
const options = { run: "", failed: false, limit: 50, offset: 0 };
const requestContract = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Literal(1),
  method: Schema.Literals(["searchTraces", "searchSpans"]),
  params: Schema.Struct({
    startTime: Schema.optionalKey(Schema.String),
    endTime: Schema.optionalKey(Schema.String),
    traceID: Schema.optionalKey(Schema.String),
  }),
});
const parseRequest = Schema.decodeUnknownSync(requestContract);

function viewerFixture(
  respond: (index: number) => { body: string; status?: number; location?: string },
) {
  return Effect.gen(function* () {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        requests.push(body);
        const reply = respond(requests.length - 1);
        if (reply.location) response.setHeader("location", reply.location);
        response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        response.end(reply.body);
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
    const address = server.address();
    if (address === null || typeof address === "string")
      return yield* Effect.die("fixture did not bind TCP");
    return { endpoint: `http://127.0.0.1:${address.port}`, requests };
  });
}
const rpc = <A>(result: A) => ({ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) });
const detail = (attributes: Array<{ key: string; value: string; type: string }> = []) => ({
  traceID,
  traceStart: summary.startTime,
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
        attributes,
        r: 1,
        s: 1,
        links: [],
        events: [],
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
    },
  ],
});

describe("read-only viewer 0.5.0 query adapter", () => {
  it("sends explicit nanosecond bounds, pages locally, and does not infer root failure from child errors", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fixture = yield* viewerFixture((index) =>
          rpc(
            index % 4 === 0
              ? [
                  { ...summary, errorCount: 3 },
                  { ...summary, traceID: "b".repeat(32) },
                ]
              : index % 4 === 1
                ? [summary]
                : [],
          ),
        );
        const result = yield* listSdkTraces({ ...options, endpoint: fixture.endpoint, limit: 1 });
        expect(result).toMatchObject({
          total: 2,
          truncated: true,
          traces: [
            {
              outcome: "success",
              matchedErrorCount: 3,
              matchedSpanCount: 1,
              countsScope: "all-spans",
            },
          ],
        });
        const first = parseRequest(JSON.parse(fixture.requests[0] ?? "null"));
        expect(first.params).toMatchObject({ startTime: "0", endTime: "9223372036854775807" });
        for (const request of fixture.requests)
          expect(parseRequest(JSON.parse(request)).method).toBe("searchTraces");
        const next = yield* listSdkTraces({
          ...options,
          endpoint: fixture.endpoint,
          offset: 1,
          limit: 1,
        });
        expect(next.offset).toBe(1);
        expect(next.traces).toMatchObject([{ traceID: "b".repeat(32) }]);
        expect(next.truncated).toBe(false);
      }).pipe(Effect.scoped),
    ));

  it("includes interrupted roots in --failed even with zero OTLP errors", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fixture = yield* viewerFixture((index) =>
          rpc(index === 0 || index === 3 ? [summary] : []),
        );
        const result = yield* listSdkTraces({
          ...options,
          endpoint: fixture.endpoint,
          failed: true,
          run: "test-run",
        });
        expect(result.traces).toMatchObject([
          { outcome: "interrupted", matchedErrorCount: 0, countsScope: "run-matched-spans" },
        ]);
        expect(fixture.requests.every((request) => request.includes("sdk.run_id"))).toBe(true);
      }).pipe(Effect.scoped),
    ));

  it("retains approved Herdr metadata and represents interruption without an OTLP error", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fixture = yield* viewerFixture(() =>
          rpc(
            detail([
              { key: "status.interrupted", value: "true", type: "bool" },
              { key: "herdr.deadline_ms", value: "5000", type: "int64" },
              { key: "herdr.bytes_written", value: "32", type: "int64" },
              { key: "sdk.secret", value: "secret", type: "string" },
              { key: "herdr.method", value: "secret injected method", type: "string" },
            ]),
          ),
        );
        const result = yield* showSdkTrace(traceID, { ...options, endpoint: fixture.endpoint });
        expect(result.spans[0]).toMatchObject({
          outcome: "interrupted",
          attributes: [
            { key: "status.interrupted", value: "true" },
            { key: "herdr.deadline_ms", value: "5000" },
            { key: "herdr.bytes_written", value: "32" },
          ],
        });
        expect(JSON.stringify(result)).not.toContain("secret");
      }).pipe(Effect.scoped),
    ));

  it("does not infer success from unset OTLP status", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fixture = yield* viewerFixture(() => rpc(detail()));
        const result = yield* showSdkTrace(traceID, { ...options, endpoint: fixture.endpoint });
        expect(result.spans[0]?.outcome).toBe("unknown");
      }).pipe(Effect.scoped),
    ));

  it("marks incomplete parents, cycles, deep trees and retained links without terminal escapes", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const base = detail([{ key: "sdk.outcome", value: "interrupted", type: "string" }]);
        const node = base.spans[0];
        if (!node) return yield* Effect.die("missing test node");
        const fixture = yield* viewerFixture(() =>
          rpc({
            ...base,
            spans: [
              {
                ...node,
                depth: 10000,
                spanData: {
                  ...node.spanData,
                  name: "\u001b[31m" + "x".repeat(500),
                  parentSpanID: "2".repeat(16),
                  links: [{ traceID: "b".repeat(32), spanID }],
                },
              },
              {
                ...node,
                spanData: {
                  ...node.spanData,
                  spanID: "3".repeat(16),
                  parentSpanID: "3".repeat(16),
                },
              },
            ],
          }),
        );
        const result = yield* showSdkTrace(traceID, { ...options, endpoint: fixture.endpoint });
        expect(result.spans[0]).toMatchObject({
          depth: 32,
          depthTruncated: true,
          incompleteParent: true,
          outcome: "interrupted",
          links: [{ traceID: "b".repeat(32), spanID }],
        });
        expect(result.spans[1]?.cycle).toBe(true);
        expect(result.spans[0]?.name.length).toBeLessThanOrEqual(160);
        expect(JSON.stringify(result)).not.toContain("\\u001b");
      }).pipe(Effect.scoped),
    ));

  it("projects viewer 0.5.0 timed events with bounded approved metadata and native drop evidence", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const base = detail();
        const node = base.spans[0];
        if (!node) return yield* Effect.die("missing event test span");
        const event = {
          name: "herdr.graphics.invalidated",
          timestamp: "1788630424281000001",
          droppedAttributesCount: 0,
          attributes: [
            { key: "herdr.reason", value: "timeout", type: "string" },
            { key: "sdk.secret", value: "secret payload", type: "string" },
          ],
        };
        const fixture = yield* viewerFixture(() =>
          rpc({
            ...base,
            spans: [
              {
                ...node,
                spanData: {
                  ...node.spanData,
                  droppedEventsCount: 2,
                  droppedLinksCount: 3,
                  events: [
                    event,
                    {
                      ...event,
                      name: "\u001bsecret event",
                      attributes: Array.from({ length: 30 }, () => ({
                        key: "herdr.bytes.count",
                        value: "1",
                        type: "int64",
                      })),
                    },
                    ...Array.from({ length: 15 }, () => event),
                  ],
                },
              },
            ],
          }),
        );
        const result = yield* showSdkTrace(traceID, { ...options, endpoint: fixture.endpoint });
        expect(result.partial).toBe(true);
        expect(result.spans[0]).toMatchObject({
          droppedEventsCount: 2,
          droppedLinksCount: 3,
          eventsTruncated: true,
          linksTruncated: true,
        });
        expect(result.spans[0]?.events).toHaveLength(16);
        expect(result.spans[0]?.events[0]).toEqual({
          name: "herdr.graphics.invalidated",
          timestamp: event.timestamp,
          droppedAttributesCount: 0,
          attributes: [{ key: "herdr.reason", value: "timeout" }],
          attributesTruncated: false,
        });
        expect(result.spans[0]?.events[1]).toMatchObject({
          name: "sdk.redacted",
          attributesTruncated: true,
        });
        expect(result.spans[0]?.events[1]?.attributes).toHaveLength(24);
        expect(JSON.stringify(result)).not.toContain("secret");
      }).pipe(Effect.scoped),
    ));

  it("defaults to 2MB but permits bounded 8MB reads without expanding output caps", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fixture = yield* viewerFixture(() =>
          rpc({ ...detail(), ignoredPayload: "x".repeat(3_000_000) }),
        );
        const error = yield* showSdkTrace(traceID, { ...options, endpoint: fixture.endpoint }).pipe(
          Effect.flip,
        );
        expect(error).toMatchObject({ reason: "ResponseLimit" });
        if ("message" in error) expect(error.message).toContain("2MB");
        const result = yield* showSdkTrace(traceID, {
          ...options,
          endpoint: fixture.endpoint,
          maxResponseMb: 8,
        });
        expect(result.total).toBe(1);
        expect(JSON.stringify(result).length).toBeLessThan(2000);
      }).pipe(Effect.scoped),
    ));

  it.for(["9", "NaN", "0", "1.5"])("rejects --max-response-mb %s before HTTP", (value, context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fixture = yield* viewerFixture(() => rpc([]));
        const error = yield* runSdkTraceQueryCli([
          "list",
          "--endpoint",
          fixture.endpoint,
          "--max-response-mb",
          value,
        ]).pipe(Effect.flip);
        expect(error).toMatchObject({ reason: "Arguments" });
        expect(fixture.requests).toEqual([]);
      }).pipe(Effect.scoped),
    ),
  );

  it("enforces an explicitly smaller 1MB response budget", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const fixture = yield* viewerFixture(() =>
          rpc({ ...detail(), ignoredPayload: "x".repeat(1_500_000) }),
        );
        const error = yield* showSdkTrace(traceID, {
          ...options,
          endpoint: fixture.endpoint,
          maxResponseMb: 1,
        }).pipe(Effect.flip);
        expect(error).toMatchObject({ reason: "ResponseLimit" });
        if ("message" in error) expect(error.message).toContain("1MB");
      }).pipe(Effect.scoped),
    ));

  it("does not follow HTTP redirects even to another local endpoint", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const target = yield* viewerFixture(() => rpc([]));
        const source = yield* viewerFixture(() => ({
          status: 302,
          body: "",
          location: `${target.endpoint}/rpc`,
        }));
        const error = yield* listSdkTraces({ ...options, endpoint: source.endpoint }).pipe(
          Effect.flip,
        );
        expect(error).toMatchObject({ reason: "HttpStatus" });
        expect(target.requests).toEqual([]);
      }).pipe(Effect.scoped),
    ));

  it.for(["sdk.telemetry.dropped", "sdk.telemetry.metadata_dropped"])(
    "marks %s independently of execution outcome",
    (key, context) =>
      runSdkToolingTest(
        context,
        Effect.gen(function* () {
          const fixture = yield* viewerFixture(() =>
            rpc(
              detail([
                { key: "sdk.outcome", value: "success", type: "string" },
                { key, value: "3", type: "int64" },
              ]),
            ),
          );
          const result = yield* showSdkTrace(traceID, { ...options, endpoint: fixture.endpoint });
          expect(result.partial).toBe(true);
          expect(result.spans[0]?.outcome).toBe("success");
        }).pipe(Effect.scoped),
      ),
  );

  it.for([
    ["HTTP status", { status: 503, body: "secret remote diagnostic" }, "HttpStatus"],
    ["JSON", { body: "not-json secret" }, "MalformedJson"],
    ["schema", rpc([{ traceID }]), "Schema"],
    [
      "RPC failure",
      {
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "secret" } }),
      },
      "RpcError",
    ],
    ["byte limit", { body: "😀".repeat(600_000) }, "ResponseLimit"],
  ] as const)(
    "classifies %s failures without leaking raw bodies",
    ([_name, response, reason], context) =>
      runSdkToolingTest(
        context,
        Effect.gen(function* () {
          const fixture = yield* viewerFixture(() => response);
          const error = yield* listSdkTraces({ ...options, endpoint: fixture.endpoint }).pipe(
            Effect.flip,
          );
          expect(error).toMatchObject({ reason });
          expect(JSON.stringify(error)).not.toContain("secret");
        }).pipe(Effect.scoped),
      ),
  );

  it.for([
    "http://example.com",
    "http://user:secret@127.0.0.1:8000",
    "http://127.0.0.1:8000?secret",
    "http://127.0.0.1:8000#secret",
  ])("rejects unsafe endpoint before HTTP: %s", (endpoint, context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const error = yield* runSdkTraceQueryCli(["list", "--endpoint", endpoint]).pipe(
          Effect.flip,
        );
        expect(error).toMatchObject({ reason: "Arguments" });
        expect(JSON.stringify(error)).not.toContain("secret");
      }),
    ),
  );

  it.for([
    [-32001, "NotFound"],
    [-32004, "RpcError"],
    [-32603, "RpcError"],
  ] as const)(
    "classifies trace lookup RPC %s without treating other failures as absence",
    ([code, reason], context) =>
      runSdkToolingTest(
        context,
        Effect.gen(function* () {
          const fixture = yield* viewerFixture(() => ({
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code, message: "secret" } }),
          }));
          const error = yield* showSdkTrace(traceID, {
            ...options,
            endpoint: fixture.endpoint,
          }).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "SdkTraceQueryError", reason });
          expect(JSON.stringify(error)).not.toContain("secret");
          expect(fixture.requests).toHaveLength(1);
          expect(parseRequest(JSON.parse(fixture.requests[0] ?? "null")).method).toBe(
            "searchSpans",
          );
        }).pipe(Effect.scoped),
      ),
  );

  it("interrupts an in-flight HTTP request", (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const accepted = yield* Deferred.make<void>();
        const closed = yield* Deferred.make<void>();
        const server = createServer((request) => {
          Effect.runSync(Deferred.succeed(accepted, undefined));
          request.on("close", () => Effect.runSync(Deferred.succeed(closed, undefined)));
        });
        yield* Effect.acquireRelease(
          Effect.callback<void>((resume) => {
            server.listen(0, "127.0.0.1", () => resume(Effect.void));
          }),
          () =>
            Effect.sync(() => {
              server.closeAllConnections();
              server.close();
            }),
        );
        const address = server.address();
        if (!address || typeof address === "string")
          return yield* Effect.die("missing TCP address");
        const fiber = yield* listSdkTraces({
          ...options,
          endpoint: `http://127.0.0.1:${address.port}`,
        }).pipe(Effect.forkScoped);
        yield* Deferred.await(accepted);
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(closed).pipe(Effect.timeout(2000));
      }).pipe(Effect.scoped),
    ));
});
