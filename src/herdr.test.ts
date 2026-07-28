import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vite-plus/test";
import Herdr, { HerdrError, type PaneId, type Workspace } from "./index.ts";

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(async (server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("workspace get uses the public namespace and translates camel case in both directions", async () => {
  const requests: unknown[] = [];
  const socketPath = await startRecordingHerdrServer(requests, (request) => {
    if (request.method === "ping") return { type: "pong", version: "0.8.0", protocol: 18 };
    return {
      type: "workspace_info",
      workspace: {
        workspace_id: "w1",
        number: 1,
        label: "api",
        focused: true,
        pane_count: 2,
        tab_count: 1,
        active_tab_id: "w1:t1",
        agent_status: "working",
        tokens: {},
      },
    };
  });
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });

  const workspace: Workspace = await herdr.workspaces.get(herdr.ids.workspace("w1"));

  expect(workspace.paneCount).toBe(2);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ method: "workspace.get", params: { workspace_id: "w1" } });
});

test("agent outputs retain pane targeting and receive public defaults", async () => {
  const socketPath = await startRecordingHerdrServer([], (request) => {
    if (request.method === "ping") return { type: "pong", version: "0.8.0", protocol: 18 };
    return {
      type: "agent_info",
      agent: {
        terminal_id: "term-1",
        agent_status: "idle",
        workspace_id: "w1",
        tab_id: "w1:t1",
        pane_id: "w1:p1",
        focused: false,
        revision: 3,
      },
    };
  });
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });

  const agent = await herdr.agents.get({ paneId: herdr.ids.pane("w1:p1") });

  expect(agent).toMatchObject({
    paneId: "w1:p1",
    status: "idle",
    launchPending: false,
    interactiveReady: false,
    screenDetectionSkipped: false,
    stateChangeSequence: 0,
  });
  expect(agent).not.toHaveProperty("id");
});

test("server wire errors become HerdrError without closing the open code space", async () => {
  const socketPath = await startRecordingHerdrServer([], (request) => {
    if (request.method === "ping") return { type: "pong", version: "0.8.0", protocol: 18 };
    return new WireFailure("new_server_code", "future failure");
  });
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });

  const failure = await herdr.panes.get(herdr.ids.pane("missing")).catch((cause: unknown) => cause);

  expect(failure).toBeInstanceOf(HerdrError);
  expect(failure).toMatchObject({ code: "new_server_code" });
});

test("invalid ratios and oversized graphics frames fail before socket I/O", async () => {
  const herdr = new Herdr({ socketPath: herdrPath(join(tmpdir(), "socket-that-does-not-exist")) });
  const paneId: PaneId = herdr.ids.pane("w1:p1");

  await expect(herdr.panes.split(paneId, { direction: "right", ratio: 1 })).rejects.toMatchObject({
    code: "invalid_argument",
  });
  await expect(
    herdr.panes.graphics.set(paneId, {
      format: "png",
      imageWidth: 1,
      imageHeight: 1,
      data: new Uint8Array(512 * 1024 + 1),
    }),
  ).rejects.toMatchObject({ code: "image_too_large" });
  await expect(
    herdr.panes.reportMetadata(paneId, { source: "test", ttlMs: 0 }),
  ).rejects.toMatchObject({ code: "invalid_argument" });
  await expect(
    herdr.agents.start({ name: herdr.ids.agentName("test"), kind: "pi", paneId, timeoutMs: 3_000 }),
  ).rejects.toMatchObject({ code: "invalid_argument" });
  expect(() => herdr.ids.absolutePath("relative/path")).toThrow(HerdrError);
});

test("event waits normalize lifecycle envelopes to dot-named public events", async () => {
  const requests: unknown[] = [];
  const socketPath = await startRecordingHerdrServer(requests, (request) => {
    if (request.method === "ping") return { type: "pong", version: "0.8.0", protocol: 18 };
    return {
      type: "wait_matched",
      event: {
        event: "pane_output_changed",
        data: { type: "pane_output_changed", pane_id: "w1:p1", workspace_id: "w1", revision: 7 },
      },
    };
  });
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });

  const event = await herdr.events.wait({
    type: "pane.output_changed",
    paneId: herdr.ids.pane("w1:p1"),
  });

  expect(event).toEqual({
    type: "pane.output_changed",
    paneId: "w1:p1",
    workspaceId: "w1",
    revision: 7,
  });
  expect(requests[1]).toMatchObject({
    method: "events.wait",
    params: { match_event: { event: "pane_output_changed", pane_id: "w1:p1" } },
  });
});

test("popup plugin panes accept wire ok and return void", async () => {
  const socketPath = await startRecordingHerdrServer([], (request) => {
    if (request.method === "ping") return { type: "pong", version: "0.8.0", protocol: 18 };
    return { type: "ok" };
  });
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });

  const result = await herdr.plugins.panes.open(herdr.ids.plugin("demo"), {
    entrypoint: "main",
    placement: "popup",
  });

  expect(result).toBeUndefined();
  await expect(
    herdr.plugins.panes.open(herdr.ids.plugin("demo"), {
      entrypoint: "main",
      placement: "overlay",
    }),
  ).rejects.toMatchObject({ code: "unsupported_result" });
});

test("unknown event discriminants fail with an identifying HerdrError", async () => {
  const socketPath = await startRecordingHerdrServer([], (request) => {
    if (request.method === "ping") return { type: "pong", version: "0.8.0", protocol: 18 };
    return {
      type: "wait_matched",
      event: { event: "pane_future_state", data: { type: "pane_future_state" } },
    };
  });
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });

  await expect(
    herdr.events.wait({ type: "pane.closed", paneId: herdr.ids.pane("w1:p1") }),
  ).rejects.toMatchObject({ code: "unsupported_event" });
});

test("abort signals close established event streams", async () => {
  const socketPath = await startRecordingHerdrServer([], (request) => {
    if (request.method === "ping") return { type: "pong", version: "0.8.0", protocol: 18 };
    return new WireStreamResult({ type: "subscription_started" });
  });
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });
  const controller = new AbortController();
  const stream = await herdr.events.subscribe([{ type: "workspace.created" }] as const, {
    signal: controller.signal,
  });

  const pendingEvent = stream[Symbol.asyncIterator]().next();
  controller.abort("test complete");

  await expect(pendingEvent).rejects.toMatchObject({ code: "aborted" });
  expect(stream.closed).toBe(true);
});

test("unsupported protocol is rejected before a resource request", async () => {
  const requests: unknown[] = [];
  const socketPath = await startRecordingHerdrServer(requests, () => ({
    type: "pong",
    version: "99.0.0",
    protocol: 99,
  }));
  const herdr = new Herdr({ socketPath: herdrPath(socketPath) });

  await expect(herdr.workspaces.list()).rejects.toMatchObject({ code: "unsupported_protocol" });
  expect(requests).toHaveLength(1);
});

class WireFailure {
  constructor(
    readonly code: string,
    readonly message: string,
  ) {}
}

class WireStreamResult {
  constructor(readonly result: Readonly<Record<string, unknown>>) {}
}

interface RecordedRequest {
  readonly id: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

async function startRecordingHerdrServer(
  requests: unknown[],
  respond: (
    request: RecordedRequest,
  ) => Readonly<Record<string, unknown>> | WireFailure | WireStreamResult,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "herdr-sdk-test-"));
  temporaryDirectories.push(directory);
  const socketPath = join(directory, "herdr.sock");
  const server = createServer((socket) => consumeRequest(socket, requests, respond));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

function consumeRequest(
  socket: Socket,
  requests: unknown[],
  respond: (
    request: RecordedRequest,
  ) => Readonly<Record<string, unknown>> | WireFailure | WireStreamResult,
): void {
  let input = "";
  socket.on("data", (chunk: Buffer) => {
    input += chunk.toString("utf8");
    const newline = input.indexOf("\n");
    if (newline < 0) return;
    // SAFETY: This faithful socket harness receives the SDK's known request contract.
    const request = JSON.parse(input.slice(0, newline)) as RecordedRequest;
    requests.push(request);
    const response = respond(request);
    if (response instanceof WireStreamResult) {
      socket.write(`${JSON.stringify({ id: request.id, result: response.result })}\n`);
      return;
    }
    socket.end(
      `${JSON.stringify(response instanceof WireFailure ? { id: request.id, error: response } : { id: request.id, result: response })}\n`,
    );
  });
}

function herdrPath(value: string): ReturnType<Herdr["ids"]["absolutePath"]> {
  // The temporary test socket path is absolute by construction; the public helper verifies it at runtime below.
  return new Herdr().ids.absolutePath(value);
}
