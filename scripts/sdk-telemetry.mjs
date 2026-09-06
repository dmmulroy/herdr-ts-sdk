import { fileURLToPath } from "node:url";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { randomUUID } from "node:crypto";
import {
  Cause,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Option,
  References,
  Schema,
  Stream,
  Tracer,
} from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import {
  OtlpExporter,
  OtlpLogger,
  OtlpSerialization,
  OtlpTracer,
} from "effect/unstable/observability";
import {
  approvedSdkTelemetryAttribute,
  sdkTelemetryAttributeKeys,
} from "./sdk-telemetry-execution.mjs";
import { sdkTelemetryIdentity, sdkTelemetrySerialization } from "./sdk-telemetry-serialization.mjs";

/** @typedef {{kind:"test"|"verification"|"lab"|"application",name:string,file?:string|undefined,runId?:string|undefined,attempt?:number|undefined,endpoint?:string|undefined,enabled?:boolean|undefined,parent?:{traceId:string,spanId:string,sampled?:boolean},maxSpans?:number,maxLogs?:number,flushTimeoutMs?:number}} SdkTelemetryInput */
/** @typedef {{status:"disabled"|"exported"|"partial"|"unavailable",exported:number,dropped:number}} SdkTelemetryOutcome */
/** @typedef {{enabled:boolean,endpoint:string,viewer:string,runId:string}} SdkTraceConfig */
/** Fiber-local child process configuration; never mutates process.env. */
const sdkTraceConfig = Context.Reference("herdr-sdk/development-trace-config", {
  defaultValue: /** @returns {SdkTraceConfig} */ () => ({
    enabled: false,
    endpoint: "",
    viewer: "",
    runId: "",
  }),
});

/** Child environment carries the currently active parent, not an ended execution span. @type {Effect.Effect<NodeJS.ProcessEnv>} */
export const sdkTraceChildEnvironment = Effect.gen(function* () {
  const config = yield* sdkTraceConfig;
  if (!config.enabled) return {};
  const span = yield* Effect.currentSpan.pipe(Effect.option);
  return {
    HERDR_TRACE: "1",
    HERDR_TRACE_ENDPOINT: config.endpoint,
    HERDR_TRACE_VIEWER_URL: config.viewer,
    HERDR_TRACE_RUN_ID: config.runId,
    TRACEPARENT: Option.isSome(span)
      ? `00-${span.value.traceId}-${span.value.spanId}-${span.value.sampled ? "01" : "00"}`
      : undefined,
  };
});

const decodeSdkTelemetryScalar = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
);
/** Inspect only known own data properties; accessors and arbitrary object inspection never run.
 * @param {Parameters<Tracer.Span["event"]>[2]} metadata
 * @param {Set<string>} tokens
 */
const sdkTelemetryScalarMetadata = (metadata, tokens) => {
  /** @type {Array<readonly [string,string|number|boolean]>} */ const entries = [];
  if (metadata === undefined) return Object.fromEntries(entries);
  for (const key of sdkTelemetryAttributeKeys) {
    if (entries.length === 24) break;
    const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) continue;
    const value = decodeSdkTelemetryScalar(descriptor.value);
    if (Option.isSome(value) && approvedSdkTelemetryAttribute(key, String(value.value), tokens))
      entries.push([key, value.value]);
  }
  return Object.fromEntries(entries);
};

const sdkTelemetryBudgets = Schema.Struct({
  maxSpans: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 4096 })),
  maxLogs: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 1024 })),
  flushTimeoutMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 3000 }),
  ),
});
const parseSdkTelemetryBudgets = Schema.decodeEffect(sdkTelemetryBudgets);

const partialResponse = Schema.Struct({
  partialSuccess: Schema.optional(
    Schema.Struct({
      rejectedSpans: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
      rejectedLogRecords: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
    }),
  ),
});
const decodePartialResponse = Schema.decodeEffect(Schema.fromJsonString(partialResponse));
/** Bound collector acknowledgement bytes before JSON parsing; Fetch's text getter ignores MaxBodySize.
 * @param {import("effect/unstable/http/HttpClientResponse").HttpClientResponse} response
 */
const sdkTelemetryAcknowledgement = (response) =>
  Effect.gen(function* () {
    const body = yield* response.stream.pipe(
      Stream.runFoldEffect(
        () => Buffer.alloc(0),
        (previous, chunk) =>
          previous.byteLength + chunk.byteLength > 16384
            ? Effect.fail("SDK telemetry acknowledgement exceeds byte limit")
            : Effect.succeed(Buffer.concat([previous, chunk])),
      ),
    );
    return yield* decodePartialResponse(body.toString("utf8"));
  });

/** Read trusted source literals at execution time; no copied operation inventory and no import-time filesystem effects. */
export const sdkTelemetrySourceTokens = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const tokens = new Set(["sdk.execution", "success", "failure", "interrupted", "timeout"]);
  const directory = new URL("../src/", import.meta.url);
  for (const file of yield* fs.readDirectory(fileURLToPath(directory))) {
    if (!file.endsWith(".ts") || /\.(test|tst)\.ts$/.test(file)) continue;
    const source = yield* fs.readFileString(fileURLToPath(new URL(file, directory)));
    for (const match of source.matchAll(/["'`]([A-Za-z][A-Za-z0-9_.]{0,119})["'`]/g))
      if (match[1]) tokens.add(match[1]);
  }
  const generated = yield* fs.readFileString(
    fileURLToPath(new URL("../src/generated/wire-method-map.ts", import.meta.url)),
  );
  for (const match of generated.matchAll(/"([A-Za-z][A-Za-z0-9_.]{0,119})"/g))
    if (match[1]) tokens.add(match[1]);
  for (const file of [
    "sdk-verification-process.mjs",
    "sdk-verification-runner.mjs",
    "sdk-verify.mjs",
    "sdk-lab.mjs",
  ]) {
    const source = yield* fs.readFileString(fileURLToPath(new URL(file, import.meta.url)));
    for (const match of source.matchAll(/["'`]([A-Za-z][A-Za-z0-9_.]{0,119})["'`]/g))
      if (match[1]) tokens.add(match[1]);
  }
  return tokens;
}).pipe(Effect.provide(NodeFileSystem.layer));

/** Local endpoint parser rejects credentials, query strings, fragments and non-loopback destinations. @param {string} input */
const sdkTelemetryEndpoint = (input) =>
  Effect.try(() => {
    const url = new URL(input);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/v1/traces"
    )
      throw new Error("SDK telemetry endpoint must be loopback OTLP HTTP");
    return url.href;
  });

/** Execute once, close product resources before ending root, then bound exporter shutdown. Restore tracedExit at the caller boundary.
 * Exported means HTTP acknowledgement, not viewer ingestion. Telemetry failures never replace the original product Exit.
 * @template A,E,R
 * @param {SdkTelemetryInput} input
 * @param {Effect.Effect<A,E,R>} effect
 * @returns {Effect.Effect<{tracedExit:Exit.Exit<A,E>,traceId:string|undefined,runId:string,telemetry:SdkTelemetryOutcome},never,Exclude<R,import("effect/Scope").Scope>>}
 */
export const traceSdkExecution = (input, effect) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const rawRunId = input.runId ?? process.env.HERDR_TRACE_RUN_ID ?? randomUUID();
      const runId =
        /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
          rawRunId,
        )
          ? rawRunId
          : sdkTelemetryIdentity(rawRunId);
      const enabled = input.enabled ?? process.env.HERDR_TRACE === "1";
      const endpointExit = yield* sdkTelemetryEndpoint(
        input.endpoint ?? process.env.HERDR_TRACE_ENDPOINT ?? "http://127.0.0.1:4318/v1/traces",
      ).pipe(Effect.exit);
      const tokensExit = enabled
        ? yield* sdkTelemetrySourceTokens.pipe(Effect.exit)
        : Exit.succeed(new Set());
      const budgets = yield* parseSdkTelemetryBudgets({
        maxSpans: input.maxSpans ?? 1024,
        maxLogs: input.maxLogs ?? 128,
        flushTimeoutMs: input.flushTimeoutMs ?? 1000,
      }).pipe(Effect.exit);
      if (
        !enabled ||
        Exit.isFailure(endpointExit) ||
        Exit.isFailure(tokensExit) ||
        Exit.isFailure(budgets)
      ) {
        const tracedExit = yield* restore(
          Effect.scoped(effect).pipe(
            Effect.provideService(sdkTraceConfig, {
              enabled: false,
              endpoint: "",
              viewer: "",
              runId: "",
            }),
          ),
        ).pipe(Effect.exit);
        return {
          tracedExit,
          traceId: undefined,
          runId,
          telemetry: { status: !enabled ? "disabled" : "unavailable", exported: 0, dropped: 0 },
        };
      }
      const endpoint = endpointExit.value;
      const tokens = tokensExit.value;
      const counters = {
        exported: 0,
        dropped: 0,
        attempted: 0,
        failed: false,
        traceItems: 0,
        logItems: 0,
      };
      const { maxSpans, maxLogs, flushTimeoutMs: timeout } = budgets.value;
      let spans = 0,
        logs = 0,
        metadataDropped = 0;
      /** @type {string|undefined} */ let traceId;
      const httpLayer = Layer.effect(
        HttpClient.HttpClient,
        Effect.gen(function* () {
          const client = yield* HttpClient.HttpClient;
          return client.pipe(
            HttpClient.transformResponse((response) =>
              Effect.gen(function* () {
                const value = yield* response;
                if (value.status < 200 || value.status >= 300) {
                  counters.failed = true;
                  return value;
                }
                const partial = yield* sdkTelemetryAcknowledgement(value).pipe(Effect.exit);
                if (Exit.isFailure(partial)) {
                  counters.failed = true;
                  return value;
                }
                const rejected = Number(
                  partial.value.partialSuccess?.rejectedSpans ??
                    partial.value.partialSuccess?.rejectedLogRecords ??
                    0,
                );
                if (!Number.isSafeInteger(rejected) || rejected < 0) {
                  counters.failed = true;
                  return value;
                }
                const items = value.request.url.endsWith("/traces")
                  ? counters.traceItems
                  : counters.logItems;
                if (rejected > items) {
                  counters.failed = true;
                  return value;
                }
                // Counts accepted records, not HTTP batches or confirmed viewer ingestion.
                counters.exported += items - rejected;
                return value;
              }).pipe(
                Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    if (Exit.isFailure(exit)) counters.failed = true;
                  }),
                ),
              ),
            ),
          );
        }),
      ).pipe(Layer.provide(FetchHttpClient.layer));
      const dependencies = Layer.mergeAll(
        httpLayer,
        Layer.succeed(
          OtlpSerialization.OtlpSerialization,
          sdkTelemetrySerialization(tokens, counters),
        ),
        OtlpExporter.layerFlusher,
      );
      const config = {
        enabled: true,
        endpoint,
        viewer: process.env.HERDR_TRACE_VIEWER_URL ?? "",
        runId,
      };
      /** @type {Exit.Exit<A,E>|undefined} */ let productExit;
      const telemetryExit = yield* Effect.scoped(
        Effect.gen(function* () {
          const native = yield* OtlpTracer.make({
            url: endpoint,
            resource: { serviceName: "herdr-sdk-development" },
            exportInterval: "1 day",
            maxBatchSize: 8192,
            shutdownTimeout: timeout,
          });
          const logger = yield* OtlpLogger.make({
            url: endpoint.replace(/\/traces$/, "/logs"),
            resource: { serviceName: "herdr-sdk-development" },
            exportInterval: "1 day",
            maxBatchSize: 8192,
            shutdownTimeout: timeout,
            excludeLogSpans: true,
          });
          const isScalar = Schema.is(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]));
          /** Quarantine only synchronous telemetry callbacks, never product effects. @param {()=>void} callback */
          const telemetryCallback = (callback) => {
            const exit = Effect.runSync(Effect.exit(Effect.sync(callback)));
            if (Exit.isFailure(exit)) {
              counters.failed = true;
              metadataDropped++;
            }
          };
          const boundedTracer = Tracer.make({
            span: (options) => {
              const sampled = options.sampled && spans++ < maxSpans;
              if (options.sampled && !sampled) counters.dropped++;
              const span = native.span({
                ...options,
                name: tokens.has(options.name) ? options.name : "sdk.redacted",
                sampled,
                links: [],
              });
              let events = 0,
                links = 0;
              /** @type {Tracer.Span} */
              const bounded = {
                ...span,
                _tag: "Span",
                get status() {
                  return span.status;
                },
                attribute(key, value) {
                  telemetryCallback(() => {
                    if (
                      (span.attributes.size < 24 ||
                        span.attributes.has(key) ||
                        key.startsWith("sdk.telemetry.") ||
                        key === "sdk.outcome") &&
                      isScalar(value) &&
                      approvedSdkTelemetryAttribute(key, String(value), tokens)
                    )
                      span.attribute(key, value);
                  });
                },
                event(name, time, values) {
                  telemetryCallback(() => {
                    if (events++ >= 16) {
                      metadataDropped++;
                      return;
                    }
                    const safe = sdkTelemetryScalarMetadata(values, tokens);
                    span.event(tokens.has(name) ? name : "sdk.redacted", time, safe);
                  });
                },
                addLinks(values) {
                  telemetryCallback(() => {
                    const remaining = 16 - links;
                    metadataDropped += Math.max(0, values.length - remaining);
                    const safe = values
                      .slice(0, remaining)
                      .filter(
                        (link) =>
                          /^[a-f0-9]{32}$/.test(link.span.traceId) &&
                          /^[a-f0-9]{16}$/.test(link.span.spanId),
                      )
                      .map((link) => ({
                        span: link.span,
                        attributes: sdkTelemetryScalarMetadata(link.attributes, tokens),
                      }));
                    links += safe.length;
                    span.addLinks(safe);
                  });
                },
                end(time, exit) {
                  telemetryCallback(() => {
                    // Do not ask native Cause rendering to inspect arbitrary product error objects.
                    span.end(
                      time,
                      Exit.isSuccess(exit)
                        ? Exit.void
                        : Cause.hasInterruptsOnly(exit.cause)
                          ? exit
                          : Exit.fail("sdk.failure"),
                    );
                  });
                },
              };
              bounded.addLinks(options.links);
              return bounded;
            },
          });
          const boundedLogger = Logger.make((options) => {
            if (logs++ >= maxLogs) {
              counters.dropped++;
              return;
            }
            // Logger invocation is a synchronous runtime callback edge; quarantine native formatting defects here.
            const logged = Effect.runSync(
              Effect.exit(
                Effect.acquireUseRelease(
                  Effect.sync(() => {
                    const annotations = sdkTelemetryScalarMetadata(
                      options.fiber.getRef(References.CurrentLogAnnotations),
                      tokens,
                    );
                    const context = options.fiber.context;
                    options.fiber.setContext(
                      Context.add(context, References.CurrentLogAnnotations, annotations),
                    );
                    return context;
                  }),
                  () =>
                    Effect.sync(() =>
                      logger.log({ ...options, message: "sdk.log.redacted", cause: Cause.empty }),
                    ),
                  (context) => Effect.sync(() => options.fiber.setContext(context)),
                ),
              ),
            );
            if (Exit.isFailure(logged)) {
              counters.failed = true;
              counters.dropped++;
            }
          });
          const traceparent = /^00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])$/.exec(
            process.env.TRACEPARENT ?? "",
          );
          const parent =
            input.parent ??
            (traceparent?.[1] && traceparent?.[2]
              ? {
                  traceId: traceparent[1],
                  spanId: traceparent[2],
                  sampled: traceparent[3] === "01",
                }
              : undefined);
          const validParent =
            parent &&
            /^[a-f0-9]{32}$/.test(parent.traceId) &&
            !/^0+$/.test(parent.traceId) &&
            /^[a-f0-9]{16}$/.test(parent.spanId) &&
            !/^0+$/.test(parent.spanId)
              ? Tracer.externalSpan(parent)
              : undefined;
          const root = yield* Effect.makeSpan("sdk.execution", {
            attributes: {
              "sdk.run_id": runId,
              "sdk.test_id": sdkTelemetryIdentity(`${input.file ?? ""}\n${input.name}`),
              "sdk.execution.kind": input.kind,
              "sdk.attempt": input.attempt ?? 0,
            },
            parent: validParent,
          }).pipe(Effect.withTracer(boundedTracer));
          traceId = root.traceId;
          const exit = yield* restore(
            Effect.scoped(effect).pipe(
              Effect.withParentSpan(root),
              Effect.annotateSpans({ "sdk.run_id": runId }),
              Effect.withTracer(boundedTracer),
              Effect.withLogger(boundedLogger),
              Effect.provideService(sdkTraceConfig, config),
            ),
          ).pipe(Effect.exit);
          productExit = exit;
          root.attribute("sdk.telemetry.dropped", counters.dropped);
          root.attribute("sdk.telemetry.metadata_dropped", metadataDropped);
          root.attribute(
            "sdk.outcome",
            Exit.isSuccess(exit)
              ? root.attributes.get("sdk.outcome") === "failure"
                ? "failure"
                : "success"
              : Cause.hasInterruptsOnly(exit.cause)
                ? "interrupted"
                : "failure",
          );
          root.end(
            yield* Effect.clockWith((clock) => Effect.succeed(clock.currentTimeNanosUnsafe())),
            exit,
          );
          return exit;
        }),
      ).pipe(Effect.provide(dependencies), Effect.exit);
      const tracedExit =
        productExit ??
        (yield* restore(
          Effect.scoped(effect).pipe(
            Effect.provideService(sdkTraceConfig, {
              enabled: false,
              endpoint: "",
              viewer: "",
              runId: "",
            }),
          ),
        ).pipe(Effect.exit));
      if (Exit.isFailure(telemetryExit)) counters.failed = true;
      const dropped = counters.dropped + Math.max(0, counters.attempted - counters.exported);
      /** @type {SdkTelemetryOutcome["status"]} */
      const status =
        counters.exported === 0
          ? "unavailable"
          : counters.failed || dropped > 0 || metadataDropped > 0
            ? "partial"
            : "exported";
      return {
        tracedExit,
        traceId,
        runId,
        telemetry: { status, exported: counters.exported, dropped },
      };
    }),
  );
