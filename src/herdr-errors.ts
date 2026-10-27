/**
 * Defines the typed failures exposed by Herdr SDK operations.
 *
 * Schema-backed tagged errors distinguish configuration, input, transport, timeout, compatibility, server, response, event, and SSH agent registration failures for targeted recovery.
 *
 * @since 0.8.2
 */
import { Schema } from "effect";

/**
 * Failure to decode or resolve Herdr SDK configuration.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrConfigurationError extends Schema.TaggedError<HerdrConfigurationError>()(
  "HerdrConfigurationError",
  {
    operation: Schema.Literal("loadHerdrConfig"),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Creates a safe configuration failure while retaining the diagnostic cause. */
  constructor(cause: unknown) {
    super({
      operation: "loadHerdrConfig",
      message:
        "Herdr configuration loading failed. Correct the SDK options or Herdr environment configuration and try again.",
      cause,
    });
  }
}

/**
 * Failure to parse caller input into the domain value required by one SDK operation.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrInvalidInput extends Schema.TaggedError<HerdrInvalidInput>()(
  "HerdrInvalidInput",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Creates an input parse failure at a named public operation boundary. */
  constructor(operation: string, cause: unknown) {
    super({
      operation,
      message: `Herdr input parsing failed for ${operation}. Correct the supplied value and try again.`,
      cause,
    });
  }
}

/**
 * Local Unix-socket connection, read, write, or premature-close failure.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrTransportError extends Schema.TaggedError<HerdrTransportError>()(
  "HerdrTransportError",
  {
    operation: Schema.Literals([
      "request",
      "compatibility_check",
      "event_subscription",
      "ssh_agent_registration",
    ]),
    reason: Schema.Literals(["connect", "read", "write", "premature_close"]),
    requestId: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Creates a classified transport failure with its wire correlation identifier. */
  constructor(
    operation: HerdrTransportError["operation"],
    reason: HerdrTransportError["reason"],
    requestId: string,
    cause: unknown,
  ) {
    super({
      operation,
      reason,
      requestId,
      message: `Herdr transport failed during ${operation}: ${reason}. The server outcome may be uncertain; inspect the affected resources before retrying.`,
      cause,
    });
  }
}

/**
 * Local deadline elapsed before a Herdr operation completed.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrRequestTimeout extends Schema.TaggedError<HerdrRequestTimeout>()(
  "HerdrRequestTimeout",
  {
    operation: Schema.Literals([
      "request",
      "compatibility_check",
      "event_subscription",
      "ssh_agent_registration",
    ]),
    requestId: Schema.String,
    timeoutMilliseconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    message: Schema.String,
  },
) {
  /** Creates a local deadline failure without classifying fiber interruption as a timeout. */
  constructor(
    operation: HerdrRequestTimeout["operation"],
    requestId: string,
    timeoutMilliseconds: number,
  ) {
    super({
      operation,
      requestId,
      timeoutMilliseconds,
      message: `Herdr request timed out during ${operation} after ${timeoutMilliseconds} milliseconds. The server outcome may be uncertain; inspect the affected resources before retrying with a longer deadline.`,
    });
  }
}

/**
 * Malformed, oversized, mismatched, or schema-invalid Herdr response.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrInvalidResponse extends Schema.TaggedError<HerdrInvalidResponse>()(
  "HerdrInvalidResponse",
  {
    reason: Schema.Literals([
      "malformed_json",
      "oversized_frame",
      "correlation_mismatch",
      "schema_mismatch",
      "missing_result",
      "unsupported_value",
    ]),
    requestId: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Creates a classified response-boundary failure. */
  constructor(reason: HerdrInvalidResponse["reason"], requestId: string, cause: unknown) {
    super({
      reason,
      requestId,
      message: `Herdr response parsing failed: ${reason}. The server response is incompatible with this SDK build.`,
      cause,
    });
  }
}

/**
 * Server protocol version differs from protocol 22 supported by this SDK.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrUnsupportedProtocol extends Schema.TaggedError<HerdrUnsupportedProtocol>()(
  "HerdrUnsupportedProtocol",
  {
    actualProtocol: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    supportedProtocol: Schema.Literal(22),
    requestId: Schema.String,
    message: Schema.String,
  },
) {
  /** Creates a protocol compatibility failure from the ping handshake. */
  constructor(actualProtocol: number, supportedProtocol: 22, requestId: string) {
    super({
      actualProtocol,
      supportedProtocol,
      requestId,
      message: `Herdr protocol is unsupported: server uses ${actualProtocol}, SDK requires ${supportedProtocol}. Install compatible Herdr and SDK versions.`,
    });
  }
}

/**
 * Success result discriminant is not supported for the requested operation.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrUnsupportedResult extends Schema.TaggedError<HerdrUnsupportedResult>()(
  "HerdrUnsupportedResult",
  {
    operation: Schema.String,
    actualType: Schema.String,
    expectedType: Schema.String,
    requestId: Schema.String,
    message: Schema.String,
  },
) {
  /** Creates an unsupported success-result failure. */
  constructor(operation: string, actualType: string, expectedType: string, requestId: string) {
    super({
      operation,
      actualType,
      expectedType,
      requestId,
      message: `Herdr result is unsupported for ${operation}: received ${actualType}, expected ${expectedType}. Update the SDK or use a compatible server.`,
    });
  }
}

/**
 * Event discriminant is not supported by this SDK build.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrUnsupportedEvent extends Schema.TaggedError<HerdrUnsupportedEvent>()(
  "HerdrUnsupportedEvent",
  {
    eventType: Schema.String,
    requestId: Schema.String,
    message: Schema.String,
  },
) {
  /** Creates an unsupported event failure from a subscription or wait boundary. */
  constructor(eventType: string, requestId: string) {
    super({
      eventType,
      requestId,
      message: `Herdr event is unsupported: ${eventType}. Update the SDK or narrow the subscription to supported events.`,
    });
  }
}

/**
 * Open-code server-returned failure correlated to one request.
 *
 * @category errors
 * @since 0.8.2
 */
export class HerdrServerError extends Schema.TaggedError<HerdrServerError>()("HerdrServerError", {
  serverCode: Schema.String,
  serverMessage: Schema.String,
  requestId: Schema.String,
  message: Schema.String,
}) {
  /** Creates a typed boundary error while preserving the server's open code space. */
  constructor(serverCode: string, serverMessage: string, requestId: string) {
    super({
      serverCode,
      serverMessage,
      requestId,
      message: `Herdr server rejected the request with ${serverCode}: ${serverMessage}`,
    });
  }
}

/**
 * Event subscription fell behind Herdr's retained history and was closed by the server.
 *
 * Cached state derived from the subscription is stale. Open a new subscription, wait for it to be
 * accepted, then reconcile through authoritative reads such as `session.snapshot`.
 *
 * @category errors
 * @since 0.9.5
 */
export class HerdrEventsLost extends Schema.TaggedError<HerdrEventsLost>()("HerdrEventsLost", {
  serverMessage: Schema.String,
  requestId: Schema.String,
  message: Schema.String,
}) {
  /** Creates a subscription overrun failure from the server's `events_lost` response. */
  constructor(serverMessage: string, requestId: string) {
    super({
      serverMessage,
      requestId,
      message:
        "Herdr event subscription fell behind retained history and was closed; events were missed. Resubscribe, then reconcile cached state with session.snapshot.",
    });
  }
}

/**
 * Herdr ended a connection-scoped SSH agent registration before its owner released it.
 *
 * @category errors
 * @since 0.9.5
 */
export class HerdrSshAgentRegistrationClosed extends Schema.TaggedError<HerdrSshAgentRegistrationClosed>()(
  "HerdrSshAgentRegistrationClosed",
  {
    requestId: Schema.String,
    message: Schema.String,
  },
) {
  /** Creates a lease-ended failure when the server closes the registration connection. */
  constructor(requestId: string) {
    super({
      requestId,
      message:
        "Herdr SSH agent registration ended because the server closed its connection. Herdr panes can no longer reach this agent through the registration; register it again if the server is still running.",
    });
  }
}
