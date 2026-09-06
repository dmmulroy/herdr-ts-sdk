import { Effect, FileSystem, Schema } from "effect";
import { NodeRuntime } from "@effect/platform-node-shared";
import {
  runVerificationCommand,
  traceVerificationExecution,
  verificationNodeLayer,
} from "./sdk-verification-process.mjs";
import { symlink } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packageSmokeManifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    dependencies: Schema.Record(Schema.String, Schema.String),
  }),
);
const parsePackageSmokeManifest = Schema.decodeEffect(packageSmokeManifest);
/**
 * NodeFileSystem.symlink lacks junctions, needed without Windows symlink privileges.
 * @param {string} target
 * @param {string} path
 * @returns {Effect.Effect<void, NodeJS.ErrnoException>}
 */
const linkPackageDirectory = (target, path) =>
  Effect.callback((resume) => {
    symlink(target, path, "junction", (error) => resume(error ? Effect.fail(error) : Effect.void));
  });

const runPackageCommand = Effect.fnUntraced(
  /** @param {string} stage @param {string} command @param {readonly string[]} args @param {string} cwd */
  function* (stage, command, args, cwd) {
    const result = yield* runVerificationCommand(command, args, { cwd, capture: true, stage });
    if (result.status === "fail")
      return yield* Effect.fail(
        new Error(
          `Package smoke command failed: ${command} ${args.join(" ")} (${result.detail})\n${result.output}`,
        ),
      );
    return result.output;
  },
);

const findNpmEntrypoint = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate =
      process.platform === "win32"
        ? join(directory, "node_modules/npm/bin/npm-cli.js")
        : join(directory, "npm");
    if (yield* fs.exists(candidate)) return yield* fs.realPath(candidate);
  }
  return yield* Effect.fail(
    new Error("Package smoke requires npm on PATH (bundled with Node) and the system tar command."),
  );
});

/** Builds a disposable offline tarball consumer; returned temporaryDirectory is already removed and only proves cleanup. */
export function checkPackedPackage({ root = repositoryRoot, runtimeNode = process.execPath } = {}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
      prefix: "herdr-package-check-",
    });
    const require = createRequire(join(root, "package.json"));
    const manifest = yield* parsePackageSmokeManifest(
      yield* fs.readFileString(join(root, "package.json")),
    );
    const stage = join(temporaryDirectory, "package");
    const consumer = join(temporaryDirectory, "consumer");
    yield* fs.makeDirectory(stage);
    yield* fs.makeDirectory(consumer);
    for (const name of [
      "src",
      "schema",
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "README.md",
      "LICENSE",
    ]) {
      yield* fs.copy(join(root, name), join(stage, name));
    }
    yield* linkPackageDirectory(join(root, "node_modules"), join(stage, "node_modules"));
    const vp = join(dirname(require.resolve("vite-plus/package.json")), "bin/vp");
    yield* runPackageCommand("package.build", process.execPath, [vp, "pack"], stage);
    const npm = yield* findNpmEntrypoint;
    // --force only bypasses npm's rejection of this package's pnpm devEngines; scripts stay disabled.
    yield* runPackageCommand(
      "package.pack",
      process.execPath,
      [
        npm,
        "pack",
        "--force",
        "--ignore-scripts",
        "--offline",
        "--pack-destination",
        temporaryDirectory,
        "--cache",
        join(temporaryDirectory, "npm-cache"),
        "--update-notifier=false",
      ],
      stage,
    );
    const tarball = join(
      temporaryDirectory,
      `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`,
    );
    const installed = join(consumer, "node_modules", manifest.name);
    yield* fs.makeDirectory(installed, { recursive: true });
    // Extract the actual npm tarball, not dist or a source link. No registry resolution is attempted.
    yield* runPackageCommand(
      "package.extract",
      "tar",
      ["-xzf", tarball, "--strip-components=1", "-C", installed],
      consumer,
    );
    for (const dependency of [...Object.keys(manifest.dependencies), "@types/node"]) {
      const target = join(consumer, "node_modules", dependency);
      yield* fs.makeDirectory(dirname(target), { recursive: true });
      yield* linkPackageDirectory(
        yield* fs.realPath(join(root, "node_modules", dependency)),
        target,
      );
    }
    yield* fs.writeFileString(
      join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    yield* fs.writeFileString(
      join(consumer, "runtime.mjs"),
      `
import assert from "node:assert/strict";
import { Effect } from "effect";
import { NodeRuntime } from "@effect/platform-node-shared";
import { HerdrSdk, PaneId, parsePaneId, herdrSdkLayerFromOptions } from ${JSON.stringify(manifest.name)};
assert.equal(typeof HerdrSdk, "function");
assert.equal(typeof herdrSdkLayerFromOptions, "function");
NodeRuntime.runMain(Effect.gen(function* () {
  assert.equal(yield* parsePaneId("pane-package-smoke"), PaneId.make("pane-package-smoke"));
  console.log("Packed runtime import passed on " + process.version);
}));
`,
    );
    yield* fs.writeFileString(
      join(consumer, "consumer.mts"),
      `
import { Effect, Stream } from "effect";
import { HerdrSdk, herdrSdkLayerFromOptions, type IHerdrSdk, type PingResult, type ServerOperationError } from ${JSON.stringify(manifest.name)};
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
declare const sdk: IHerdrSdk;
const ping = sdk.server.ping();
const events = sdk.events.subscribe([{ type: "workspace.created" }] as const);
const provided = Effect.gen(function* () { return yield* HerdrSdk; }).pipe(Effect.provide(herdrSdkLayerFromOptions({ socketPath: "/tmp/package-smoke.sock" })));
export type PingSuccess = Assert<Equal<Effect.Success<typeof ping>, PingResult>>;
export type PingFailure = Assert<Equal<Effect.Error<typeof ping>, ServerOperationError>>;
export type EventInference = Assert<Equal<Stream.Success<typeof events>["type"], "workspace.created">>;
export type LayerRequirements = Assert<Equal<Effect.Services<typeof provided>, never>>;
// @ts-expect-error Encoded request timeout must not accept arbitrary objects.
sdk.server.ping({ requestTimeout: { invalid: true } });
`,
    );
    yield* fs.writeFileString(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          lib: ["ESNext"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          noImplicitOverride: true,
          noFallthroughCasesInSwitch: true,
          noEmit: true,
          // Pinned Effect declarations reference missing SchemaAST.Sentinel; consumer inference is still checked.
          skipLibCheck: true,
        },
        include: ["consumer.mts"],
      }),
    );
    const runtimeOutput = yield* runPackageCommand(
      "package.runtime",
      runtimeNode,
      [join(consumer, "runtime.mjs")],
      consumer,
    );
    const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
    yield* runPackageCommand(
      "package.types",
      process.execPath,
      [tsc, "--project", join(consumer, "tsconfig.json")],
      consumer,
    );
    return { runtimeOutput: runtimeOutput.trim(), temporaryDirectory };
  }).pipe(Effect.scoped, Effect.provide(verificationNodeLayer));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--runtime-node")) {
    console.error(
      "Package smoke usage: node scripts/check-package.mjs [--runtime-node /path/to/node]",
    );
    process.exitCode = 1;
  } else {
    NodeRuntime.runMain(
      traceVerificationExecution(
        { kind: "verification", name: "package" },
        checkPackedPackage({ runtimeNode: args[1] ?? process.execPath }).pipe(
          Effect.tap((result) =>
            Effect.sync(() =>
              console.log(
                `${result.runtimeOutput}\nPacked declarations and inference passed (offline, installed dependency graph reused; registry resolution not checked).`,
              ),
            ),
          ),
          Effect.as(0),
        ),
      ).pipe(
        Effect.tap((code) =>
          Effect.sync(() => {
            process.exitCode = code;
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            console.error(
              `Package smoke failed: ${String(cause)}\nEnsure dependencies are installed and the development Node version satisfies vite-plus engines.`,
            );
            process.exitCode = 1;
          }),
        ),
      ),
    );
  }
}
