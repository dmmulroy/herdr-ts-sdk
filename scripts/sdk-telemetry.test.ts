import { inspect } from "node:util";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Logger, References, Tracer } from "effect";
import { expect, it } from "vite-plus/test";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { traceSdkExecution, sdkTraceChildEnvironment } from "./sdk-telemetry.mjs";
import { approvedSdkTelemetryAttribute } from "./sdk-telemetry-execution.mjs";
import {
  acquireSdkTelemetryTestServer,
  sdkTelemetryRecordedSpans,
} from "./sdk-telemetry-test-server.ts";

it("exports only approved metadata after product finalizers, preserving failure identity", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const secret = "SECRET_SENTINEL_/personal/private?token=xyz";
      const error = new Error(secret, { cause: new Error(secret) });
      let finalized = false;
      const result = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: secret, file: secret },
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              finalized = true;
            }),
          );
          yield* Effect.logError(secret, error).pipe(
            Effect.annotateLogs({ "sdk.outcome": secret, "herdr.reason": secret }),
          );
          yield* Effect.annotateCurrentSpan({
            "herdr.method": secret,
            "herdr.deadline_ms": Infinity,
            "sdk.outcome": secret,
          });
          return yield* Effect.fail(error);
        }).pipe(
          Effect.withSpan(secret, {
            links: [
              {
                span: Tracer.externalSpan({ traceId: "a".repeat(32), spanId: "b".repeat(16) }),
                attributes: { "herdr.reason": secret },
              },
            ],
          }),
        ),
      );
      expect(finalized).toBe(true);
      expect(Exit.isFailure(result.tracedExit) && Cause.squash(result.tracedExit.cause)).toBe(
        error,
      );
      expect(result.telemetry.status).toBe("exported");
      expect(server.requests.length).toBe(2);
      expect(JSON.stringify(server.requests)).not.toContain(secret);
      const spans = sdkTelemetryRecordedSpans(server.requests);
      expect(spans.find((span) => span.name === "sdk.execution")?.attributes).toContainEqual({
        key: "sdk.outcome",
        value: { stringValue: "failure" },
      });
      expect(spans.find((span) => span.name === "sdk.redacted")?.status.code).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(Logger.layer([]))),
  ));

it("propagates external parent and scoped child environment without process mutation", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const parent = { traceId: "1".repeat(32), spanId: "2".repeat(16) };
      const before = process.env.TRACEPARENT;
      const result = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: "parent", parent },
        sdkTraceChildEnvironment,
      );
      const environment = yield* result.tracedExit;
      expect(result.traceId).toBe(parent.traceId);
      expect(environment.TRACEPARENT).toMatch(new RegExp(`^00-${parent.traceId}-[a-f0-9]{16}-01$`));
      expect(environment.HERDR_TRACE_RUN_ID).toBe(result.runId);
      expect(process.env.TRACEPARENT).toBe(before);
      expect(sdkTelemetryRecordedSpans(server.requests)[0]?.parentSpanId).toBe(parent.spanId);
    }).pipe(Effect.scoped),
  ));

it("preserves an unsampled external parent without claiming exporter loss or acceptance", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const parent = { traceId: "3".repeat(32), spanId: "4".repeat(16), sampled: false };
      const result = yield* traceSdkExecution(
        {
          enabled: true,
          endpoint: server.endpoint,
          kind: "test",
          name: "unsampled parent",
          parent,
        },
        sdkTraceChildEnvironment.pipe(Effect.withSpan("unsampled child")),
      );
      const environment = yield* result.tracedExit;
      expect(result.traceId).toBe(parent.traceId);
      expect(environment.TRACEPARENT).toMatch(new RegExp(`^00-${parent.traceId}-[a-f0-9]{16}-00$`));
      expect(result.telemetry).toEqual({ status: "unavailable", exported: 0, dropped: 0 });
      expect(server.requests).toEqual([]);
    }).pipe(Effect.scoped),
  ));

it("reports budget loss and HTTP partial rejection without changing product value", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer({
        responseBody: '{"partialSuccess":{"rejectedSpans":"1"}}',
      });
      const result = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: "budget", maxSpans: 2 },
        Effect.forEach([1, 2, 3], (value) =>
          Effect.succeed(value).pipe(Effect.withSpan("arbitrary")),
        ),
      );
      expect(yield* result.tracedExit).toEqual([1, 2, 3]);
      expect(result.telemetry.status).toBe("partial");
      expect(result.telemetry.dropped).toBeGreaterThanOrEqual(3);
      expect(sdkTelemetryRecordedSpans(server.requests)).toHaveLength(2);
    }).pipe(Effect.scoped),
  ));

it("bounds unavailable HTTP shutdown and refuses remote endpoints", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer({ respond: false });
      const result = yield* traceSdkExecution(
        {
          enabled: true,
          endpoint: server.endpoint,
          kind: "test",
          name: "hung",
          flushTimeoutMs: 25,
        },
        Effect.succeed(7),
      );
      expect(yield* result.tracedExit).toBe(7);
      expect(result.telemetry.status).toBe("unavailable");
      const refused = yield* traceSdkExecution(
        { enabled: true, endpoint: "https://example.com/v1/traces", kind: "test", name: "remote" },
        Effect.succeed(8),
      );
      expect(yield* refused.tracedExit).toBe(8);
      expect(refused.telemetry.status).toBe("unavailable");
    }).pipe(Effect.scoped),
  ));

it("invalid budgets and disabled execution never contact OTLP or rerun product work", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      let runs = 0;
      for (const maxSpans of [NaN, Infinity, -1, 0, 1.5, 5000]) {
        const result = yield* traceSdkExecution(
          {
            enabled: true,
            endpoint: server.endpoint,
            kind: "test",
            name: "invalid budget",
            maxSpans,
          },
          Effect.sync(() => ++runs),
        );
        expect(yield* result.tracedExit).toBe(runs);
        expect(result.telemetry.status).toBe("unavailable");
      }
      const disabled = yield* traceSdkExecution(
        { enabled: false, endpoint: server.endpoint, kind: "test", name: "disabled" },
        Effect.sync(() => ++runs),
      );
      expect(yield* disabled.tracedExit).toBe(7);
      expect(disabled.telemetry.status).toBe("disabled");
      expect(server.requests).toEqual([]);
    }).pipe(Effect.scoped),
  ));

it("bounds metadata and keeps nested run identity with truthful partial outcome", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const result = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: "events" },
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          for (let index = 0; index < 30; index++) span.event("unapproved event", BigInt(index));
          yield* Effect.void.pipe(Effect.withSpan("nested unknown"));
        }).pipe(Effect.withSpan("outer unknown")),
      );
      yield* result.tracedExit;
      expect(result.telemetry.status).toBe("partial");
      const spans = sdkTelemetryRecordedSpans(server.requests);
      expect(
        spans.every((span) =>
          span.attributes.some(
            (attribute) =>
              attribute.key === "sdk.run_id" && attribute.value.stringValue === result.runId,
          ),
        ),
      ).toBe(true);
      expect(spans.flatMap((span) => span.events)).toHaveLength(16);
      expect(spans.find((span) => span.name === "sdk.execution")?.attributes).toContainEqual({
        key: "sdk.telemetry.metadata_dropped",
        value: { intValue: 14 },
      });
    }).pipe(Effect.scoped),
  ));

it("preserves caller loggers when safe correlated export is enabled", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      let observed = 0;
      const result = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: "logs" },
        Effect.logInfo("private local body"),
      ).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make(() => {
              observed++;
            }),
          ]),
        ),
      );
      yield* result.tracedExit;
      expect(observed).toBe(1);
      expect(server.requests.find((request) => request.path === "/v1/logs")?.body).not.toContain(
        "private local body",
      );
      expect(result.telemetry.exported).toBe(2);
    }).pipe(Effect.scoped),
  ));

it("bounds acknowledgement bytes and never follows collector redirects", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const destination = yield* acquireSdkTelemetryTestServer();
      const redirect = yield* acquireSdkTelemetryTestServer({
        status: 307,
        redirect: destination.endpoint,
      });
      const oversized = yield* acquireSdkTelemetryTestServer({
        responseBody: JSON.stringify({ padding: "x".repeat(20000) }),
      });
      for (const endpoint of [redirect.endpoint, oversized.endpoint]) {
        const result = yield* traceSdkExecution(
          { enabled: true, endpoint, kind: "test", name: "collector safety", flushTimeoutMs: 30 },
          Effect.succeed(19),
        );
        expect(yield* result.tracedExit).toBe(19);
        expect(result.telemetry.status).toBe("unavailable");
        expect(result.telemetry.dropped).toBeGreaterThan(0);
      }
      expect(destination.requests).toEqual([]);
    }).pipe(Effect.scoped),
  ));

it("prioritizes root outcome and drop diagnostics over optional approved metadata", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const result = yield* traceSdkExecution(
        {
          enabled: true,
          endpoint: server.endpoint,
          kind: "test",
          name: "metadata saturation",
          maxSpans: 1,
        },
        Effect.gen(function* () {
          const root = yield* Effect.currentSpan;
          const values = {
            "sdk.attempt": 1,
            "sdk.execution_index": 2,
            "sdk.exit_code": 1,
            "herdr.deadline_ms": 1,
            "herdr.bytes_written": 2,
            "herdr.bytes_read": 3,
            "herdr.events.count": 4,
            "herdr.bytes.count": 5,
            "herdr.method": "session.info",
            "herdr.operation": "request",
            "herdr.result_type": "session_info",
            "herdr.error_tag": "HerdrTransportError",
            "herdr.reason": "timeout",
            "sdk.stage.name": "runtime",
            "sdk.stage.status": "failure",
            "sdk.command.name": "runtime",
            "herdr.connection_id": "a".repeat(32),
            "herdr.outcome": "success",
            "status.interrupted": true,
          };
          for (const [key, value] of Object.entries(values)) root.attribute(key, value);
          // Includes SDK-owned initial fields; annotations after saturation must still survive export.
          for (let index = 0; index < 20; index++) root.event("overflow", BigInt(index));
          yield* Effect.void.pipe(Effect.withSpan("dropped"));
        }),
      );
      yield* result.tracedExit;
      const root = sdkTelemetryRecordedSpans(server.requests)[0];
      expect(root?.attributes).toContainEqual({
        key: "sdk.outcome",
        value: { stringValue: "success" },
      });
      expect(root?.attributes).toContainEqual({
        key: "sdk.telemetry.dropped",
        value: { intValue: 1 },
      });
      expect(root?.attributes).toContainEqual({
        key: "sdk.telemetry.metadata_dropped",
        value: { intValue: 4 },
      });
      expect(root?.attributes.length).toBeLessThanOrEqual(24);
      expect(result.telemetry.status).toBe("partial");
    }).pipe(Effect.scoped),
  ));

it("never evaluates metadata getters or inspection hooks before native trace and log conversion", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      let inspected = 0;
      const privateArray = Array.from({ length: 10000 }, () => 1);
      Object.defineProperty(privateArray, 9999, {
        get() {
          inspected++;
          throw new Error("private array inspected");
        },
      });
      let callerObserved = false;
      const callerLogger = Logger.make(({ fiber }) => {
        expect(fiber.getRef(References.CurrentLogAnnotations).private).toBe(privateArray);
        callerObserved = true;
      });
      const privateObject = {
        [inspect.custom]() {
          inspected++;
          throw new Error("private object inspected");
        },
      };
      const eventMetadata = {
        get private() {
          inspected++;
          throw new Error("private getter evaluated");
        },
        get "herdr.reason"() {
          inspected++;
          throw new Error("approved accessor evaluated");
        },
      };
      const result = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: "metadata quarantine" },
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          span.event("private event", 0n, eventMetadata);
          span.addLinks([
            {
              span: Tracer.externalSpan({ traceId: "1".repeat(32), spanId: "2".repeat(16) }),
              attributes: eventMetadata,
            },
          ]);
          yield* Effect.gen(function* () {
            const before = yield* References.CurrentLogAnnotations;
            yield* Effect.logInfo("private body");
            const after = yield* References.CurrentLogAnnotations;
            expect(after).toBe(before);
          }).pipe(
            Effect.withLogger(callerLogger),
            Effect.annotateLogs({
              private: privateArray,
              "herdr.reason": privateObject,
              "sdk.outcome": "success",
            }),
          );
          return 42;
        }),
      ).pipe(Effect.provide(Logger.layer([])));
      expect(yield* result.tracedExit).toBe(42);
      expect(inspected).toBe(0);
      expect(callerObserved).toBe(true);
      expect(result.telemetry.status).toBe("exported");
      const logs = server.requests.find((request) => request.path === "/v1/logs")?.body;
      expect(logs).toContain(result.traceId);
      expect(logs).toContain("sdk.outcome");
      expect(logs).not.toContain("private");
    }).pipe(Effect.scoped),
  ));

it("quarantines metadata proxy defects without swallowing product failures", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const metadata = new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error("private proxy defect");
          },
        },
      );
      const failure = new Error("original product failure");
      for (const fail of [false, true]) {
        let finished = false;
        const result = yield* traceSdkExecution(
          { enabled: true, endpoint: server.endpoint, kind: "test", name: "proxy quarantine" },
          Effect.gen(function* () {
            const span = yield* Effect.currentSpan;
            span.event("private", 0n, metadata);
            finished = true;
            return yield* fail ? Effect.fail(failure) : Effect.succeed(42);
          }),
        );
        expect(finished).toBe(true);
        expect(result.telemetry.status).toBe("partial");
        if (fail)
          expect(Exit.isFailure(result.tracedExit) && Cause.squash(result.tracedExit.cause)).toBe(
            failure,
          );
        else expect(yield* result.tracedExit).toBe(42);
      }
    }).pipe(Effect.scoped),
  ));

it("restores caller fiber annotations after a native logger clock defect", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const clock = yield* Clock.Clock;
      let failNativeLog = false;
      let callerObserved = false;
      const privateValue = { private: "preserved" };
      const failingClock: Clock.Clock = {
        currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
        currentTimeMillis: clock.currentTimeMillis,
        currentTimeNanosUnsafe: () => {
          if (failNativeLog) {
            failNativeLog = false;
            throw new Error("native logger clock defect");
          }
          return clock.currentTimeNanosUnsafe();
        },
        currentTimeNanos: clock.currentTimeNanos,
        monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: clock.monotonicTimeNanos,
        sleep: (duration) => clock.sleep(duration),
      };
      const caller = Logger.make(({ fiber }) => {
        expect(fiber.getRef(References.CurrentLogAnnotations).private).toBe(privateValue);
        callerObserved = true;
      });
      const result = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: "native logger defect" },
        Effect.gen(function* () {
          const before = yield* References.CurrentLogAnnotations;
          failNativeLog = true;
          yield* Effect.logInfo("safe callback probe");
          expect(yield* References.CurrentLogAnnotations).toBe(before);
          return 42;
        }).pipe(Effect.withLogger(caller), Effect.annotateLogs({ private: privateValue })),
      ).pipe(Effect.provideService(Clock.Clock, failingClock), Effect.provide(Logger.layer([])));
      expect(yield* result.tracedExit).toBe(42);
      expect(callerObserved).toBe(true);
      expect(result.telemetry).toEqual({ status: "partial", exported: 1, dropped: 1 });
    }).pipe(Effect.scoped),
  ));

it("allows only bounded parsed stress reproduction metadata", () => {
  const tokens = new Set<string>();
  for (const seed of ["-2147483648", "0", "2147483647"])
    expect(approvedSdkTelemetryAttribute("sdk.stress.seed", seed, tokens)).toBe(true);
  for (const seed of ["-2147483649", "2147483648", "1.5", "NaN", "1e3", "private"])
    expect(approvedSdkTelemetryAttribute("sdk.stress.seed", seed, tokens)).toBe(false);
  for (const repetitions of ["1", "1000"])
    expect(approvedSdkTelemetryAttribute("sdk.stress.repetitions", repetitions, tokens)).toBe(true);
  for (const repetitions of ["0", "-1", "1001", "1.5", "Infinity"])
    expect(approvedSdkTelemetryAttribute("sdk.stress.repetitions", repetitions, tokens)).toBe(
      false,
    );
});

it("flushes the interrupted root only after product resource release", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const server = yield* acquireSdkTelemetryTestServer();
      const ready = yield* Deferred.make<void>();
      let finalized = false;
      const fiber = yield* traceSdkExecution(
        { enabled: true, endpoint: server.endpoint, kind: "test", name: "interrupt" },
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              finalized = true;
            }),
          );
          yield* Deferred.succeed(ready, undefined);
          yield* Effect.never;
        }),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(ready);
      yield* Fiber.interrupt(fiber);
      expect(finalized).toBe(true);
      const root = sdkTelemetryRecordedSpans(server.requests).find(
        (span) => span.name === "sdk.execution",
      );
      expect(root?.attributes).toContainEqual({
        key: "sdk.outcome",
        value: { stringValue: "interrupted" },
      });
    }).pipe(Effect.scoped),
  ));
