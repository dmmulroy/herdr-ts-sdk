/**
 * Verifies attached public documentation at TS and tooling JS declaration owners.
 * TS retains the Effect-style module/export tags; tooling JS requires prose only.
 * Generated contracts, test fixtures, and re-exports are not declaration owners.
 */
import { Effect, FileSystem } from "effect";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync, Visitor } from "vite";

const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));
const scriptsDirectory = fileURLToPath(new URL("./", import.meta.url));
const excludedSourceFiles = new Set(["herdr-test-server.ts", "herdr-wire-fixtures.ts", "index.ts"]);
// The local telemetry receiver is fixture infrastructure, not a tooling API declaration owner.
const excludedScriptFiles = new Set(["sdk-telemetry-test-server.ts"]);

/** @param {string} jsdoc @param {string} tag */
function countTag(jsdoc, tag) {
  return jsdoc.match(new RegExp(`@${tag}\\b`, "g"))?.length ?? 0;
}

const checkPublicJsdoc = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const sourceFiles = (yield* fs.readDirectory(sourceDirectory))
    .filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".tst.ts") &&
        !excludedSourceFiles.has(file),
    )
    .sort()
    .map((file) => ({ file, directory: sourceDirectory, effectTags: true }));
  const scriptFiles = (yield* fs.readDirectory(scriptsDirectory))
    .filter(
      (file) =>
        (file.endsWith(".mjs") || file.endsWith(".ts")) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".tst.ts") &&
        !file.endsWith("-test-fixture.mjs") &&
        !excludedScriptFiles.has(file),
    )
    .sort()
    .map((file) => ({ file, directory: scriptsDirectory, effectTags: file.endsWith(".ts") }));
  const files = [...sourceFiles, ...scriptFiles];
  const failures = [];
  let exportCount = 0;
  for (const { file, directory, effectTags } of files) {
    const source = yield* fs.readFileString(join(directory, file));
    const parsed = parseSync(file, source);
    if (parsed.errors.length > 0) {
      failures.push(`${file}: cannot check documentation on invalid syntax`);
      continue;
    }
    /** Only whitespace may separate a declaration from its nearest block JSDoc. @param {number} start */
    function attachedJsdoc(start) {
      const comment = parsed.comments.findLast((candidate) => candidate.end <= start);
      return comment?.type === "Block" &&
        comment.value.startsWith("*") &&
        source.slice(comment.end, start).trim() === ""
        ? comment.value
        : undefined;
    }
    /** @param {number} start @param {string} kind */
    function requireJsdoc(start, kind) {
      const jsdoc = attachedJsdoc(start);
      const location = `${file}:${source.slice(0, start).split("\n").length}`;
      if (jsdoc === undefined) failures.push(`${location}: ${kind} has no attached JSDoc`);
      return { jsdoc, location };
    }
    if (effectTags) {
      const moduleComment = parsed.comments[0];
      if (
        moduleComment?.start !== 0 ||
        moduleComment.type !== "Block" ||
        !moduleComment.value.startsWith("*") ||
        countTag(moduleComment.value, "since") !== 1
      ) {
        failures.push(`${file}: module documentation must contain exactly one @since tag`);
      }
    }

    /** @type {import("vite").ESTree.AssignmentExpression[]} */
    const assignments = [];
    /** @type {import("vite").ESTree.Node[]} */
    const functions = [];
    new Visitor({
      AssignmentExpression(node) {
        assignments.push(node);
      },
      FunctionExpression(node) {
        functions.push(node);
      },
      FunctionDeclaration(node) {
        functions.push(node);
      },
      ArrowFunctionExpression(node) {
        functions.push(node);
      },
    }).visit(parsed.program);

    /** Dynamic computed keys do not establish a named property; literal bracket keys do.
     * @param {import("vite").ESTree.Node} key @param {boolean} computed
     */
    function memberName(key, computed) {
      return key.type === "Identifier" && !computed
        ? key.name
        : key.type === "Literal"
          ? String(key.value)
          : undefined;
    }
    /** Explicit declarations own documentation; inherited/schema-generated members do not create local declarations.
     * @param {Extract<import("vite").ESTree.Node, { type: "ClassDeclaration" | "ClassExpression" }>} declaration
     */
    function checkClass(declaration) {
      const declaredNames = new Set(
        declaration.body.body.flatMap((member) =>
          "key" in member ? [memberName(member.key, member.computed)] : [],
        ),
      );
      for (const member of declaration.body.body) {
        if (member.type === "StaticBlock") continue;
        if (
          "key" in member &&
          (member.key.type === "PrivateIdentifier" ||
            member.accessibility === "private" ||
            member.accessibility === "protected")
        )
          continue;
        requireJsdoc(member.start, "public class member");
        if (member.type !== "MethodDefinition" || member.kind !== "constructor") continue;
        for (const parameter of member.value.params) {
          if (
            parameter.type === "TSParameterProperty" &&
            parameter.accessibility !== "private" &&
            parameter.accessibility !== "protected"
          )
            requireJsdoc(parameter.start, "public class member");
        }
        // JS constructor assignments introduce inferred public properties. An explicit field wins;
        // nested functions have their own ownership and are not constructor declarations.
        if (effectTags) continue;
        const inferredNames = new Set();
        for (const assignment of assignments) {
          if (
            assignment.start < member.value.start ||
            assignment.end > member.value.end ||
            functions.some(
              (fn) =>
                fn !== member.value &&
                fn.start > member.value.start &&
                fn.end < member.value.end &&
                fn.start <= assignment.start &&
                fn.end >= assignment.end,
            )
          )
            continue;
          if (
            assignment.left.type !== "MemberExpression" ||
            assignment.left.object.type !== "ThisExpression" ||
            assignment.left.property.type === "PrivateIdentifier"
          )
            continue;
          const name = memberName(assignment.left.property, assignment.left.computed);
          if (name === undefined || declaredNames.has(name) || inferredNames.has(name)) continue;
          inferredNames.add(name);
          requireJsdoc(assignment.start, "public class member");
        }
      }
    }
    /** @param {import("vite").ESTree.Node} declaration @param {number} start */
    function checkDeclaration(declaration, start) {
      exportCount += 1;
      const { jsdoc, location } = requireJsdoc(start, "exported declaration");
      if (effectTags && jsdoc !== undefined) {
        for (const tag of ["category", "since"]) {
          if (countTag(jsdoc, tag) !== 1)
            failures.push(`${location}: exported JSDoc must contain exactly one @${tag} tag`);
        }
      }
      if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression")
        checkClass(declaration);
      if (declaration.type === "TSInterfaceDeclaration") {
        for (const member of declaration.body.body)
          requireJsdoc(member.start, "public interface member");
      }
      if (declaration.type === "VariableDeclaration") {
        for (const variable of declaration.declarations) {
          if (variable.init?.type === "ClassExpression") checkClass(variable.init);
        }
      }
    }
    for (const statement of parsed.program.body) {
      if (
        (statement.type === "ExportNamedDeclaration" ||
          statement.type === "ExportDefaultDeclaration") &&
        statement.declaration !== null &&
        statement.declaration.type !== "Identifier"
      ) {
        checkDeclaration(statement.declaration, statement.start);
      }
    }
    // Local export lists still require documentation at the original binding. External re-exports do not.
    const localNames = new Set(
      parsed.module.staticExports.flatMap((entry) =>
        entry.entries.flatMap((item) =>
          item.moduleRequest === null && item.localName.name !== null ? [item.localName.name] : [],
        ),
      ),
    );
    /** Local export aliases resolve to original bindings, including destructuring.
     * @param {import("vite").ESTree.Node} binding @returns {string[]}
     */
    function bindingNames(binding) {
      switch (binding.type) {
        case "Identifier":
          return [binding.name];
        case "ObjectPattern":
          return binding.properties.flatMap((property) =>
            bindingNames(property.type === "RestElement" ? property.argument : property.value),
          );
        case "ArrayPattern":
          return binding.elements.flatMap((element) =>
            element === null ? [] : bindingNames(element),
          );
        case "AssignmentPattern":
          return bindingNames(binding.left);
        case "RestElement":
          return bindingNames(binding.argument);
        default:
          return [];
      }
    }
    for (const statement of parsed.program.body) {
      if (statement.type === "VariableDeclaration") {
        if (
          statement.declarations.some((declaration) =>
            bindingNames(declaration.id).some((name) => localNames.has(name)),
          )
        )
          checkDeclaration(statement, statement.start);
      } else if (
        "id" in statement &&
        statement.id?.type === "Identifier" &&
        localNames.has(statement.id.name)
      ) {
        checkDeclaration(statement, statement.start);
      }
    }
  }
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Verified Effect-style JSDoc on ${exportCount} exports across ${files.length} modules.`,
    );
  }
});

NodeRuntime.runMain(
  checkPublicJsdoc.pipe(
    Effect.timeout("30 seconds"),
    Effect.provide(NodeFileSystem.layer),
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(`Public JSDoc check failed (${error._tag})`);
        process.exitCode = 1;
      }),
    ),
  ),
);
