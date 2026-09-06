import { NodeFileSystem } from "@effect/platform-node-shared";
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Schema, Scope } from "effect";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import herdrApiSchema from "../schema/herdr-api.schema.json" with { type: "json" };
import type { ErrorResponse } from "./generated/wire-error-response.ts";
import type { Request } from "./generated/wire-request.ts";
import type { SuccessResponse } from "./generated/wire-success-response.ts";
import { resolveHerdrSocketEndpoint } from "./herdr-transport.ts";

const schemaId = "https://herdr.dev/herdr-api.schema.json";
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema({ ...herdrApiSchema, $id: schemaId });
const requestParser = ajv.compile<Request>({ $ref: `${schemaId}#/schemas/request` });
const graphicsStreamRequestParser = ajv.compile<HerdrGraphicsStreamRequest>({
  type: "object",
  required: ["id", "method", "params"],
  properties: {
    id: { type: "string" },
    method: { const: "pane.graphics.stream" },
    params: {
      type: "object",
      required: ["pane_id"],
      properties: {
        pane_id: { type: "string" },
        layer_id: { type: ["string", "null"] },
        z_index: { type: "integer" },
      },
    },
  },
});

interface HerdrGraphicsStreamRequest {
  readonly id: string;
  readonly method: "pane.graphics.stream";
  readonly params: {
    readonly pane_id: string;
    readonly layer_id?: string | null;
    readonly z_index?: number;
  };
}

/** Every request accepted by the test server, including the schema-skipped graphics stream. */
export type HerdrTestRequest = Request | HerdrGraphicsStreamRequest;

/** Typed response emitted by the local socket test server. */
export type HerdrTestResponse = SuccessResponse | ErrorResponse;

/** Raw bytes bypass response validation, including partial UTF-8 and coalesced frames. */
export class HerdrRawTestResponse {
  /** Bytes are written unchanged; no newline is appended. */
  constructor(readonly value: string | Uint8Array) {}
}

/** Data observes post-request socket chunks, not graphics frames; boundaries are nondeterministic. */
export type HerdrTestEventKind = "accept" | "request" | "data" | "close";

/** Metadata deliberately excludes request IDs, methods, payloads, paths, and error text. */
export interface HerdrTestTimelineEntry {
  readonly sequence: number;
  readonly kind: HerdrTestEventKind | "write" | "failure" | "stop";
  readonly connection: number;
  readonly bytes: number;
}

/** Safe fixture failure; original callback errors are intentionally not retained. */
export class HerdrTestFixtureError extends Schema.TaggedError<HerdrTestFixtureError>()(
  "HerdrTestFixtureError",
  { message: Schema.String },
) {}

/** Owned response gate; cleanup resolves pending waits with false. */
export interface HerdrResponseGate {
  readonly wait: Effect.Effect<boolean>;
  readonly release: Effect.Effect<void>;
}

/** Test-only limits; socketPath overrides the endpoint for local startup-failure tests. */
export interface HerdrTestServerOptions {
  readonly timelineCapacity?: number;
  readonly waitTimeoutMs?: number;
  readonly socketPath?: string;
  /** Parent for the fixture-owned temporary directory; useful for cleanup assertions. */
  readonly directory?: string;
}

/** Scoped local fixture; requests are full test observations, NOT safe diagnostics. */
export interface HerdrTestServer {
  /** Filesystem-shaped SDK configuration path, including on Windows. */
  readonly socketPath: string;
  readonly requests: HerdrTestRequest[];
  readonly openSocketCount: () => number;
  readonly openSocketMethods: () => readonly string[];
  /** Cumulative counts survive timeline eviction; all waits have finite deadlines. */
  readonly waitFor: (
    kind: HerdrTestEventKind,
    count?: number,
    timeoutMs?: number,
  ) => Effect.Effect<void, HerdrTestFixtureError>;
  /** Detached, bounded metadata-only snapshot. */
  readonly timeline: () => readonly HerdrTestTimelineEntry[];
  readonly createResponseGate: () => Effect.Effect<HerdrResponseGate>;
  /** Waits for write callbacks (bounded), NOT client reads; use gates for ordering assertions. */
  readonly writeChunks: (
    socket: Socket,
    chunks: readonly Uint8Array[],
  ) => Effect.Effect<void, HerdrTestFixtureError>;
  /** Runs work in the fixture scope; cleanup interrupts both delay and work. */
  readonly schedule: (delayMs: number, work: Effect.Effect<void, unknown>) => Effect.Effect<void>;
  /** Idempotent cleanup; reports callback/parse/socket failure with safe diagnostics. */
  readonly close: Effect.Effect<void, HerdrTestFixtureError>;
}

type TestResponse = HerdrTestResponse | HerdrRawTestResponse | void;

/** Starts a scoped NDJSON fault fixture; callbacks and scheduled work are interrupted on cleanup. */
export const startHerdrTestServer = Effect.fn("startHerdrTestServer")(function* (
  respond: (request: HerdrTestRequest, socket: Socket) => Effect.Effect<TestResponse, unknown>,
  options: HerdrTestServerOptions = {},
): Effect.fn.Return<HerdrTestServer, HerdrTestFixtureError, Scope.Scope> {
  const capacity = yield* parseTestLimit(options.timelineCapacity ?? 64);
  const waitTimeoutMs = yield* parseTestLimit(options.waitTimeoutMs ?? 5000);
  let unobservedFailure: (() => HerdrTestFixtureError) | undefined;
  let scopeFailureDiagnostic: (() => string) | undefined;
  let diagnosticReported = false;
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
    Scope.close(scope, exit).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (unobservedFailure !== undefined) return Effect.die(unobservedFailure());
          if (Exit.isFailure(exit) && !diagnosticReported && scopeFailureDiagnostic !== undefined) {
            return Effect.logError(scopeFailureDiagnostic());
          }
          return Effect.void;
        }),
      ),
    ),
  );
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs
      .makeTempDirectoryScoped({ prefix: "hs-", directory: options.directory })
      .pipe(
        Effect.mapError(
          () =>
            new HerdrTestFixtureError({
              message: "Herdr test fixture failure: temporary directory acquisition",
            }),
        ),
      );
    const socketPath = options.socketPath ?? join(directory, "herdr.sock");
    const requests: HerdrTestRequest[] = [];
    const sockets = new Set<Socket>();
    const socketMethods = new Map<Socket, string>();
    const connectionIds = new Map<Socket, number>();
    const entries: HerdrTestTimelineEntry[] = [];
    const counts = { accept: 0, request: 0, data: 0, close: 0 };
    const gates = new Set<Deferred.Deferred<boolean>>();
    let changed = Deferred.makeUnsafe<void>();
    let sequence = 0;
    let nextConnection = 0;
    let stopped = false;
    let failed = false;

    function record(kind: HerdrTestTimelineEntry["kind"], connection = 0, bytes = 0): void {
      entries.push({ sequence: ++sequence, kind, connection, bytes });
      if (entries.length > capacity) entries.shift();
      if (kind === "accept" || kind === "request" || kind === "data" || kind === "close")
        counts[kind]++;
      const previous = changed;
      changed = Deferred.makeUnsafe<void>();
      Deferred.doneUnsafe(previous, Effect.void);
    }
    function diagnostic(reason: string): HerdrTestFixtureError {
      return new HerdrTestFixtureError({
        message: `Herdr test fixture failure: ${reason}; counts=${JSON.stringify(counts)}; timeline=${JSON.stringify(entries)}; reproduce with the focused fixture test and the same gate/chunk ordering`,
      });
    }
    scopeFailureDiagnostic = () => diagnostic("enclosing scope failed").message;
    function cancelGates(): void {
      for (const gate of gates) Deferred.doneUnsafe(gate, Effect.succeed(false));
      gates.clear();
    }
    function fail(): void {
      if (failed) return;
      failed = true;
      unobservedFailure = () =>
        diagnostic("unobserved callback, socket, or request parsing failure");
      record("failure");
      cancelGates();
      for (const socket of sockets) socket.destroy();
    }
    const writeChunks = Effect.fn("HerdrTestServer.writeChunks")(function* (
      socket: Socket,
      chunks: readonly Uint8Array[],
    ) {
      if (stopped || failed || socket.destroyed) return;
      if (!sockets.has(socket))
        return yield* Effect.fail(diagnostic("write requires an owned socket"));
      for (const chunk of chunks) {
        yield* Effect.callback<void, HerdrTestFixtureError>((resume) => {
          socket.write(chunk, (error) => {
            if (error) resume(Effect.fail(diagnostic("write callback")));
            else resume(Effect.void);
          });
          record("write", connectionIds.get(socket), chunk.byteLength);
        }).pipe(
          Effect.timeout(waitTimeoutMs),
          Effect.catchTag("TimeoutError", () => Effect.fail(diagnostic("write timeout"))),
        );
      }
    });
    const supervise = <A>(work: Effect.Effect<A, unknown>) =>
      work.pipe(
        // Finalizers run uninterruptibly, so mixed interruption/defect causes cannot skip reporting.
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
            ? Effect.sync(fail)
            : Effect.void,
        ),
        Effect.catchCause(() => Effect.void),
      );
    // NodeSocketServer was inspected: its normal stream lifecycle hides raw accepted socket
    // fault control. Keep the Node adapter here for deliberate truncation/reset and raw writes.
    const run = Effect.runForkWith(yield* Effect.context<never>());
    const track = Fiber.runIn(scope);
    const server = createServer((socket) => {
      const connection = ++nextConnection;
      sockets.add(socket);
      connectionIds.set(socket, connection);
      socket.on("error", (error: NodeJS.ErrnoException) => {
        // Client cancellation/reset is an intended transport fault, not a fixture defect.
        if (error.code !== "ECONNRESET" && error.code !== "EPIPE") fail();
      });
      socket.once("close", () => {
        sockets.delete(socket);
        socketMethods.delete(socket);
        connectionIds.delete(socket);
        record("close", connection);
      });
      record("accept", connection);
      let input = Buffer.alloc(0);
      let receivedRequest = false;
      socket.on("data", (chunk: Buffer) => {
        if (stopped || failed) return;
        if (receivedRequest) {
          record("data", connection, chunk.byteLength);
          return;
        }
        input = Buffer.concat([input, chunk]);
        const newline = input.indexOf(10);
        if (newline < 0) {
          if (input.byteLength > 1024 * 1024) fail();
          return;
        }
        if (newline > 1024 * 1024) {
          fail();
          return;
        }
        try {
          const parsed: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(input.subarray(0, newline)),
          );
          if (!requestParser(parsed) && !graphicsStreamRequestParser(parsed)) {
            fail();
            return;
          }
          receivedRequest = true;
          requests.push(parsed);
          socketMethods.set(socket, parsed.method);
          record("request", connection);
          const remainingBytes = input.byteLength - newline - 1;
          if (remainingBytes > 0) record("data", connection, remainingBytes);
          input = Buffer.alloc(0);
          track(
            run(
              supervise(
                Effect.suspend(() => respond(parsed, socket)).pipe(
                  Effect.flatMap((response) => {
                    if (response === undefined) return Effect.void;
                    const value =
                      response instanceof HerdrRawTestResponse
                        ? response.value
                        : `${JSON.stringify(response)}\n`;
                    return writeChunks(socket, [
                      typeof value === "string" ? Buffer.from(value) : value,
                    ]);
                  }),
                ),
              ),
            ),
          );
        } catch {
          fail();
        }
      });
    });
    server.on("error", fail);
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        stopped = true;
        record("stop");
        cancelGates();
        const closed = [...sockets].map((socket) =>
          Effect.callback<void>((resume) => {
            if (socket.closed) {
              resume(Effect.void);
              return;
            }
            const onClose = (): void => resume(Effect.void);
            socket.once("close", onClose);
            socket.destroy();
            return Effect.sync(() => {
              socket.off("close", onClose);
            });
          }),
        );
        yield* Effect.all(closed, { concurrency: "unbounded", discard: true });
        if (server.listening)
          yield* Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          });
      }),
    );
    yield* Effect.callback<void, HerdrTestFixtureError>((resume) => {
      const onError = (): void => resume(Effect.fail(diagnostic("startup")));
      server.once("error", onError);
      try {
        server.listen(resolveHerdrSocketEndpoint(socketPath), () => resume(Effect.void));
      } catch {
        resume(Effect.fail(diagnostic("startup")));
      }
      return Effect.sync(() => {
        server.off("error", onError);
      });
    });

    const close = Scope.close(scope, Exit.void).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          unobservedFailure = undefined;
          if (failed) diagnosticReported = true;
          return failed
            ? Effect.fail(diagnostic("callback, socket, or request parsing"))
            : Effect.void;
        }),
      ),
    );
    return {
      socketPath,
      requests,
      openSocketCount: () => sockets.size,
      openSocketMethods: () => [...socketMethods.values()],
      timeline: () => entries.map((entry) => ({ ...entry })),
      waitFor: Effect.fn("HerdrTestServer.waitFor")(function* (
        kind,
        count = 1,
        timeoutMs = waitTimeoutMs,
      ) {
        yield* parseTestLimit(count);
        yield* parseTestLimit(timeoutMs);
        yield* Effect.gen(function* () {
          while (true) {
            if (failed) {
              unobservedFailure = undefined;
              diagnosticReported = true;
              return yield* Effect.fail(diagnostic("callback, socket, or request parsing"));
            }
            if (counts[kind] >= count) return;
            if (stopped) return yield* Effect.fail(diagnostic("closed before wait completed"));
            yield* Deferred.await(changed);
          }
        }).pipe(
          Effect.timeout(timeoutMs),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(diagnostic(`wait timeout kind=${kind} count=${count}`)),
          ),
        );
      }),
      createResponseGate: () =>
        Effect.sync(() => {
          const gate = Deferred.makeUnsafe<boolean>();
          if (stopped || failed) Deferred.doneUnsafe(gate, Effect.succeed(false));
          else gates.add(gate);
          return {
            wait: Deferred.await(gate),
            release: Effect.sync(() => {
              Deferred.doneUnsafe(gate, Effect.succeed(!stopped && !failed));
              gates.delete(gate);
            }),
          };
        }),
      writeChunks,
      schedule: (delayMs, work) =>
        Effect.gen(function* () {
          yield* parseTestDelay(delayMs).pipe(Effect.orDie);
          if (stopped || failed) return;
          yield* supervise(work).pipe(Effect.delay(delayMs), Effect.forkIn(scope));
        }),
      close,
    } satisfies HerdrTestServer;
  }).pipe(
    Scope.provide(scope),
    Effect.provide(NodeFileSystem.layer),
    Effect.onError(() =>
      Effect.sync(() => {
        unobservedFailure = undefined;
        diagnosticReported = true;
      }).pipe(Effect.andThen(Scope.close(scope, Exit.void))),
    ),
  );
});

function parseTestDelay(value: number): Effect.Effect<number, HerdrTestFixtureError> {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
    ? Effect.succeed(value)
    : Effect.fail(
        new HerdrTestFixtureError({
          message: "Herdr test fixture invalid delay: expected a nonnegative bounded integer",
        }),
      );
}

function parseTestLimit(value: number): Effect.Effect<number, HerdrTestFixtureError> {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
    ? Effect.succeed(value)
    : Effect.fail(
        new HerdrTestFixtureError({
          message: "Herdr test fixture invalid limit: expected a positive bounded integer",
        }),
      );
}
