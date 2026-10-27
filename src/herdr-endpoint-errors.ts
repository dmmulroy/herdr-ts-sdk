/**
 * Classifies client-shell endpoint failures without including terminal text or payload bytes.
 * Requests and input writes are never retried automatically after an uncertain outcome.
 * @since 0.9.0
 */
import { Schema } from "effect";

/** Endpoint generation or required codec negotiation failed. @category errors @since 0.9.0 */
export class HerdrEndpointNegotiationError extends Schema.TaggedError<HerdrEndpointNegotiationError>()(
  "HerdrEndpointNegotiationError",
  {
    reason: Schema.Literals(["welcome", "generation", "codec", "rejected", "capability"]),
    message: Schema.String,
  },
) {
  /** Creates a bounded negotiation failure without server payloads. */
  constructor(reason: HerdrEndpointNegotiationError["reason"]) {
    super({
      reason,
      message: `Herdr endpoint negotiation failed: ${reason}. Use a compatible Herdr 0.9.5 endpoint.`,
    });
  }
}
/** Endpoint socket acquisition or I/O failed. @category errors @since 0.9.0 */
export class HerdrEndpointTransportError extends Schema.TaggedError<HerdrEndpointTransportError>()(
  "HerdrEndpointTransportError",
  {
    reason: Schema.Literals(["connect", "read", "write", "premature_close"]),
    message: Schema.String,
  },
) {
  /** Creates a safe I/O failure; remote write outcomes can be uncertain. */
  constructor(reason: HerdrEndpointTransportError["reason"]) {
    super({
      reason,
      message: `Herdr endpoint transport failed: ${reason}. Inspect the affected resource before retrying.`,
    });
  }
}
/** Endpoint framing, chunking, or presentation data violated its negotiated contract. @category errors @since 0.9.0 */
export class HerdrEndpointInvalidMessage extends Schema.TaggedError<HerdrEndpointInvalidMessage>()(
  "HerdrEndpointInvalidMessage",
  {
    reason: Schema.Literals([
      "framing",
      "oversized_frame",
      "schema",
      "correlation",
      "revision",
      "unsupported_message",
      "resource_limit",
    ]),
    message: Schema.String,
  },
) {
  /** Creates a bounded binary/JSON protocol failure without embedding content. */
  constructor(reason: HerdrEndpointInvalidMessage["reason"]) {
    super({
      reason,
      message: `Herdr endpoint message is invalid: ${reason}. Reconnect to a compatible endpoint; do not replay mutations automatically.`,
    });
  }
}
/** A bounded endpoint acquisition, request, or health probe expired. @category errors @since 0.9.0 */
export class HerdrEndpointRequestTimeout extends Schema.TaggedError<HerdrEndpointRequestTimeout>()(
  "HerdrEndpointRequestTimeout",
  {
    operation: Schema.Literals(["connect", "request", "write", "health", "surface"]),
    message: Schema.String,
  },
) {
  /** Creates a deadline failure that does not imply an operation was never delivered. */
  constructor(operation: HerdrEndpointRequestTimeout["operation"]) {
    super({
      operation,
      message: `Herdr endpoint deadline elapsed during ${operation}. The remote outcome may be uncertain; inspect before retrying.`,
    });
  }
}
/** A connection handle was used after its owning session ended. @category errors @since 0.9.0 */
export class HerdrEndpointClosed extends Schema.TaggedError<HerdrEndpointClosed>()(
  "HerdrEndpointClosed",
  { message: Schema.String },
) {
  /** Creates a use-after-close failure. */
  constructor() {
    super({
      message:
        "Herdr endpoint session is closed. Use the connection only within its owning callback or Scope.",
    });
  }
}
/** Endpoint does not advertise a requested optional API method. @category errors @since 0.9.0 */
export class HerdrEndpointUnsupportedMethod extends Schema.TaggedError<HerdrEndpointUnsupportedMethod>()(
  "HerdrEndpointUnsupportedMethod",
  { method: Schema.String, message: Schema.String },
) {
  /** Records the method name, never its parameters. */
  constructor(method: string) {
    super({
      method,
      message: `Herdr endpoint does not advertise ${method}. Choose a supported action or update the server.`,
    });
  }
}
/** An endpoint-issued handle belongs to another connection or boot. @category errors @since 0.9.0 */
export class HerdrEndpointStaleReference extends Schema.TaggedError<HerdrEndpointStaleReference>()(
  "HerdrEndpointStaleReference",
  { message: Schema.String },
) {
  /** Creates a stale-handle failure without replaying the requested operation. */
  constructor() {
    super({
      message:
        "Herdr endpoint reference is stale. Discover the command again on this live connection before invoking it.",
    });
  }
}
/** Failures that terminate a client-shell resource lifetime. @category errors @since 0.9.0 */
export type HerdrEndpointFailure =
  | HerdrEndpointNegotiationError
  | HerdrEndpointTransportError
  | HerdrEndpointInvalidMessage
  | HerdrEndpointRequestTimeout
  | HerdrEndpointClosed;
