/**
 * Frames newline-delimited JSON read from Herdr Unix sockets.
 *
 * The line buffer preserves partial frames across chunks and rejects oversized buffered data before unbounded memory can accumulate.
 *
 * @since 0.8.2
 */
import { Result } from "effect";
import { HerdrInvalidResponse } from "./herdr-errors.ts";

/**
 * Incremental byte segments retained until a complete Herdr socket line arrives.
 *
 * @category models
 * @since 0.8.2
 */
export interface HerdrSocketLineBuffer {
  /** Ordered byte segments belonging to the current unterminated line. */
  readonly segments: readonly Uint8Array[];
  /** Total bytes retained across `segments`, used to enforce the frame limit incrementally. */
  readonly byteLength: number;
}

/**
 * Complete bounded lines plus bytes not consumed after an optional line limit.
 *
 * @category models
 * @since 0.8.2
 */
export interface HerdrSocketLineSplit {
  /** Partial line state to pass into the next split operation. */
  readonly buffer: HerdrSocketLineBuffer;
  /** Complete newline-delimited frames without their newline bytes. */
  readonly lines: readonly Uint8Array[];
  /** Exact input bytes left after the requested maximum line count was reached. */
  readonly remainder: readonly Uint8Array[];
}

/**
 * Creates an empty incremental Herdr socket line buffer.
 *
 * @category constructors
 * @since 0.8.2
 */
export function makeHerdrSocketLineBuffer(): HerdrSocketLineBuffer {
  return { segments: [], byteLength: 0 };
}

/**
 * Splits socket chunks into bounded lines while preserving exact unconsumed remainder bytes.
 *
 * @category decoding
 * @since 0.8.2
 */
export function splitHerdrSocketLines(
  state: HerdrSocketLineBuffer,
  chunks: readonly Uint8Array[],
  maximumLineBytes: number,
  requestId: string,
  maximumLines = Number.POSITIVE_INFINITY,
): Result.Result<HerdrSocketLineSplit, HerdrInvalidResponse> {
  let segments = [...state.segments];
  let byteLength = state.byteLength;
  const lines: Uint8Array[] = [];

  for (const [chunkIndex, chunk] of chunks.entries()) {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      if (segment.length > 0) {
        segments.push(segment);
        byteLength += segment.length;
      }
      if (byteLength > maximumLineBytes) {
        return Result.fail(
          new HerdrInvalidResponse("oversized_frame", requestId, {
            maximumBytes: maximumLineBytes,
          }),
        );
      }
      if (newline < 0) break;

      lines.push(joinHerdrSocketLineSegments(segments, byteLength));
      segments = [];
      byteLength = 0;
      offset = newline + 1;
      if (lines.length >= maximumLines) {
        const remainder = [chunk.subarray(offset), ...chunks.slice(chunkIndex + 1)].filter(
          (bytes) => bytes.length > 0,
        );
        return Result.succeed({
          buffer: makeHerdrSocketLineBuffer(),
          lines,
          remainder,
        });
      }
    }
  }

  return Result.succeed({
    buffer: { segments, byteLength },
    lines,
    remainder: [],
  });
}

function joinHerdrSocketLineSegments(
  segments: readonly Uint8Array[],
  byteLength: number,
): Uint8Array {
  const firstSegment = segments[0];
  if (segments.length === 1 && firstSegment !== undefined) return firstSegment;
  const line = new Uint8Array(byteLength);
  let offset = 0;
  for (const segment of segments) {
    line.set(segment, offset);
    offset += segment.length;
  }
  return line;
}
