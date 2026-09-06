import { Deferred, Duration, Effect, Fiber, Option, Schema, Stream, type Scope } from "effect";
import { expect, test, type TestContext } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { HerdrConfig, HerdrProtocolVersion } from "./herdr-config.ts";
import { parseHerdrAbsolutePath } from "./herdr-domain.ts";
import {
  HerdrInvalidResponse,
  HerdrRequestTimeout,
  HerdrServerError,
  HerdrTransportError,
  HerdrUnsupportedProtocol,
} from "./herdr-errors.ts";
import {
  HerdrTransport,
  herdrTransportLayerWithoutDependencies,
  resolveHerdrSocketEndpoint,
} from "./herdr-transport.ts";
import { HerdrRawTestResponse, startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";
import packageJson from "../package.json" with { type: "json" };

const runTransportTest = <A, E>(context: TestContext, effect: Effect.Effect<A, E, Scope.Scope>) =>
  runHerdrTest(context, effect);

test("Windows filesystem-shaped Herdr socket paths resolve to named-pipe endpoints", () => {
  expect(resolveHerdrSocketEndpoint("C:\\Users\\dev\\herdr\\herdr.sock", "win32")).toBe(
    "\\\\.\\pipe\\C:\\Users\\dev\\herdr\\herdr.sock",
  );
  expect(resolveHerdrSocketEndpoint("\\\\.\\pipe\\custom-herdr", "win32")).toBe(
    "\\\\.\\pipe\\custom-herdr",
  );
  expect(resolveHerdrSocketEndpoint("/tmp/herdr.sock", "darwin")).toBe("/tmp/herdr.sock");
});

test("transport classifies malformed, oversized, server, timeout, and protocol failures", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const malformedServer = yield* startHerdrTestServer(() =>
        Effect.succeed(new HerdrRawTestResponse("{oops\n")),
      );
      const malformed = yield* withTransport(
        malformedServer.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport.request("ping", {}, { requestId: "malformed" }).pipe(Effect.flip);
        }),
      );
      expect(malformed).toMatchObject({
        _tag: "HerdrInvalidResponse",
        reason: "malformed_json",
        requestId: "malformed",
      });
      const oversizedServer = yield* startHerdrTestServer(() =>
        Effect.succeed(new HerdrRawTestResponse(`${"x".repeat(1024 * 1024 + 1)}\n`)),
      );
      const oversized = yield* withTransport(
        oversizedServer.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport.request("ping", {}, { requestId: "oversized" }).pipe(Effect.flip);
        }),
      );
      expect(oversized).toMatchObject({
        _tag: "HerdrInvalidResponse",
        reason: "oversized_frame",
        requestId: "oversized",
      });
      const errorServer = yield* startHerdrTestServer((request) =>
        Effect.succeed(
          request.method === "ping"
            ? makeHerdrSuccessResponse(request)
            : { id: request.id, error: { code: "fixture_rejected", message: "no" } },
        ),
      );
      const serverFailure = yield* withTransport(
        errorServer.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport
            .request("server.stop", {}, { requestId: "server-error" })
            .pipe(Effect.flip);
        }),
      );
      expect(serverFailure).toBeInstanceOf(HerdrServerError);
      expect(serverFailure).toMatchObject({
        serverCode: "fixture_rejected",
        serverMessage: "no",
        requestId: "server-error",
      });
      const timeoutServer = yield* startHerdrTestServer(() => Effect.void);
      const timeout = yield* withTransport(
        timeoutServer.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport
            .request("ping", {}, { requestId: "timeout", requestTimeout: Duration.millis(10) })
            .pipe(Effect.flip);
        }),
      );
      expect(timeout).toBeInstanceOf(HerdrRequestTimeout);
      expect(timeout).toMatchObject({ requestId: "timeout", timeoutMilliseconds: 10 });
      const protocolServer = yield* startHerdrTestServer((request) =>
        Effect.succeed({
          id: request.id,
          result: { type: "pong", version: "future", protocol: packageJson.herdr.protocol - 1 },
        }),
      );
      const protocol = yield* withTransport(
        protocolServer.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport.request("ping", {}, { requestId: "protocol" }).pipe(Effect.flip);
        }),
      );
      expect(protocol).toBeInstanceOf(HerdrUnsupportedProtocol);
      expect(protocol).toMatchObject({
        actualProtocol: packageJson.herdr.protocol - 1,
        supportedProtocol: packageJson.herdr.protocol,
      });
      const partialServer = yield* startHerdrTestServer((_request, socket) =>
        Effect.sync(() => {
          socket.end('{"id":"partial","result":{"type":"pong"}}');
        }),
      );
      const partial = yield* withTransport(
        partialServer.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport.request("ping", {}, { requestId: "partial" }).pipe(Effect.flip);
        }),
      );
      expect(partial).toBeInstanceOf(HerdrTransportError);
      expect(partial).toMatchObject({ reason: "premature_close", requestId: "partial" });
    }),
  ));

test("transport classifies a missing local socket as a connection failure", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer(() => Effect.void);
      yield* server.close;
      const failure = yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport
            .request("ping", {}, { requestId: "missing-socket" })
            .pipe(Effect.flip);
        }),
      );
      expect(failure).toBeInstanceOf(HerdrTransportError);
      expect(failure).toMatchObject({
        operation: "compatibility_check",
        reason: "connect",
        requestId: "missing-socket",
      });
    }),
  ));

test("transport interruption closes an established socket", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer(() => Effect.void);
      yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          const fiber = yield* transport
            .request("ping", {}, { requestId: "interrupted" })
            .pipe(Effect.forkChild);
          yield* server.waitFor("request");
          yield* Fiber.interrupt(fiber);
        }),
      );
      yield* server.waitFor("close");
      expect(server.openSocketCount()).toBe(0);
    }),
  ));

test("transport correlates responses, converts request keys, and memoizes compatibility", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request) =>
        Effect.succeed(
          request.method === "ping"
            ? makeHerdrSuccessResponse(request)
            : {
                id: request.id,
                result: {
                  type: "workspace_info",
                  workspace: {
                    active_tab_id: "tab-1",
                    agent_status: "idle",
                    focused: true,
                    label: "Workspace 1",
                    number: 1,
                    pane_count: 1,
                    tab_count: 1,
                    workspace_id: "workspace-1",
                  },
                },
              },
        ),
      );
      const results = yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          const first = yield* transport.request(
            "workspace.get",
            { workspaceId: "workspace-1" },
            { requestId: "request-1" },
          );
          const second = yield* transport.request(
            "workspace.get",
            { workspaceId: "workspace-2" },
            { requestId: "request-2" },
          );
          return [first, second] as const;
        }),
      );
      expect(results[0].requestId).toBe("request-1");
      expect(results[1].requestId).toBe("request-2");
      expect(server.requests.filter((request) => request.method === "ping")).toHaveLength(1);
      expect(server.requests[1]).toMatchObject({
        id: "request-1",
        method: "workspace.get",
        params: { workspace_id: "workspace-1" },
      });
    }),
  ));

test("transport rejects a response whose correlation identifier does not match", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request) =>
        Effect.succeed(
          request.method === "ping"
            ? makeHerdrSuccessResponse(request)
            : { id: "different-request", result: { type: "ok" } },
        ),
      );
      const failure = yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport
            .request("server.stop", {}, { requestId: "request-3" })
            .pipe(Effect.flip);
        }),
      );
      expect(failure).toBeInstanceOf(HerdrInvalidResponse);
      expect(failure).toMatchObject({ reason: "correlation_mismatch", requestId: "request-3" });
    }),
  ));

test("transport rejects invalid UTF-8 instead of accepting replacement characters", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request) =>
        Effect.succeed(
          new HerdrRawTestResponse(
            Buffer.concat([
              Buffer.from(
                `{"id":"${request.id}","result":{"type":"pong","protocol":${packageJson.herdr.protocol},"version":"`,
              ),
              Buffer.from([0xc3, 0x28]),
              Buffer.from('"}}\n'),
            ]),
          ),
        ),
      );
      const failure = yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport.request("ping", {}).pipe(Effect.flip);
        }),
      );
      expect(failure).toMatchObject({ _tag: "HerdrInvalidResponse", reason: "malformed_json" });
    }),
  ));

test.for(["malformed", "timeout", "interrupted"] as const)(
  "failed stream handshake closes its socket before caller scope ends: %s",
  (failureMode, context) =>
    runTransportTest(
      context,
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(
            request.method === "ping"
              ? makeHerdrSuccessResponse(request)
              : failureMode === "malformed"
                ? new HerdrRawTestResponse("{oops\n")
                : undefined,
          ),
        );
        yield* withTransport(
          server.socketPath,
          Effect.scoped(
            Effect.gen(function* () {
              const transport = yield* HerdrTransport;
              const handshake = transport.openStream(
                "pane.graphics.stream",
                { paneId: "pane-1" },
                { requestTimeout: Duration.millis(30) },
              );
              if (failureMode === "interrupted") {
                const fiber = yield* handshake.pipe(Effect.forkChild);
                yield* server.waitFor("request", 2);
                yield* Fiber.interrupt(fiber);
              } else {
                const failure = yield* handshake.pipe(Effect.flip);
                expect(failure._tag).toBe(
                  failureMode === "malformed" ? "HerdrInvalidResponse" : "HerdrRequestTimeout",
                );
              }
              yield* server.waitFor("close", server.requests.length);
              expect(server.openSocketCount()).toBe(0);
            }),
          ),
        );
      }),
    ),
);

test("stream handshake preserves split UTF-8 and exact coalesced trailing bytes", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const trailing = Buffer.from([0, 255, 10, 128]);
      const server = yield* startHerdrTestServer((request, socket) =>
        Effect.gen(function* () {
          if (request.method === "ping") {
            const response = Buffer.from(
              JSON.stringify({
                id: request.id,
                result: { type: "pong", protocol: packageJson.herdr.protocol, version: "a🌍b" },
              }) + "\n",
            );
            const split = response.indexOf(Buffer.from("🌍")) + 2;
            socket.write(response.subarray(0, split));
            yield* Effect.yieldNow;
            socket.write(response.subarray(split));
          } else {
            socket.end(
              Buffer.concat([
                Buffer.from(JSON.stringify(makeHerdrSuccessResponse(request)) + "\n"),
                trailing,
              ]),
            );
          }
        }),
      );
      const bytes = yield* withTransport(
        server.socketPath,
        Effect.scoped(
          Effect.gen(function* () {
            const transport = yield* HerdrTransport;
            const stream = yield* transport.openStream("pane.graphics.stream", {
              paneId: "pane-1",
            });
            return yield* Stream.runCollect(stream.readBytes);
          }),
        ),
      );
      expect(Buffer.concat(bytes)).toEqual(trailing);
    }),
  ));

test("graphics bytes do not replay the test server handshake", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request) =>
        Effect.succeed(makeHerdrSuccessResponse(request)),
      );
      yield* withTransport(
        server.socketPath,
        Effect.scoped(
          Effect.gen(function* () {
            const transport = yield* HerdrTransport;
            const stream = yield* transport.openStream("pane.graphics.stream", {
              paneId: "pane-1",
            });
            yield* transport.writeStreamBytes(stream, Buffer.from("{}\nframe"));
            yield* server.waitFor("data");
            expect(
              server.requests.filter((request) => request.method === "pane.graphics.stream"),
            ).toHaveLength(1);
          }),
        ),
      );
    }),
  ));

test("compatibility retries after a transient failure and memoizes the successful result", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      let pingCount = 0;
      const server = yield* startHerdrTestServer((request) =>
        Effect.sync(() => {
          if (request.method === "ping" && ++pingCount === 1)
            return new HerdrRawTestResponse("{oops\n");
          return makeHerdrSuccessResponse(request);
        }),
      );
      yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          const failure = yield* transport.request("server.stop", {}).pipe(Effect.flip);
          expect(failure._tag).toBe("HerdrInvalidResponse");
          yield* transport.request("server.stop", {});
          yield* transport.request("server.stop", {});
          expect(pingCount).toBe(2);
        }),
      );
    }),
  ));

test("invalid request options fail before compatibility socket acquisition", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request) =>
        Effect.succeed(makeHerdrSuccessResponse(request)),
      );
      const failure = yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* transport.request("server.stop", {}, { requestId: "" }).pipe(Effect.flip);
        }),
      );
      expect(failure._tag).toBe("HerdrInvalidInput");
      expect(server.requests).toHaveLength(0);
    }),
  ));

test.for(["request", "stream"] as const)(
  "%s deadline includes compatibility wait and closes abandoned ping",
  (kind, context) =>
    runTransportTest(
      context,
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer(() => Effect.void);
        yield* withTransport(
          server.socketPath,
          Effect.scoped(
            Effect.gen(function* () {
              const transport = yield* HerdrTransport;
              const options = { requestId: "deadline", requestTimeout: Duration.millis(30) };
              const failure = yield* (
                kind === "request"
                  ? transport.request("server.stop", {}, options)
                  : transport.openStream("pane.graphics.stream", { paneId: "pane-1" }, options)
              ).pipe(Effect.flip);
              expect(failure).toMatchObject({
                _tag: "HerdrRequestTimeout",
                requestId: "deadline",
                timeoutMilliseconds: 30,
              });
              expect(server.requests.map((request) => request.method)).toEqual(["ping"]);
              yield* server.waitFor("close");
              expect(server.openSocketCount()).toBe(0);
            }),
          ),
        );
      }),
    ),
);

test("peer disconnect during a graphics write is a typed failure, not an uncaught socket error", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request, socket) =>
        Effect.sync(() => {
          if (request.method === "pane.graphics.stream")
            socket.once("data", () => socket.destroy());
          return makeHerdrSuccessResponse(request);
        }),
      );
      const failure = yield* withTransport(
        server.socketPath,
        Effect.scoped(
          Effect.gen(function* () {
            const transport = yield* HerdrTransport;
            const stream = yield* transport.openStream("pane.graphics.stream", {
              paneId: "pane-1",
            });
            return yield* transport
              .writeStreamBytes(stream, new Uint8Array(8 * 1024 * 1024))
              .pipe(Effect.flip);
          }),
        ),
      );
      expect(failure).toMatchObject({
        _tag: "HerdrTransportError",
        operation: "graphics_write",
        reason: "write",
      });
    }),
  ));

test.for([
  { event: "workspace_closed", data: {}, tag: "HerdrInvalidResponse" },
  { event: "future_event", data: {}, tag: "HerdrUnsupportedEvent" },
  {
    event: "workspace_created",
    data: { type: "workspace_closed", workspace_id: "workspace-1" },
    tag: "HerdrInvalidResponse",
  },
])(
  "events.wait classifies malformed or unsupported event: $event / $tag",
  ({ event, data, tag }, context) =>
    runTransportTest(
      context,
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(
            request.method === "ping"
              ? makeHerdrSuccessResponse(request)
              : new HerdrRawTestResponse(
                  JSON.stringify({
                    id: request.id,
                    result: { type: "wait_matched", event: { event, data } },
                  }) + "\n",
                ),
          ),
        );
        const failure = yield* withTransport(
          server.socketPath,
          Effect.gen(function* () {
            const transport = yield* HerdrTransport;
            return yield* transport
              .request("events.wait", { matchEvent: { event: "workspace_created" } })
              .pipe(Effect.flip);
          }),
        );
        expect(failure._tag).toBe(tag);
      }),
    ),
);

test("one request timing out does not cancel another caller's shared compatibility check", (context) =>
  runTransportTest(
    context,
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const server = yield* startHerdrTestServer((request) =>
        request.method === "ping"
          ? Deferred.await(gate).pipe(Effect.as(makeHerdrSuccessResponse(request)))
          : Effect.succeed(makeHerdrSuccessResponse(request)),
      );
      const results = yield* withTransport(
        server.socketPath,
        Effect.gen(function* () {
          const transport = yield* HerdrTransport;
          return yield* Effect.all(
            [
              transport
                .request(
                  "server.stop",
                  {},
                  { requestId: "short", requestTimeout: Duration.millis(30) },
                )
                .pipe(
                  Effect.flip,
                  Effect.tap(() => Deferred.succeed(gate, undefined)),
                ),
              transport.request("server.stop", {}, { requestId: "long" }),
            ],
            { concurrency: "unbounded" },
          );
        }),
      );
      expect(results[0]).toMatchObject({ _tag: "HerdrRequestTimeout", requestId: "short" });
      expect(results[1]).toMatchObject({ requestId: "long", result: { type: "ok" } });
      expect(server.requests.filter((request) => request.method === "ping")).toHaveLength(1);
    }),
  ));

function withTransport<A, E, R>(
  socketPath: string,
  effect: Effect.Effect<A, E, R | HerdrTransport>,
) {
  return Effect.gen(function* () {
    const absolutePath = yield* parseHerdrAbsolutePath(socketPath);
    const supportedProtocol = yield* Schema.decodeUnknownEffect(HerdrProtocolVersion)(
      packageJson.herdr.protocol,
    );
    return yield* effect.pipe(
      Effect.provide(herdrTransportLayerWithoutDependencies),
      Effect.provideService(
        HerdrConfig,
        HerdrConfig.of({
          socketPath: absolutePath,
          session: Option.none(),
          requestTimeout: Duration.seconds(1),
          application: Option.none(),
          supportedProtocol,
        }),
      ),
    );
  });
}
