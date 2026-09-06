import { pathToFileURL } from "node:url";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import { parseArgs } from "node:util";
import { approvedSdkTelemetryAttribute } from "./sdk-telemetry-execution.mjs";
import { sdkTelemetrySourceTokens } from "./sdk-telemetry.mjs";
import { Console, Effect, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

/** Query failures exclude server bodies and unsafe input values. */
export const SdkTraceQueryError = Schema.TaggedStruct("SdkTraceQueryError", {
  reason: Schema.String,
  message: Schema.String,
});

const traceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));
const spanId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/));
const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const attribute = Schema.Struct({ key: Schema.String, value: Schema.String, type: Schema.String });
// Minimal projection of the v0.5.0 SQL wire contract; unknown fields are intentionally not retained.
const traceSummary = Schema.Struct({
  traceID: traceId,
  hasRootSpan: Schema.Boolean,
  rootSpan: Schema.NullOr(
    Schema.Struct({ name: Schema.String, serviceName: Schema.NullOr(Schema.String) }),
  ),
  startTime: Schema.String.check(Schema.isPattern(/^\d{1,24}$/)),
  durationNs: Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{1,24}$/))),
  spanCount: count,
  errorCount: count,
});
const spanNode = Schema.Struct({
  depth: count,
  matched: Schema.Boolean,
  salvaged: Schema.optional(Schema.Boolean),
  cyclePoint: Schema.optional(Schema.Boolean),
  spanData: Schema.Struct({
    spanID: spanId,
    parentSpanID: Schema.NullOr(spanId),
    name: Schema.String,
    start: Schema.Number.check(Schema.isFinite()),
    dur: Schema.Number.check(Schema.isFinite()),
    statusCode: Schema.Literals(["Unset", "Ok", "Error"]),
    attributes: Schema.Array(attribute),
    r: count,
    s: count,
    links: Schema.Array(Schema.Struct({ traceID: traceId, spanID: spanId })),
    droppedEventsCount: count,
    droppedLinksCount: count,
    events: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        timestamp: Schema.String.check(Schema.isPattern(/^\d{1,24}$/)),
        droppedAttributesCount: count,
        attributes: Schema.Array(attribute),
      }),
    ),
  }),
});
const traceDetail = Schema.Struct({
  traceID: traceId,
  traceStart: Schema.String.check(Schema.isPattern(/^\d{1,24}$/)),
  unplacedSpanCount: count,
  spans: Schema.Array(spanNode),
});
const queryOptions = Schema.Struct({
  endpoint: Schema.String.check(
    Schema.isPattern(/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?\/?$/),
  ),
  run: Schema.String.check(Schema.isMaxLength(128), Schema.isPattern(/^[a-zA-Z0-9_.:-]*$/)),
  failed: Schema.Boolean,
  limit: count.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500)),
  offset: count.check(Schema.isLessThanOrEqualTo(10000)),
  maxResponseMb: count
    .check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(8))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(2))),
});
const parseQueryOptions = Schema.decodeEffect(queryOptions);
const parseTraceId = Schema.decodeEffect(traceId);
const parseTraceSummaries = Schema.decodeUnknownEffect(Schema.Array(traceSummary));
const parseTraceDetail = Schema.decodeUnknownEffect(traceDetail);
const parseRpcEnvelope = Schema.decodeUnknownEffect(
  Schema.Union([
    Schema.Struct({
      jsonrpc: Schema.Literal("2.0"),
      id: Schema.Literal(1),
      result: Schema.Unknown,
    }),
    Schema.Struct({
      jsonrpc: Schema.Literal("2.0"),
      id: Schema.Literal(1),
      error: Schema.Struct({ code: Schema.Number.check(Schema.isInt()), message: Schema.String }),
    }),
  ]),
);

/** Remove terminal controls and bound each displayed metadata string. @param {string} text */
export function sanitizeTraceText(text) {
  const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, "?");
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean;
}

/** @param {string} reason @param {string} message */
function queryFailure(reason, message) {
  return SdkTraceQueryError.make({ reason, message });
}

/** @typedef {{id: string, type: string, group: {logicalOperator: string, children: ReadonlyArray<ReturnType<typeof attributeCondition>>}}} SdkTraceSearch */
/** @template T @param {string} endpoint @param {"searchTraces" | "searchSpans"} method @param {{startTime: string, endTime: string, query: SdkTraceSearch | undefined} | {traceID: string}} params @param {(input: unknown) => Effect.Effect<T, Schema.SchemaError>} parseResult @param {number} maxResponseMb */
function queryViewerRpc(endpoint, method, params, parseResult, maxResponseMb) {
  return Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(`${endpoint.replace(/\/$/, "")}/rpc`).pipe(
        HttpClientRequest.bodyText(
          JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          "application/json",
        ),
      ),
    );
    if (response.status !== 200)
      return yield* Effect.fail(
        queryFailure(
          "HttpStatus",
          `Trace query rejected (HTTP ${response.status}). Check the viewer endpoint and retry.`,
        ),
      );
    let receivedBytes = 0;
    const body = yield* response.stream.pipe(
      Stream.mapEffect((chunk) => {
        receivedBytes += chunk.byteLength;
        return receivedBytes > maxResponseMb * 1_000_000
          ? Effect.fail(
              queryFailure(
                "ResponseLimit",
                `Trace query response exceeds ${maxResponseMb}MB. For a known large trace, raise --max-response-mb up to 8; otherwise rerun a focused test or scenario.`,
              ),
            )
          : Effect.succeed(chunk);
      }),
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (text, chunk) => text + chunk,
      ),
    );
    const json = yield* Effect.try({
      try: () => JSON.parse(body),
      catch: () =>
        queryFailure(
          "MalformedJson",
          "Trace query returned invalid JSON. Check viewer compatibility (0.5.0).",
        ),
    });
    const envelope = yield* parseRpcEnvelope(json);
    if ("error" in envelope) {
      if (method === "searchSpans" && envelope.error.code === -32001)
        return yield* Effect.fail(
          queryFailure(
            "NotFound",
            "Trace query found no matching trace. Retry this read after ingestion, or check the trace ID and viewer retention.",
          ),
        );
      return yield* Effect.fail(
        queryFailure(
          "RpcError",
          `Trace query RPC failed (code ${envelope.error.code}). Check the trace ID and viewer compatibility (0.5.0).`,
        ),
      );
    }
    return yield* parseResult(envelope.result);
  }).pipe(
    Effect.timeout(5000),
    Effect.catchTags({
      SchemaError: () =>
        Effect.fail(
          queryFailure(
            "Schema",
            "Trace query response is incompatible. Expected otel-desktop-viewer 0.5.0; check the installed version.",
          ),
        ),
      HttpClientError: () =>
        Effect.fail(
          queryFailure(
            "Connection",
            "Trace query could not reach the viewer. Start trace:viewer or check --endpoint.",
          ),
        ),
      TimeoutError: () =>
        Effect.fail(
          queryFailure("Timeout", "Trace query exceeded 5 seconds. Narrow the query and retry."),
        ),
    }),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
  );
}

/** @param {string} name @param {string} value */
function attributeCondition(name, value) {
  return {
    id: name,
    type: "condition",
    query: {
      field: { name, type: "string", searchScope: "attribute", attributeScope: "span" },
      fieldOperator: "=",
      value,
    },
  };
}

/** List bounded trace summaries; offset is local because viewer 0.5.0 has no pagination. @param {Schema.Codec.Encoded<typeof queryOptions>} options */
export const listSdkTraces = (options) =>
  Effect.gen(function* () {
    const config = yield* parseQueryOptions(options);
    const tokens = yield* sdkTelemetrySourceTokens.pipe(
      Effect.mapError(() =>
        queryFailure(
          "MetadataPolicy",
          "Trace query could not load the local metadata policy. Run from a complete SDK checkout.",
        ),
      ),
    );
    const children = config.run ? [attributeCondition("sdk.run_id", config.run)] : [];
    const query = children.length
      ? { id: "sdk-query", type: "group", group: { logicalOperator: "AND", children } }
      : undefined;
    const traces = yield* queryViewerRpc(
      config.endpoint,
      "searchTraces",
      { startTime: "0", endTime: "9223372036854775807", query },
      parseTraceSummaries,
      config.maxResponseMb,
    );
    const outcomeTraces = yield* Effect.forEach(["success", "failure", "interrupted"], (outcome) =>
      queryViewerRpc(
        config.endpoint,
        "searchTraces",
        {
          startTime: "0",
          endTime: "9223372036854775807",
          query: {
            id: "sdk-outcome",
            type: "group",
            group: {
              logicalOperator: "AND",
              children: [...children, attributeCondition("sdk.outcome", outcome)],
            },
          },
        },
        parseTraceSummaries,
        config.maxResponseMb,
      ),
    );
    const successes = new Set(outcomeTraces[0]?.map((trace) => trace.traceID));
    const failures = new Set(outcomeTraces[1]?.map((trace) => trace.traceID));
    const interrupted = new Set(outcomeTraces[2]?.map((trace) => trace.traceID));
    const matching = traces.filter(
      (trace) => !config.failed || failures.has(trace.traceID) || interrupted.has(trace.traceID),
    );
    return {
      total: matching.length,
      offset: config.offset,
      truncated: config.offset + config.limit < matching.length,
      traces: matching.slice(config.offset, config.offset + config.limit).map((trace) => ({
        traceID: trace.traceID,
        hasRootSpan: trace.hasRootSpan,
        startTime: trace.startTime,
        durationNs: trace.durationNs,
        matchedSpanCount: trace.spanCount,
        matchedErrorCount: trace.errorCount,
        countsScope: config.run ? "run-matched-spans" : "all-spans",
        outcome:
          Number(interrupted.has(trace.traceID)) +
            Number(failures.has(trace.traceID)) +
            Number(successes.has(trace.traceID)) >
          1
            ? "mixed"
            : interrupted.has(trace.traceID)
              ? "interrupted"
              : failures.has(trace.traceID)
                ? "failure"
                : successes.has(trace.traceID)
                  ? "success"
                  : "unknown",
        rootSpan:
          trace.rootSpan === null
            ? null
            : {
                name: tokens.has(trace.rootSpan.name)
                  ? sanitizeTraceText(trace.rootSpan.name)
                  : "sdk.redacted",
                serviceName:
                  trace.rootSpan.serviceName === "herdr-sdk-development"
                    ? trace.rootSpan.serviceName
                    : "sdk.redacted",
              },
      })),
    };
  });

/** @param {typeof spanNode.Type.spanData} span */
function traceSpanOutcome(span) {
  if (
    span.attributes.some(
      (a) =>
        (a.key === "status.interrupted" && a.value === "true") ||
        ((a.key === "sdk.outcome" || a.key === "herdr.outcome") && a.value === "interrupted"),
    )
  )
    return "interrupted";
  const explicit = span.attributes.find(
    (a) =>
      (a.key === "sdk.outcome" || a.key === "herdr.outcome") &&
      ["success", "failure"].includes(a.value),
  );
  if (explicit) return explicit.value === "success" ? "success" : "failure";
  return span.statusCode === "Error" ? "failure" : span.statusCode === "Ok" ? "success" : "unknown";
}

/** @param {typeof spanNode.Type} node @param {ReadonlyArray<typeof spanNode.Type>} nodes */
function traceParentCycle(node, nodes) {
  const parents = new Map(
    nodes.map((entry) => [entry.spanData.spanID, entry.spanData.parentSpanID]),
  );
  const seen = new Set([node.spanData.spanID]);
  let parent = node.spanData.parentSpanID;
  while (parent) {
    if (seen.has(parent)) return true;
    seen.add(parent);
    parent = parents.get(parent) ?? null;
  }
  return false;
}

/** Show bounded, cycle-safe trace rows; missing parents and salvaged cycles remain explicit. @param {string} id @param {Schema.Codec.Encoded<typeof queryOptions>} options */
export const showSdkTrace = (id, options) =>
  Effect.gen(function* () {
    const config = yield* parseQueryOptions(options);
    const parsedId = yield* parseTraceId(id);
    const tokens = yield* sdkTelemetrySourceTokens.pipe(
      Effect.mapError(() =>
        queryFailure(
          "MetadataPolicy",
          "Trace query could not load the local metadata policy. Run from a complete SDK checkout.",
        ),
      ),
    );
    const trace = yield* queryViewerRpc(
      config.endpoint,
      "searchSpans",
      { traceID: parsedId },
      parseTraceDetail,
      config.maxResponseMb,
    );
    if (trace.traceID !== parsedId)
      return yield* Effect.fail(
        queryFailure(
          "Correlation",
          "Trace query returned a different trace ID. Check viewer compatibility.",
        ),
      );
    const present = new Set(trace.spans.map((node) => node.spanData.spanID));
    if (present.size !== trace.spans.length)
      return yield* Effect.fail(
        queryFailure(
          "DuplicateSpan",
          "Trace query contains duplicate span IDs. Check viewer compatibility.",
        ),
      );
    const page = trace.spans.slice(config.offset, config.offset + config.limit);
    const visible = new Set(page.map((node) => node.spanData.spanID));
    return {
      traceID: trace.traceID,
      traceStart: trace.traceStart,
      total: trace.spans.length,
      unplacedSpanCount: trace.unplacedSpanCount,
      truncated: trace.spans.length > config.offset + config.limit,
      partial:
        trace.unplacedSpanCount > 0 ||
        trace.spans.some(
          (node) =>
            node.spanData.droppedEventsCount > 0 ||
            node.spanData.droppedLinksCount > 0 ||
            node.spanData.events.some((event) => event.droppedAttributesCount > 0),
        ) ||
        trace.spans.some((node) =>
          node.spanData.attributes.some(
            (a) =>
              (a.key === "sdk.telemetry.dropped" || a.key === "sdk.telemetry.metadata_dropped") &&
              approvedSdkTelemetryAttribute(a.key, a.value, tokens) &&
              Number(a.value) > 0,
          ),
        ),
      spans: page.map((node) => ({
        spanID: node.spanData.spanID,
        parentSpanID: node.spanData.parentSpanID,
        name: tokens.has(node.spanData.name)
          ? sanitizeTraceText(node.spanData.name)
          : "sdk.redacted",
        depth: Math.min(node.depth, 32),
        depthTruncated: node.depth > 32,
        durationNs: node.spanData.dur,
        startOffsetNs: node.spanData.start,
        outcome: traceSpanOutcome(node.spanData),
        incompleteParent:
          node.spanData.parentSpanID !== null && !present.has(node.spanData.parentSpanID),
        parentOutsidePage:
          node.spanData.parentSpanID !== null &&
          present.has(node.spanData.parentSpanID) &&
          !visible.has(node.spanData.parentSpanID),
        cycle:
          node.salvaged === true || node.cyclePoint === true || traceParentCycle(node, trace.spans),
        links: node.spanData.links.slice(0, 16),
        linksTruncated: node.spanData.links.length > 16 || node.spanData.droppedLinksCount > 0,
        droppedEventsCount: node.spanData.droppedEventsCount,
        droppedLinksCount: node.spanData.droppedLinksCount,
        eventsTruncated: node.spanData.events.length > 16 || node.spanData.droppedEventsCount > 0,
        events: node.spanData.events.slice(0, 16).map((event) => ({
          name: tokens.has(event.name) ? sanitizeTraceText(event.name) : "sdk.redacted",
          timestamp: event.timestamp,
          droppedAttributesCount: event.droppedAttributesCount,
          attributes: event.attributes
            .filter((a) => approvedSdkTelemetryAttribute(a.key, a.value, tokens))
            .slice(0, 24)
            .map((a) => ({ key: sanitizeTraceText(a.key), value: sanitizeTraceText(a.value) })),
          attributesTruncated:
            event.droppedAttributesCount > 0 ||
            event.attributes.filter((a) => approvedSdkTelemetryAttribute(a.key, a.value, tokens))
              .length > 24,
        })),
        attributes: node.spanData.attributes
          .filter((a) => approvedSdkTelemetryAttribute(a.key, a.value, tokens))
          .slice(0, 24)
          .map((a) => ({ key: sanitizeTraceText(a.key), value: sanitizeTraceText(a.value) })),
        attributesTruncated:
          node.spanData.attributes.filter((a) =>
            approvedSdkTelemetryAttribute(a.key, a.value, tokens),
          ).length > 24,
      })),
    };
  });

/** Run read-only list/show commands with explicit loopback configuration. @param {ReadonlyArray<string>} args */
export const runSdkTraceQueryCli = (args) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          allowPositionals: true,
          options: {
            endpoint: { type: "string" },
            run: { type: "string" },
            failed: { type: "boolean" },
            json: { type: "boolean" },
            limit: { type: "string" },
            offset: { type: "string" },
            "max-response-mb": { type: "string" },
          },
        }),
      catch: () =>
        queryFailure(
          "Arguments",
          "Trace query arguments invalid. Use list [--run ID] [--failed] or show TRACE_ID, with --endpoint URL --limit 1..500 --offset N --max-response-mb 1..8 --json.",
        ),
    });
    const options = {
      endpoint:
        parsed.values.endpoint ?? process.env.HERDR_TRACE_VIEWER_URL ?? "http://127.0.0.1:8000",
      run: parsed.values.run ?? "",
      failed: parsed.values.failed ?? false,
      limit: Number(parsed.values.limit ?? 50),
      offset: Number(parsed.values.offset ?? 0),
      maxResponseMb: Number(parsed.values["max-response-mb"] ?? 2),
    };
    const [command, id] = parsed.positionals;
    if (command === "list" && parsed.positionals.length === 1) {
      const result = yield* listSdkTraces(options);
      yield* Console.log(
        parsed.values.json
          ? JSON.stringify(result, null, 2)
          : [
              ...result.traces.map(
                (trace) =>
                  `${trace.traceID} ${trace.outcome} matchedSpans=${trace.matchedSpanCount} matchedErrors=${trace.matchedErrorCount} ${trace.rootSpan?.name ?? "[incomplete root]"}`,
              ),
              `Showing ${result.traces.length}/${result.total}${result.truncated ? " [truncated; use --offset]" : ""}`,
            ].join("\n"),
      );
    } else if (command === "show" && id && parsed.positionals.length === 2) {
      const result = yield* showSdkTrace(id, options);
      yield* Console.log(
        parsed.values.json
          ? JSON.stringify(result, null, 2)
          : [
              result.traceID,
              ...result.spans.map(
                (span) =>
                  `${"  ".repeat(span.depth)}${span.name} ${span.outcome} ${span.durationNs}ns${span.incompleteParent ? " [incomplete parent]" : ""}${span.parentOutsidePage ? " [parent outside page]" : ""}${span.cycle ? " [cycle]" : ""}${span.depthTruncated ? " [depth truncated]" : ""}${span.links.length ? ` [links: ${span.links.map((link) => `show ${link.traceID} (span ${link.spanID})`).join(", ")}]` : ""}${span.linksTruncated ? " [links truncated]" : ""}${span.attributes.length ? ` ${span.attributes.map((a) => `${a.key}=${a.value}`).join(" ")}` : ""}${span.attributesTruncated ? " [attributes truncated]" : ""}${span.eventsTruncated ? " [events truncated]" : ""}${span.droppedEventsCount || span.droppedLinksCount ? ` [native dropped events=${span.droppedEventsCount} links=${span.droppedLinksCount}]` : ""}${span.events.map((event) => `\n${"  ".repeat(span.depth + 1)}event ${event.name} @${event.timestamp}ns ${event.attributes.map((a) => `${a.key}=${a.value}`).join(" ")}${event.attributesTruncated ? " [event attributes truncated]" : ""}`).join("")}`,
              ),
              `Showing ${result.spans.length}/${result.total}; unplaced=${result.unplacedSpanCount}${result.partial ? " [partial telemetry]" : ""}${result.truncated ? " [truncated; use --offset]" : ""}`,
            ].join("\n"),
      );
    } else
      return yield* Effect.fail(
        queryFailure(
          "Arguments",
          "Trace query requires list or show TRACE_ID. Use --json for bounded structured output.",
        ),
      );
  }).pipe(
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        queryFailure(
          "Arguments",
          "Trace query input invalid. Use a loopback HTTP URL, lowercase 32-hex trace ID, limit 1..500, offset 0..10000, max-response-mb 1..8 and a safe run ID.",
        ),
      ),
    ),
  );

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(
    runSdkTraceQueryCli(process.argv.slice(2)).pipe(
      Effect.catchTag("SdkTraceQueryError", (error) =>
        Effect.gen(function* () {
          yield* Console.error(error.message);
          process.exitCode = 1;
        }),
      ),
    ),
  );
}
