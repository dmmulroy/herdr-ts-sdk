import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import { Console, Effect, Schema } from "effect";
import { verificationNodeLayer } from "./sdk-verification-process.mjs";
import { readSdkEvidenceBundle, renderSdkEvidenceReview } from "./sdk-evidence-bundle.mjs";
import {
  runSdkEvidence,
  renderSdkEvidence,
  openSdkEvidence,
  sdkEvidenceRunCatalog,
} from "./sdk-evidence-runner.mjs";

/** CLI usage failures never echo untrusted arguments or causes. */
export const SdkEvidenceCliError = Schema.TaggedStruct("SdkEvidenceCliError", {
  message: Schema.String,
});

const evidenceHelp = `SDK evidence (fixtures plus explicitly selected isolated Herdr)
Usage: node scripts/sdk-evidence.mjs COMMAND
  list [--json]
  run SCENARIO [--claim TEXT] [--record] [--trace] [--preset review|walkthrough] [--out ABSOLUTE_PARENT] [--herdr-executable ABSOLUTE_BINARY] [--json]
  inspect BUNDLE_DIRECTORY [--chapter ID] [--json]
  render BUNDLE_DIRECTORY [--preset review|walkthrough] [--json]
  open BUNDLE_DIRECTORY [--trace] [--chapter ID] [--json]
Bundles are private and outside the checkout. Fixture --record captures fixture PTY output.
herdr-sdk-workflow --record explicitly consents to a fresh isolated real Herdr TUI session.
This primary scenario requires --record; missing prerequisites never fall back to fixtures.
--herdr-executable selects an explicitly installed binary for the isolated scenario only.
No arbitrary socket, session, cwd, or ambient live target is accepted.
--trace exports explicitly; start the loopback viewer separately. Inspect never executes commands.
Product, telemetry, viewer, recording, render, and cleanup outcomes remain independent.`;

const presetSchema = Schema.Literals(["review", "walkthrough"]);
const parseEvidencePreset = Schema.decodeUnknownEffect(presetSchema);

/** Parse evidence commands without interpreting reproduction text or launching implicit UI. @param {ReadonlyArray<string>} args */
export const runSdkEvidenceCli = (args) =>
  Effect.gen(function* () {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      yield* Console.log(evidenceHelp);
      return 0;
    }
    const parsed = yield* Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          allowPositionals: true,
          strict: true,
          options: {
            json: { type: "boolean", default: false },
            record: { type: "boolean", default: false },
            trace: { type: "boolean", default: false },
            claim: { type: "string" },
            preset: { type: "string" },
            out: { type: "string" },
            chapter: { type: "string" },
            "herdr-executable": { type: "string" },
          },
        }),
      catch: () =>
        SdkEvidenceCliError.make({
          message:
            "Evidence command arguments are invalid. Use list, run SCENARIO, inspect DIRECTORY, render DIRECTORY, or open DIRECTORY.",
        }),
    });
    const [command, target, ...extra] = parsed.positionals;
    const flags = parsed.values;
    const allowed =
      command === "run"
        ? ["json", "record", "trace", "claim", "preset", "out", "herdr-executable"]
        : command === "inspect"
          ? ["json", "chapter"]
          : command === "render"
            ? ["json", "preset"]
            : command === "open"
              ? ["json", "trace", "chapter"]
              : ["json"];
    if (
      extra.length ||
      Object.entries(flags).some(
        ([key, value]) => value !== false && value !== undefined && !allowed.includes(key),
      )
    )
      return yield* Effect.fail(
        SdkEvidenceCliError.make({
          message:
            "Evidence command has unsupported options. Check the documented options for this command.",
        }),
      );
    if (command === "list" && target === undefined) {
      yield* Console.log(
        flags.json
          ? JSON.stringify(sdkEvidenceRunCatalog)
          : sdkEvidenceRunCatalog
              .map((item) => `${item.id} [${item.executionKind}]: ${item.title}`)
              .join("\n"),
      );
      return 0;
    }
    if (!target || !["run", "inspect", "render", "open"].includes(command ?? ""))
      return yield* Effect.fail(
        SdkEvidenceCliError.make({
          message:
            "Evidence command requires a scenario or bundle directory. Use list to discover scenarios.",
        }),
      );
    if (command === "run") {
      const preset = yield* parseEvidencePreset(flags.preset ?? "review");
      const result = yield* runSdkEvidence({
        scenarioId: target,
        claim: flags.claim,
        record: flags.record,
        trace: flags.trace,
        preset,
        out: flags.out,
        herdrExecutable: flags["herdr-executable"],
      });
      yield* Console.log(
        flags.json
          ? JSON.stringify(result)
          : `${result.directory}\n${renderSdkEvidenceReview(result.manifest).text}`,
      );
      return result.manifest.outcomes.product.status === "passed" ? 0 : 1;
    }
    if (command === "inspect") {
      const manifest = yield* readSdkEvidenceBundle(target);
      if (flags.chapter && !manifest.chapters.some((chapter) => chapter.id === flags.chapter))
        return yield* Effect.fail(
          SdkEvidenceCliError.make({
            message:
              "Evidence chapter was not found. Inspect without --chapter to list available chapters.",
          }),
        );
      yield* Console.log(
        flags.json
          ? JSON.stringify(manifest)
          : renderSdkEvidenceReview(
              manifest,
              flags.chapter === undefined ? {} : { chapterId: flags.chapter },
            ).text,
      );
      return 0;
    }
    if (command === "render") {
      const preset = yield* parseEvidencePreset(flags.preset ?? "review");
      const result = yield* renderSdkEvidence(target, preset);
      yield* Console.log(
        flags.json ? JSON.stringify(result) : `${result.outcomes.render.status}\n${target}`,
      );
      return result.outcomes.render.status === "passed" ? 0 : 1;
    }
    const opened = yield* openSdkEvidence(target, { trace: flags.trace, chapterId: flags.chapter });
    yield* Console.log(flags.json ? JSON.stringify(opened) : "Evidence opened explicitly.");
    return 0;
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(
    runSdkEvidenceCli(process.argv.slice(2)).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          // Boundary emits only the tagged classification, never subprocess causes or argument text.
          const message =
            error._tag === "SdkEvidenceCliError" ||
            error._tag === "SdkEvidenceRunError" ||
            error._tag === "SdkEvidenceBundleError"
              ? error.message
              : `Evidence command failed (${error._tag}). Check --help, bundle integrity, and optional tool availability.`;
          yield* Console.error(message);
          if (process.argv.includes("--json"))
            yield* Console.log(JSON.stringify({ error: error._tag, message }));
          return 1;
        }),
      ),
      Effect.tap((code) =>
        Effect.sync(() => {
          process.exitCode = code;
        }),
      ),
      Effect.provide(verificationNodeLayer),
    ),
  );
}
