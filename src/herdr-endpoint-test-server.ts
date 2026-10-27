/**
 * Provides isolated binary endpoint fixtures without contacting a live Herdr session.
 * @since 0.9.0
 */
import { Buffer } from "node:buffer";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { NodeFileSystem, NodeStream } from "@effect/platform-node-shared";
import { Effect, FileSystem, Queue, Schema, Scope, Stream } from "effect";
import projectionFixture from "./fixtures/endpoint-snapshot-v1.json" with { type: "json" };
import { resolveHerdrSocketEndpoint } from "./herdr-transport.ts";

const FixtureRequest = Schema.Struct({
  id: Schema.String,
  method: Schema.String,
  params: Schema.Record(Schema.String, Schema.Json),
});
const parseRequest = Schema.decodeEffect(Schema.fromJsonString(FixtureRequest));
const methods = [
  "client_shell.surface.set",
  "command.invoke",
  "product_announcement.dismiss",
  "release_notes.dismiss",
];

/** Independent fixture implementation of bincode-standard unsigned integer encoding. @category testing @since 0.9.0 */
export function fixtureUnsigned(value: number): Buffer {
  if (value < 251) return Buffer.from([value]);
  if (value < 65536) {
    const bytes = Buffer.alloc(3);
    bytes[0] = 251;
    bytes.writeUInt16LE(value, 1);
    return bytes;
  }
  const bytes = Buffer.alloc(5);
  bytes[0] = 252;
  bytes.writeUInt32LE(value, 1);
  return bytes;
}
/** Encodes a fixture string using its UTF-8 byte count. @category testing @since 0.9.0 */
export function fixtureText(text: string): Buffer {
  const bytes = Buffer.from(text);
  return Buffer.concat([fixtureUnsigned(bytes.length), bytes]);
}
/** Encodes an independent server fixture frame. @category testing @since 0.9.0 */
export function fixtureFrame(parts: readonly Uint8Array[]): Buffer {
  const body = Buffer.concat(parts);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([size, body]);
}
/** Encodes a server named-control message. @category testing @since 0.9.0 */
export function fixtureControl(name: string, data: string): Buffer {
  return fixtureFrame([Buffer.from([20]), fixtureText(name), fixtureText(data)]);
}
/** Encodes a response chunk, independently of the production client codec. @category testing @since 0.9.0 */
export function fixtureResponse(
  requestId: string,
  data: string,
  finalChunk = true,
  bootId = "boot-v1",
): Buffer {
  const bytes = Buffer.from(data);
  return fixtureFrame([
    Buffer.from([18]),
    fixtureText(bootId),
    fixtureText(requestId),
    Buffer.from([finalChunk ? 1 : 0]),
    fixtureUnsigned(bytes.length),
    bytes,
  ]);
}
const fixtureCell = (symbol: string) =>
  Buffer.concat([fixtureText(symbol), Buffer.from([0, 0, 0, 0, 0])]);
/** One complete 1x1 surface in the exact v0.9.0 field order. @category testing @since 0.9.0 */
export function fixtureSurface(revision = 1, projectionRevision = 7): Buffer {
  return fixtureFrame([
    Buffer.from([13]),
    fixtureText("boot-v1"),
    fixtureUnsigned(projectionRevision),
    fixtureUnsigned(revision),
    Buffer.from([1]),
    fixtureCell("x"),
    Buffer.from([1, 1, 0, 0, 0]),
    Buffer.from([1]),
    fixtureText("w1:p1"),
    Buffer.from([2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 8, 16]),
    Buffer.from([0, 0, 0, 0, 0]),
  ]);
}
/** One incremental 1x1 row patch in the exact v0.9.0 field order. @category testing @since 0.9.0 */
export function fixturePatch(base = 1, revision = 2, x = 0): Buffer {
  return fixtureFrame([
    Buffer.from([19]),
    fixtureText("boot-v1"),
    Buffer.from([7]),
    fixtureUnsigned(base),
    fixtureUnsigned(revision),
    Buffer.from([1, x, 0, 1]),
    fixtureCell("y"),
    Buffer.from([0, 0]),
  ]);
}

function decodeFixtureStrings(bytes: Buffer, count: number): readonly string[] {
  let offset = 1;
  const strings: string[] = [];
  for (let index = 0; index < count; index++) {
    const tag = bytes.readUInt8(offset++);
    const length =
      tag === 251 ? bytes.readUInt16LE(offset) : tag === 252 ? bytes.readUInt32LE(offset) : tag;
    if (tag === 251) offset += 2;
    if (tag === 252) offset += 4;
    if (offset + length > bytes.length) throw new Error("Truncated endpoint fixture request");
    strings.push(bytes.subarray(offset, offset + length).toString());
    offset += length;
  }
  return strings;
}

/** Starts an isolated endpoint fixture; socket callbacks enter Effect once through a connection queue. @category testing @since 0.9.0 */
export const startEndpointTestServer = (
  options: {
    readonly response?: (
      request: typeof FixtureRequest.Type,
    ) => Effect.Effect<readonly Uint8Array[]>;
    readonly health?: boolean;
    readonly snapshot?: typeof projectionFixture;
    readonly fragmented?: boolean;
    readonly advertisedMethods?: readonly string[];
    /** Completed-work sequences by pane sent, like Herdr 0.9.5, before the seed snapshot. */
    readonly completions?: { readonly [paneId: string]: number };
    /** Raw `view` JSON for an `endpoint.agent-view.v1` companion sent before the seed snapshot; omitted sends none. */
    readonly agentView?: typeof Schema.Json.Type;
  } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "he-" });
    const socketPath = join(directory, "herdr-client.sock");
    const connections = yield* Queue.make<Socket>();
    const requests = yield* Queue.make<typeof FixtureRequest.Type>();
    const controls = yield* Queue.make<string>();
    const closed = yield* Queue.make<void>();
    const inputs = yield* Queue.make<Uint8Array>();
    const sockets = new Set<Socket>();
    const scope = yield* Scope.Scope;
    const write = (socket: Socket, bytes: Uint8Array) =>
      Effect.callback<void>((resume) => {
        socket.write(bytes, () => resume(Effect.void));
      });
    const send = (socket: Socket, bytes: Uint8Array) =>
      options.fragmented
        ? Effect.gen(function* () {
            for (let offset = 0; offset < bytes.length; offset += 3)
              yield* write(socket, bytes.subarray(offset, offset + 3));
          })
        : write(socket, bytes);
    const serve = (socket: Socket) =>
      Effect.gen(function* () {
        let buffer = Buffer.alloc(0);
        yield* NodeStream.fromReadable<Uint8Array, Error>({
          evaluate: () => socket,
          onError: () => new Error("Endpoint fixture read failed"),
        }).pipe(
          Stream.runForEach((chunk) =>
            Effect.gen(function* () {
              buffer = Buffer.concat([buffer, chunk]);
              if (buffer.length > 2 * 1024 * 1024)
                return yield* Effect.die(new Error("Endpoint fixture buffer exceeded limit"));
              while (buffer.length >= 4) {
                const length = buffer.readUInt32LE();
                if (buffer.length < 4 + length) return;
                const payload = buffer.subarray(4, 4 + length);
                buffer = buffer.subarray(4 + length);
                if (payload[0] === 20) {
                  const [kind] = decodeFixtureStrings(payload, 2);
                  if (kind === undefined)
                    return yield* Effect.die(new Error("Missing fixture control kind"));
                  yield* Queue.offer(controls, kind);
                  if (kind === "endpoint.hello.v1") {
                    yield* send(
                      socket,
                      fixtureControl(
                        "endpoint.welcome.v1",
                        JSON.stringify({
                          generation: 1,
                          server_version: "0.9.5",
                          snapshot_codec: "shell.snapshot.v1",
                          surface_codec: "shell.surface.v1",
                          input_codec: "shell.input.semantic.v1",
                          blob_codec: "shell.blob.v1",
                          methods: options.advertisedMethods ?? methods,
                          capabilities: [
                            "surface_reuse",
                            "surface_delta",
                            "surface_scroll",
                            "surface_interest",
                            "presentation_effects_fence",
                            "health_check",
                            "agent_view_projection",
                            "agent_completions",
                          ],
                        }),
                      ),
                    );
                    const seed = options.snapshot ?? projectionFixture;
                    if (options.agentView !== undefined)
                      yield* send(
                        socket,
                        fixtureControl(
                          "endpoint.agent-view.v1",
                          JSON.stringify({
                            boot_id: seed.boot_id,
                            revision: seed.revision,
                            view: options.agentView,
                          }),
                        ),
                      );
                    yield* send(
                      socket,
                      fixtureControl(
                        "endpoint.agent-completions.v1",
                        JSON.stringify({
                          boot_id: seed.boot_id,
                          revision: seed.revision,
                          completions: options.completions ?? {},
                        }),
                      ),
                    );
                    yield* send(socket, fixtureControl("shell.snapshot.v1", JSON.stringify(seed)));
                  } else if (kind === "endpoint.health.ping.v1" && options.health !== false)
                    yield* send(socket, fixtureControl("endpoint.health.pong.v1", "{}"));
                } else if (payload[0] === 15) {
                  const [, json] = decodeFixtureStrings(payload, 2);
                  if (json === undefined)
                    return yield* Effect.die(new Error("Missing fixture request JSON"));
                  const request = yield* parseRequest(json).pipe(Effect.orDie);
                  yield* Queue.offer(requests, request);
                  const response =
                    options.response === undefined
                      ? [
                          fixtureResponse(
                            request.id,
                            JSON.stringify({
                              id: request.id,
                              result:
                                request.method === "client_shell.surface.set"
                                  ? {
                                      type: "client_shell_surface_set",
                                      active: request.params.active,
                                      projection_revision: 7,
                                    }
                                  : { type: "ok" },
                            }),
                          ),
                          ...(request.method === "client_shell.surface.set" && request.params.active
                            ? [fixtureSurface()]
                            : []),
                        ]
                      : yield* options.response(request);
                  for (const bytes of response) yield* send(socket, bytes);
                } else yield* Queue.offer(inputs, new Uint8Array(payload));
              }
            }),
          ),
          Effect.catch(() => Effect.void),
        );
      });
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createServer((socket) => {
          sockets.add(socket);
          socket.on("error", () => {});
          socket.once("close", () => {
            sockets.delete(socket);
            Queue.offerUnsafe(closed, undefined);
          });
          Queue.offerUnsafe(connections, socket);
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          for (const socket of sockets) socket.destroy();
          if (server.listening)
            yield* Effect.callback<void>((resume) => {
              server.close(() => resume(Effect.void));
            });
        }),
    );
    yield* Effect.callback<void, Error>((resume) => {
      server.once("error", (error) => resume(Effect.fail(error)));
      server.listen(resolveHerdrSocketEndpoint(socketPath), () => resume(Effect.void));
    });
    yield* Stream.fromQueue(connections).pipe(
      Stream.runForEach((socket) => serve(socket).pipe(Effect.forkIn(scope))),
      Effect.forkIn(scope),
    );
    return {
      socketPath,
      requests,
      controls,
      closed,
      inputs,
      send: (bytes: Uint8Array) =>
        Effect.forEach([...sockets], (socket) => send(socket, bytes), { discard: true }),
    };
  }).pipe(Effect.provide(NodeFileSystem.layer));
