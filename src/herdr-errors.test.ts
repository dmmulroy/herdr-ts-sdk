import { expect, test } from "vite-plus/test";
import {
  HerdrConfigurationError,
  HerdrImageTooLarge,
  HerdrInvalidInput,
  HerdrInvalidResponse,
  HerdrRequestTimeout,
  HerdrServerError,
  HerdrTransportError,
  HerdrUnsupportedProtocol,
} from "./herdr-errors.ts";

test("typed errors preserve stable tags and structured diagnostic context", () => {
  const errors = [
    new HerdrConfigurationError(new Error("bad config")),
    new HerdrInvalidInput("PaneService.split", new Error("bad ratio")),
    new HerdrTransportError("request", "connect", "request-1", new Error("ENOENT")),
    new HerdrRequestTimeout("request", "request-1", 500),
    new HerdrInvalidResponse("schema_mismatch", "request-1", new Error("bad response")),
    new HerdrUnsupportedProtocol(20, [19, 20, 21], "request-1"),
    new HerdrServerError("future_server_code", "future failure", "request-1"),
    new HerdrImageTooLarge("graphics_stream", 17, 16, "request-1"),
  ] as const;

  expect(errors.map((error) => error._tag)).toEqual([
    "HerdrConfigurationError",
    "HerdrInvalidInput",
    "HerdrTransportError",
    "HerdrRequestTimeout",
    "HerdrInvalidResponse",
    "HerdrUnsupportedProtocol",
    "HerdrServerError",
    "HerdrImageTooLarge",
  ]);
  expect(errors[2]).toMatchObject({ operation: "request", reason: "connect" });
  expect(errors[6]).toMatchObject({ serverCode: "future_server_code", requestId: "request-1" });
});

test("typed errors own searchable stable message prefixes", () => {
  const transport = new HerdrTransportError(
    "event_subscription",
    "read",
    "request-2",
    new Error("closed"),
  );
  const timeout = new HerdrRequestTimeout("graphics_write", "request-2", 1000);

  expect(transport.message.startsWith("Herdr transport failed")).toBe(true);
  expect(timeout.message.startsWith("Herdr request timed out")).toBe(true);
});
