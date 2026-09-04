import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duration, Effect, Fiber, Option, Schema } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import { HerdrConfig, type IHerdrConfig } from "./herdr-config.ts";
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

const servers: Server[] = [];
const temporaryDirectories: string[] = [];
const openSockets = new Set<Socket>();
const RecordedRequest = Schema.Struct({
  id: Schema.String,
  method: Schema.String,
  params: Schema.Record(Schema.String, Schema.Unknown),
});
const parseRecordedRequest = Schema.decodeUnknownOption(RecordedRequest);

afterEach(async () => {
  for (const socket of openSockets) socket.destroy();
  await Promise.all(
    servers.splice(0).map(async (server) => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("Windows filesystem-shaped Herdr socket paths resolve to named-pipe endpoints", () => {
  expect(resolveHerdrSocketEndpoint("C:\\Users\\dev\\herdr\\herdr.sock", "win32")).toBe(
    "\\\\.\\pipe\\C:\\Users\\dev\\herdr\\herdr.sock",
  );
  expect(resolveHerdrSocketEndpoint("\\\\.\\pipe\\custom-herdr", "win32")).toBe(
    "\\\\.\\pipe\\custom-herdr",
  );
  expect(resolveHerdrSocketEndpoint("/tmp/herdr.sock", "darwin")).toBe("/tmp/herdr.sock");
});

test("transport classifies malformed, oversized, server, timeout, and protocol failures", async () => {
  const malformedPath = await startHerdrServer([], () => new RawTestReply("{oops\n"));
  const malformed = await runWithTransport(
    malformedPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "malformed" });
    }).pipe(Effect.flip),
  );
  expect(malformed).toMatchObject({
    _tag: "HerdrInvalidResponse",
    reason: "malformed_json",
    requestId: "malformed",
  });

  const oversizedPath = await startHerdrServer(
    [],
    () => new RawTestReply(`${"x".repeat(1024 * 1024 + 1)}\n`),
  );
  const oversized = await runWithTransport(
    oversizedPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "oversized" });
    }).pipe(Effect.flip),
  );
  expect(oversized).toMatchObject({
    _tag: "HerdrInvalidResponse",
    reason: "oversized_frame",
    requestId: "oversized",
  });

  const serverErrorPath = await startHerdrServer([], (request) =>
    request.method === "ping"
      ? { id: request.id, result: { type: "pong", version: "0.8.2", protocol: 21 } }
      : { id: request.id, error: { code: "fixture_rejected", message: "no" } },
  );
  const serverFailure = await runWithTransport(
    serverErrorPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("server.stop", {}, { requestId: "server-error" });
    }).pipe(Effect.flip),
  );
  expect(serverFailure).toBeInstanceOf(HerdrServerError);
  expect(serverFailure).toMatchObject({
    serverCode: "fixture_rejected",
    serverMessage: "no",
    requestId: "server-error",
  });

  const timeoutPath = await startHerdrServer([], () => new SilentTestReply());
  const timeout = await runWithTransport(
    timeoutPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request(
        "ping",
        {},
        {
          requestId: "timeout",
          requestTimeout: Duration.millis(10),
        },
      );
    }).pipe(Effect.flip),
  );
  expect(timeout).toBeInstanceOf(HerdrRequestTimeout);
  expect(timeout).toMatchObject({ requestId: "timeout", timeoutMilliseconds: 10 });

  const protocol17Path = await startHerdrServer([], (request) => ({
    id: request.id,
    result: { type: "pong", version: "0.7.5", protocol: 17 },
  }));
  const protocol17 = await runWithTransport(
    protocol17Path,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "protocol-17" });
    }),
  );
  expect(protocol17.result).toMatchObject({ type: "pong", protocol: 17 });

  const protocol18Path = await startHerdrServer([], (request) => ({
    id: request.id,
    result: { type: "pong", version: "0.7.5-preview", protocol: 18 },
  }));
  const protocol18 = await runWithTransport(
    protocol18Path,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "protocol-18" });
    }),
  );
  expect(protocol18.result).toMatchObject({ type: "pong", protocol: 18 });

  const protocol19Path = await startHerdrServer([], (request) => ({
    id: request.id,
    result: { type: "pong", version: "0.8.0", protocol: 19 },
  }));
  const protocol19 = await runWithTransport(
    protocol19Path,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "protocol-19" });
    }),
  );
  expect(protocol19.result).toMatchObject({ type: "pong", protocol: 19 });

  const protocol20Path = await startHerdrServer([], (request) => ({
    id: request.id,
    result: { type: "pong", version: "0.8.2", protocol: 20 },
  }));
  const protocol20 = await runWithTransport(
    protocol20Path,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "protocol-20" });
    }),
  );
  expect(protocol20.result).toMatchObject({ type: "pong", protocol: 20 });

  const protocolPath = await startHerdrServer([], (request) => ({
    id: request.id,
    result: { type: "pong", version: "future", protocol: 22 },
  }));
  const protocol = await runWithTransport(
    protocolPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "protocol" });
    }).pipe(Effect.flip),
  );
  expect(protocol).toBeInstanceOf(HerdrUnsupportedProtocol);
  expect(protocol).toMatchObject({ actualProtocol: 22, supportedProtocols: [17, 18, 19, 20, 21] });

  const partialPath = await startHerdrServer(
    [],
    () => new RawTestReply('{"id":"partial","result":{"type":"pong"}}'),
  );
  const partial = await runWithTransport(
    partialPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "partial" });
    }).pipe(Effect.flip),
  );
  expect(partial).toBeInstanceOf(HerdrTransportError);
  expect(partial).toMatchObject({ reason: "premature_close", requestId: "partial" });
});

test("transport classifies a missing Unix socket as a connection failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-effect-missing-socket-test-"));
  temporaryDirectories.push(directory);
  const socketPath = join(directory, "missing.sock");

  const failure = await runWithTransport(
    socketPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("ping", {}, { requestId: "missing-socket" });
    }).pipe(Effect.flip),
  );

  expect(failure).toBeInstanceOf(HerdrTransportError);
  expect(failure).toMatchObject({
    operation: "compatibility_check",
    reason: "connect",
    requestId: "missing-socket",
  });
});

test("transport interruption closes an established socket", async () => {
  const socketPath = await startHerdrServer([], () => new SilentTestReply());

  await runWithTransport(
    socketPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      const fiber = yield* transport
        .request("ping", {}, { requestId: "interrupted" })
        .pipe(Effect.forkChild);
      yield* Effect.sleep(Duration.millis(10));
      yield* Fiber.interrupt(fiber);
    }),
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  expect(openSockets.size).toBe(0);
});

test("transport correlates responses, converts request keys, and memoizes compatibility", async () => {
  const requests: RecordedRequest[] = [];
  const socketPath = await startHerdrServer(requests, (request) => {
    if (request.method === "ping") {
      return { id: request.id, result: { type: "pong", version: "0.8.2", protocol: 21 } };
    }
    return {
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
    };
  });

  const results = await runWithTransport(
    socketPath,
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
  expect(requests.filter((request) => request.method === "ping")).toHaveLength(1);
  expect(requests[1]).toMatchObject({
    id: "request-1",
    method: "workspace.get",
    params: { workspace_id: "workspace-1" },
  });
});

test("transport rejects a response whose correlation identifier does not match", async () => {
  const socketPath = await startHerdrServer([], (request) => {
    if (request.method === "ping") {
      return { id: request.id, result: { type: "pong", version: "0.8.2", protocol: 21 } };
    }
    return { id: "different-request", result: { type: "ok" } };
  });

  const failure = await runWithTransport(
    socketPath,
    Effect.gen(function* () {
      const transport = yield* HerdrTransport;
      return yield* transport.request("server.stop", {}, { requestId: "request-3" });
    }).pipe(Effect.flip),
  );

  expect(failure).toBeInstanceOf(HerdrInvalidResponse);
  expect(failure).toMatchObject({ reason: "correlation_mismatch", requestId: "request-3" });
});

interface RecordedRequest extends Schema.Schema.Type<typeof RecordedRequest> {}

interface HerdrTestReplyObject {
  readonly [key: string]: HerdrTestReplyValue;
}

type HerdrTestReplyValue =
  | string
  | number
  | boolean
  | null
  | readonly HerdrTestReplyValue[]
  | HerdrTestReplyObject;

function runWithTransport<A, E>(
  socketPath: string,
  effect: Effect.Effect<A, E, HerdrTransport>,
): Promise<A> {
  const config: IHerdrConfig = {
    socketPath: Effect.runSync(parseHerdrAbsolutePath(socketPath)),
    session: Option.none(),
    requestTimeout: Duration.seconds(1),
    application: Option.none(),
    supportedProtocols: [17, 18, 19, 20, 21],
  };
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(herdrTransportLayerWithoutDependencies),
      Effect.provideService(HerdrConfig, HerdrConfig.of(config)),
    ),
  );
}

async function startHerdrServer(
  requests: RecordedRequest[],
  respond: (request: RecordedRequest) => HerdrTestReply,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "herdr-effect-transport-test-"));
  temporaryDirectories.push(directory);
  const socketPath = join(directory, "herdr.sock");
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
    socket.once("end", () => socket.end());
    consumeRequest(socket, requests, respond);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

function consumeRequest(
  socket: Socket,
  requests: RecordedRequest[],
  respond: (request: RecordedRequest) => HerdrTestReply,
): void {
  let input = "";
  socket.on("data", (chunk: Buffer) => {
    input += chunk.toString("utf8");
    const newline = input.indexOf("\n");
    if (newline < 0) return;
    const parsed = parseRecordedRequest(JSON.parse(input.slice(0, newline)));
    if (Option.isNone(parsed)) return socket.destroy(new Error("invalid test request"));
    requests.push(parsed.value);
    const response = respond(parsed.value);
    if (response instanceof SilentTestReply) return;
    socket.end(response instanceof RawTestReply ? response.value : `${JSON.stringify(response)}\n`);
  });
}

type HerdrTestReply = HerdrTestReplyObject | RawTestReply | SilentTestReply;

class RawTestReply {
  constructor(readonly value: string) {}
}

class SilentTestReply {}
