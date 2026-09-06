import { NodeFileSystem } from "@effect/platform-node-shared";
import { Effect, FileSystem, Schema } from "effect";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "../src/herdr-test-runtime.ts";

const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const agentGuides = ["AGENT.md", "AGENTS.md", "docs/agent-workflow.md"] as const;
const parseAgentPackageScripts = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ scripts: Schema.Record(Schema.String, Schema.String) })),
);

// These small guides use inline links, not reference-style Markdown or embedded HTML.
function extractAgentContextReferences(markdown: string) {
  const paths: Array<string> = [];
  const scripts: Array<string> = [];
  for (const match of markdown.matchAll(/\]\(([^\s)]+)\)/g)) {
    const destination = match[1];
    if (!destination || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(destination)) continue;
    const path = destination.split("#")[0];
    if (path) paths.push(path);
  }
  for (const match of markdown.matchAll(/\bpnpm run ([a-z][a-z\d:-]*)\b/g)) {
    if (match[1]) scripts.push(match[1]);
  }
  return { paths, scripts };
}

test("agent context extraction ignores external links and keeps exact script names", () => {
  expect(
    extractAgentContextReferences(
      "[local](../src/index.ts#exports) [web](https://example.test) [anchor](#start) " +
        "[mail](mailto:example@example.test) [network](//example.test) " +
        "`pnpm run verify:quick` and `pnpm run test:runtime`",
    ),
  ).toEqual({ paths: ["../src/index.ts"], scripts: ["verify:quick", "test:runtime"] });
});

test.for(agentGuides)("agent context references resolve in %s", (guide, context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const guidePath = resolve(repositoryDirectory, guide);
      const references = extractAgentContextReferences(yield* fs.readFileString(guidePath));
      const manifest = yield* fs
        .readFileString(resolve(repositoryDirectory, "package.json"))
        .pipe(Effect.flatMap(parseAgentPackageScripts));
      expect(references.paths.length, `${guide}: expected local navigation links`).toBeGreaterThan(
        0,
      );
      for (const path of references.paths) {
        expect(
          yield* fs.exists(resolve(dirname(guidePath), path)),
          `${guide}: missing local path ${path}`,
        ).toBe(true);
      }
      for (const script of references.scripts) {
        expect(
          Object.hasOwn(manifest.scripts, script),
          `${guide}: missing package script ${script}`,
        ).toBe(true);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  ),
);
