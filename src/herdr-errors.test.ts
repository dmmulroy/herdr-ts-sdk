import { expect, test } from "vite-plus/test";
import {
  HerdrConfigurationError,
  HerdrEventsLost,
  HerdrInvalidInput,
  HerdrInvalidResponse,
  HerdrRequestTimeout,
  HerdrServerError,
  HerdrSshAgentRegistrationClosed,
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
    new HerdrUnsupportedProtocol(0, 22, "request-1"),
    new HerdrServerError("future_server_code", "future failure", "request-1"),
    new HerdrEventsLost("event subscription fell behind", "request-1"),
    new HerdrSshAgentRegistrationClosed("request-1"),
  ] as const;

  expect(errors.map((error) => error._tag)).toEqual([
    "HerdrConfigurationError",
    "HerdrInvalidInput",
    "HerdrTransportError",
    "HerdrRequestTimeout",
    "HerdrInvalidResponse",
    "HerdrUnsupportedProtocol",
    "HerdrServerError",
    "HerdrEventsLost",
    "HerdrSshAgentRegistrationClosed",
  ]);
  expect(errors[2]).toMatchObject({ operation: "request", reason: "connect" });
  expect(errors[6]).toMatchObject({ serverCode: "future_server_code", requestId: "request-1" });
  expect(errors[7]).toMatchObject({
    serverMessage: "event subscription fell behind",
    requestId: "request-1",
  });
});

test("typed errors own searchable stable message prefixes", () => {
  const transport = new HerdrTransportError(
    "event_subscription",
    "read",
    "request-2",
    new Error("closed"),
  );
  const timeout = new HerdrRequestTimeout("ssh_agent_registration", "request-2", 1000);

  expect(transport.message.startsWith("Herdr transport failed")).toBe(true);
  expect(timeout.message.startsWith("Herdr request timed out")).toBe(true);
  expect(new HerdrEventsLost("lost", "request-2").message).toContain("session.snapshot");
});
