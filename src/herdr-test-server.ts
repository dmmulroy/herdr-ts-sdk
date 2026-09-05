import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Ajv2020 } from "ajv/dist/2020.js";
import herdrApiSchema from "../schema/herdr-api.schema.json" with { type: "json" };
import type { ErrorResponse } from "./generated/wire-error-response.ts";
import type { Request } from "./generated/wire-request.ts";
import type { SuccessResponse } from "./generated/wire-success-response.ts";

const schemaId = "https://herdr.dev/herdr-api.schema.json";
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
});
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

/** Typed or deliberately malformed response emitted by the Unix-socket test server. */
export type HerdrTestResponse = SuccessResponse | ErrorResponse;

/** Raw bytes deliberately bypassing response validation in negative transport tests. */
export class HerdrRawTestResponse {
  constructor(readonly value: string) {}
}

/** Running Unix-socket fixture with observed requests and deterministic cleanup. */
export interface HerdrTestServer {
  /** Filesystem path accepted by Herdr configuration. */
  readonly socketPath: string;
  /** Schema-parsed wire requests received in order. */
  readonly requests: HerdrTestRequest[];
  /** Number of accepted sockets still open. */
  readonly openSocketCount: () => number;
  /** Wire methods currently owning accepted sockets, for lifecycle assertions. */
  readonly openSocketMethods: () => readonly string[];
  /** Stops the server, destroys sockets, and removes its temporary directory. */
  readonly close: () => Promise<void>;
}

/** Starts a real local Herdr-compatible NDJSON socket fixture. */
export async function startHerdrTestServer(
  respond: (request: HerdrTestRequest, socket: Socket) => HerdrTestResponse | HerdrRawTestResponse,
): Promise<HerdrTestServer> {
  const directory = await mkdtemp(join(tmpdir(), "herdr-effect-sdk-test-"));
  const socketPath = join(directory, "herdr.sock");
  const requests: HerdrTestRequest[] = [];
  const sockets = new Set<Socket>();
  const socketMethods = new Map<Socket, string>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      socketMethods.delete(socket);
    });
    consumeRequest(socket, requests, socketMethods, respond);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  return {
    socketPath,
    requests,
    openSocketCount: () => sockets.size,
    openSocketMethods: () => [...socketMethods.values()],
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
      await rm(directory, { force: true, recursive: true });
    },
  };
}

function consumeRequest(
  socket: Socket,
  requests: HerdrTestRequest[],
  socketMethods: Map<Socket, string>,
  respond: (request: HerdrTestRequest, socket: Socket) => HerdrTestResponse | HerdrRawTestResponse,
): void {
  let input = "";
  const decoder = new StringDecoder("utf8");
  const onData = (chunk: Buffer): void => {
    input += decoder.write(chunk);
    const newline = input.indexOf("\n");
    if (newline < 0) return;
    // One request owns each socket; subsequent bytes belong to the graphics protocol.
    socket.off("data", onData);
    const parsed: unknown = JSON.parse(input.slice(0, newline));
    if (!requestParser(parsed) && !graphicsStreamRequestParser(parsed)) {
      socket.destroy(new Error("Test received a request outside the Herdr wire schema"));
      return;
    }
    requests.push(parsed);
    socketMethods.set(socket, parsed.method);
    const response = respond(parsed, socket);
    socket.write(
      response instanceof HerdrRawTestResponse ? response.value : `${JSON.stringify(response)}\n`,
    );
  };
  socket.on("data", onData);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((cause) => {
      if (cause === undefined) resolve();
      else reject(cause);
    });
  });
}
