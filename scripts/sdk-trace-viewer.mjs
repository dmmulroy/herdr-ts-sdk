import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Console, Effect, Schema } from "effect";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import { runVerificationCommand, verificationNodeLayer } from "./sdk-verification-process.mjs";

const viewerPort = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1024),
  Schema.isLessThanOrEqualTo(65535),
);
const viewerConfig = Schema.Struct({
  http: viewerPort,
  grpc: viewerPort,
  browserPort: viewerPort,
  maxSizeMb: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(16),
    Schema.isLessThanOrEqualTo(512),
  ),
});
const parseViewerConfig = Schema.decodeEffect(viewerConfig);
const ViewerFailure = Schema.TaggedStruct("SdkTraceViewerError", { message: Schema.String });

/** Check the preinstalled viewer without starting it; only the tested adapter version is accepted. */
export const checkSdkTraceViewer = Effect.gen(function* () {
  const result = yield* runVerificationCommand("otel-desktop-viewer", ["--version"], {
    capture: true,
    timeout: 5000,
  });
  if (result.status !== "pass")
    return {
      compatible: false,
      message:
        "Trace viewer binary unavailable. Install otel-desktop-viewer 0.5.0 separately and ensure it is on PATH; this command never installs tools.",
    };
  if (result.stdout.trim() !== "otel-desktop-viewer version 0.5.0")
    return {
      compatible: false,
      message:
        "Trace viewer version incompatible. This query adapter is tested only with otel-desktop-viewer 0.5.0; select that binary on PATH.",
    };
  return {
    compatible: true,
    message: "Trace viewer 0.5.0 compatible (read-only JSON-RPC adapter).",
  };
});

/** Own one ephemeral loopback viewer subprocess; interruption stops only this child, never a shared viewer. @param {ReadonlyArray<string>} args */
export const runSdkTraceViewerCli = (args) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          options: {
            http: { type: "string" },
            grpc: { type: "string" },
            "browser-port": { type: "string" },
            "db-max-size": { type: "string" },
            check: { type: "boolean" },
          },
        }),
      catch: () =>
        ViewerFailure.make({
          message:
            "Trace viewer arguments invalid. Use --http PORT --grpc PORT --browser-port PORT --db-max-size 16MB..512MB or --check.",
        }),
    });
    const size = parsed.values["db-max-size"] ?? "64MB";
    const config = yield* parseViewerConfig({
      http: Number(parsed.values.http ?? 4318),
      grpc: Number(parsed.values.grpc ?? 4317),
      browserPort: Number(parsed.values["browser-port"] ?? 8000),
      maxSizeMb: /^\d+MB$/.test(size) ? Number(size.slice(0, -2)) : NaN,
    });
    if (new Set([config.http, config.grpc, config.browserPort]).size !== 3)
      return yield* Effect.fail(
        ViewerFailure.make({
          message:
            "Trace viewer ports must be distinct. Choose unused loopback ports; an existing viewer is never stopped.",
        }),
      );
    const compatibility = yield* checkSdkTraceViewer;
    if (!compatibility.compatible)
      return yield* Effect.fail(ViewerFailure.make({ message: compatibility.message }));
    yield* Console.log(compatibility.message);
    if (parsed.values.check) return;
    yield* Console.log(
      `Trace viewer owns an in-memory ${config.maxSizeMb}MB store at http://127.0.0.1:${config.browserPort}; OTLP http://127.0.0.1:${config.http}/v1/traces. Ctrl+C closes only this viewer. Session limit: 24 hours.`,
    );
    const result = yield* runVerificationCommand(
      "otel-desktop-viewer",
      [
        "--host",
        "127.0.0.1",
        "--open-browser=false",
        "--http",
        String(config.http),
        "--grpc",
        String(config.grpc),
        "--browser-port",
        String(config.browserPort),
        "--db-max-size",
        `${config.maxSizeMb}MB`,
      ],
      { timeout: 86_400_000 },
    );
    if (result.status !== "pass")
      return yield* Effect.fail(
        ViewerFailure.make({
          message:
            "Trace viewer stopped unsuccessfully. Check for occupied ports or the 24-hour session limit; shared viewers are never stopped.",
        }),
      );
  }).pipe(
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        ViewerFailure.make({
          message:
            "Trace viewer configuration invalid. Ports must be 1024..65535 and storage 16MB..512MB.",
        }),
      ),
    ),
  );

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(
    runSdkTraceViewerCli(process.argv.slice(2)).pipe(
      Effect.provide(verificationNodeLayer),
      Effect.catchTag("SdkTraceViewerError", (error) =>
        Effect.gen(function* () {
          yield* Console.error(error.message);
          process.exitCode = 1;
        }),
      ),
    ),
  );
}
