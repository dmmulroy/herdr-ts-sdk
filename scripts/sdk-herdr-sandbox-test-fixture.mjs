import { Effect } from "effect";
import { createServer, createConnection } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const mode = process.argv[2];
const socket =
  mode === "debug"
    ? (process.env.HERDR_SOCKET_PATH ?? "").replace("/config/herdr/", "/config/herdr-dev/")
    : (process.env.HERDR_SOCKET_PATH ?? "");
const root = process.env.HOME ?? "";
const marker = process.argv[3] ?? "";
const main = Effect.gen(function* () {
  if (!root.startsWith("/tmp/hs-") || !socket.startsWith(`${root}/`))
    return yield* Effect.die("fixture isolation violated");
  if (process.argv.includes("server")) {
    const drainConnection =
      mode === "drain-stop"
        ? yield* Effect.acquireRelease(
            Effect.callback(
              (
                /** @type {(effect:Effect.Effect<import("node:net").Socket,Error>)=>void} */ resume,
              ) => {
                const connection = createConnection(join(dirname(marker), "drain.sock"));
                connection.once("error", (error) => resume(Effect.fail(error)));
                connection.once("connect", () => resume(Effect.succeed(connection)));
                return Effect.sync(() => connection.destroy());
              },
            ),
            (connection) => Effect.sync(() => connection.destroy()),
          )
        : undefined;
    yield* Effect.tryPromise(() => mkdir(dirname(socket), { recursive: true }));
    yield* Effect.tryPromise(() =>
      writeFile(join(root, "fixture-environment.json"), JSON.stringify(process.env)),
    );
    yield* Effect.acquireUseRelease(
      Effect.callback(
        (/** @type {(effect:Effect.Effect<import("node:net").Server,Error>)=>void} */ resume) => {
          const server = createServer((connection) =>
            connection.on("data", (data) => {
              if (data.toString() === "stop") {
                connection.end();
                server.close();
              }
            }),
          );
          server.once("error", (error) => resume(Effect.fail(error)));
          server.listen(socket, () => resume(Effect.succeed(server)));
        },
      ),
      (server) =>
        Effect.callback((resume) => {
          server.once("close", () => resume(Effect.void));
        }),
      (server) =>
        Effect.sync(() => {
          server.close();
        }),
    );
    if (drainConnection) {
      // The API socket has acknowledged shutdown, but this real process still owns draining work.
      yield* Effect.callback((/** @type {(effect:Effect.Effect<void,Error>)=>void} */ resume) => {
        drainConnection.once("error", (error) => resume(Effect.fail(error)));
        drainConnection.once("end", () => resume(Effect.void));
        drainConnection.resume();
      });
    }
  } else if (process.argv.includes("stop")) {
    if (mode === "stall-stop") yield* Effect.sleep(60000);
    yield* Effect.callback((/** @type {(effect:Effect.Effect<void,Error>)=>void} */ resume) => {
      const connection = createConnection(socket);
      connection.once("error", (error) => resume(Effect.fail(error)));
      connection.once("connect", () => connection.end("stop"));
      connection.once("close", () => resume(Effect.void));
      return Effect.sync(() => connection.destroy());
    });
  } else if (process.argv.includes("status")) {
    if (mode === "bad-metadata") {
      yield* Effect.sync(() => process.stdout.write("private diagnostic sentinel"));
      return;
    }
    yield* Effect.sync(() =>
      process.stdout.write(
        JSON.stringify({
          client: { version: "0.8.2", protocol: 20 },
          server: { status: "running", version: "0.8.2", protocol: 20 },
        }),
      ),
    );
  } else if (mode === "stall-ready") {
    yield* Effect.tryPromise(() => writeFile(marker, root));
    yield* Effect.sleep(60000);
  }
});
Effect.runPromise(main.pipe(Effect.scoped)).catch(() => {
  process.exitCode = 1;
});
