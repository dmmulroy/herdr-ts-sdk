import { Console, Data, Effect, FileSystem, Ref, Schema, Semaphore, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

/** Terminal control failures contain finite diagnostics, never captured terminal content. */
export class SdkTerminalControlError extends Data.TaggedError("SdkTerminalControlError") {
  /** @param {{operation:string,reason:"invalid-input"|"unavailable"|"incompatible"|"timeout"|"process-exit"|"output-limit"|"disk-limit"|"artifact"|"malformed-response"|"closed",message:string}} input */
  constructor(input) {
    super(input);
    /** Recorder operation that failed; never includes terminal input or output. */
    this.operation = input.operation;
    /** Bounded recorder failure classification used by evidence outcome reporting. */
    this.reason = input.reason;
  }
}
/** @param {string} operation @param {SdkTerminalControlError["reason"]} reason */
const terminalFailure = (operation, reason) =>
  new SdkTerminalControlError({
    operation,
    reason,
    message:
      "SDK terminal control could not complete the operation; inspect its classified reason before retrying. Input may already have acted.",
  });
const safePath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const terminalMarker = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));
const parseTerminalMarker = Schema.decodeEffect(terminalMarker);
const parseTerminalMarkers = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        name: terminalMarker,
        at_ms: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
      }),
    ),
  ),
);
/** @typedef {{executable?:string, environment?:NodeJS.ProcessEnv}} TerminalToolOptions */
/** @typedef {{status:"pending"}|{status:"stopped"}|{status:"failed",reason:string}} TerminalCleanup */
/** @param {TerminalToolOptions} options */
const terminalExecutable = (options) =>
  Effect.gen(function* () {
    if (options.executable !== undefined) {
      if (!isAbsolute(options.executable))
        return yield* Effect.fail(terminalFailure("check", "invalid-input"));
      return options.executable;
    }
    const fs = yield* FileSystem.FileSystem;
    for (const candidate of [
      join(homedir(), ".cargo/bin/termctrl"),
      "/opt/homebrew/bin/termctrl",
      "/usr/local/bin/termctrl",
      "/usr/bin/termctrl",
    ]) {
      if (yield* fs.exists(candidate)) return candidate;
    }
    return yield* Effect.fail(terminalFailure("check", "unavailable"));
  });
/** Only explicit trace propagation enters the fixture process; shell hooks and ambient sockets never do. @param {NodeJS.ProcessEnv} input @param {string} home */
function terminalEnvironment(input, home) {
  const output = {
    PATH: safePath,
    HOME: home,
    TMPDIR: home,
    TERMCTRL_RUNTIME_DIR: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    LANG: "en_US.UTF-8",
    TERM: "xterm-256color",
    NO_COLOR: "1",
  };
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...output };
  for (const key of [
    "HERDR_TRACE",
    "HERDR_TRACE_ENDPOINT",
    "HERDR_TRACE_VIEWER_URL",
    "HERDR_TRACE_RUN_ID",
    "HERDR_TRACE_PARENT",
    "TRACEPARENT",
    "HERDR_EVIDENCE_SCENARIO",
    "HERDR_EVIDENCE_RESULT",
  ]) {
    if (input[key] !== undefined) environment[key] = input[key];
  }
  return environment;
}
/** @param {Stream.Stream<Uint8Array, import("effect/PlatformError").PlatformError>} stream */
const captureTerminalOutput = (stream) =>
  stream.pipe(
    Stream.runFoldEffect(
      () => Buffer.alloc(0),
      (buffer, chunk) =>
        buffer.length + chunk.length > 262144
          ? Effect.fail(terminalFailure("capture", "output-limit"))
          : Effect.succeed(Buffer.concat([buffer, chunk])),
    ),
    Effect.map((buffer) => buffer.toString("utf8")),
  );
/** A single CLI invocation owns and drains both pipes; deadlines also interrupt and reap its process. */
const runTerminalCommand = Effect.fnUntraced(
  function* (
    /** @type {string} */ executable,
    /** @type {ReadonlyArray<string>} */ args,
    /** @type {NodeJS.ProcessEnv} */ env,
    _timeoutMs = 10000,
  ) {
    if (!isAbsolute(executable))
      return yield* Effect.fail(terminalFailure("command", "invalid-input"));
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(executable, args, {
        env,
        extendEnv: false,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        forceKillAfter: 500,
      }),
    );
    const [code, stdout] = yield* Effect.all(
      [child.exitCode, captureTerminalOutput(child.stdout), captureTerminalOutput(child.stderr)],
      { concurrency: "unbounded" },
    );
    if (code !== 0)
      return yield* Effect.fail(terminalFailure(args[0] ?? "command", "process-exit"));
    return stdout;
  },
  (effect, _executable, _args, _env, timeoutMs = 10000) =>
    effect.pipe(
      Effect.interruptible,
      Effect.timeout(timeoutMs),
      Effect.scoped,
      Effect.catchTags({
        PlatformError: () => Effect.fail(terminalFailure("command", "unavailable")),
        TimeoutError: () => Effect.fail(terminalFailure("command", "timeout")),
      }),
    ),
);

/** Renderers have a sampled disk budget in addition to their process deadline. */
const runTerminalArtifactCommand = Effect.fnUntraced(
  function* (
    /** @type {string} */ executable,
    /** @type {ReadonlyArray<string>} */ args,
    /** @type {NodeJS.ProcessEnv} */ env,
    /** @type {string} */ outputPath,
    /** @type {number} */ byteLimit,
    /** @type {number} */ timeoutMs,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const monitor = Effect.gen(function* () {
      while (true) {
        if (Number((yield* fs.stat(outputPath)).size) > byteLimit)
          return yield* Effect.fail(terminalFailure("render", "disk-limit"));
        yield* Effect.sleep(100);
      }
    });
    yield* Effect.raceFirst(runTerminalCommand(executable, args, env, timeoutMs), monitor);
    const size = Number((yield* fs.stat(outputPath)).size);
    if (size === 0 || size > byteLimit)
      return yield* Effect.fail(terminalFailure("render", "artifact"));
  },
);

/** Check the installed CLI version without installing or opening a terminal session. @param {TerminalToolOptions} options */
export const checkSdkTerminalControl = (options = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-terminal-check-" });
    const executable = yield* terminalExecutable(options);
    const version = (yield* runTerminalCommand(
      executable,
      ["--version"],
      terminalEnvironment({}, home),
    )).trim();
    if (version !== "termctrl 0.3.0")
      return yield* Effect.fail(terminalFailure("check", "incompatible"));
    return { version, executable };
  }).pipe(Effect.scoped);

/**
 * Start a clean-environment PTY in caller Scope. Finalization is registered before start; stop is idempotent.
 * Recording disk budget is sampled every 100ms (not a hard filesystem quota); deadline stops idle sessions too.
 * @param {TerminalToolOptions & {command:string,args?:ReadonlyArray<string>,cwd:string,recordingPath:string,timeoutMs?:number,maxRecordingBytes?:number,onCleanup?:(outcome:TerminalCleanup)=>Effect.Effect<void>,cols?:number,rows?:number}} options
 */
export const startSdkTerminalSession = (options) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executable = yield* terminalExecutable(options);
      const budget = options.maxRecordingBytes ?? 32 * 1024 * 1024;
      const timeout = options.timeoutMs ?? 120000;
      const cols = options.cols ?? 100;
      const rows = options.rows ?? 28;
      if (
        ![options.command, options.cwd, options.recordingPath, executable].every(isAbsolute) ||
        budget < 1024 ||
        budget > 64 * 1024 * 1024 ||
        !Number.isInteger(budget) ||
        !Number.isInteger(timeout) ||
        timeout < 100 ||
        timeout > 300000 ||
        !Number.isInteger(cols) ||
        cols < 40 ||
        cols > 200 ||
        !Number.isInteger(rows) ||
        rows < 12 ||
        rows > 60
      )
        return yield* Effect.fail(terminalFailure("start", "invalid-input"));
      if (yield* fs.exists(options.recordingPath))
        return yield* Effect.fail(terminalFailure("start", "artifact"));
      if (!(yield* fs.exists(executable)))
        return yield* Effect.fail(terminalFailure("start", "unavailable"));
      yield* restore(checkSdkTerminalControl({ executable }));
      // termctrl accepts an existing empty file; exclusive creation rejects dangling symlinks too.
      yield* fs.writeFileString(options.recordingPath, "", { mode: 0o600, flag: "wx" });
      const home = yield* fs.makeTempDirectory({ directory: "/tmp", prefix: "sdt-" });
      const sessionName = `sdk-${randomUUID()}`;
      const env = terminalEnvironment(options.environment ?? {}, home);
      const mutex = yield* Semaphore.make(1);
      // Stop must bypass an active readiness wait so disk/deadline supervision remains timely.
      const stopMutex = yield* Semaphore.make(1);
      const cleanupState = yield* Ref.make(/** @type {TerminalCleanup} */ ({ status: "pending" }));
      const attempted = yield* Ref.make(false);
      const problem = yield* Ref.make(/** @type {"disk-limit"|"timeout"|"artifact"|null} */ (null));
      const stop = () =>
        stopMutex.withPermit(
          Effect.gen(function* () {
            const previous = yield* Ref.get(cleanupState);
            if (previous.status !== "pending") return previous;
            if (!(yield* Ref.get(attempted))) {
              const result = /** @type {TerminalCleanup} */ ({ status: "stopped" });
              yield* Ref.set(cleanupState, result);
              return result;
            }
            const result = yield* runTerminalCommand(
              executable,
              ["stop", sessionName],
              env,
              5000,
            ).pipe(
              Effect.match({
                onSuccess: () => /** @type {TerminalCleanup} */ ({ status: "stopped" }),
                onFailure: (error) => /** @type {TerminalCleanup} */ ({
                  status: "failed",
                  reason: error.reason,
                }),
              }),
            );
            yield* Ref.set(cleanupState, result);
            return result;
          }),
        );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const result = yield* stop();
          if (result.status === "stopped")
            yield* fs
              .remove(home, { recursive: true })
              .pipe(
                Effect.catchTag("PlatformError", () =>
                  Ref.set(cleanupState, { status: "failed", reason: "runtime-cleanup" }),
                ),
              );
          const outcome = yield* Ref.get(cleanupState);
          if (options.onCleanup) yield* options.onCleanup(outcome);
          else if (outcome.status === "failed")
            yield* Console.error(
              "SDK terminal cleanup unresolved; isolated runtime retained.",
              outcome.reason,
            );
        }),
      );
      /** @param {ReadonlyArray<string>} args @param {number} [duration] */
      const operation = (args, duration = 10000) =>
        mutex.withPermit(
          Effect.gen(function* () {
            const failure = yield* Ref.get(problem);
            if (failure !== null) return yield* Effect.fail(terminalFailure("session", failure));
            if ((yield* Ref.get(cleanupState)).status !== "pending")
              return yield* Effect.fail(terminalFailure("session", "closed"));
            return yield* runTerminalCommand(executable, args, env, duration);
          }),
        );
      yield* fs.chmod(home, 0o700);
      yield* Ref.set(attempted, true);
      yield* restore(
        runTerminalCommand(
          executable,
          [
            "start",
            sessionName,
            "--cols",
            String(cols),
            "--rows",
            String(rows),
            "--max-bytes",
            "262144",
            "--cwd",
            options.cwd,
            "--record",
            options.recordingPath,
            "--color",
            "never",
            "--",
            options.command,
            ...(options.args ?? []),
          ],
          env,
        ),
      );
      yield* Effect.gen(function* () {
        while ((yield* Ref.get(cleanupState)).status === "pending") {
          const size = yield* fs.stat(options.recordingPath).pipe(
            Effect.map((info) => Number(info.size)),
            Effect.catchTag("PlatformError", () => Effect.succeed(-1)),
          );
          if (size < 0 || size > budget) {
            yield* Ref.set(problem, size < 0 ? "artifact" : "disk-limit");
            yield* stop();
            return;
          }
          yield* Effect.sleep(100);
        }
      }).pipe(Effect.interruptible, Effect.forkScoped);
      yield* Effect.gen(function* () {
        yield* Effect.sleep(timeout);
        yield* Ref.set(problem, "timeout");
        yield* stop();
      }).pipe(Effect.interruptible, Effect.forkScoped);
      return {
        recordingPath: options.recordingPath,
        sessionName,
        cleanup: () => Ref.get(cleanupState),
        stop,
        recording: () =>
          Effect.gen(function* () {
            const failure = yield* Ref.get(problem);
            if (failure !== null)
              return { status: /** @type {const} */ ("failed"), reason: failure };
            const cleanup = yield* Ref.get(cleanupState);
            if (cleanup.status === "failed")
              return { status: /** @type {const} */ ("failed"), reason: "cleanup-unresolved" };
            const size = Number((yield* fs.stat(options.recordingPath)).size);
            if (size === 0) return { status: /** @type {const} */ ("failed"), reason: "artifact" };
            if (size > budget)
              return { status: /** @type {const} */ ("failed"), reason: "disk-limit" };
            return {
              status:
                cleanup.status === "stopped"
                  ? /** @type {const} */ ("recorded")
                  : /** @type {const} */ ("recording"),
            };
          }),
        readScreen: () => operation(["show", sessionName]),
        sendText: (/** @type {string} */ text) =>
          text.length > 16384
            ? Effect.fail(terminalFailure("send", "invalid-input"))
            : operation(["send", sessionName, `text:${text}`]),
        pressKey: (/** @type {string} */ key) =>
          /^(enter|escape|tab|backspace|up|down|left|right|ctrl-[a-z])$/.test(key)
            ? operation(["send", sessionName, key])
            : Effect.fail(terminalFailure("send", "invalid-input")),
        // CLI `wait` can reject an already-exited child even when its final screen matches.
        // Poll the retained screen instead; readiness is evidence, not child liveness.
        waitForText: (/** @type {string} */ text, duration = 10000) =>
          text.length > 16384 || !Number.isInteger(duration) || duration < 1 || duration > 120000
            ? Effect.fail(terminalFailure("wait", "invalid-input"))
            : Effect.gen(function* () {
                while (true) {
                  const screen = yield* operation(["show", sessionName]);
                  if (screen.includes(text)) return screen;
                  yield* Effect.sleep(50);
                }
              }).pipe(
                Effect.timeout(duration),
                Effect.catchTag("TimeoutError", () =>
                  Effect.fail(terminalFailure("wait", "timeout")),
                ),
              ),
        mark: (/** @type {string} */ id) =>
          Effect.gen(function* () {
            const marker = yield* parseTerminalMarker(id).pipe(
              Effect.mapError(() => terminalFailure("mark", "invalid-input")),
            );
            yield* operation(["mark", sessionName, marker]);
            return { name: marker };
          }),
      };
    }),
  );

const herdrTerminalClient = Schema.Struct({
  command: Schema.String,
  args: Schema.Tuple([
    Schema.Literal("--session"),
    Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,63}$/)),
  ]),
  cwd: Schema.String,
  environment: Schema.Struct({
    PATH: Schema.String,
    HOME: Schema.String,
    TMPDIR: Schema.String,
    XDG_CONFIG_HOME: Schema.String,
    XDG_CACHE_HOME: Schema.String,
    XDG_STATE_HOME: Schema.optionalKey(Schema.String),
    HERDR_CONFIG_PATH: Schema.String,
    HERDR_SOCKET_PATH: Schema.String,
    SHELL: Schema.Literal("/bin/sh"),
    TERM: Schema.Literal("xterm-256color"),
    LANG: Schema.String,
  }),
});
// The sandbox client exposes an argv array; this boundary still establishes the exact session tuple.
const parseHerdrTerminalClient = Schema.decodeUnknownEffect(herdrTerminalClient);
/** @typedef {import("./sdk-herdr-sandbox.mjs").SdkHerdrSandboxClient} SdkHerdrTerminalClient */

/**
 * Record the actual isolated Herdr TUI; the sandbox owner must keep its private server Scope alive.
 * The sandbox selects an explicit absolute Herdr executable; this adapter never resolves it through PATH.
 * The PTY runs env -i with only parsed sandbox fields, never caller credentials, shell hooks or IDs.
 * Observe waitForText/readScreen before source marks; SDK acknowledgements alone do not prove UI paint.
 * @param {{client:SdkHerdrTerminalClient,recordingPath:string,executable?:string,timeoutMs?:number,maxRecordingBytes?:number,cols?:number,rows?:number,onCleanup?:(outcome:TerminalCleanup)=>Effect.Effect<void>}} options
 */
export const startSdkHerdrTerminalSession = (options) =>
  Effect.gen(function* () {
    const client = yield* parseHerdrTerminalClient(options.client).pipe(
      Effect.mapError(() => terminalFailure("herdr-client", "invalid-input")),
    );
    const paths = [
      client.environment.HOME,
      client.environment.TMPDIR,
      client.environment.XDG_CONFIG_HOME,
      client.environment.XDG_CACHE_HOME,
      client.environment.HERDR_CONFIG_PATH,
      client.environment.HERDR_SOCKET_PATH,
    ];
    if (client.environment.XDG_STATE_HOME) paths.push(client.environment.XDG_STATE_HOME);
    if (
      !isAbsolute(client.command) ||
      client.command.includes("\0") ||
      !/^\/tmp\/[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(client.cwd) ||
      paths.some((path) => {
        const child = relative(client.cwd, path);
        return !isAbsolute(path) || child === ".." || child.startsWith("../") || isAbsolute(child);
      }) ||
      client.environment.PATH !== safePath
    )
      return yield* Effect.fail(terminalFailure("herdr-client", "invalid-input"));
    const session = yield* startSdkTerminalSession({
      ...options,
      command: "/usr/bin/env",
      args: [
        "-i",
        ...Object.entries(client.environment).map(([key, value]) => `${key}=${value}`),
        client.command,
        ...client.args,
      ],
      cwd: client.cwd,
      cols: options.cols ?? 120,
      rows: options.rows ?? 32,
    });
    // Live demonstration input belongs to the SDK workflow, never the recorder.
    return {
      recordingPath: session.recordingPath,
      sessionName: session.sessionName,
      cleanup: session.cleanup,
      stop: session.stop,
      recording: session.recording,
      readScreen: session.readScreen,
      waitForText: session.waitForText,
      mark: session.mark,
    };
  });

/** Render closed source recordings at real speed; edited holds do not alter source time. @param {TerminalToolOptions & {recordingPath:string,outputPath:string,preset?:"review"|"walkthrough",clips?:ReadonlyArray<{from:string,to:string,caption:string}>}} options */
export const renderSdkTerminalRecording = (options) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (
      !isAbsolute(options.recordingPath) ||
      !isAbsolute(options.outputPath) ||
      options.outputPath === options.recordingPath ||
      !["review", "walkthrough"].includes(options.preset ?? "review")
    )
      return yield* Effect.fail(terminalFailure("render", "invalid-input"));
    const source = yield* fs.stat(options.recordingPath);
    if (Number(source.size) > 64 * 1024 * 1024)
      return yield* Effect.fail(terminalFailure("render", "disk-limit"));
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-terminal-render-" });
    const env = terminalEnvironment({}, home);
    const executable = yield* terminalExecutable(options);
    const raw = yield* runTerminalCommand(
      executable,
      ["markers", options.recordingPath, "--json"],
      env,
    );
    const markers = yield* parseTerminalMarkers(raw).pipe(
      Effect.mapError(() => terminalFailure("markers", "malformed-response")),
    );
    const preset = options.preset ?? "review";
    const clips = [];
    for (const clip of options.clips ?? []) {
      const from = markers.find((marker) => marker.name === clip.from);
      const to = markers.find((marker) => marker.name === clip.to);
      if (!from || !to || to.at_ms < from.at_ms || !/^[\x20-\x7e]{1,32}$/.test(clip.caption))
        return yield* Effect.fail(terminalFailure("render", "invalid-input"));
      clips.push({ ...clip, speed: 1, hold_ms: preset === "review" ? 4000 : 6000 });
    }
    const editPath = `${options.outputPath}.edit.json`;
    // Exclusive reservations reject existing paths and symlinks before the renderer can write.
    yield* fs.writeFileString(options.outputPath, "", { mode: 0o600, flag: "wx" });
    yield* fs.writeFileString(editPath, JSON.stringify({ clips }, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    yield* runTerminalArtifactCommand(
      executable,
      [
        "video",
        options.recordingPath,
        "--out",
        options.outputPath,
        "--footer",
        "--pixel-ratio",
        "1",
        "--fps",
        "15",
        "--tail-ms",
        clips.length ? "0" : preset === "review" ? "4000" : "6000",
        ...(clips.length ? ["--edit", editPath] : []),
      ],
      env,
      options.outputPath,
      128 * 1024 * 1024,
      120000,
    );
    return {
      status: /** @type {const} */ ("rendered"),
      outputPath: options.outputPath,
      editPath,
      preset,
      markers: markers.map((marker) => ({ name: marker.name, atMs: marker.at_ms })),
      clips: clips.map(({ hold_ms, ...clip }) => ({ ...clip, holdMs: hold_ms })),
    };
  }).pipe(Effect.scoped);

/** Capture one named source-time terminal frame, not an edited-video timestamp or existing desktop UI.
 * @param {TerminalToolOptions & {recordingPath:string,marker:string,outputPath:string}} options
 */
export const captureSdkTerminalFrame = (options) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (
      !isAbsolute(options.recordingPath) ||
      !isAbsolute(options.outputPath) ||
      options.outputPath === options.recordingPath
    )
      return yield* Effect.fail(terminalFailure("frame", "invalid-input"));
    const marker = yield* parseTerminalMarker(options.marker).pipe(
      Effect.mapError(() => terminalFailure("frame", "invalid-input")),
    );
    const source = yield* fs.stat(options.recordingPath);
    if (Number(source.size) === 0 || Number(source.size) > 64 * 1024 * 1024)
      return yield* Effect.fail(terminalFailure("frame", "disk-limit"));
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-terminal-frame-" });
    const env = terminalEnvironment({}, home);
    const executable = yield* terminalExecutable(options);
    const raw = yield* runTerminalCommand(
      executable,
      ["markers", options.recordingPath, "--json"],
      env,
    );
    const markers = yield* parseTerminalMarkers(raw).pipe(
      Effect.mapError(() => terminalFailure("markers", "malformed-response")),
    );
    const selected = markers.find((entry) => entry.name === marker);
    if (!selected) return yield* Effect.fail(terminalFailure("frame", "invalid-input"));
    yield* fs.writeFileString(options.outputPath, "", { mode: 0o600, flag: "wx" });
    yield* runTerminalArtifactCommand(
      executable,
      [
        "save",
        "--recording",
        options.recordingPath,
        "--at-marker",
        marker,
        "--format",
        "png",
        "--pixel-ratio",
        "1",
        "--out",
        options.outputPath,
      ],
      env,
      options.outputPath,
      8 * 1024 * 1024,
      30000,
    );
    return {
      status: /** @type {const} */ ("captured"),
      outputPath: options.outputPath,
      marker,
      atMs: selected.at_ms,
    };
  }).pipe(Effect.scoped);
