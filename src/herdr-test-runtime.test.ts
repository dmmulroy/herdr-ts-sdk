import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import {
  acquireSdkTelemetryTestServer,
  sdkTelemetryRecordedSpans,
} from "../scripts/sdk-telemetry-test-server.ts";
import { sdkTelemetryIdentity } from "../scripts/sdk-telemetry-serialization.mjs";

test("test runtime distinguishes equal leaf names in different suites", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const receiver = yield* acquireSdkTelemetryTestServer();
      const fullNames = ["first suite > same leaf", "second suite > same leaf"];
      yield* Effect.forEach(
        fullNames,
        (fullName) =>
          Effect.promise(() =>
            runHerdrTest(
              { ...context, task: { ...context.task, name: "same leaf", fullName } },
              Effect.void,
              { enabled: true, endpoint: receiver.endpoint },
            ),
          ),
        { concurrency: "unbounded" },
      );
      const identities = sdkTelemetryRecordedSpans(receiver.requests)
        .filter((span) => span.name === "sdk.execution")
        .flatMap((span) => span.attributes.filter((attribute) => attribute.key === "sdk.test_id"))
        .map((attribute) => attribute.value.stringValue);
      expect(identities).toHaveLength(2);
      expect(new Set(identities).size).toBe(2);
      expect(identities).toEqual(
        expect.arrayContaining(
          fullNames.map((fullName) =>
            sdkTelemetryIdentity(`src/herdr-test-runtime.test.ts\n${fullName}`),
          ),
        ),
      );
    }),
    { enabled: false },
  ));

test("test runtime bounds property executions without skipping later cases", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const receiver = yield* acquireSdkTelemetryTestServer();
      let executions = 0;
      yield* Effect.forEach(Array.from({ length: 34 }), () =>
        Effect.promise(() =>
          runHerdrTest(
            context,
            Effect.sync(() => {
              executions++;
            }),
            { enabled: true, endpoint: receiver.endpoint },
          ),
        ),
      );
      expect(executions).toBe(34);
      const roots = sdkTelemetryRecordedSpans(receiver.requests).filter(
        (span) => span.name === "sdk.execution",
      );
      expect(roots).toHaveLength(32);
      expect(
        roots.map(
          (span) =>
            span.attributes.find((attribute) => attribute.key === "sdk.execution_index")?.value
              .intValue,
        ),
      ).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
    }),
    { enabled: false },
  ));

// Promise adaptation below tests the real Vitest boundary itself, not a parallel runtime workflow.
test("test runtime disabled performs no exporter requests and still closes resources", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const receiver = yield* acquireSdkTelemetryTestServer();
      let closed = false;
      const value = yield* Effect.promise(() =>
        runHerdrTest(
          context,
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                closed = true;
              }),
            );
            return 42;
          }),
          { enabled: false, endpoint: receiver.endpoint },
        ),
      );
      expect(value).toBe(42);
      expect(closed).toBe(true);
      expect(receiver.requests).toEqual([]);
    }),
    { enabled: false },
  ));

test.concurrent.for(["left", "right"])(
  "test runtime isolates concurrent %s context and exports after cleanup",
  (side, context) =>
    runHerdrTest(
      context,
      Effect.gen(function* () {
        const receiver = yield* acquireSdkTelemetryTestServer();
        let closed = false;
        let exportBeforeClose = false;
        receiver.server.on("request", () => {
          if (!closed) exportBeforeClose = true;
        });
        const value = yield* Effect.promise(() =>
          runHerdrTest(
            context,
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  closed = true;
                }).pipe(Effect.withSpan("herdr.socket.close")),
              );
              const run = Effect.runForkWith(yield* Effect.context<never>());
              const completed = yield* Deferred.make<void>();
              // Exercise the same callback edge as raw fixture sockets with the captured owning context.
              const callback = () =>
                run(
                  Deferred.succeed(completed, undefined).pipe(
                    Effect.withSpan("herdr.socket.write"),
                  ),
                );
              yield* Effect.sync(callback);
              yield* Deferred.await(completed);
              return side;
            }),
            { enabled: true, endpoint: receiver.endpoint },
          ),
        );
        expect(value).toBe(side);
        expect(closed).toBe(true);
        expect(exportBeforeClose).toBe(false);
        const spans = sdkTelemetryRecordedSpans(receiver.requests);
        const roots = spans.filter((span) => span.name === "sdk.execution");
        expect(roots).toHaveLength(1);
        const root = roots[0];
        if (root === undefined) return yield* Effect.die("Test runtime root span missing");
        expect(root.attributes).toContainEqual({
          key: "sdk.test_id",
          value: {
            stringValue: sdkTelemetryIdentity(
              `src/herdr-test-runtime.test.ts\n${context.task.fullName}`,
            ),
          },
        });
        for (const name of ["herdr.socket.close", "herdr.socket.write"]) {
          const child = spans.find((span) => span.name === name);
          expect(child).toBeDefined();
          if (child === undefined)
            return yield* Effect.die("Test runtime callback or finalizer span missing");
          expect(child.traceId).toBe(root.traceId);
          expect(child.parentSpanId).toBe(root.spanId);
          expect(BigInt(child.endTimeUnixNano)).toBeLessThanOrEqual(BigInt(root.endTimeUnixNano));
        }
        expect(receiver.requests.map((request) => request.body).join("\n")).not.toContain(
          context.task.file.filepath,
        );
      }),
      { enabled: false },
    ),
);

test("test runtime preserves the exact failure when telemetry is unavailable", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const receiver = yield* acquireSdkTelemetryTestServer({ status: 503 });
      const failure = new Error("private test failure must not be exported");
      let closed = false;
      const exit = yield* Effect.tryPromise({
        try: () =>
          runHerdrTest(
            context,
            Effect.fail(failure).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  closed = true;
                }),
              ),
            ),
            { enabled: true, endpoint: receiver.endpoint },
          ),
        catch: (error) => error,
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure);
      expect(closed).toBe(true);
      expect(receiver.requests.map((request) => request.body).join("\n")).not.toContain(
        failure.message,
      );
    }),
    { enabled: false },
  ));

test("test runtime interruption closes the product before exporting its interrupted root", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const receiver = yield* acquireSdkTelemetryTestServer();
      const controller = new AbortController();
      const ready = yield* Deferred.make<void>();
      let closed = false;
      const running = yield* Effect.tryPromise({
        try: () =>
          runHerdrTest(
            { ...context, signal: controller.signal },
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  closed = true;
                }).pipe(Effect.withSpan("herdr.socket.close")),
              );
              yield* Deferred.succeed(ready, undefined);
              return yield* Effect.never;
            }),
            { enabled: true, endpoint: receiver.endpoint },
          ),
        catch: (error) => error,
      }).pipe(Effect.exit, Effect.forkScoped);
      yield* Deferred.await(ready);
      yield* Effect.sync(() => controller.abort());
      const exit = yield* Fiber.join(running);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(closed).toBe(true);
      const spans = sdkTelemetryRecordedSpans(receiver.requests);
      const root = spans.find((span) => span.name === "sdk.execution");
      expect(root?.attributes).toContainEqual({
        key: "sdk.outcome",
        value: { stringValue: "interrupted" },
      });
      expect(spans.some((span) => span.name === "herdr.socket.close")).toBe(true);
    }),
    { enabled: false },
  ));
