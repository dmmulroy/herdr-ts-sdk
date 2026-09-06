import { Effect, Fiber, FileSystem, Ref, Schema } from "effect";
import { expect, test } from "vite-plus/test";
import { join, resolve } from "node:path";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import {
  checkSdkTerminalControl,
  captureSdkTerminalFrame,
  renderSdkTerminalRecording,
  startSdkTerminalSession,
  startSdkHerdrTerminalSession,
} from "./sdk-terminal-control.mjs";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-terminal-test-" });
  const executable = join(directory, "termctrl");
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  yield* fs.writeFileString(
    executable,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve("scripts/sdk-terminal-control-test-fixture.mjs"))} "$@"\n`,
    { mode: 0o700 },
  );
  return {
    directory,
    executable,
    fs,
    options: {
      executable,
      command: process.execPath,
      cwd: directory,
      recordingPath: join(directory, "source.termctrl"),
    },
  };
});
const parseEnvironment = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      HOME: Schema.String,
      PATH: Schema.String,
      HERDR_TRACE_VIEWER_URL: Schema.String,
    }),
  ),
);

test("terminal fixture capture has isolated environment and idempotent scoped stop", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      expect((yield* checkSdkTerminalControl({ executable: f.executable })).version).toBe(
        "termctrl 0.3.0",
      );
      const handle = yield* startSdkTerminalSession({
        ...f.options,
        environment: {
          NODE_OPTIONS: "secret-sentinel",
          HERDR_SOCKET_PATH: "secret-sentinel",
          HERDR_TRACE_VIEWER_URL: "http://127.0.0.1:19400",
        },
      });
      const raw = yield* f.fs.readFileString(`${handle.recordingPath}.environment.json`);
      expect(raw).not.toContain("secret-sentinel");
      const env = yield* parseEnvironment(raw);
      expect(env.HOME).not.toBe(process.env.HOME);
      expect(env.HERDR_TRACE_VIEWER_URL).toBe("http://127.0.0.1:19400");
      yield* handle.sendText("fixture input");
      yield* handle.pressKey("enter");
      yield* handle.waitForText("actual output");
      expect(yield* handle.readScreen()).toContain("Fixture evidence: actual output");
      yield* handle.mark("done");
      expect(yield* handle.stop()).toEqual({ status: "stopped" });
      expect(yield* handle.stop()).toEqual({ status: "stopped" });
      const closed = yield* handle.sendText("not replayed").pipe(Effect.flip);
      expect(closed.reason).toBe("closed");
    }),
  ));

const parseTerminalLaunch = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

const isolatedClient = (root: string) => ({
  command: "/opt/homebrew/bin/herdr" as const,
  args: ["--session", "sdk-owned-fixture"] as const,
  cwd: root,
  environment: {
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: root,
    TMPDIR: root,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    HERDR_CONFIG_PATH: join(root, "config", "config.toml"),
    HERDR_SOCKET_PATH: join(root, "owned.sock"),
    SHELL: "/bin/sh" as const,
    TERM: "xterm-256color" as const,
    LANG: "en_US.UTF-8",
  },
});

test.for(["/opt/homebrew/bin/herdr", "/tmp/explicit build/herdr"])(
  "real Herdr recorder isolates sandbox environment with executable %s",
  (command, context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const f = yield* fixture;
        const root = yield* f.fs.makeTempDirectoryScoped({
          directory: "/tmp",
          prefix: "sdk-client-test-",
        });
        const client = { ...isolatedClient(root), command };
        const handle = yield* startSdkHerdrTerminalSession({
          client: {
            ...client,
            environment: {
              ...client.environment,
              NODE_OPTIONS: "secret-sentinel",
              HERDR_PANE_ID: "ambient-sentinel",
            },
          },
          executable: f.executable,
          recordingPath: f.options.recordingPath,
        });
        expect(handle).not.toHaveProperty("sendText");
        expect(handle).not.toHaveProperty("pressKey");
        const raw = yield* f.fs.readFileString(`${handle.recordingPath}.launch.json`);
        const args = yield* parseTerminalLaunch(raw);
        expect(raw).not.toContain("sentinel");
        expect(args.slice(args.indexOf("--") + 1, args.indexOf("--") + 3)).toEqual([
          "/usr/bin/env",
          "-i",
        ]);
        expect(args).toContain(`HERDR_SOCKET_PATH=${client.environment.HERDR_SOCKET_PATH}`);
        expect(args).toContain(`XDG_STATE_HOME=${client.environment.XDG_STATE_HOME}`);
        expect(args.slice(-3)).toEqual([client.command, ...client.args]);
        expect(args[args.indexOf("--cols") + 1]).toBe("120");
        expect(args[args.indexOf("--rows") + 1]).toBe("32");
        const daemon = yield* f.fs.readFileString(`${handle.recordingPath}.environment.json`);
        expect(daemon).not.toContain(root);
        yield* handle.waitForText("actual output");
        yield* handle.mark("observed");
        expect(yield* handle.stop()).toEqual({ status: "stopped" });
      }),
    ),
);

test("Herdr recorder rejects paths escaping owned root before recorder acquisition", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const root = yield* f.fs.makeTempDirectoryScoped({
        directory: "/tmp",
        prefix: "sdk-client-test-",
      });
      const client = isolatedClient(root);
      for (const socket of [
        "/tmp/other-session.sock",
        join(root, "..", "ambient.sock"),
        "relative.sock",
      ]) {
        const error = yield* startSdkHerdrTerminalSession({
          client: { ...client, environment: { ...client.environment, HERDR_SOCKET_PATH: socket } },
          executable: f.executable,
          recordingPath: f.options.recordingPath,
        }).pipe(Effect.flip);
        expect(error).toMatchObject({ operation: "herdr-client", reason: "invalid-input" });
        expect(yield* f.fs.exists(f.options.recordingPath)).toBe(false);
      }
    }),
  ));

test("Herdr recorder rejects PATH lookup and command strings before acquisition", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const root = yield* f.fs.makeTempDirectoryScoped({
        directory: "/tmp",
        prefix: "sdk-client-test-",
      });
      for (const command of ["herdr", "./herdr", "herdr --session ambient", "/bin/herdr\0suffix"]) {
        const error = yield* startSdkHerdrTerminalSession({
          client: { ...isolatedClient(root), command },
          executable: f.executable,
          recordingPath: f.options.recordingPath,
        }).pipe(Effect.flip);
        expect(error).toMatchObject({ operation: "herdr-client", reason: "invalid-input" });
        expect(yield* f.fs.exists(f.options.recordingPath)).toBe(false);
      }
    }),
  ));

test("terminal dimensions are bounded before acquisition", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      for (const cols of [0, 201, 80.5, NaN]) {
        expect(
          (yield* startSdkTerminalSession({ ...f.options, cols }).pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        expect(yield* f.fs.exists(f.options.recordingPath)).toBe(false);
      }
    }),
  ));

test("deadline stop bypasses an active readiness wait", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const handle = yield* startSdkTerminalSession({ ...f.options, timeoutMs: 100 });
      const waiter = yield* handle.waitForText("never", 60000).pipe(Effect.forkScoped);
      yield* Effect.gen(function* () {
        while ((yield* handle.cleanup()).status === "pending") yield* Effect.sleep(20);
      }).pipe(Effect.timeout(3000));
      expect(yield* handle.cleanup()).toEqual({ status: "stopped" });
      yield* Fiber.interrupt(waiter);
    }),
  ));

test("interruption during start stops the possibly-created owned session", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const fiber = yield* startSdkTerminalSession({ ...f.options, args: ["start-wait"] }).pipe(
        Effect.scoped,
        Effect.forkScoped,
      );
      yield* Effect.gen(function* () {
        while (!(yield* f.fs.exists(`${f.options.recordingPath}.environment.json`)))
          yield* Effect.sleep(20);
      }).pipe(Effect.timeout(3000));
      const raw = yield* f.fs.readFileString(`${f.options.recordingPath}.environment.json`);
      const env = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Struct({ HOME: Schema.String })),
      )(raw);
      yield* Fiber.interrupt(fiber);
      expect(yield* f.fs.exists(env.HOME)).toBe(false);
    }),
  ));

test("recording disk budget stops a session independently of terminal retention", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const handle = yield* startSdkTerminalSession({ ...f.options, maxRecordingBytes: 1024 });
      yield* f.fs.writeFileString(handle.recordingPath, "x".repeat(2048));
      yield* Effect.gen(function* () {
        while ((yield* handle.cleanup()).status === "pending") yield* Effect.sleep(20);
      }).pipe(Effect.timeout(3000));
      expect((yield* handle.readScreen().pipe(Effect.flip)).reason).toBe("disk-limit");
      expect(yield* handle.recording()).toEqual({ status: "failed", reason: "disk-limit" });
      expect(yield* handle.cleanup()).toEqual({ status: "stopped" });
    }),
  ));

test("render preserves marker source time, holds payoff, and rejects existing destinations", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(f.options.recordingPath, "source");
      const options = {
        executable: f.executable,
        recordingPath: f.options.recordingPath,
        outputPath: join(f.directory, "review.mp4"),
        clips: [{ from: "ready", to: "done", caption: "Fixture observed result" }],
      };
      const result = yield* renderSdkTerminalRecording(options);
      expect(result.markers).toEqual([
        { name: "ready", atMs: 0 },
        { name: "done", atMs: 100 },
      ]);
      expect(result.clips[0]).toMatchObject({ speed: 1, holdMs: 4000 });
      expect(yield* renderSdkTerminalRecording(options).pipe(Effect.exit)).toHaveProperty(
        "_tag",
        "Failure",
      );
      expect(yield* f.fs.readFileString(options.recordingPath)).toBe("source");
    }),
  ));

test("missing binary and pre-existing recording fail before acquisition", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(
        (yield* startSdkTerminalSession({
          ...f.options,
          executable: join(f.directory, "missing"),
        }).pipe(Effect.flip)).reason,
      ).toBe("unavailable");
      yield* f.fs.writeFileString(f.options.recordingPath, "keep");
      expect((yield* startSdkTerminalSession(f.options).pipe(Effect.flip)).reason).toBe("artifact");
      expect(yield* f.fs.readFileString(f.options.recordingPath)).toBe("keep");
    }),
  ));

test("start rejects a dangling recording symlink without creating its target", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const target = join(f.directory, "untouched.termctrl");
      yield* f.fs.symlink(target, f.options.recordingPath);
      yield* startSdkTerminalSession(f.options).pipe(Effect.flip);
      expect(yield* f.fs.exists(target)).toBe(false);
    }),
  ));

test("failed acquisition reports unresolved cleanup without replacing the original failure", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const outcome = yield* Ref.make("unobserved");
      const error = yield* startSdkTerminalSession({
        ...f.options,
        args: ["fail-start", "stop-fail"],
        onCleanup: (result) => Ref.set(outcome, result.status),
      }).pipe(Effect.scoped, Effect.flip);
      expect(error).toMatchObject({ operation: "start", reason: "process-exit" });
      expect(yield* Ref.get(outcome)).toBe("failed");
      const raw = yield* f.fs.readFileString(`${f.options.recordingPath}.environment.json`);
      const env = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Struct({ HOME: Schema.String })),
      )(raw);
      expect(yield* f.fs.exists(env.HOME)).toBe(true);
      // The inert fixture owns no daemon; remove only this test's unresolved runtime directory.
      yield* f.fs.remove(env.HOME, { recursive: true });
    }),
  ));

test("complete screen capture fails rather than silently truncating excessive output", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      const handle = yield* startSdkTerminalSession({ ...f.options, args: ["flood"] });
      expect((yield* handle.readScreen().pipe(Effect.flip)).reason).toBe("output-limit");
      expect(yield* handle.stop()).toEqual({ status: "stopped" });
    }),
  ));

test("render rejects symlink destinations and malformed marker responses", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(f.options.recordingPath, "retained source");
      const outputPath = join(f.directory, "symlink.mp4");
      yield* f.fs.symlink(f.options.recordingPath, outputPath);
      yield* renderSdkTerminalRecording({ ...f.options, outputPath }).pipe(Effect.flip);
      expect(yield* f.fs.readFileString(f.options.recordingPath)).toBe("retained source");
      const malformed = join(f.directory, "malformed.termctrl");
      yield* f.fs.writeFileString(malformed, "fixture");
      expect(
        (yield* renderSdkTerminalRecording({
          executable: f.executable,
          recordingPath: malformed,
          outputPath: join(f.directory, "unused.mp4"),
        }).pipe(Effect.flip)).reason,
      ).toBe("malformed-response");
    }),
  ));

test("render interruption reaps its executable and leaves an explicitly partial artifact", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(f.options.recordingPath, "source");
      const outputPath = join(f.directory, "render-wait.mp4");
      const fiber = yield* renderSdkTerminalRecording({ ...f.options, outputPath }).pipe(
        Effect.forkScoped,
      );
      yield* Effect.gen(function* () {
        while (!(yield* f.fs.exists(`${outputPath}.pid`))) yield* Effect.sleep(20);
      }).pipe(Effect.timeout(3000));
      const pid = Number(yield* f.fs.readFileString(`${outputPath}.pid`));
      yield* Fiber.interrupt(fiber);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(Number((yield* f.fs.stat(outputPath)).size)).toBe(0);
      expect(yield* f.fs.readFileString(f.options.recordingPath)).toBe("source");
    }),
  ));

test("source frame capture preserves named source time and never overwrites artifacts", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(f.options.recordingPath, "source");
      const options = { ...f.options, outputPath: join(f.directory, "poster.png"), marker: "done" };
      expect(yield* captureSdkTerminalFrame(options)).toMatchObject({
        status: "captured",
        marker: "done",
        atMs: 100,
      });
      expect(
        Buffer.from(yield* f.fs.readFile(options.outputPath))
          .subarray(1, 4)
          .toString(),
      ).toBe("PNG");
      yield* captureSdkTerminalFrame(options).pipe(Effect.flip);
      expect(
        (yield* captureSdkTerminalFrame({
          ...options,
          marker: "absent",
          outputPath: join(f.directory, "unused.png"),
        }).pipe(Effect.flip)).reason,
      ).toBe("invalid-input");
      expect(yield* f.fs.exists(join(f.directory, "unused.png"))).toBe(false);
    }),
  ));

test.skipIf(process.env.HERDR_TERMINAL_INTEGRATION !== "1")(
  "real opt-in termctrl retains exited fixture output and renders readable video",
  (context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const f = yield* fixture;
        const handle = yield* startSdkTerminalSession({
          command: process.execPath,
          args: ["-e", "console.log('Fixture evidence: observed result')"],
          cwd: f.directory,
          recordingPath: f.options.recordingPath,
        });
        yield* handle.waitForText("Fixture evidence: observed result");
        yield* handle.mark("ready");
        expect(yield* handle.readScreen()).toContain("observed result");
        yield* handle.mark("done");
        expect(yield* handle.stop()).toEqual({ status: "stopped" });
        const video = yield* renderSdkTerminalRecording({
          recordingPath: handle.recordingPath,
          outputPath: join(f.directory, "real.mp4"),
          clips: [{ from: "ready", to: "done", caption: "Fixture observed result" }],
        });
        expect(Number((yield* f.fs.stat(video.outputPath)).size)).toBeGreaterThan(0);
        const frame = yield* captureSdkTerminalFrame({
          recordingPath: handle.recordingPath,
          marker: "done",
          outputPath: join(f.directory, "real.png"),
        });
        expect(frame.status).toBe("captured");
        expect(
          Buffer.from(yield* f.fs.readFile(frame.outputPath))
            .subarray(1, 4)
            .toString(),
        ).toBe("PNG");
      }),
    ),
  30000,
);
