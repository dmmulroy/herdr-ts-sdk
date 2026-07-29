import type { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { HerdrError } from "./herdr-error.ts";
import { assertHerdrWireEvent } from "./herdr-wire-parser.ts";
import {
  normalizeHerdrNamedResources,
  toCamelCaseValue,
  toSnakeCaseValue,
} from "./herdr-transport.ts";
import type {
  HerdrEvent,
  HerdrEventStream,
  HerdrRequestOptions,
  JsonValue,
  PaneGraphicsFrame,
  PaneGraphicsStream,
  PaneId,
} from "./herdr-public-api.ts";

const MAX_GRAPHICS_STREAM_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_EVENT_LINE_BYTES = 1024 * 1024;
const HERDR_EVENT_TYPES = new Set([
  "workspace.created",
  "workspace.updated",
  "workspace.metadata_updated",
  "workspace.closed",
  "workspace.renamed",
  "workspace.moved",
  "workspace.reordered",
  "workspace.focused",
  "worktree.created",
  "worktree.opened",
  "worktree.removed",
  "tab.created",
  "tab.closed",
  "tab.renamed",
  "tab.moved",
  "tab.focused",
  "pane.created",
  "pane.closed",
  "pane.updated",
  "pane.focused",
  "pane.moved",
  "pane.output_changed",
  "pane.exited",
  "pane.agent_detected",
  "pane.agent_status_changed",
  "pane.scroll_changed",
  "pane.output_matched",
  "layout.updated",
]);

/** Async event stream backed by one Herdr subscription socket. */
export class SocketHerdrEventStream<Event extends HerdrEvent> implements HerdrEventStream<Event> {
  #closed = false;
  readonly #socket: Socket;
  readonly #requestId: string;
  readonly #values: Event[] = [];
  readonly #waiting: Array<{
    readonly resolve: (value: IteratorResult<Event>) => void;
    readonly reject: (failure: HerdrError) => void;
  }> = [];
  readonly #decoder = new StringDecoder("utf8");
  #buffer = "";
  #failure: HerdrError | undefined;
  readonly #signal: AbortSignal | undefined;
  readonly #onAbort = (): void => {
    this.finish(
      new HerdrError(
        "aborted",
        "Event subscription was aborted",
        this.#requestId,
        this.#signal?.reason,
      ),
    );
    this.#socket.destroy();
  };

  /** Starts consuming normalized dot-named events from an open socket. */
  constructor(socket: Socket, requestId: string, signal?: AbortSignal) {
    this.#socket = socket;
    this.#requestId = requestId;
    this.#signal = signal;
    socket.setTimeout(0);
    signal?.addEventListener("abort", this.#onAbort, { once: true });
    if (signal?.aborted === true) this.#onAbort();
    socket.on("data", (chunk: Buffer) => this.consumeChunk(chunk));
    socket.once("error", (cause: Error) =>
      this.finish(
        new HerdrError("transport_error", "Event subscription socket failed", requestId, cause),
      ),
    );
    socket.once("end", () => this.finish());
  }

  /** Whether this event subscription has ended locally or remotely. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Closes the event subscription and completes pending iteration. */
  async close(): Promise<void> {
    this.finish();
    this.#socket.destroy();
  }

  /** Iterates events in socket order until closure. */
  [Symbol.asyncIterator](): AsyncIterator<Event> {
    return { next: async (): Promise<IteratorResult<Event>> => this.nextEvent() };
  }

  private async nextEvent(): Promise<IteratorResult<Event>> {
    const value = this.#values.shift();
    if (value !== undefined) return { done: false, value };
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#closed) return { done: true, value: undefined };
    return await new Promise((resolve, reject) => this.#waiting.push({ resolve, reject }));
  }

  private consumeChunk(chunk: Buffer): void {
    this.#buffer += this.#decoder.write(chunk);
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) {
        if (Buffer.byteLength(this.#buffer, "utf8") > MAX_EVENT_LINE_BYTES) {
          this.finish(new HerdrError("invalid_event", "Event line exceeds 1 MiB", this.#requestId));
          this.#socket.destroy();
        }
        return;
      }
      if (Buffer.byteLength(this.#buffer.slice(0, newline), "utf8") > MAX_EVENT_LINE_BYTES) {
        this.finish(new HerdrError("invalid_event", "Event line exceeds 1 MiB", this.#requestId));
        this.#socket.destroy();
        return;
      }
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.trim().length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        const parsedEvent = parseHerdrEventEnvelope(parsed, this.#requestId);
        // SAFETY: Event is constrained by the subscriptions used to construct this generic stream.
        const event = parsedEvent as Event;
        const waiter = this.#waiting.shift();
        if (waiter === undefined) this.#values.push(event);
        else waiter.resolve({ done: false, value: event });
      } catch (cause) {
        this.finish(
          HerdrError.is(cause)
            ? cause
            : new HerdrError(
                "invalid_event",
                "Event contains invalid JSON",
                this.#requestId,
                cause,
              ),
        );
        this.#socket.destroy();
        return;
      }
    }
  }

  private finish(failure?: HerdrError): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#failure = failure;
    this.#signal?.removeEventListener("abort", this.#onAbort);
    this.#values.length = 0;
    for (const waiter of this.#waiting.splice(0)) {
      if (failure === undefined) waiter.resolve({ done: true, value: undefined });
      else waiter.reject(failure);
    }
  }
}

/** Graphics stream that writes JSON headers followed by raw image bytes. */
export class SocketPaneGraphicsStream implements PaneGraphicsStream {
  #closed = false;
  #failure: HerdrError | undefined;
  readonly #socket: Socket;
  readonly #requestId: string;
  /** Pane receiving all graphics stream frames. */
  readonly paneId: PaneId;
  readonly #signal: AbortSignal | undefined;
  readonly #onAbort = (): void => {
    this.finish(
      new HerdrError(
        "aborted",
        "Graphics stream was aborted",
        this.#requestId,
        this.#signal?.reason,
      ),
    );
    this.#socket.destroy();
  };
  readonly #onSocketError = (cause: Error): void => {
    this.finish(
      new HerdrError("transport_error", "Graphics stream socket failed", this.#requestId, cause),
    );
  };
  readonly #onSocketEnd = (): void => this.finish();

  /** Creates a graphics frame stream over an initialized socket. */
  constructor(socket: Socket, requestId: string, paneId: PaneId, signal?: AbortSignal) {
    this.#socket = socket;
    this.#requestId = requestId;
    this.paneId = paneId;
    this.#signal = signal;
    socket.setTimeout(0);
    socket.once("error", this.#onSocketError);
    socket.once("end", this.#onSocketEnd);
    signal?.addEventListener("abort", this.#onAbort, { once: true });
    if (signal?.aborted === true) this.#onAbort();
  }

  /** Whether this graphics stream can no longer accept frames. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Writes one frame after enforcing Herdr's 16 MiB stream limit. */
  async write(frame: PaneGraphicsFrame, options: HerdrRequestOptions = {}): Promise<void> {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#closed)
      throw new HerdrError("stream_closed", "Graphics stream is already closed", this.#requestId);
    if (frame.data.byteLength > MAX_GRAPHICS_STREAM_FRAME_BYTES)
      throw new HerdrError(
        "image_too_large",
        "Graphics stream frame exceeds 16 MiB",
        this.#requestId,
      );
    if (frame.data.byteLength === 0)
      throw new HerdrError(
        "invalid_frame",
        "Graphics stream frame must contain data",
        this.#requestId,
      );
    if (
      !Number.isInteger(frame.imageWidth) ||
      frame.imageWidth <= 0 ||
      !Number.isInteger(frame.imageHeight) ||
      frame.imageHeight <= 0
    )
      throw new HerdrError(
        "invalid_frame",
        "Graphics stream dimensions must be positive integers",
        this.#requestId,
      );
    if (options.signal?.aborted === true)
      throw new HerdrError(
        "aborted",
        "Graphics stream write was aborted",
        this.#requestId,
        options.signal.reason,
      );
    const header = toSnakeCaseValue({
      format: frame.format,
      imageWidth: frame.imageWidth,
      imageHeight: frame.imageHeight,
      dataLength: frame.data.byteLength,
      placement: frame.placement,
    });
    await writeSocketBytes(
      this.#socket,
      Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`), Buffer.from(frame.data)]),
      this.#requestId,
      options,
    );
  }

  /** Closes the graphics stream and clears its server-owned layer. */
  async close(): Promise<void> {
    if (!this.#closed) {
      this.finish();
      this.#socket.end();
    }
  }

  private finish(failure?: HerdrError): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#failure = failure;
    this.#signal?.removeEventListener("abort", this.#onAbort);
    this.#socket.off("error", this.#onSocketError);
    this.#socket.off("end", this.#onSocketEnd);
  }
}

/** Normalizes either Herdr event envelope family to one public dot-named event. */
export function parseHerdrEventEnvelope(value: unknown, requestId: string): HerdrEvent {
  if (value === null || typeof value !== "object")
    throw new HerdrError("invalid_event", "Event envelope must be an object", requestId);
  const envelope = value as { readonly event?: unknown; readonly data?: unknown };
  if (
    typeof envelope.event !== "string" ||
    envelope.data === null ||
    typeof envelope.data !== "object"
  )
    throw new HerdrError("invalid_event", "Event envelope is malformed", requestId);
  const camel = normalizeHerdrNamedResources(toCamelCaseValue(envelope.data, true));
  if (!isJsonObject(camel))
    throw new HerdrError("invalid_event", "Event data must be an object", requestId);
  const separator = envelope.event.indexOf("_");
  const eventType =
    envelope.event.includes(".") || separator < 0
      ? envelope.event
      : `${envelope.event.slice(0, separator)}.${envelope.event.slice(separator + 1)}`;
  if (!HERDR_EVENT_TYPES.has(eventType))
    throw new HerdrError(
      "unsupported_event",
      `Unsupported event discriminant ${eventType}`,
      requestId,
    );
  assertHerdrWireEvent(value, requestId);
  const eventValue = { ...camel, type: eventType };
  // SAFETY: The public event union mirrors the bundled protocol schema; envelope and discriminant shapes were checked above.
  return eventValue as HerdrEvent;
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function writeSocketBytes(
  socket: Socket,
  bytes: Buffer,
  requestId: string,
  options: HerdrRequestOptions,
): Promise<void> {
  const timeoutMs = options.requestTimeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs < 0)
  )
    throw new HerdrError(
      "invalid_argument",
      "Graphics stream write timeout must be a finite non-negative integer",
      requestId,
    );
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (failure: HerdrError): void => {
      cleanup();
      socket.destroy();
      reject(failure);
    };
    const onAbort = (): void =>
      fail(
        new HerdrError(
          "aborted",
          "Graphics stream write was aborted",
          requestId,
          options.signal?.reason,
        ),
      );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined)
      timer = setTimeout(
        () => fail(new HerdrError("timeout", "Graphics stream write deadline exceeded", requestId)),
        timeoutMs,
      );
    socket.write(bytes, (cause?: Error | null) => {
      cleanup();
      if (cause === undefined || cause === null) resolve();
      else
        reject(new HerdrError("transport_error", "Graphics stream write failed", requestId, cause));
    });
  });
}
