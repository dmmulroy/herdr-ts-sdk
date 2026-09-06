import { createServer } from "node:http";
import { Effect, Schema } from "effect";

const otlpAttribute = Schema.Struct({
  key: Schema.String,
  value: Schema.Struct({
    stringValue: Schema.optional(Schema.String),
    intValue: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
    boolValue: Schema.optional(Schema.Boolean),
  }),
});
const otlpEvent = Schema.Struct({
  name: Schema.String,
  timeUnixNano: Schema.String,
  attributes: Schema.Array(otlpAttribute),
});
const otlpLink = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  attributes: Schema.Array(otlpAttribute),
});
const otlpSpan = Schema.Struct({
  name: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
  startTimeUnixNano: Schema.String,
  endTimeUnixNano: Schema.String,
  attributes: Schema.Array(otlpAttribute),
  events: Schema.Array(otlpEvent),
  links: Schema.Array(otlpLink),
  status: Schema.Struct({ code: Schema.Number }),
});
const otlpTracePayload = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({ scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(otlpSpan) })) }),
  ),
});
const parseOtlpTracePayload = Schema.decodeUnknownSync(Schema.fromJsonString(otlpTracePayload));

/** Parse real recorded OTLP JSON into typed span observations for local integration tests. */
export const sdkTelemetryRecordedSpans = (
  requests: ReadonlyArray<{ path: string; body: string }>,
) =>
  requests
    .filter((request) => request.path === "/v1/traces")
    .flatMap((request) =>
      parseOtlpTracePayload(request.body).resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
    );

/** Scoped loopback OTLP recording fixture; captures bounded outgoing bytes, never a live Herdr socket. */
export const acquireSdkTelemetryTestServer = (
  options: { status?: number; responseBody?: string; respond?: boolean; redirect?: string } = {},
) =>
  Effect.acquireRelease(
    Effect.callback<
      {
        endpoint: string;
        requests: Array<{ path: string; body: string }>;
        server: ReturnType<typeof createServer>;
      },
      Error
    >((resume) => {
      const requests: Array<{ path: string; body: string }> = [];
      const server = createServer((request, response) => {
        const chunks: Array<Buffer> = [];
        let size = 0;
        request.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) request.destroy();
          else chunks.push(chunk);
        });
        request.on("end", () => {
          requests.push({ path: request.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
          if (options.respond === false) return;
          if (options.redirect) response.setHeader("location", options.redirect);
          response.writeHead(options.status ?? 200, { "content-type": "application/json" });
          response.end(options.responseBody ?? "{}");
        });
      });
      server.once("error", (error) => resume(Effect.fail(error)));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          resume(Effect.fail(new Error("SDK OTLP fixture did not bind TCP")));
          return;
        }
        resume(
          Effect.succeed({
            endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
            requests,
            server,
          }),
        );
      });
      return Effect.sync(() => {
        server.closeAllConnections();
        server.close();
      });
    }),
    ({ server }) =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections();
        server.close(() => resume(Effect.void));
      }),
  );
