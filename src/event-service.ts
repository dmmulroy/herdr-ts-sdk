/**
 * Consumes Herdr lifecycle and pane events as typed Effect values.
 *
 * Subscriptions are cold, live-only streams with literal-specification narrowing; one-shot waits preserve the event type selected by their matcher.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Result, Schema, Stream } from "effect";
import herdrApiSchema from "../schema/herdr-api.schema.json" with { type: "json" };
import type { EventEnvelope } from "./generated/wire-event.ts";
import type { SubscriptionEventEnvelope } from "./generated/wire-subscription-event.ts";
import { parseHerdrWireEvent } from "./herdr-wire-parser.ts";
import {
  EventMatch,
  type EventMatch as EventMatchValue,
  type EventMatchEncoded,
  type EventForMatch,
  type EventForSubscription,
  EventSubscriptionSpec,
  type EventSubscriptionSpecEncoded,
  EventWaitInput,
  type EventWaitInputEncoded,
  HerdrEvent,
  type HerdrEvent as HerdrEventValue,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import {
  HerdrInvalidResponse,
  HerdrTransportError,
  HerdrUnsupportedEvent,
} from "./herdr-errors.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  type HerdrSocketLineBuffer,
  makeHerdrSocketLineBuffer,
  splitHerdrSocketLines,
} from "./herdr-socket-lines.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const MAX_EVENT_LINE_BYTES = 1024 * 1024;
// Decode complete bounded lines; preserve BOMs so JSON parsing rejects them.
const eventUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const HerdrEventEnvelopeProbe = Schema.Struct({ event: Schema.String });
const parseHerdrEventEnvelopeProbe = Schema.decodeUnknownOption(HerdrEventEnvelopeProbe);
const parseHerdrEventResult = Schema.decodeUnknownResult(HerdrEvent);
const lifecycleEventKinds = new Set(herdrApiSchema.schemas.event.$defs.EventKind.enum);
const supportedEventKinds = new Set([
  ...lifecycleEventKinds,
  ...herdrApiSchema.schemas.subscription_event.$defs.SubscriptionEventKind.enum,
]);
const encodeEventSubscriptionSpec = Schema.encodeEffect(EventSubscriptionSpec);
const parseEventMatch = Schema.decodeUnknownEffect(EventMatch);
const parseEventSubscriptionSpec = Schema.decodeUnknownEffect(EventSubscriptionSpec);
const parseEventWaitInput = Schema.decodeUnknownEffect(EventWaitInput);
const parseHerdrEvent = Schema.decodeUnknownEffect(HerdrEvent);

/**
 * Expected failures for subscription and one-shot event operations.
 *
 * @category errors
 * @since 0.8.2
 */
export type EventOperationError = HerdrTransportRequestError | HerdrUnsupportedEvent;

/**
 * Typed event subscription and one-shot wait capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IEventService {
  /** Creates a cold, live-only stream whose acceptance defines the event sequence start. */
  readonly subscribe: <const Subscriptions extends readonly EventSubscriptionSpecEncoded[]>(
    subscriptions: Subscriptions,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Stream.Stream<EventForSubscription<Subscriptions[number]>, EventOperationError>;
  /** Waits for one event and preserves its match-specific result type. */
  readonly wait: <const Match extends EventMatchEncoded>(
    match: Match,
    input?: EventWaitInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<EventForMatch<Match>, EventOperationError>;
}

/**
 * Yieldable Effect service for Herdr event operations.
 *
 * @category services
 * @since 0.8.2
 */
export class EventService extends Context.Service<EventService, IEventService>()(
  "@herdr/sdk/EventService",
) {}

/**
 * Constructs event operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeEventService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  return EventService.of({
    subscribe: (subscriptions, options = {}) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const parsedSubscriptions = yield* Effect.forEach(subscriptions, (subscription) =>
            decodeHerdrInput("EventService.subscribe", parseEventSubscriptionSpec, subscription),
          );
          const encodedSubscriptions = yield* Effect.forEach(parsedSubscriptions, (subscription) =>
            encodeEventSubscriptionSpec(subscription).pipe(Effect.orDie),
          );
          const opened = yield* transport.openStream(
            "events.subscribe",
            { subscriptions: encodedSubscriptions },
            options,
          );
          return decodeHerdrEventStream(opened.readBytes, opened.requestId, subscriptions);
        }),
      ).pipe(Stream.withSpan("EventService.subscribe")),
    wait: defineHerdrOperation("EventService.wait", (match, input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsedMatch = yield* decodeHerdrInput(
          "EventService.wait.match",
          parseEventMatch,
          match,
        );
        const parsedInput = yield* decodeHerdrInput(
          "EventService.wait",
          parseEventWaitInput,
          input,
        );
        const response = yield* transport.request(
          "events.wait",
          {
            matchEvent: encodeEventMatch(parsedMatch),
            timeoutMs: Option.getOrNull(parsedInput.timeoutMs),
          },
          options,
        );
        const event = yield* decodeHerdrWire(
          parseHerdrEvent,
          response.result.event.data,
          response.requestId,
        );
        if (isEventForMatch(event, match)) return event;
        return yield* new HerdrInvalidResponse(
          "schema_mismatch",
          response.requestId,
          new Error("Herdr wait returned a different event type than the requested match"),
        );
      }),
    ),
  });
});

/**
 * Provides event operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const eventServiceLayerWithoutDependencies: Layer.Layer<
  EventService,
  never,
  HerdrTransport
> = Layer.effect(EventService, makeEventService);

/**
 * Production event-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const eventServiceLayer = eventServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);

function decodeEventLine(
  bytes: Uint8Array,
  requestId: string,
): Result.Result<HerdrEventValue, HerdrInvalidResponse | HerdrUnsupportedEvent> {
  const parsedJson = Result.try({
    try: () => JSON.parse(eventUtf8Decoder.decode(bytes)),
    catch: (cause) => new HerdrInvalidResponse("malformed_json", requestId, cause),
  });
  if (Result.isFailure(parsedJson)) return parsedJson;

  const parsedEnvelope = Result.try({
    try: () => parseHerdrWireEvent(parsedJson.success, requestId),
    catch: (cause) => {
      const probe = parseHerdrEventEnvelopeProbe(parsedJson.success);
      return Option.isSome(probe) && !supportedEventKinds.has(probe.value.event)
        ? new HerdrUnsupportedEvent(probe.value.event, requestId)
        : new HerdrInvalidResponse("schema_mismatch", requestId, cause);
    },
  });
  if (Result.isFailure(parsedEnvelope)) return Result.fail(parsedEnvelope.failure);

  const envelope = parsedEnvelope.success;
  // The wire schema validates these discriminants independently, not their agreement.
  if (lifecycleEventKinds.has(envelope.event) && envelope.event !== envelope.data.type) {
    return Result.fail(
      new HerdrInvalidResponse(
        "schema_mismatch",
        requestId,
        new Error("Herdr event envelope kind differs from its payload type"),
      ),
    );
  }

  return parseHerdrEventResult(eventDataWithType(envelope)).pipe(
    Result.mapError((cause) => new HerdrInvalidResponse("schema_mismatch", requestId, cause)),
  );
}

type HerdrEventStreamInput =
  | { readonly _tag: "Bytes"; readonly value: Uint8Array }
  | { readonly _tag: "End" };

function decodeHerdrEventStream<
  const Subscriptions extends readonly EventSubscriptionSpecEncoded[],
>(
  bytes: Stream.Stream<Uint8Array, HerdrTransportError>,
  requestId: string,
  subscriptions: Subscriptions,
): Stream.Stream<EventForSubscription<Subscriptions[number]>, EventOperationError> {
  const inputs: Stream.Stream<HerdrEventStreamInput, HerdrTransportError> = bytes.pipe(
    Stream.map((value) => ({ _tag: "Bytes", value }) as const),
    Stream.concat(Stream.succeed({ _tag: "End" } as const)),
  );
  return inputs.pipe(
    Stream.mapAccumArray(makeHerdrSocketLineBuffer, (state, input) =>
      parseHerdrEventChunks(state, input, requestId, subscriptions),
    ),
    Stream.mapEffect((decoded) =>
      Result.match(decoded, {
        onFailure: Effect.fail,
        onSuccess: Effect.succeed,
      }),
    ),
  );
}

function parseHerdrEventChunks<const Subscriptions extends readonly EventSubscriptionSpecEncoded[]>(
  state: HerdrSocketLineBuffer,
  inputs: readonly HerdrEventStreamInput[],
  requestId: string,
  subscriptions: Subscriptions,
): readonly [
  HerdrSocketLineBuffer,
  ReadonlyArray<
    Result.Result<
      EventForSubscription<Subscriptions[number]>,
      HerdrInvalidResponse | HerdrTransportError | HerdrUnsupportedEvent
    >
  >,
] {
  const decodedEvents: Result.Result<
    EventForSubscription<Subscriptions[number]>,
    HerdrInvalidResponse | HerdrTransportError | HerdrUnsupportedEvent
  >[] = [];

  for (const input of inputs) {
    if (input._tag === "End") {
      if (state.byteLength > 0) {
        decodedEvents.push(
          Result.fail(
            new HerdrTransportError(
              "event_subscription",
              "premature_close",
              requestId,
              new Error("Herdr closed the event socket during an incomplete response line"),
            ),
          ),
        );
      }
      return [makeHerdrSocketLineBuffer(), decodedEvents];
    }

    let remaining: readonly Uint8Array[] = [input.value];
    while (remaining.length > 0) {
      // Preserve the valid prefix even when a later line in this read exceeds the limit.
      const split = splitHerdrSocketLines(state, remaining, MAX_EVENT_LINE_BYTES, requestId, 1);
      if (Result.isFailure(split)) {
        decodedEvents.push(Result.fail(split.failure));
        return [makeHerdrSocketLineBuffer(), decodedEvents];
      }
      state = split.success.buffer;
      remaining = split.success.remainder;
      for (const line of split.success.lines) {
        if (line.length === 0) continue;
        const decoded = decodeEventLine(line, requestId);
        if (Result.isFailure(decoded)) {
          decodedEvents.push(Result.fail(decoded.failure));
          return [makeHerdrSocketLineBuffer(), decodedEvents];
        }
        if (isEventForSubscriptions(decoded.success, subscriptions)) {
          decodedEvents.push(Result.succeed(decoded.success));
        }
      }
    }
  }

  return [state, decodedEvents];
}

function eventDataWithType(envelope: EventEnvelope | SubscriptionEventEnvelope) {
  switch (envelope.event) {
    case "pane.output_matched":
      return { ...envelope.data, type: "pane_output_matched" as const };
    case "pane.agent_status_changed":
      return { ...envelope.data, type: "pane_agent_status_changed" as const };
    case "pane.scroll_changed":
      return { ...envelope.data, type: "pane_scroll_changed" as const };
    default:
      return envelope.data;
  }
}

function isEventForSubscriptions<
  const Subscriptions extends readonly EventSubscriptionSpecEncoded[],
>(
  event: HerdrEventValue,
  subscriptions: Subscriptions,
): event is EventForSubscription<Subscriptions[number]> {
  return subscriptions.some((subscription) => subscription.type === event.type);
}

function isEventForMatch<const Match extends EventMatchEncoded>(
  event: HerdrEventValue,
  match: Match,
): event is EventForMatch<Match> {
  return event.type === match.type;
}

function encodeEventMatch(match: EventMatchValue) {
  switch (match.type) {
    case "workspace.created":
      return {
        event: "workspace_created" as const,
        workspaceId: Option.getOrNull(match.workspaceId),
      };
    case "workspace.updated":
      return { event: "workspace_updated" as const, workspaceId: match.workspaceId };
    case "workspace.closed":
      return { event: "workspace_closed" as const, workspaceId: match.workspaceId };
    case "workspace.renamed":
      return {
        event: "workspace_renamed" as const,
        workspaceId: match.workspaceId,
        label: Option.getOrNull(match.label),
      };
    case "workspace.moved":
      return { event: "workspace_moved" as const, workspaceId: match.workspaceId };
    case "workspace.focused":
      return { event: "workspace_focused" as const, workspaceId: match.workspaceId };
    case "tab.created":
      return {
        event: "tab_created" as const,
        tabId: Option.getOrNull(match.tabId),
        workspaceId: Option.getOrNull(match.workspaceId),
      };
    case "tab.closed":
      return { event: "tab_closed" as const, tabId: match.tabId };
    case "tab.renamed":
      return {
        event: "tab_renamed" as const,
        tabId: match.tabId,
        label: Option.getOrNull(match.label),
      };
    case "tab.moved":
      return { event: "tab_moved" as const, tabId: match.tabId };
    case "tab.focused":
      return { event: "tab_focused" as const, tabId: match.tabId };
    case "pane.created":
      return {
        event: "pane_created" as const,
        paneId: Option.getOrNull(match.paneId),
        workspaceId: Option.getOrNull(match.workspaceId),
      };
    case "pane.closed":
      return { event: "pane_closed" as const, paneId: match.paneId };
    case "pane.focused":
      return { event: "pane_focused" as const, paneId: match.paneId };
    case "pane.moved":
      return { event: "pane_moved" as const, paneId: match.paneId };
    case "pane.output_changed":
      return {
        event: "pane_output_changed" as const,
        paneId: match.paneId,
        minRevision: Option.getOrNull(match.minRevision),
      };
    case "pane.exited":
      return { event: "pane_exited" as const, paneId: match.paneId };
    case "pane.agent_detected":
      return {
        event: "pane_agent_detected" as const,
        paneId: match.paneId,
        agent: Option.getOrNull(match.agent),
      };
    case "pane.agent_status_changed":
      return {
        event: "pane_agent_status_changed" as const,
        paneId: match.paneId,
        agentStatus: match.agentStatus,
      };
  }
}
