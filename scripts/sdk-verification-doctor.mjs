import { Effect, FileSystem, Schema } from "effect";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import * as NodeSocketServer from "@effect/platform-node-shared/NodeSocketServer";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVerificationProtocol } from "./sdk-verification-metadata.mjs";
import { runVerificationCommand, verificationNodeLayer } from "./sdk-verification-process.mjs";

const directory = fileURLToPath(new URL("../", import.meta.url));
const versionSchema = Schema.Struct({ version: Schema.String });
const packageSchema = Schema.Struct({
  engines: Schema.Struct({ node: Schema.String }),
  devEngines: Schema.Struct({
    packageManager: Schema.Struct({ name: Schema.Literal("pnpm"), version: Schema.String }),
  }),
  dependencies: Schema.Record(Schema.String, Schema.String),
  devDependencies: Schema.Record(Schema.String, Schema.String),
});

const parseDoctorPackage = Schema.decodeEffect(Schema.fromJsonString(packageSchema));
const parseDoctorVersion = Schema.decodeEffect(Schema.fromJsonString(versionSchema));
const parseToolingEngines = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ engines: Schema.Struct({ node: Schema.String }) })),
);

const doctorSdk = Effect.gen(function* () {
  if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2] ?? "")) {
    console.log("Doctor usage: node scripts/sdk-doctor.mjs");
    console.log(
      "Checks package runtime, development CLI, package manager, installed dependency manifests/exact pins, read-only vendor alignment, bundled protocol metadata and isolated local socket bind/close.",
    );
    console.log(
      "Does not connect to live Herdr, install, repair, resolve dependency ranges or independently verify the recorded upstream commit.",
    );
    return;
  }
  if (process.argv.length > 2) {
    console.error(
      "Doctor usage: node scripts/sdk-doctor.mjs (no live Herdr connection; no installs or repairs)",
    );
    process.exitCode = 2;
    return;
  }
  const fs = yield* FileSystem.FileSystem;
  const manifest = yield* parseDoctorPackage(
    yield* fs.readFileString(join(directory, "package.json")),
  );
  /** @type {Array<[string, {status: string, detail: string}]>} */
  const checks = [];
  const minimum = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(manifest.engines.node);
  const actual = process.versions.node.split(".").map(Number);
  const expected = minimum
    ? [Number(minimum[1]), Number(minimum[2] ?? 0), Number(minimum[3] ?? 0)]
    : [];
  const comparison = actual.reduce(
    (result, part, index) => result || Math.sign(part - (expected[index] ?? 0)),
    0,
  );
  checks.push([
    "package runtime",
    {
      status: minimum && comparison >= 0 ? "pass" : "fail",
      detail: `Node ${process.versions.node} (${process.platform}/${process.arch}); requires ${manifest.engines.node}`,
    },
  ]);
  const toolingEngines = yield* Effect.gen(function* () {
    const tool = yield* parseToolingEngines(
      yield* fs.readFileString(join(directory, "node_modules/vite-plus/package.json")),
    );
    return tool.engines.node;
  }).pipe(Effect.catch(() => Effect.succeed("unavailable")));
  const toolingProbe = yield* runVerificationCommand(
    process.execPath,
    [join(directory, "scripts/sdk-verification-cli.mjs"), "test", "--help"],
    { cwd: directory, capture: true, timeout: 10_000 },
  );
  checks.push([
    "development tooling",
    {
      status: toolingProbe.status,
      detail: `vite-plus declares Node ${toolingEngines}; direct CLI probe ${toolingProbe.detail} (separate from package runtime floor)`,
    },
  ]);
  const manager = yield* runVerificationCommand("pnpm", ["--version"], {
    cwd: directory,
    capture: true,
    timeout: 10_000,
    shell: process.platform === "win32",
  });
  const managerVersion = manager.output.trim();
  checks.push([
    "package manager",
    {
      status:
        manager.status === "pass" && managerVersion === manifest.devEngines.packageManager.version
          ? "pass"
          : "fail",
      detail:
        manager.status === "pass"
          ? `pnpm ${managerVersion}; expected ${manifest.devEngines.packageManager.version}`
          : `pnpm unavailable (${manager.detail}); no installation attempted`,
    },
  ]);
  for (const [name, requiredVersion] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    const dependency = yield* Effect.gen(function* () {
      return yield* parseDoctorVersion(
        yield* fs.readFileString(join(directory, "node_modules", name, "package.json")),
      );
    }).pipe(
      Effect.map(({ version }) => ({
        status: /^\d/.test(requiredVersion) && version !== requiredVersion ? "fail" : "pass",
        detail: `${name} ${version} (declared ${requiredVersion}; ${/^\d/.test(requiredVersion) ? "exact pin checked" : "installed, range not evaluated"})`,
      })),
      Effect.catch((error) =>
        Effect.succeed({
          status: "fail",
          detail: `${name} unavailable (${error._tag}); install locked dependencies explicitly`,
        }),
      ),
    );
    checks.push(["dependency", dependency]);
  }
  const vendor = yield* Effect.gen(function* () {
    const manifestText = yield* fs.readFileString(join(directory, ".agent-repos"));
    const entry = manifestText
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/))
      .find(([name]) => name === "effect");
    if (!entry || !entry[1] || !entry[3])
      return { status: "fail", detail: "Effect entry missing from .agent-repos" };
    const version = yield* parseDoctorVersion(
      yield* fs.readFileString(join(directory, entry[1], "packages/effect/package.json")),
    );
    const expectedTag = `effect@${manifest.dependencies.effect}`;
    return {
      status:
        entry[3] === expectedTag && version.version === manifest.dependencies.effect
          ? "pass"
          : "fail",
      detail: `.agent-repos ${entry[3]}; vendor ${version.version}; dependency ${manifest.dependencies.effect} (read-only reference)`,
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({ status: "fail", detail: `Vendor alignment unavailable (${error._tag})` }),
    ),
  );
  checks.push(["vendor alignment", vendor]);
  checks.push(["protocol", yield* checkVerificationProtocol(directory)]);
  const socket = yield* Effect.gen(function* () {
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "hsd-" });
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\herdr-sdk-doctor-${randomUUID()}`
        : join(temporary, "probe.sock");
    yield* NodeSocketServer.make({ path: socketPath });
    return {
      status: "pass",
      detail: `${process.platform === "win32" ? "named-pipe" : "Unix socket"} bind/close in isolated fixture; live Herdr not contacted`,
    };
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.scoped,
    Effect.catch((error) =>
      Effect.succeed({
        status: "fail",
        detail: `Local socket capability unavailable (${error._tag}); live Herdr not contacted`,
      }),
    ),
  );
  checks.push(["local socket", socket]);
  for (const [name, result] of checks)
    console.log(`${result.status.toUpperCase()} ${name}: ${result.detail}`);
  console.log(
    "SKIPPED dependency range/lockfile resolution: installed manifests and exact pins only; no installs attempted",
  );
  console.log(
    "SKIPPED upstream verification: recorded commit only; no network access or repair attempted",
  );
  process.exitCode = checks.some(([, result]) => result.status === "fail") ? 1 : 0;
});

NodeRuntime.runMain(
  doctorSdk.pipe(
    Effect.provide(verificationNodeLayer),
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(
          `FAIL doctor metadata (${error._tag}); package.json must declare runtime, package manager and dependencies.`,
        );
        process.exitCode = 1;
      }),
    ),
  ),
);
