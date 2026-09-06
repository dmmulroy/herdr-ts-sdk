import { Effect, FileSystem } from "effect";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { join } from "node:path";

// Faithful CLI process fixture: persistent state survives short-lived command processes.
const fixtureProgram = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const [command, session, ...args] = process.argv.slice(2);
  const home = process.env.HOME ?? "";
  const state = join(home, "fixture-session.json");
  const recordIndex = args.indexOf("--record");
  if (command === "--version") {
    console.log("termctrl 0.3.0");
    return;
  }
  if (command === "start") {
    const recording = args[recordIndex + 1];
    if (!recording) {
      process.exitCode = 1;
      return;
    }
    yield* fs.writeFileString(recording, "fixture recording");
    yield* fs.writeFileString(state, JSON.stringify({ session, recording, args }));
    // Tests use existence as readiness: publish only after the complete JSON is written.
    yield* fs.writeFileString(`${recording}.environment.json.tmp`, JSON.stringify(process.env));
    yield* fs.rename(`${recording}.environment.json.tmp`, `${recording}.environment.json`);
    yield* fs.writeFileString(`${recording}.launch.json`, JSON.stringify(args));
    if (args.includes("start-wait")) yield* Effect.never;
    if (args.includes("fail-start")) process.exitCode = 1;
    return;
  }
  if (command === "stop") {
    if (!(yield* fs.exists(state))) {
      process.exitCode = 1;
      return;
    }
    if ((yield* fs.readFileString(state)).includes("stop-fail")) {
      process.exitCode = 1;
      return;
    }
    yield* fs.remove(state);
    return;
  }
  if (command === "show") {
    console.log(
      (yield* fs.readFileString(state)).includes("flood")
        ? "x".repeat(300000)
        : "Fixture evidence: actual output",
    );
    return;
  }
  if (command === "wait") {
    if (args[0] === "never") yield* Effect.never;
    return;
  }
  if (command === "markers") {
    console.log(
      session?.includes("malformed")
        ? "not json"
        : JSON.stringify([
            { name: "ready", at_ms: 0 },
            { name: "done", at_ms: 100 },
          ]),
    );
    return;
  }
  if (command === "save") {
    const output = args[args.indexOf("--out") + 1];
    if (!output) {
      process.exitCode = 1;
      return;
    }
    yield* fs.writeFile(
      output,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    return;
  }
  if (command === "video") {
    const output = args[args.indexOf("--out") + 1];
    if (!output) {
      process.exitCode = 1;
      return;
    }
    if (output.includes("render-wait")) {
      // An empty PID file parses as zero (the caller's process group), not this child.
      yield* fs.writeFileString(`${output}.pid.tmp`, String(process.pid));
      yield* fs.rename(`${output}.pid.tmp`, `${output}.pid`);
      yield* Effect.never;
    }
    yield* fs.writeFileString(output, "fixture video");
  }
});
Effect.runPromise(fixtureProgram.pipe(Effect.provide(NodeFileSystem.layer))).catch(() => {
  process.exitCode = 1;
});
