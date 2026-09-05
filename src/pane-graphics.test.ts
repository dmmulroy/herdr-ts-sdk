import { Deferred, Duration, Effect, Exit, Fiber, Option, Schema, Scope } from "effect";
import { expect, test } from "vite-plus/test";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import {
  HerdrGraphicsStreamClosed,
  HerdrImageTooLarge,
  HerdrInvalidFrame,
  HerdrInvalidInput,
  HerdrInvalidResponse,
  HerdrRequestTimeout,
  HerdrServerError,
} from "./herdr-errors.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

const GraphicsStreamHeader = Schema.Struct({
  data_length: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
const parseGraphicsStreamHeader = Schema.decodeUnknownOption(GraphicsStreamHeader);

test("graphics frames enforce mode-specific limits before socket writes", async () => {
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "pane.graphics.stream") socket.removeAllListeners("data");
    return makeHerdrSuccessResponse(request);
  });

  try {
    const failures = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const paneId = herdr.ids.pane("pane-1");
        const empty = yield* herdr.panes.graphics
          .set(paneId, {
            format: "png",
            imageWidth: 1,
            imageHeight: 1,
            data: new Uint8Array(),
          })
          .pipe(Effect.flip);
        const oneShot = yield* herdr.panes.graphics
          .set(paneId, {
            format: "png",
            imageWidth: 1,
            imageHeight: 1,
            data: new Uint8Array(512 * 1024 + 1),
          })
          .pipe(Effect.flip);
        const stream = yield* Effect.scoped(
          Effect.gen(function* () {
            const writer = yield* herdr.panes.graphics.openStream(paneId);
            return yield* writer
              .write({
                format: "png",
                imageWidth: 1,
                imageHeight: 1,
                data: new Uint8Array(16 * 1024 * 1024 + 1),
              })
              .pipe(Effect.flip);
          }),
        );
        return { empty, oneShot, stream };
      }),
    );

    expect(failures.empty).toBeInstanceOf(HerdrInvalidFrame);
    expect(failures.oneShot).toBeInstanceOf(HerdrImageTooLarge);
    expect(failures.stream).toBeInstanceOf(HerdrImageTooLarge);
    expect(
      server.requests.filter((request) => request.method === "pane.graphics.set"),
    ).toHaveLength(0);
  } finally {
    await server.close();
  }
});

test("graphics writers write in scope, finalize, and reject escaped use", async () => {
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "pane.graphics.stream") socket.removeAllListeners("data");
    return makeHerdrSuccessResponse(request);
  });

  try {
    const failure = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const paneId = herdr.ids.pane("pane-1");
        const writer = yield* Effect.scoped(
          Effect.gen(function* () {
            const acquired = yield* herdr.panes.graphics.openStream(paneId);
            yield* acquired.write({
              format: "png",
              imageWidth: 1,
              imageHeight: 1,
              data: Uint8Array.of(1),
            });
            return acquired;
          }),
        );
        return yield* writer
          .write({
            format: "png",
            imageWidth: 1,
            imageHeight: 1,
            data: Uint8Array.of(1),
          })
          .pipe(Effect.flip);
      }),
    );

    expect(failure).toBeInstanceOf(HerdrGraphicsStreamClosed);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(server.openSocketMethods()).toEqual([]);
  } finally {
    await server.close();
  }
});

test("timing out a backpressured graphics write closes its stream socket", async () => {
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "pane.graphics.stream") socket.removeAllListeners("data");
    return makeHerdrSuccessResponse(request);
  });

  try {
    const result = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const paneId = herdr.ids.pane("pane-1");
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const writer = yield* herdr.panes.graphics.openStream(paneId);
            const failure = yield* writer
              .write(
                {
                  format: "png",
                  imageWidth: 1,
                  imageHeight: 1,
                  data: new Uint8Array(16 * 1024 * 1024),
                },
                { requestTimeout: Duration.millis(1) },
              )
              .pipe(Effect.flip);
            const afterTimeout = yield* writer
              .write({
                format: "png",
                imageWidth: 1,
                imageHeight: 1,
                data: Uint8Array.of(1),
              })
              .pipe(Effect.flip);
            yield* Effect.sleep(Duration.millis(10));
            return { failure, afterTimeout, openMethods: server.openSocketMethods() };
          }),
        );
      }),
    );

    expect(result.failure).toBeInstanceOf(HerdrRequestTimeout);
    expect(result.afterTimeout).toBeInstanceOf(HerdrGraphicsStreamClosed);
    expect(result.openMethods).toEqual([]);
  } finally {
    await server.close();
  }
});

test("concurrent graphics writes remain complete wire frames", async () => {
  const receivedPayloads: Uint8Array[] = [];
  let resolveFramesReceived: (() => void) | undefined;
  const framesReceived = new Promise<void>((resolve) => {
    resolveFramesReceived = resolve;
  });
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "pane.graphics.stream") {
      socket.removeAllListeners("data");
      let buffered = Buffer.alloc(0);
      let expectedPayloadBytes: number | undefined;
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        while (true) {
          if (expectedPayloadBytes === undefined) {
            const newline = buffered.indexOf(10);
            if (newline < 0) return;
            const header = parseGraphicsStreamHeader(
              JSON.parse(buffered.subarray(0, newline).toString("utf8")),
            );
            if (Option.isNone(header)) {
              socket.destroy(new Error("Test received an invalid graphics stream header"));
              return;
            }
            expectedPayloadBytes = header.value.data_length;
            buffered = buffered.subarray(newline + 1);
          }
          if (buffered.length < expectedPayloadBytes) return;
          receivedPayloads.push(buffered.subarray(0, expectedPayloadBytes));
          buffered = buffered.subarray(expectedPayloadBytes);
          expectedPayloadBytes = undefined;
          if (receivedPayloads.length === 2) resolveFramesReceived?.();
        }
      });
    }
    return makeHerdrSuccessResponse(request);
  });

  try {
    await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const paneId = herdr.ids.pane("pane-1");
        yield* Effect.scoped(
          Effect.gen(function* () {
            const writer = yield* herdr.panes.graphics.openStream(paneId);
            yield* Effect.all(
              [
                writer.write({
                  format: "png",
                  imageWidth: 1,
                  imageHeight: 1,
                  data: new Uint8Array(64 * 1024).fill(1),
                }),
                writer.write({
                  format: "png",
                  imageWidth: 1,
                  imageHeight: 1,
                  data: new Uint8Array(64 * 1024).fill(2),
                }),
              ],
              { concurrency: "unbounded" },
            );
            yield* Effect.promise(() => framesReceived).pipe(Effect.timeout("1 second"));
          }),
        );
      }),
    );

    expect(receivedPayloads.map((payload) => payload.length)).toEqual([64 * 1024, 64 * 1024]);
    const firstPayloadBytes = receivedPayloads
      .map((payload) => payload.at(0))
      .filter((value) => value !== undefined)
      .sort((left, right) => left - right);
    expect(firstPayloadBytes).toEqual([1, 2]);
  } finally {
    await server.close();
  }
});

test("graphics capabilities, layers, BGRA, and direct-file acknowledgements cross the socket", async () => {
  const observedFileHeaders: unknown[] = [];
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "pane.graphics.info") {
      return {
        id: request.id,
        result: {
          type: "pane_graphics_info",
          cell_width_px: 9,
          cell_height_px: 18,
          pane_visible: true,
          file_frame_directory: "/tmp/herdr-graphics",
          file_frame_formats: ["rgba", "bgra"],
          file_frame_max_bytes: 4096,
          file_frame_direct_max_bytes: 2048,
          file_frame_damage: true,
          max_layers_per_pane: 16,
          pixel_mouse: true,
          file_frame_transport: "direct-kitty",
        },
      };
    }
    if (request.method === "pane.graphics.stream") {
      socket.removeAllListeners("data");
      let buffered = "";
      socket.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        const newline = buffered.indexOf("\n");
        if (newline < 0) return;
        const header = JSON.parse(buffered.slice(0, newline)) as {
          readonly sequence: number;
          readonly revision: number;
        };
        observedFileHeaders.push(header);
        const acknowledgement = JSON.stringify({
          id: `${request.id}:file:${header.sequence}`,
          result: {
            type: "pane_graphics_frame_ack",
            sequence: header.sequence,
            revision: header.revision,
          },
        });
        const midpoint = Math.floor(acknowledgement.length / 2);
        socket.write(acknowledgement.slice(0, midpoint));
        socket.write(acknowledgement.slice(midpoint) + "\n");
      });
    }
    return makeHerdrSuccessResponse(request);
  });

  try {
    const result = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const paneId = herdr.ids.pane("pane-1");
        const info = yield* herdr.panes.graphics.info(paneId);
        yield* herdr.panes.graphics.set(paneId, {
          format: "bgra",
          imageWidth: 1,
          imageHeight: 1,
          data: Uint8Array.of(0, 0, 0, 255),
          layerId: "overlay",
          zIndex: 7,
        });
        yield* herdr.panes.graphics.clearLayer(paneId, { layerId: "overlay" });
        const acknowledgement = yield* Effect.scoped(
          Effect.gen(function* () {
            const writer = yield* herdr.panes.graphics.openLayerStream(paneId, {
              layerId: "overlay",
              zIndex: 7,
            });
            return yield* writer.writeFile({
              format: "bgra",
              imageWidth: 1,
              imageHeight: 1,
              filePath: herdr.ids.absolutePath("/tmp/herdr-graphics/frame.bgra"),
              sequence: 4,
              revision: 9,
              placement: { viewportCol: 2 },
            });
          }),
        );
        return { info, acknowledgement };
      }),
    );

    expect(result.info).toMatchObject({
      paneVisible: true,
      fileFrameFormats: ["rgba", "bgra"],
      fileFrameDamage: true,
      maxLayersPerPane: 16,
      pixelMouse: true,
    });
    expect(Option.getOrUndefined(result.info.fileFrameTransport)).toBe("direct-kitty");
    expect(result.acknowledgement).toEqual({ sequence: 4, revision: 9 });
    expect(server.requests.find((request) => request.method === "pane.graphics.set")).toMatchObject(
      {
        params: { format: "bgra", layer_id: "overlay", z_index: 7 },
      },
    );
    expect(
      server.requests.find((request) => request.method === "pane.graphics.clear"),
    ).toMatchObject({ params: { layer_id: "overlay" } });
    expect(
      server.requests.find((request) => request.method === "pane.graphics.stream"),
    ).toMatchObject({ params: { layer_id: "overlay", z_index: 7 } });
    expect(observedFileHeaders).toEqual([
      {
        format: "bgra",
        image_width: 1,
        image_height: 1,
        file: { path: "/tmp/herdr-graphics/frame.bgra" },
        sequence: 4,
        revision: 9,
        placement: { viewport_col: 2 },
      },
    ]);
  } finally {
    await server.close();
  }
});

test("graphics writers retain post-handshake server errors for the next write", async () => {
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "pane.graphics.stream") {
      socket.removeAllListeners("data");
      setTimeout(() => {
        socket.write(
          JSON.stringify({
            id: request.id,
            error: { code: "invalid_graphics_frame", message: "bad frame" },
          }) + "\n",
        );
      }, 5);
    }
    return makeHerdrSuccessResponse(request);
  });

  try {
    const failure = await runWithSdk(
      server.socketPath,
      Effect.scoped(
        Effect.gen(function* () {
          const herdr = yield* HerdrSdk;
          const writer = yield* herdr.panes.graphics.openStream(herdr.ids.pane("pane-1"));
          yield* Effect.sleep(Duration.millis(20));
          return yield* writer
            .write({
              format: "png",
              imageWidth: 1,
              imageHeight: 1,
              data: Uint8Array.of(1),
            })
            .pipe(Effect.flip);
        }),
      ),
    );

    expect(failure).toBeInstanceOf(HerdrServerError);
    expect(failure).toMatchObject({
      serverCode: "invalid_graphics_frame",
      serverMessage: "bad frame",
    });
  } finally {
    await server.close();
  }
});

test.each(["write", "writeFile"] as const)(
  "invalid %s options do not invalidate a graphics writer",
  async (operation) => {
    const server = await startHerdrTestServer((request, socket) => {
      if (request.method === "pane.graphics.stream") socket.removeAllListeners("data");
      return makeHerdrSuccessResponse(request);
    });
    try {
      const failure = await runWithSdk(
        server.socketPath,
        Effect.scoped(
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const writer = yield* herdr.panes.graphics.openStream(herdr.ids.pane("pane-1"));
            const options = { requestTimeout: Duration.millis(-1) };
            const invalidWrite =
              operation === "write"
                ? writer.write(
                    { format: "png", imageWidth: 1, imageHeight: 1, data: Uint8Array.of(1) },
                    options,
                  )
                : writer.writeFile(
                    {
                      format: "rgba",
                      imageWidth: 1,
                      imageHeight: 1,
                      filePath: herdr.ids.absolutePath("/tmp/frame.rgba"),
                      sequence: 1,
                      revision: 1,
                    },
                    options,
                  );
            const failure = yield* invalidWrite.pipe(Effect.flip);
            yield* writer.write({
              format: "png",
              imageWidth: 1,
              imageHeight: 1,
              data: Uint8Array.of(1),
            });
            return failure;
          }),
        ),
      );
      expect(failure).toBeInstanceOf(HerdrInvalidInput);
    } finally {
      await server.close();
    }
  },
);

test.each(["interruption", "scope closure"] as const)(
  "%s during a direct-file acknowledgement wait closes and invalidates the writer",
  async (termination) => {
    const frameReceived = Effect.runSync(Deferred.make<void>());
    const socketClosed = Effect.runSync(Deferred.make<void>());
    const server = await startHerdrTestServer((request, socket) => {
      if (request.method === "pane.graphics.stream") {
        socket.removeAllListeners("data");
        let buffered = "";
        socket.on("data", (chunk: Buffer) => {
          buffered += chunk.toString("utf8");
          if (buffered.includes("\n")) Effect.runSync(Deferred.succeed(frameReceived, undefined));
        });
        socket.once("close", () => Effect.runSync(Deferred.succeed(socketClosed, undefined)));
      }
      return makeHerdrSuccessResponse(request);
    });
    try {
      const failure = await runWithSdk(
        server.socketPath,
        Effect.scoped(
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const writerScope = yield* Scope.fork(yield* Scope.Scope);
            const writer = yield* herdr.panes.graphics
              .openStream(herdr.ids.pane("pane-1"))
              .pipe(Scope.provide(writerScope));
            const pending = yield* writer
              .writeFile({
                format: "rgba",
                imageWidth: 1,
                imageHeight: 1,
                filePath: herdr.ids.absolutePath("/tmp/frame.rgba"),
                sequence: 1,
                revision: 1,
              })
              .pipe(Effect.forkScoped);
            yield* Deferred.await(frameReceived).pipe(Effect.timeout("1 second"));
            if (termination === "interruption") {
              yield* Fiber.interrupt(pending);
            } else {
              yield* Scope.close(writerScope, Exit.void);
              const pendingFailure = yield* Fiber.join(pending).pipe(
                Effect.flip,
                Effect.timeout("1 second"),
              );
              expect(pendingFailure).toBeInstanceOf(HerdrGraphicsStreamClosed);
            }
            const failure = yield* writer
              .write({
                format: "png",
                imageWidth: 1,
                imageHeight: 1,
                data: Uint8Array.of(1),
              })
              .pipe(Effect.flip);
            yield* Deferred.await(socketClosed).pipe(Effect.timeout("1 second"));
            return failure;
          }),
        ),
      );
      expect(failure).toBeInstanceOf(HerdrGraphicsStreamClosed);
    } finally {
      await server.close();
    }
  },
);

test("a mismatched direct-file acknowledgement invalidates the writer before another frame", async () => {
  const socketClosed = Effect.runSync(Deferred.make<void>());
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "pane.graphics.stream") {
      socket.removeAllListeners("data");
      let buffered = "";
      socket.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        if (!buffered.includes("\n")) return;
        socket.write(
          JSON.stringify({
            id: `${request.id}:file:99`,
            result: { type: "pane_graphics_frame_ack", sequence: 99, revision: 1 },
          }) + "\n",
        );
      });
      socket.once("close", () => Effect.runSync(Deferred.succeed(socketClosed, undefined)));
    }
    return makeHerdrSuccessResponse(request);
  });
  try {
    const result = await runWithSdk(
      server.socketPath,
      Effect.scoped(
        Effect.gen(function* () {
          const herdr = yield* HerdrSdk;
          const writer = yield* herdr.panes.graphics.openStream(herdr.ids.pane("pane-1"));
          const mismatch = yield* writer
            .writeFile({
              format: "rgba",
              imageWidth: 1,
              imageHeight: 1,
              filePath: herdr.ids.absolutePath("/tmp/frame.rgba"),
              sequence: 1,
              revision: 1,
            })
            .pipe(Effect.flip);
          const closed = yield* writer
            .write({
              format: "png",
              imageWidth: 1,
              imageHeight: 1,
              data: Uint8Array.of(1),
            })
            .pipe(Effect.flip);
          yield* Deferred.await(socketClosed).pipe(Effect.timeout("1 second"));
          return { mismatch, closed };
        }),
      ),
    );
    expect(result.mismatch).toBeInstanceOf(HerdrInvalidResponse);
    expect(result.closed).toBeInstanceOf(HerdrGraphicsStreamClosed);
  } finally {
    await server.close();
  }
});

test.each(["configured", "override"] as const)(
  "%s deadline bounds a direct-file write whose server never acknowledges",
  async (deadlineSource) => {
    const frameReceived = Effect.runSync(Deferred.make<void>());
    const socketClosed = Effect.runSync(Deferred.make<void>());
    const server = await startHerdrTestServer((request, socket) => {
      if (request.method === "pane.graphics.stream") {
        socket.removeAllListeners("data");
        let buffered = "";
        socket.on("data", (chunk: Buffer) => {
          buffered += chunk.toString("utf8");
          if (buffered.includes("\n")) Effect.runSync(Deferred.succeed(frameReceived, undefined));
        });
        socket.once("close", () => Effect.runSync(Deferred.succeed(socketClosed, undefined)));
      }
      return makeHerdrSuccessResponse(request);
    });
    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const herdr = yield* HerdrSdk;
            const writer = yield* herdr.panes.graphics.openStream(herdr.ids.pane("pane-1"));
            const timeout = yield* writer
              .writeFile(
                {
                  format: "rgba",
                  imageWidth: 1,
                  imageHeight: 1,
                  filePath: herdr.ids.absolutePath("/tmp/frame.rgba"),
                  sequence: 1,
                  revision: 1,
                },
                deadlineSource === "override" ? { requestTimeout: Duration.millis(50) } : {},
              )
              .pipe(Effect.flip);
            const closed = yield* writer
              .write({
                format: "png",
                imageWidth: 1,
                imageHeight: 1,
                data: Uint8Array.of(1),
              })
              .pipe(Effect.flip);
            yield* Deferred.await(frameReceived);
            yield* Deferred.await(socketClosed);
            return { timeout, closed };
          }),
        ).pipe(
          Effect.provide(
            herdrSdkLayerFromOptions({
              socketPath: HerdrAbsolutePath.make(server.socketPath),
              requestTimeout:
                deadlineSource === "configured" ? Duration.millis(50) : Duration.seconds(5),
            }),
          ),
          Effect.timeout("2 seconds"),
        ),
      );
      expect(result.timeout).toBeInstanceOf(HerdrRequestTimeout);
      expect(result.timeout).toMatchObject({
        operation: "graphics_write",
        timeoutMilliseconds: 50,
      });
      expect(result.closed).toBeInstanceOf(HerdrGraphicsStreamClosed);
    } finally {
      await server.close();
    }
  },
);

function runWithSdk<A, E>(socketPath: string, effect: Effect.Effect<A, E, HerdrSdk>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(socketPath) })),
    ),
  );
}
