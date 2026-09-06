import { NodeSocket } from "@effect/platform-node-shared";
import { Deferred, Duration, Effect, Exit, Fiber, Schema, Stream } from "effect";
import { FastCheck } from "effect/testing";
import { beforeEach, expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { HerdrAbsolutePath, HerdrSdk, herdrSdkLayerFromOptions } from "./index.ts";
import { startHerdrTestServer, type HerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

const parseStressSeed = Schema.decodeUnknownSync(
  Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 }),
  ),
);
const parseStressRepetitions = Schema.decodeUnknownSync(
  Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 1000 })),
);
const seed = parseStressSeed(process.env.HERDR_STRESS_SEED ?? "21021");
const repetitions = parseStressRepetitions(process.env.HERDR_STRESS_REPETITIONS ?? "8");
const stressParameters = { seed, numRuns: repetitions, endOnFailure: true };
const stressTimeoutMs = repetitions * 5000 + 5000;

beforeEach(({ onTestFailed }) => {
  onTestFailed(() => {
    console.error(
      `Herdr stress reproduction: HERDR_STRESS_SEED=${seed} HERDR_STRESS_REPETITIONS=${repetitions} ./node_modules/.bin/vitest run src/herdr-stress.test.ts`,
    );
  });
});

function stressWorkspace(workspaceId: string, label: string) {
  return {
    workspace_id: workspaceId,
    number: 1,
    label,
    focused: true,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: "tab-stress",
    agent_status: "idle" as const,
  };
}

function fragmentStressBytes(bytes: Buffer, widths: readonly number[]) {
  const chunks: Buffer[] = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const width = widths[index % widths.length] ?? 1;
    const end = Math.min(offset + width, bytes.length);
    chunks.push(bytes.subarray(offset, end));
    offset = end;
    index += 1;
  }
  return chunks;
}

// Real sockets require the live runtime; deadlines bound failures, not scheduling assertions.
function provideStressSdk(socketPath: string) {
  return Effect.provide(
    herdrSdkLayerFromOptions({
      socketPath: HerdrAbsolutePath.make(socketPath),
      requestTimeout: Duration.seconds(2),
    }),
  );
}

test(
  "seeded stress: fragmented UTF-8 and NDJSON preserve every event in order",
  (context) =>
    FastCheck.assert(
      FastCheck.asyncProperty(
        FastCheck.array(FastCheck.integer({ min: 1, max: 257 }), { minLength: 1, maxLength: 12 }),
        FastCheck.array(
          FastCheck.constantFrom("漢字", "e\u0301", '"quoted"', "line\nbreak", "🦊"),
          {
            minLength: 3,
            maxLength: 8,
          },
        ),
        (widths, suffixes) =>
          runHerdrTest(
            context,
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({
                  "sdk.stress.seed": seed,
                  "sdk.stress.repetitions": repetitions,
                });
                const labels = suffixes.map((suffix, index) => `🌍-${index}-${suffix}`);
                const firstEventObserved = yield* Deferred.make<void>();
                const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
                  Effect.gen(function* () {
                    const response = makeHerdrSuccessResponse(request);
                    if (request.method !== "events.subscribe") return response;
                    const bytes = Buffer.from(
                      [
                        JSON.stringify(response),
                        ...labels.map((label, index) =>
                          JSON.stringify({
                            event: "workspace_created",
                            data: {
                              type: "workspace_created",
                              workspace: stressWorkspace(`workspace-${index}`, label),
                            },
                          }),
                        ),
                        "",
                      ].join("\n"),
                    );
                    // Force write boundaries inside a four-byte code point and before the final delimiter.
                    // The OS may coalesce writes; no assertion depends on remote chunk boundaries.
                    const split = bytes.indexOf(Buffer.from("🌍")) + 1;
                    const firstEventEnd = bytes.indexOf(10, bytes.indexOf(10) + 1) + 1;
                    yield* server.writeChunks(socket, [
                      bytes.subarray(0, split),
                      ...fragmentStressBytes(bytes.subarray(split, firstEventEnd), widths),
                    ]);
                    // Subsequent frames cannot arrive until the public stream yields the first.
                    yield* Deferred.await(firstEventObserved);
                    yield* server.writeChunks(socket, [
                      ...fragmentStressBytes(bytes.subarray(firstEventEnd, -1), widths),
                      bytes.subarray(-1),
                    ]);
                  }),
                );
                const events = yield* Effect.gen(function* () {
                  const herdr = yield* HerdrSdk;
                  return yield* herdr.events.subscribe([{ type: "workspace.created" }]).pipe(
                    Stream.tap((event) =>
                      event.workspace.id === "workspace-0"
                        ? Deferred.succeed(firstEventObserved, undefined)
                        : Effect.void,
                    ),
                    Stream.take(labels.length),
                    Stream.runCollect,
                  );
                }).pipe(provideStressSdk(server.socketPath));
                expect(events.map((event) => event.workspace.label)).toEqual(labels);
                expect(events.map((event) => event.workspace.id)).toEqual(
                  labels.map((_, index) => `workspace-${index}`),
                );
                yield* server.waitFor("close", 2);
                expect(server.openSocketCount()).toBe(0);
              }),
            ).pipe(Effect.timeout("3 seconds")),
          ),
      ),
      stressParameters,
    ),
  stressTimeoutMs,
);

test(
  "seeded stress: canceling one pending response never completes or cancels its peers",
  (context) =>
    FastCheck.assert(
      FastCheck.asyncProperty(
        FastCheck.integer({ min: 0, max: 3 }),
        FastCheck.boolean(),
        FastCheck.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
        (canceledIndex, sendPartialResponse, releaseOrder) =>
          runHerdrTest(
            context,
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({
                  "sdk.stress.seed": seed,
                  "sdk.stress.repetitions": repetitions,
                });
                const gates = yield* Effect.forEach([0, 1, 2, 3], () => Deferred.make<void>());
                const responseReady = yield* Effect.forEach([0, 1, 2, 3], () =>
                  Deferred.make<void>(),
                );
                const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
                  Effect.gen(function* () {
                    if (request.method !== "workspace.get")
                      return makeHerdrSuccessResponse(request);
                    const index = Number(request.params.workspace_id.replace("workspace-", ""));
                    const gate = gates.at(index);
                    const ready = responseReady.at(index);
                    if (gate === undefined || ready === undefined)
                      throw new Error("Herdr stress received an unexpected workspace");
                    const bytes = Buffer.from(
                      JSON.stringify({
                        id: request.id,
                        result: {
                          type: "workspace_info",
                          workspace: stressWorkspace(
                            request.params.workspace_id,
                            `response-${index}`,
                          ),
                        },
                      }) + "\n",
                    );
                    const split = sendPartialResponse ? Math.floor(bytes.length / 2) : 0;
                    if (split > 0) yield* server.writeChunks(socket, [bytes.subarray(0, split)]);
                    yield* Deferred.succeed(ready, undefined);
                    yield* Deferred.await(gate);
                    yield* server.writeChunks(socket, [bytes.subarray(split)]);
                  }),
                );
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const herdr = yield* HerdrSdk;
                    const pending = yield* Effect.forEach([0, 1, 2, 3], (index) =>
                      herdr.workspaces
                        .get(herdr.ids.workspace(`workspace-${index}`))
                        .pipe(Effect.forkScoped),
                    );
                    yield* server.waitFor("request", 5);
                    yield* Effect.forEach(responseReady, Deferred.await);
                    yield* server.waitFor("close", 1);
                    let closedCount = 1;
                    for (const index of releaseOrder) {
                      const gate = gates.at(index);
                      const fiber = pending.at(index);
                      if (gate === undefined || fiber === undefined) {
                        throw new Error("Herdr stress release index is missing");
                      }
                      closedCount += 1;
                      if (index === canceledIndex) {
                        yield* Fiber.interrupt(fiber);
                        expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
                        yield* server.waitFor("close", closedCount);
                        // A late response on the canceled socket cannot affect surviving sockets.
                        yield* Deferred.succeed(gate, undefined);
                      } else {
                        yield* Deferred.succeed(gate, undefined);
                        const workspace = yield* Fiber.join(fiber);
                        expect(workspace.id).toBe(`workspace-${index}`);
                        expect(workspace.label).toBe(`response-${index}`);
                        yield* Fiber.interrupt(fiber);
                        expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true);
                        yield* server.waitFor("close", closedCount);
                      }
                    }
                  }),
                ).pipe(provideStressSdk(server.socketPath));
                yield* server.waitFor("close", 5);
                expect(server.openSocketCount()).toBe(0);
              }),
            ).pipe(Effect.timeout("3 seconds")),
          ),
      ),
      stressParameters,
    ),
  stressTimeoutMs,
);

const parseStressGraphicsHeader = Schema.decodeUnknownSync(
  Schema.Struct({
    format: Schema.Literal("png"),
    image_width: Schema.Literal(1),
    image_height: Schema.Literal(1),
    data_length: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 131072 })),
  }),
);

test(
  "seeded stress: concurrent graphics writes preserve the complete payload multiset",
  (context) =>
    FastCheck.assert(
      FastCheck.asyncProperty(
        FastCheck.array(
          FastCheck.record({
            length: FastCheck.constantFrom(1, 255, 4096, 65537, 131072),
            salt: FastCheck.integer({ min: 0, max: 255 }),
          }),
          { minLength: 3, maxLength: 7 },
        ),
        (frames) =>
          runHerdrTest(
            context,
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({
                  "sdk.stress.seed": seed,
                  "sdk.stress.repetitions": repetitions,
                });
                const payloads = frames.map(({ length, salt }) =>
                  Buffer.from(
                    Uint8Array.from({ length }, (_, offset) => (offset * 31 + salt) % 256),
                  ),
                );
                const received: Buffer[] = [];
                const framesReceived = yield* Deferred.make<void, Error>();
                const graphicsReadCompleted = yield* Deferred.make<void, Error>();
                const server: HerdrTestServer = yield* startHerdrTestServer((request, socket) =>
                  Effect.gen(function* () {
                    const response = makeHerdrSuccessResponse(request);
                    if (request.method !== "pane.graphics.stream") return response;
                    let buffered = Buffer.alloc(0);
                    let expectedBytes: number | undefined;
                    // The fixture owns the accepted socket; this adapter owns only its read listeners.
                    const graphicsSocket = yield* NodeSocket.fromDuplex(Effect.succeed(socket));
                    yield* graphicsSocket
                      .run(
                        (chunk) =>
                          Effect.gen(function* () {
                            buffered = Buffer.concat([buffered, chunk]);
                            while (buffered.length > 0) {
                              if (expectedBytes === undefined) {
                                const newline = buffered.indexOf(10);
                                if (newline < 0) return;
                                const header = parseStressGraphicsHeader(
                                  JSON.parse(buffered.subarray(0, newline).toString("utf8")),
                                );
                                expectedBytes = header.data_length;
                                buffered = buffered.subarray(newline + 1);
                              }
                              if (buffered.length < expectedBytes) return;
                              received.push(Buffer.from(buffered.subarray(0, expectedBytes)));
                              buffered = buffered.subarray(expectedBytes);
                              expectedBytes = undefined;
                              if (received.length === payloads.length) {
                                expect(buffered.length).toBe(0);
                                yield* Deferred.succeed(framesReceived, undefined);
                              }
                            }
                          }),
                        {
                          // NodeSocket's readiness hook has no error channel; catchCause below
                          // forwards even a failed handshake to the test's completion signal.
                          onOpen: server
                            .writeChunks(socket, [Buffer.from(JSON.stringify(response) + "\n")])
                            .pipe(Effect.orDie),
                        },
                      )
                      .pipe(
                        Effect.catchCause((cause) =>
                          Effect.gen(function* () {
                            const error = new Error("Herdr stress graphics frame parsing failed", {
                              cause,
                            });
                            yield* Deferred.fail(framesReceived, error);
                            yield* Deferred.fail(graphicsReadCompleted, error);
                          }),
                        ),
                      );
                    expect(buffered.length).toBe(0);
                    expect(expectedBytes).toBeUndefined();
                    yield* Deferred.succeed(graphicsReadCompleted, undefined);
                  }),
                );
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const herdr = yield* HerdrSdk;
                    const writer = yield* herdr.panes.graphics.openStream(
                      herdr.ids.pane("pane-stress"),
                    );
                    const startWrites = yield* Deferred.make<void>();
                    const writes = yield* Effect.forEach(payloads, (data) =>
                      Effect.gen(function* () {
                        yield* Deferred.await(startWrites);
                        yield* writer.write({ format: "png", imageWidth: 1, imageHeight: 1, data });
                      }).pipe(Effect.forkScoped),
                    );
                    yield* Deferred.succeed(startWrites, undefined);
                    yield* Effect.forEach(writes, Fiber.join, { concurrency: "unbounded" });
                    yield* Deferred.await(framesReceived);
                  }),
                ).pipe(provideStressSdk(server.socketPath));
                yield* Deferred.await(graphicsReadCompleted);
                yield* server.waitFor("close", 2);
                expect(server.openSocketCount()).toBe(0);
                expect(received).toHaveLength(payloads.length);
                const sortedReceived = received.sort((left, right) => Buffer.compare(left, right));
                for (const [index, expected] of [...payloads]
                  .sort((left, right) => Buffer.compare(left, right))
                  .entries()) {
                  expect(
                    sortedReceived.at(index)?.equals(expected),
                    `complete graphics payload ${index}`,
                  ).toBe(true);
                }
              }),
            ).pipe(Effect.timeout("3 seconds")),
          ),
      ),
      stressParameters,
    ),
  stressTimeoutMs,
);
