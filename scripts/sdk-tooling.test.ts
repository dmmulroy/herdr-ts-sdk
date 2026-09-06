import {
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vite-plus/test";
import { runHerdrTest } from "../src/herdr-test-runtime.ts";
import { startHerdrTestServer } from "../src/herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "../src/herdr-wire-fixtures.ts";
import {
  runVerificationCommand,
  verificationNodeLayer,
  type VerificationCommandOptions,
} from "./sdk-verification-process.mjs";

const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const vpEntrypoint = fileURLToPath(import.meta.resolve("vite-plus/bin"));
const tscEntrypoint = join(
  dirname(fileURLToPath(import.meta.resolve("typescript/package.json"))),
  "bin/tsc",
);

// Test policy captures bounded diagnostics; shared verification owns process cleanup and deadlines.
const runToolingCommand = (
  command: string,
  args: ReadonlyArray<string>,
  options: VerificationCommandOptions = {},
) => runVerificationCommand(command, args, { ...options, capture: true, timeout: 25_000 });

// One shared build owns its disposable directory for the entire Vitest suite.
class SdkToolingFixture extends Context.Service<
  SdkToolingFixture,
  {
    readonly directory: string;
    readonly packageDirectory: string;
  }
>()("test/SdkToolingFixture") {}

const toolingFixtureLayer = Layer.effect(
  SdkToolingFixture,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "herdr-sdk-tooling-" });
    const packageDirectory = join(directory, "package");
    yield* fs.makeDirectory(packageDirectory);
    for (const path of [
      "src",
      "schema",
      "examples",
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
    ]) {
      yield* fs.copy(join(repositoryDirectory, path), join(packageDirectory, path));
    }
    yield* fs.symlink(
      join(repositoryDirectory, "node_modules"),
      join(packageDirectory, "node_modules"),
    );
    // Build only the isolated checkout, using the local CLI rather than the vp script dispatcher.
    const build = yield* runToolingCommand(process.execPath, [vpEntrypoint, "pack"], {
      cwd: packageDirectory,
    });
    expect(build.exitCode, build.detail + build.stdout + build.stderr).toBe(0);
    // Emit example entrypoints so the Node 20 test baseline needs no type-stripping flag.
    const compiledExamples = yield* runToolingCommand(
      process.execPath,
      [
        tscEntrypoint,
        "--project",
        "examples/tsconfig.json",
        "--noEmit",
        "false",
        "--declaration",
        "false",
        "--rewriteRelativeImportExtensions",
        "--rootDir",
        ".",
        "--outDir",
        "compiled",
      ],
      { cwd: packageDirectory },
    );
    expect(compiledExamples.stdout + compiledExamples.stderr).toBe("");
    expect(compiledExamples.exitCode, compiledExamples.detail).toBe(0);
    return { directory, packageDirectory };
  }),
).pipe(Layer.provideMerge(verificationNodeLayer));
const toolingRuntime = ManagedRuntime.make(toolingFixtureLayer);

beforeAll(() => runHerdrTest(undefined, toolingRuntime.contextEffect), 60_000);
afterAll(() => runHerdrTest(undefined, toolingRuntime.disposeEffect));

const runToolingTest = <A, E>(
  context: TestContext,
  effect: Effect.Effect<A, E, Layer.Success<typeof toolingFixtureLayer>>,
) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const services = yield* toolingRuntime.contextEffect;
      return yield* effect.pipe(Effect.provide(services));
    }),
  );

describe("wire generation", () => {
  it(
    "recreates a missing generated directory and is deterministic",
    (context) =>
      runToolingTest(
        context,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const fixture = yield* SdkToolingFixture;
          const directory = join(fixture.directory, "generation");
          yield* fs.makeDirectory(join(directory, "scripts"), { recursive: true });
          yield* fs.copy(
            join(repositoryDirectory, "scripts/generate-wire-types.mjs"),
            join(directory, "scripts/generate-wire-types.mjs"),
          );
          yield* fs.copy(join(repositoryDirectory, "schema"), join(directory, "schema"));
          yield* fs.symlink(
            join(repositoryDirectory, "node_modules"),
            join(directory, "node_modules"),
          );
          const generate = runToolingCommand(process.execPath, [
            join(directory, "scripts/generate-wire-types.mjs"),
          ]);
          const firstRun = yield* generate;
          expect(firstRun.exitCode, firstRun.detail + firstRun.stdout + firstRun.stderr).toBe(0);
          const generatedDirectory = join(directory, "src/generated");
          const files = (yield* fs.readDirectory(generatedDirectory)).sort();
          expect(files).toEqual([
            "wire-error-response.ts",
            "wire-event.ts",
            "wire-method-map.ts",
            "wire-request.ts",
            "wire-subscription-event.ts",
            "wire-success-response.ts",
          ]);
          const first = yield* Effect.forEach(files, (file) =>
            fs.readFileString(join(generatedDirectory, file)),
          );
          const secondRun = yield* generate;
          expect(secondRun.exitCode, secondRun.detail + secondRun.stdout + secondRun.stderr).toBe(
            0,
          );
          expect(
            yield* Effect.forEach(files, (file) =>
              fs.readFileString(join(generatedDirectory, file)),
            ),
          ).toEqual(first);
          // Apply the generate formatter only inside this fixture.
          const format = yield* runToolingCommand(
            process.execPath,
            [vpEntrypoint, "fmt", generatedDirectory],
            { cwd: fixture.packageDirectory },
          );
          expect(format.exitCode, format.detail + format.stdout + format.stderr).toBe(0);
          for (const file of files) {
            expect(yield* fs.readFileString(join(generatedDirectory, file))).toBe(
              yield* fs.readFileString(join(repositoryDirectory, "src/generated", file)),
            );
          }
        }),
      ),
    30_000,
  );
});

describe("public JSDoc checker", () => {
  it.for([
    [
      "public property",
      "src/member.ts",
      "export class Capability { value = 1; }",
      "public class member",
    ],
    [
      "public method",
      "src/member.ts",
      "export class Capability { run() {} }",
      "public class member",
    ],
    [
      "public accessor",
      "src/member.ts",
      "export class Capability { get value() { return 1; } }",
      "public class member",
    ],
    [
      "static method",
      "src/member.ts",
      "export class Capability { static run() {} }",
      "public class member",
    ],
    [
      "constructor property",
      "src/member.ts",
      "export class Capability { /** Creates capability. */ constructor(public value: string) {} }",
      "public class member",
    ],
    [
      "class expression",
      "src/member.ts",
      "export const Capability = class { value = 1; };",
      "public class member",
    ],
    [
      "interface method",
      "src/member.ts",
      "export interface Capability { run(): void; }",
      "public interface member",
    ],
    [
      "local export owner",
      "scripts/member.mjs",
      "class Capability {}\nexport { Capability };",
      "exported declaration",
    ],
    [
      "ordinary member comment",
      "src/member.ts",
      "export class Capability { /** Unrelated. */ documented = 1; /* Not JSDoc. */ value = 2; }",
      "public class member",
    ],
    ["MJS export", "scripts/member.mjs", "export const value = 1;", "exported declaration"],
    [
      "destructured export owner",
      "scripts/member.mjs",
      "const { value: [renamed = 1] } = { value: [] }; export { renamed as publicValue };",
      "exported declaration",
    ],
    [
      "tooling TS member",
      "scripts/member.ts",
      "export class Capability { value = 1; }",
      "public class member",
    ],
    [
      "literal bracket property",
      "scripts/member.mjs",
      "/** Capability. */ export class Capability { /** Creates capability. */ constructor() { this['value'] = 1; } }",
      "public class member",
    ],
    [
      "computed key collision",
      "scripts/member.mjs",
      "const value = 'dynamic'; /** Capability. */ export class Capability { /** Dynamic field. */ [value]; /** Creates capability. */ constructor() { this.value = 1; } }",
      "public class member",
    ],
    [
      "inferred property",
      "scripts/member.mjs",
      "/** Capability. */ export class Capability { /** Creates capability. */ constructor() { this.value = 1; } }",
      "public class member",
    ],
  ] as const)(
    "rejects undocumented %s at the checker boundary",
    ([name, file, declaration, diagnostic], context) =>
      runToolingTest(
        context,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const fixture = yield* SdkToolingFixture;
          const directory = join(fixture.directory, `jsdoc-${name.replaceAll(" ", "-")}`);
          yield* fs.makeDirectory(join(directory, "scripts"), { recursive: true });
          yield* fs.makeDirectory(join(directory, "src"));
          yield* fs.copy(
            join(repositoryDirectory, "scripts/check-public-jsdoc.mjs"),
            join(directory, "scripts/check-public-jsdoc.mjs"),
          );
          yield* fs.symlink(
            join(repositoryDirectory, "node_modules"),
            join(directory, "node_modules"),
          );
          const prefix = file.endsWith(".ts")
            ? "/** Module. @since 0.8.2 */\n/** Capability. @category services @since 0.8.2 */\n"
            : "";
          yield* fs.writeFileString(join(directory, file), prefix + declaration);
          const rejected = yield* runToolingCommand(process.execPath, [
            join(directory, "scripts/check-public-jsdoc.mjs"),
          ]);
          expect(rejected.exitCode, rejected.stdout + rejected.stderr).toBe(1);
          expect(rejected.stderr).toContain(`${diagnostic} has no attached JSDoc`);
          const documented = file.endsWith(".ts")
            ? "export class Capability { /** Value with braces { } in docs. */ value = `}`; /** Runs capability. */ run() { return { value: this.value }; } /** Creates capability. */ constructor(/** Caller label. */ public label: string) {} private hidden = 1; protected inherited = 2; #secret = 3; }"
            : "/** Capability. */ class Capability { /** Explicit field owns docs. */ value; /** Creates capability. */ constructor() { this.value = 1; /** Inferred field owns docs. */ this.reason = 'fixture'; const key = 'dynamic'; this[key] = 2; } /** Runs capability. */ run() {} } export { Capability };\n/** Inherited members are owned by their base. */ export class Derived extends Capability {}\n/** String content is not a declaration. */ export const text = 'export class Undocumented {}';";
          yield* fs.writeFileString(join(directory, file), prefix + documented);
          // Excluded fixture/test declarations must not acquire production documentation policy.
          for (const excluded of [
            "scripts/sdk-telemetry-test-server.ts",
            "scripts/member.test.ts",
            "scripts/member.tst.ts",
            "scripts/member-test-fixture.mjs",
            "src/herdr-test-server.ts",
          ]) {
            yield* fs.writeFileString(
              join(directory, excluded),
              "export const undocumentedFixture = 1;",
            );
          }
          const accepted = yield* runToolingCommand(process.execPath, [
            join(directory, "scripts/check-public-jsdoc.mjs"),
          ]);
          expect(accepted.exitCode, accepted.stdout + accepted.stderr).toBe(0);
        }),
      ),
  );
  it("checks type declarations at their owner without requiring JSDoc on re-exports", (context) =>
    runToolingTest(
      context,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* SdkToolingFixture;
        const directory = join(fixture.directory, "type-reexports");
        yield* fs.makeDirectory(join(directory, "scripts"), { recursive: true });
        yield* fs.makeDirectory(join(directory, "src"));
        yield* fs.copy(
          join(repositoryDirectory, "scripts/check-public-jsdoc.mjs"),
          join(directory, "scripts/check-public-jsdoc.mjs"),
        );
        yield* fs.symlink(
          join(repositoryDirectory, "node_modules"),
          join(directory, "node_modules"),
        );
        yield* fs.writeFileString(
          join(directory, "src/capability.ts"),
          "/** Module docs. @since 0.8.2 */\n/** Public input. @category inputs @since 0.8.2 */\nexport type CapabilityInput = string;\n",
        );
        yield* fs.writeFileString(
          join(directory, "src/capability-exports.ts"),
          [
            "/** Re-export module. @since 0.8.2 */",
            'export type { CapabilityInput } from "./capability.ts";',
            'export type * from "./capability.ts";',
            'export type * as CapabilityTypes from "./capability.ts";',
            'export { type CapabilityInput as Input } from "./capability.ts";',
            "export type",
            '{ CapabilityInput as MultilineInput } from "./capability.ts";',
          ].join("\n"),
        );
        const result = yield* runToolingCommand(process.execPath, [
          join(directory, "scripts/check-public-jsdoc.mjs"),
        ]);
        expect(result.exitCode, result.detail + result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toContain("1 exports across 3 modules");
      }),
    ));

  it.for([
    ["ordinary block comment", "/* Not JSDoc */\nexport const undocumentedValue = 2;"],
    ["async function", "export async function undocumentedOperation() {}"],
    ["default function", "export default function undocumentedOperation() {}"],
    ["abstract class", "export abstract class UndocumentedService {}"],
    ["type alias", "export type UndocumentedInput = string;"],
  ] as const)("rejects an undocumented %s", ([name, declaration], context) =>
    runToolingTest(
      context,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* SdkToolingFixture;
        const directory = join(fixture.directory, name.replaceAll(" ", "-"));
        yield* fs.makeDirectory(join(directory, "scripts"), { recursive: true });
        yield* fs.makeDirectory(join(directory, "src"));
        yield* fs.copy(
          join(repositoryDirectory, "scripts/check-public-jsdoc.mjs"),
          join(directory, "scripts/check-public-jsdoc.mjs"),
        );
        yield* fs.symlink(
          join(repositoryDirectory, "node_modules"),
          join(directory, "node_modules"),
        );
        const documented =
          "/** Module docs. @since 0.8.2 */\n/** Documented value. @category values @since 0.8.2 */\nexport const documentedValue = 1;\n";
        yield* fs.writeFileString(join(directory, "src/capability.ts"), documented + declaration);
        const rejected = yield* runToolingCommand(process.execPath, [
          join(directory, "scripts/check-public-jsdoc.mjs"),
        ]);
        expect(rejected.exitCode, rejected.detail).toBe(1);
        expect(rejected.stderr).toContain("exported declaration has no attached JSDoc");
        yield* fs.writeFileString(
          join(directory, "src/capability.ts"),
          documented +
            "/** Public operation. @category values @since 0.8.2 */\nexport async function documentedOperation() {}\n",
        );
        const accepted = yield* runToolingCommand(process.execPath, [
          join(directory, "scripts/check-public-jsdoc.mjs"),
        ]);
        expect(accepted.exitCode, accepted.detail + accepted.stdout + accepted.stderr).toBe(0);
        expect(accepted.stdout).toContain("2 exports");
      }),
    ),
  );
});

describe("published package", () => {
  it(
    "resolves runtime exports and declaration files without private source files",
    (context) =>
      runToolingTest(
        context,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const fixture = yield* SdkToolingFixture;
          const directory = join(fixture.directory, "consumer");
          const installedPackage = join(directory, "node_modules/@herdr/sdk");
          yield* fs.makeDirectory(installedPackage, { recursive: true });
          yield* fs.copy(join(fixture.packageDirectory, "dist"), join(installedPackage, "dist"));
          yield* fs.copy(
            join(fixture.packageDirectory, "package.json"),
            join(installedPackage, "package.json"),
          );
          for (const dependency of ["effect", "ajv", "@effect", "@types"]) {
            yield* fs.symlink(
              join(repositoryDirectory, "node_modules", dependency),
              join(directory, "node_modules", dependency),
            );
          }
          yield* fs.writeFileString(join(directory, "package.json"), '{"type":"module"}');
          yield* fs.writeFileString(
            join(directory, "consumer.mjs"),
            'import { HerdrSdk, herdrSdkLayer, WorkspaceId } from "@herdr/sdk";\nif (!HerdrSdk || !herdrSdkLayer || !WorkspaceId) throw new Error("Missing public runtime exports");\n',
          );
          const runtime = yield* runToolingCommand(process.execPath, ["consumer.mjs"], {
            cwd: directory,
          });
          expect(runtime.exitCode, runtime.detail + runtime.stdout + runtime.stderr).toBe(0);

          const readme = yield* fs.readFileString(join(repositoryDirectory, "README.md"));
          const snippets = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)];
          expect(snippets.length).toBeGreaterThan(5);
          for (const [index, match] of snippets.entries()) {
            const snippet = match[1] ?? "";
            const imports = snippet.match(/^import .*$/gm) ?? [];
            const body = snippet.replace(/^import .*\n/gm, "");
            const importsText = imports.join("\n");
            const missingEffectImports = ["Duration", "Effect"].filter(
              (name) => !new RegExp(`\\b${name}\\b`).test(importsText),
            );
            const sdkImports = ["HerdrSdk", "herdrSdkLayer"].filter(
              (name) => !new RegExp(`\\b${name}\\b`).test(importsText),
            );
            const preamble = [
              importsText,
              missingEffectImports.length === 0
                ? ""
                : `import { ${missingEffectImports.join(", ")} } from "effect";`,
              sdkImports.length === 0
                ? ""
                : `import { ${sdkImports.join(", ")} } from "@herdr/sdk";`,
              'import type { IHerdrSdk } from "@herdr/sdk";',
              "declare const herdr: IHerdrSdk;",
              /\bconst program\b/.test(body)
                ? ""
                : "declare const program: Effect.Effect<void, never, HerdrSdk>;",
            ].join("\n");
            const source = /^yield\s*\*/.test(body.trim())
              ? `Effect.gen(function* () {\n${body}\n});`
              : body;
            yield* fs.writeFileString(
              join(directory, `readme-${index}.ts`),
              `${preamble}\n${source}`,
            );
          }
          yield* fs.writeFileString(
            join(directory, "tsconfig.json"),
            JSON.stringify({
              compilerOptions: {
                strict: true,
                noEmit: true,
                target: "ES2023",
                module: "NodeNext",
                types: ["node"],
                skipLibCheck: true,
                noUncheckedIndexedAccess: true,
                exactOptionalPropertyTypes: true,
                noImplicitOverride: true,
                noFallthroughCasesInSwitch: true,
              },
              include: ["*.ts"],
            }),
          );
          for (const options of [[], ["--module", "ESNext", "--moduleResolution", "Bundler"]]) {
            const result = yield* runToolingCommand(
              process.execPath,
              [tscEntrypoint, "--project", directory, ...options],
              { cwd: directory },
            );
            expect(result.stdout + result.stderr).toBe("");
            expect(result.exitCode, result.detail).toBe(0);
          }
        }),
      ),
    30_000,
  );
});

describe("executable examples", () => {
  it.for([0, 7])(
    "ignores the echoed build command and reports exit status %s",
    (exitCode, context) =>
      runToolingTest(
        context,
        Effect.scoped(
          Effect.gen(function* () {
            const fixture = yield* SdkToolingFixture;
            let echoedCommand = "";
            const completedLine = `HERDR_BUILD_FINISHED:${exitCode}`;
            const server = yield* startHerdrTestServer((request) =>
              Effect.sync(() => {
                const response = makeHerdrSuccessResponse(request);
                if (request.method === "pane.send_text") echoedCommand = request.params.text;
                if (
                  request.method === "pane.wait_for_output" &&
                  response.result.type === "output_matched"
                ) {
                  const matcher = request.params.match;
                  const matchedLine = [...echoedCommand.split("\n"), completedLine].find((line) =>
                    matcher.type === "substring"
                      ? line.includes(matcher.value)
                      : new RegExp(matcher.value).test(line),
                  );
                  return {
                    ...response,
                    result: { ...response.result, matched_line: matchedLine ?? null },
                  };
                }
                return response;
              }),
            );
            const result = yield* runToolingCommand(
              process.execPath,
              ["compiled/examples/command-completion-notification.js"],
              {
                cwd: fixture.packageDirectory,
                env: { HERDR_SOCKET_PATH: server.socketPath },
              },
            ).pipe(Effect.timeout("10 seconds"));
            expect(result.exitCode, result.detail + result.stdout + result.stderr).toBe(0);
            expect(echoedCommand).toContain("pnpm run build");
            const notification = server.requests.find(
              (request) => request.method === "notification.show",
            );
            expect(notification?.params).toMatchObject({
              title: exitCode === 0 ? "Build succeeded" : "Build needs attention",
              body: completedLine,
            });
          }),
        ),
      ),
  );

  it.for(["SIGINT", "SIGTERM"] as const)(
    "clears the graphics layer before exiting on %s",
    { timeout: 10_000 },
    (signal, context) =>
      runToolingTest(
        context,
        Effect.scoped(
          Effect.gen(function* () {
            const fixture = yield* SdkToolingFixture;
            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
            const frameSent = yield* Deferred.make<void>();
            const server = yield* startHerdrTestServer((request) =>
              Effect.gen(function* () {
                const response = makeHerdrSuccessResponse(request);
                if (response.result.type === "pane_graphics_info") {
                  return {
                    ...response,
                    result: {
                      ...response.result,
                      pane_visible: true,
                      cell_width_px: 8,
                      cell_height_px: 16,
                    },
                  };
                }
                if (request.method === "pane.graphics.set")
                  yield* Deferred.succeed(frameSent, undefined);
                return response;
              }),
            );
            const child = yield* spawner.spawn(
              ChildProcess.make(
                process.execPath,
                ["compiled/examples/graphics-status-overlay.js"],
                {
                  cwd: fixture.packageDirectory,
                  env: { HERDR_SOCKET_PATH: server.socketPath },
                  extendEnv: true,
                  forceKillAfter: "1 second",
                },
              ),
            );
            const stderr = yield* Stream.mkString(Stream.decodeText(child.stderr)).pipe(
              Effect.forkScoped,
            );
            yield* Stream.runDrain(child.stdout).pipe(Effect.forkScoped);
            const exited = yield* child.exitCode.pipe(Effect.forkScoped);
            yield* Effect.raceFirst(
              Deferred.await(frameSent),
              Effect.gen(function* () {
                const status = yield* Fiber.join(exited);
                const output = yield* Fiber.join(stderr);
                return yield* Effect.die(
                  new Error(
                    `Graphics example exited before sending its frame: ${status} ${output}`,
                  ),
                );
              }),
            );
            yield* child.kill({ killSignal: signal, forceKillAfter: "1 second" });
            const status = yield* Fiber.join(exited);
            const output = yield* Fiber.join(stderr);
            expect(status, output).toBe(130);
            expect(
              server.requests
                .filter((request) => request.method === "pane.graphics.clear")
                .map((request) => request.params),
            ).toEqual([{ pane_id: "fixture", layer_id: "build-status" }]);
          }),
        ).pipe(Effect.timeout("8 seconds")),
      ),
  );
});
