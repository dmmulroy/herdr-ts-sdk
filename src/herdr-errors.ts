import { Option, Schema } from "effect";
import { HerdrByteLength } from "./herdr-domain.ts";

/** Failure to decode or resolve Herdr SDK configuration. */
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

/** Failure to parse caller input into the domain value required by one SDK operation. */
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

/** Local Unix-socket connection, read, write, or premature-close failure. */
export class HerdrTransportError extends Schema.TaggedError<HerdrTransportError>()(
  "HerdrTransportError",
  {
    operation: Schema.Literals([
      "request",
      "compatibility_check",
      "event_subscription",
      "graphics_stream",
      "graphics_write",
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

/** Local deadline elapsed before a Herdr operation completed. */
export class HerdrRequestTimeout extends Schema.TaggedError<HerdrRequestTimeout>()(
  "HerdrRequestTimeout",
  {
    operation: Schema.Literals([
      "request",
      "compatibility_check",
      "event_subscription",
      "graphics_stream",
      "graphics_write",
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

/** Malformed, oversized, mismatched, or schema-invalid Herdr response. */
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

/** Server protocol version differs from protocol 21 supported by this SDK. */
export class HerdrUnsupportedProtocol extends Schema.TaggedError<HerdrUnsupportedProtocol>()(
  "HerdrUnsupportedProtocol",
  {
    actualProtocol: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    supportedProtocol: Schema.Literal(21),
    requestId: Schema.String,
    message: Schema.String,
  },
) {
  /** Creates a protocol compatibility failure from the ping handshake. */
  constructor(actualProtocol: number, supportedProtocol: 21, requestId: string) {
    super({
      actualProtocol,
      supportedProtocol,
      requestId,
      message: `Herdr protocol is unsupported: server uses ${actualProtocol}, SDK requires ${supportedProtocol}. Install compatible Herdr and SDK versions.`,
    });
  }
}

/** Success result discriminant is not supported for the requested operation. */
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

/** Event discriminant is not supported by this SDK build. */
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

/** Open-code server-returned failure correlated to one request. */
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

/** Graphics frame has invalid data or dimensions. */
export class HerdrInvalidFrame extends Schema.TaggedError<HerdrInvalidFrame>()(
  "HerdrInvalidFrame",
  {
    operation: Schema.Literals(["graphics_set", "graphics_stream"]),
    reason: Schema.Literals(["empty_data", "schema_mismatch"]),
    requestId: Schema.Option(Schema.String),
    message: Schema.String,
  },
) {
  /** Creates a graphics frame parse failure before bytes are written. */
  constructor(
    operation: HerdrInvalidFrame["operation"],
    reason: HerdrInvalidFrame["reason"],
    requestId?: string,
  ) {
    super({
      operation,
      reason,
      requestId: Option.fromNullishOr(requestId),
      message: `Herdr graphics frame is invalid during ${operation}: ${reason}. Supply non-empty data with positive integer dimensions.`,
    });
  }
}

/** Graphics image exceeds the byte limit for its write mode. */
export class HerdrImageTooLarge extends Schema.TaggedError<HerdrImageTooLarge>()(
  "HerdrImageTooLarge",
  {
    operation: Schema.Literals(["graphics_set", "graphics_stream"]),
    actualBytes: HerdrByteLength,
    maximumBytes: HerdrByteLength,
    requestId: Schema.Option(Schema.String),
    message: Schema.String,
  },
) {
  /** Creates an oversized graphics image failure before socket I/O. */
  constructor(
    operation: HerdrImageTooLarge["operation"],
    actualBytes: number,
    maximumBytes: number,
    requestId?: string,
  ) {
    super({
      operation,
      actualBytes: HerdrByteLength.make(actualBytes),
      maximumBytes: HerdrByteLength.make(maximumBytes),
      requestId: Option.fromNullishOr(requestId),
      message: `Herdr graphics image is too large during ${operation}: received ${actualBytes} bytes, maximum ${maximumBytes} bytes. Reduce the image size and try again.`,
    });
  }
}

/** Graphics writer was used after its owning scope closed. */
export class HerdrGraphicsStreamClosed extends Schema.TaggedError<HerdrGraphicsStreamClosed>()(
  "HerdrGraphicsStreamClosed",
  {
    requestId: Schema.String,
    message: Schema.String,
  },
) {
  /** Creates a closed-resource failure for a graphics write. */
  constructor(requestId: string) {
    super({
      requestId,
      message:
        "Herdr graphics stream is closed. Acquire a new writer inside an active Effect scope.",
    });
  }
}
