import { execFile, spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { startHerdrTestServer } from "../src/herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "../src/herdr-wire-fixtures.ts";

const executeFile = promisify(execFile);
const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const vpExecutable = join(repositoryDirectory, "node_modules/.bin/vp");
const tscExecutable = join(repositoryDirectory, "node_modules/.bin/tsc");
let fixtureDirectory: string;
let packageDirectory: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "herdr-sdk-tooling-"));
  packageDirectory = join(fixtureDirectory, "package");
  await mkdir(packageDirectory);
  for (const path of [
    "src",
    "schema",
    "examples",
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
  ]) {
    await cp(join(repositoryDirectory, path), join(packageDirectory, path), { recursive: true });
  }
  await symlink(
    join(repositoryDirectory, "node_modules"),
    join(packageDirectory, "node_modules"),
    "dir",
  );
  // Build only the isolated checkout; never regenerate or rewrite the shared checkout.
  await executeFile(vpExecutable, ["pack"], { cwd: packageDirectory });
  // Emit example entrypoints so the SDK's Node 20 test baseline needs no type-stripping flag.
  const compiledExamples = spawnSync(
    tscExecutable,
    [
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
    { cwd: packageDirectory, encoding: "utf8" },
  );
  expect(compiledExamples.stdout + compiledExamples.stderr).toBe("");
  expect(compiledExamples.status).toBe(0);
}, 30_000);

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("wire generation", () => {
  it("recreates a missing generated directory and is deterministic", async () => {
    const directory = join(fixtureDirectory, "generation");
    await mkdir(join(directory, "scripts"), { recursive: true });
    await cp(
      join(repositoryDirectory, "scripts/generate-wire-types.mjs"),
      join(directory, "scripts/generate-wire-types.mjs"),
    );
    await cp(join(repositoryDirectory, "schema"), join(directory, "schema"), { recursive: true });
    await symlink(
      join(repositoryDirectory, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    const generate = () =>
      executeFile(process.execPath, [join(directory, "scripts/generate-wire-types.mjs")]);
    await generate();
    const generatedDirectory = join(directory, "src/generated");
    const files = (await readdir(generatedDirectory)).sort();
    expect(files).toEqual([
      "wire-error-response.ts",
      "wire-event.ts",
      "wire-method-map.ts",
      "wire-request.ts",
      "wire-subscription-event.ts",
      "wire-success-response.ts",
    ]);
    const first = await Promise.all(
      files.map((file) => readFile(join(generatedDirectory, file), "utf8")),
    );
    await generate();
    expect(
      await Promise.all(files.map((file) => readFile(join(generatedDirectory, file), "utf8"))),
    ).toEqual(first);
    // Apply the same formatter as the generate command, only inside this fixture.
    await executeFile(vpExecutable, ["fmt", generatedDirectory], { cwd: packageDirectory });
    for (const file of files) {
      expect(await readFile(join(generatedDirectory, file), "utf8")).toBe(
        await readFile(join(repositoryDirectory, "src/generated", file), "utf8"),
      );
    }
  }, 30_000);
});

describe("public JSDoc checker", () => {
  it("checks type declarations at their owner without requiring JSDoc on re-exports", async () => {
    const directory = join(fixtureDirectory, "type-reexports");
    await mkdir(join(directory, "scripts"), { recursive: true });
    await mkdir(join(directory, "src"));
    await cp(
      join(repositoryDirectory, "scripts/check-public-jsdoc.mjs"),
      join(directory, "scripts/check-public-jsdoc.mjs"),
    );
    await writeFile(
      join(directory, "src/capability.ts"),
      "/** Module docs. @since 0.8.2 */\n/** Public input. @category inputs @since 0.8.2 */\nexport type CapabilityInput = string;\n",
    );
    await writeFile(
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
    await expect(
      executeFile(process.execPath, [join(directory, "scripts/check-public-jsdoc.mjs")]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("1 exports across 2 modules"),
    });
  });

  it.each([
    ["ordinary block comment", "/* Not JSDoc */\nexport const undocumentedValue = 2;"],
    ["async function", "export async function undocumentedOperation() {}"],
    ["default function", "export default function undocumentedOperation() {}"],
    ["abstract class", "export abstract class UndocumentedService {}"],
    ["type alias", "export type UndocumentedInput = string;"],
  ])("rejects an undocumented %s", async (name, declaration) => {
    const directory = join(fixtureDirectory, name.replaceAll(" ", "-"));
    await mkdir(join(directory, "scripts"), { recursive: true });
    await mkdir(join(directory, "src"));
    await cp(
      join(repositoryDirectory, "scripts/check-public-jsdoc.mjs"),
      join(directory, "scripts/check-public-jsdoc.mjs"),
    );
    const documented =
      "/** Module docs. @since 0.8.2 */\n/** Documented value. @category values @since 0.8.2 */\nexport const documentedValue = 1;\n";
    await writeFile(join(directory, "src/capability.ts"), documented + declaration);
    await expect(
      executeFile(process.execPath, [join(directory, "scripts/check-public-jsdoc.mjs")]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("exported declaration has no attached JSDoc"),
    });
    await writeFile(
      join(directory, "src/capability.ts"),
      documented +
        "/** Public operation. @category values @since 0.8.2 */\nexport async function documentedOperation() {}\n",
    );
    await expect(
      executeFile(process.execPath, [join(directory, "scripts/check-public-jsdoc.mjs")]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("2 exports"),
    });
  });
});

describe("published package", () => {
  it("resolves runtime exports and declaration files without private source files", async () => {
    const directory = join(fixtureDirectory, "consumer");
    const installedPackage = join(directory, "node_modules/@herdr/sdk");
    await mkdir(installedPackage, { recursive: true });
    await cp(join(packageDirectory, "dist"), join(installedPackage, "dist"), { recursive: true });
    await cp(join(packageDirectory, "package.json"), join(installedPackage, "package.json"));
    for (const dependency of ["effect", "ajv", "@effect", "@types"]) {
      await symlink(
        join(repositoryDirectory, "node_modules", dependency),
        join(directory, "node_modules", dependency),
        "dir",
      );
    }
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    await writeFile(
      join(directory, "consumer.mjs"),
      'import { HerdrSdk, herdrSdkLayer, WorkspaceId } from "@herdr/sdk";\nif (!HerdrSdk || !herdrSdkLayer || !WorkspaceId) throw new Error("Missing public runtime exports");\n',
    );
    await executeFile(process.execPath, ["consumer.mjs"], { cwd: directory });

    const readme = await readFile(join(repositoryDirectory, "README.md"), "utf8");
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
        sdkImports.length === 0 ? "" : `import { ${sdkImports.join(", ")} } from "@herdr/sdk";`,
        'import type { IHerdrSdk } from "@herdr/sdk";',
        "declare const herdr: IHerdrSdk;",
        /\bconst program\b/.test(body)
          ? ""
          : "declare const program: Effect.Effect<void, never, HerdrSdk>;",
      ].join("\n");
      const source = /^yield\s*\*/.test(body.trim())
        ? `Effect.gen(function* () {\n${body}\n});`
        : body;
      await writeFile(join(directory, `readme-${index}.ts`), `${preamble}\n${source}`);
    }
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2023",
          module: "NodeNext",
          types: ["node"],
          skipLibCheck: true,
        },
        include: ["*.ts"],
      }),
    );
    for (const options of [[], ["--module", "ESNext", "--moduleResolution", "Bundler"]]) {
      const result = spawnSync(tscExecutable, ["--project", directory, ...options], {
        cwd: directory,
        encoding: "utf8",
      });
      expect(result.stdout + result.stderr).toBe("");
      expect(result.status).toBe(0);
    }
  }, 30_000);
});

describe("executable examples", () => {
  it.each([0, 7])(
    "ignores the echoed build command and reports exit status %s",
    async (exitCode) => {
      let echoedCommand = "";
      const completedLine = `HERDR_BUILD_FINISHED:${exitCode}`;
      const server = await startHerdrTestServer((request) => {
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
          return { ...response, result: { ...response.result, matched_line: matchedLine ?? null } };
        }
        return response;
      });
      try {
        await executeFile(
          process.execPath,
          ["compiled/examples/command-completion-notification.js"],
          {
            cwd: packageDirectory,
            env: { ...process.env, HERDR_SOCKET_PATH: server.socketPath },
            timeout: 10_000,
          },
        );
        expect(echoedCommand).toContain("pnpm run build");
        const notification = server.requests.find(
          (request) => request.method === "notification.show",
        );
        expect(notification?.params).toMatchObject({
          title: exitCode === 0 ? "Build succeeded" : "Build needs attention",
          body: completedLine,
        });
      } finally {
        await server.close();
      }
    },
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "clears the graphics layer before exiting on %s",
    async (signal) => {
      let notifyFrameSent = () => {};
      const frameSent = new Promise<void>((resolve) => {
        notifyFrameSent = resolve;
      });
      const server = await startHerdrTestServer((request) => {
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
        if (request.method === "pane.graphics.set") notifyFrameSent();
        return response;
      });
      const child = spawn(process.execPath, ["compiled/examples/graphics-status-overlay.js"], {
        cwd: packageDirectory,
        env: { ...process.env, HERDR_SOCKET_PATH: server.socketPath },
        stdio: "pipe",
        timeout: 8_000,
        killSignal: "SIGKILL",
      });
      let stderr = "";
      child.stdout.resume();
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const exited = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
      });
      try {
        await Promise.race([
          frameSent,
          exited.then(() => {
            throw new Error(`Graphics example exited before sending its frame: ${stderr}`);
          }),
        ]);
        child.kill(signal);
        expect(await exited, stderr).toEqual({ code: 130, signal: null });
        expect(
          server.requests
            .filter((request) => request.method === "pane.graphics.clear")
            .map((request) => request.params),
        ).toEqual([{ pane_id: "fixture", layer_id: "build-status" }]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await Promise.allSettled([exited, server.close()]);
      }
    },
    10_000,
  );
});
