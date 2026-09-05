/**
 * Verifies the Effect-style documentation contract for production TypeScript exports.
 *
 * Generated wire contracts and test-only modules are intentionally excluded because they are not package API
 * declaration owners.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));
const excludedSourceFiles = new Set(["herdr-test-server.ts", "herdr-wire-fixtures.ts", "index.ts"]);
const sourceFiles = readdirSync(sourceDirectory)
  .filter(
    (file) =>
      file.endsWith(".ts") &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".tst.ts") &&
      !excludedSourceFiles.has(file),
  )
  .sort();

const failures = [];
let exportCount = 0;

function findAttachedJsdoc(lines, declarationLine) {
  let cursor = declarationLine - 1;
  while (cursor >= 0 && lines[cursor].trim() === "") cursor -= 1;
  if (cursor < 0 || !lines[cursor].trim().endsWith("*/")) return undefined;

  const end = cursor;
  while (cursor >= 0) {
    const line = lines[cursor].trim();
    // Stop at the nearest block comment: an ordinary comment cannot borrow an older JSDoc.
    if (line.includes("/*")) {
      return line.startsWith("/**") ? lines.slice(cursor, end + 1).join("\n") : undefined;
    }
    if (cursor !== end && line.includes("*/")) return undefined;
    cursor -= 1;
  }
  return undefined;
}

function countTag(jsdoc, tag) {
  return jsdoc.match(new RegExp(`@${tag}\\b`, "g"))?.length ?? 0;
}

for (const file of sourceFiles) {
  const path = join(sourceDirectory, file);
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  const moduleJsdoc = source.match(/^\/\*\*[\s\S]*?\*\//)?.[0];

  if (moduleJsdoc === undefined || countTag(moduleJsdoc, "since") !== 1) {
    failures.push(`${file}: module documentation must contain exactly one @since tag`);
  }

  for (let index = 0; index < lines.length; index += 1) {
    // A type alias has an identifier; `export type { ... }` and `export type *` are re-exports.
    if (
      !/^export (?:default )?(?:declare )?(?:async )?(?:abstract )?(?:const|let|var|type(?=\s+[$_\p{ID_Start}])|interface|class|function|enum)\b/u.test(
        lines[index],
      )
    )
      continue;

    exportCount += 1;
    const jsdoc = findAttachedJsdoc(lines, index);
    if (jsdoc === undefined) {
      failures.push(`${file}:${index + 1}: exported declaration has no attached JSDoc`);
      continue;
    }
    if (countTag(jsdoc, "category") !== 1) {
      failures.push(`${file}:${index + 1}: exported JSDoc must contain exactly one @category tag`);
    }
    if (countTag(jsdoc, "since") !== 1) {
      failures.push(`${file}:${index + 1}: exported JSDoc must contain exactly one @since tag`);
    }

    if (!/^export interface\b/.test(lines[index])) continue;
    let braceDepth = 0;
    let bodyStarted = false;
    for (let memberLine = index; memberLine < lines.length; memberLine += 1) {
      if (
        bodyStarted &&
        braceDepth === 1 &&
        /^  readonly\s+[A-Za-z]/.test(lines[memberLine]) &&
        findAttachedJsdoc(lines, memberLine) === undefined
      ) {
        failures.push(`${file}:${memberLine + 1}: public interface member has no attached JSDoc`);
      }

      for (const character of lines[memberLine]) {
        if (character === "{") {
          braceDepth += 1;
          bodyStarted = true;
        } else if (character === "}") {
          braceDepth -= 1;
        }
      }
      if (bodyStarted && braceDepth === 0) break;
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Verified Effect-style JSDoc on ${exportCount} exports across ${sourceFiles.length} modules.`,
  );
}
