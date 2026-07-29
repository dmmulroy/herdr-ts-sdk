/** Error returned for transport, protocol, validation, and server failures. */
export class HerdrError extends Error {
  /** Narrows an unknown failure to an error created by this Herdr SDK instance. */
  static is(value: unknown): value is HerdrError {
    return value instanceof HerdrError;
  }

  /** Stable open Herdr error code. */
  readonly code: string;
  /** Wire correlation ID associated with the failure. */
  readonly requestId: string;
  /** Underlying transport or parsing failure, when one exists. */
  override readonly cause?: unknown;

  /** Creates a typed Herdr client error. */
  constructor(code: string, message: string, requestId: string, cause?: unknown) {
    super(`Herdr client error: ${message}`, { cause });
    this.name = "HerdrError";
    this.code = code;
    this.requestId = requestId;
    this.cause = cause;
  }
}
