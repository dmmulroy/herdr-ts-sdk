import { createHash } from "node:crypto";
import { Schema } from "effect";
import { HttpBody } from "effect/unstable/http";
import { approvedSdkTelemetryAttribute } from "./sdk-telemetry-execution.mjs";

/** Stable hashed identity for runtime names and file paths; raw text is not exported (not anonymization). @param {string} value */
export const sdkTelemetryIdentity = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);

/** @typedef {import("effect/unstable/observability/OtlpResource").KeyValue} KeyValue */
/** @typedef {{exported:number,dropped:number,attempted:number,failed:boolean,traceItems:number,logItems:number}} SdkTelemetryCounters */
const isSdkTelemetryString = Schema.is(Schema.String);
const sdkMandatoryAttributes = new Set([
  "sdk.run_id",
  "sdk.test_id",
  "sdk.execution.kind",
  "sdk.outcome",
  "sdk.telemetry.dropped",
  "sdk.telemetry.metadata_dropped",
]);

/** Only approved keys AND constrained values survive, including automatically generated exception metadata.
 * @param {Array<KeyValue>} attributes @param {Set<string>} tokens @returns {Array<KeyValue>}
 */
const sanitizeSdkAttributes = (attributes, tokens) =>
  attributes
    .filter(({ key, value }) => {
      const text = value.stringValue ?? value.intValue ?? value.boolValue;
      return (
        text !== undefined &&
        text !== null &&
        approvedSdkTelemetryAttribute(key, String(text), tokens)
      );
    })
    .sort(
      (left, right) =>
        Number(sdkMandatoryAttributes.has(right.key)) -
        Number(sdkMandatoryAttributes.has(left.key)),
    )
    .slice(0, 24);

/** Full outgoing OTLP reconstruction: no arbitrary bodies, resource fields, scope fields, causes or names cross HTTP.
 * @param {Set<string>} tokens Trusted literals read from this checkout's implementation, not runtime input.
 * @param {SdkTelemetryCounters} counters
 * @returns {import("effect/unstable/observability/OtlpSerialization").OtlpSerialization["Service"]}
 */
export const sdkTelemetrySerialization = (tokens, counters) => ({
  traces: (data) => {
    const spans = data.resourceSpans.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans),
    );
    counters.attempted += spans.length;
    counters.traceItems = spans.length;
    return HttpBody.jsonUnsafe({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "herdr-sdk-development" } }],
          },
          scopeSpans: [
            {
              scope: { name: "herdr-sdk-development" },
              spans: spans.map((span) => ({
                traceId: /^[a-f0-9]{32}$/.test(span.traceId) ? span.traceId : "0".repeat(32),
                spanId: /^[a-f0-9]{16}$/.test(span.spanId) ? span.spanId : "0".repeat(16),
                parentSpanId:
                  span.parentSpanId && /^[a-f0-9]{16}$/.test(span.parentSpanId)
                    ? span.parentSpanId
                    : undefined,
                name: tokens.has(span.name) ? span.name : "sdk.redacted",
                kind: span.kind,
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano,
                attributes: sanitizeSdkAttributes(span.attributes, tokens),
                status: { code: span.status.code },
                events: span.events.slice(0, 16).map((event) => ({
                  name: tokens.has(event.name) ? event.name : "sdk.redacted",
                  timeUnixNano: event.timeUnixNano,
                  attributes: sanitizeSdkAttributes(event.attributes, tokens),
                })),
                links: span.links
                  .slice(0, 16)
                  .filter(
                    (link) =>
                      /^[a-f0-9]{32}$/.test(link.traceId) && /^[a-f0-9]{16}$/.test(link.spanId),
                  )
                  .map((link) => ({
                    traceId: link.traceId,
                    spanId: link.spanId,
                    attributes: sanitizeSdkAttributes(link.attributes, tokens),
                  })),
                droppedAttributesCount:
                  span.attributes.length - sanitizeSdkAttributes(span.attributes, tokens).length,
                droppedEventsCount: Math.max(0, span.events.length - 16),
                droppedLinksCount: Math.max(0, span.links.length - 16),
              })),
            },
          ],
        },
      ],
    });
  },
  logs: (data) => {
    const logs = data.resourceLogs.flatMap((resource) =>
      resource.scopeLogs.flatMap((scope) => scope.logRecords ?? []),
    );
    counters.attempted += logs.length;
    counters.logItems = logs.length;
    return HttpBody.jsonUnsafe({
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "herdr-sdk-development" } }],
          },
          scopeLogs: [
            {
              scope: { name: "herdr-sdk-development" },
              logRecords: logs.map((log) => ({
                timeUnixNano: log.timeUnixNano,
                observedTimeUnixNano: log.observedTimeUnixNano,
                severityNumber: log.severityNumber,
                traceId:
                  isSdkTelemetryString(log.traceId) && /^[a-f0-9]{32}$/.test(log.traceId)
                    ? log.traceId
                    : undefined,
                spanId:
                  isSdkTelemetryString(log.spanId) && /^[a-f0-9]{16}$/.test(log.spanId)
                    ? log.spanId
                    : undefined,
                body: { stringValue: "sdk.log.redacted" },
                attributes: sanitizeSdkAttributes(log.attributes, tokens),
                droppedAttributesCount:
                  log.attributes.length - sanitizeSdkAttributes(log.attributes, tokens).length,
              })),
            },
          ],
        },
      ],
    });
  },
  metrics: () => HttpBody.jsonUnsafe({ resourceMetrics: [] }),
});
