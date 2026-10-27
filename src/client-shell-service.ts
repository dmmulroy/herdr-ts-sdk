/**
 * Provides callback-owned client-shell sessions and stream-owned projection subscriptions.
 * Acquiring the SDK does not connect an endpoint; every endpoint lifetime has an explicit owner.
 * @since 0.9.0
 */
import { dirname, join } from "node:path";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  PubSub,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  HerdrAbsolutePath,
  PaneId,
  TerminalId,
  type WorkspaceId,
  type TabId,
} from "./herdr-domain.ts";
import { HerdrConfig, herdrConfigLayer } from "./herdr-config.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
} from "./herdr-transport.ts";
import { HerdrInvalidInput } from "./herdr-errors.ts";
import { AgentViewSetInput } from "./herdr-models.ts";
import {
  CommandPaneInput,
  CommandTabInput,
  type CommandPaneInputEncoded,
  type CommandTabInputEncoded,
} from "./command-service.ts";
import {
  ProductAnnouncementDismissInput,
  type ProductAnnouncementDismissInputEncoded,
} from "./product-announcement-service.ts";
import {
  ReleaseNotesDismissInput,
  type ReleaseNotesDismissInputEncoded,
} from "./release-notes-service.ts";
import { decodeHerdrInput } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  ClientShellAgentCompletions,
  ClientShellAgentViewProjection,
  type ClientShellAgentView,
  ClientShellProjection,
  ClientShellSurface,
  ClientShellSurfacePatch,
  ClientShellSurfaceAcknowledgement,
  ClientShellPresentationEvent,
  type ClientShellSurfaceState,
  type ClientShellCommand,
} from "./herdr-client-shell-models.ts";
import {
  HerdrEndpointClosed,
  HerdrEndpointInvalidMessage,
  HerdrEndpointRequestTimeout,
  HerdrEndpointStaleReference,
  type HerdrEndpointFailure,
} from "./herdr-endpoint-errors.ts";
import {
  acquireEndpointConnection,
  type EndpointRequestError,
} from "./herdr-endpoint-transport.ts";
import {
  encodeEndpointControl,
  encodeEndpointText,
  encodeEndpointKey,
  encodeEndpointMouse,
  encodeEndpointResize,
  encodeEndpointPreference,
  encodeEndpointHostTheme,
} from "./herdr-endpoint-codecs.ts";
import {
  applyClientShellSurfacePatch,
  retainClientShellGraphics,
} from "./herdr-client-shell-state.ts";
import {
  ClientShellHostThemeInput,
  ClientShellKeyInput,
  ClientShellMouseInput,
  type ClientShellHostThemeInputEncoded,
  type ClientShellKeyInputEncoded,
  type ClientShellMouseInputEncoded,
} from "./herdr-client-shell-input.ts";

const PositiveU16 = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const PixelSize = Schema.Natural.check(Schema.isLessThanOrEqualTo(0xffff_ffff));
const Deadline = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2147483647 }));
/** Geometry and resource bounds for one explicit endpoint session. @category schemas @since 0.9.0 */
export const ClientShellConnectInput = Schema.Struct({
  socketPath: Schema.optionalKey(HerdrAbsolutePath),
  surface: Schema.Struct({ columns: PositiveU16, rows: PositiveU16 }),
  cellPixels: Schema.Struct({ width: PixelSize, height: PixelSize }),
  initialSurface: Schema.optionalKey(Schema.Literals(["inactive", "active"])),
  mouseCapture: Schema.optionalKey(Schema.Boolean),
  endpointKeybindings: Schema.optionalKey(Schema.Boolean),
  timeoutMs: Schema.optionalKey(Deadline),
  healthIntervalMs: Schema.optionalKey(Deadline),
  maximumMessageBytes: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 32 * 1024 * 1024 })),
  ),
});
/** Parsed endpoint connection options. @category models @since 0.9.0 */
export type ClientShellConnectInput = typeof ClientShellConnectInput.Type;
/** Caller-supplied endpoint geometry; socketPath denotes herdr-client.sock, not herdr.sock. @category inputs @since 0.9.0 */
export type ClientShellConnectInputEncoded = typeof ClientShellConnectInput.Encoded;
/** Connection acquisition also checks the SDK's protocol-22 baseline on the configured API socket. @category errors @since 0.9.0 */
export type HerdrEndpointConnectError = HerdrTransportRequestError | EndpointRequestError;
/** Domain operation failures for one live endpoint connection. @category errors @since 0.9.0 */
export type ClientShellOperationError =
  | EndpointRequestError
  | HerdrInvalidInput
  | HerdrEndpointStaleReference;

const parseConnect = Schema.decodeEffect(ClientShellConnectInput, { onExcessProperty: "error" });
const parseProjection = Schema.decodeEffect(Schema.fromJsonString(ClientShellProjection));
const parseAgentCompletions = Schema.decodeOption(
  Schema.fromJsonString(ClientShellAgentCompletions),
);
const parseAgentViewProjection = Schema.decodeOption(
  Schema.fromJsonString(ClientShellAgentViewProjection),
);
const parseAgentViewDefinition = Schema.decodeUnknownOption(AgentViewSetInput);
/** Classifies a companion's opaque view; an undecodable view never fails the connection. */
function classifyClientShellAgentView(
  projection: ClientShellAgentViewProjection,
): ClientShellAgentView {
  if (Option.isNone(projection.view)) return { status: "none" };
  const view = parseAgentViewDefinition(projection.view.value);
  return Option.isSome(view) ? { status: "active", view: view.value } : { status: "unrecognized" };
}
const parseSurface = Schema.decodeEffect(ClientShellSurface);
const parsePresentationEvent = Schema.decodeEffect(ClientShellPresentationEvent);
const parseKey = Schema.decodeEffect(ClientShellKeyInput, { onExcessProperty: "error" });
const parseMouse = Schema.decodeEffect(ClientShellMouseInput, { onExcessProperty: "error" });
const parseHostTheme = Schema.decodeEffect(ClientShellHostThemeInput, {
  onExcessProperty: "error",
});
const parsePatch = Schema.decodeEffect(ClientShellSurfacePatch);
const parseAcknowledgement = Schema.decodeEffect(ClientShellSurfaceAcknowledgement);
const parsePaneCommand = Schema.decodeEffect(CommandPaneInput, { onExcessProperty: "error" });
const parseTabCommand = Schema.decodeEffect(CommandTabInput, { onExcessProperty: "error" });
const parseAnnouncement = Schema.decodeEffect(ProductAnnouncementDismissInput, {
  onExcessProperty: "error",
});
const parseNotes = Schema.decodeEffect(ReleaseNotesDismissInput, { onExcessProperty: "error" });
const SurfaceSetInput = Schema.Struct({ active: Schema.Boolean });
const parseSurfaceSet = Schema.decodeEffect(SurfaceSetInput, { onExcessProperty: "error" });
const TextInput = Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(1_000_000)) });
const parseText = Schema.decodeEffect(TextInput, { onExcessProperty: "error" });
const ResizeInput = Schema.Struct({
  surface: ClientShellConnectInput.fields.surface,
  cellPixels: ClientShellConnectInput.fields.cellPixels,
});
const parseResize = Schema.decodeEffect(ResizeInput, { onExcessProperty: "error" });

/** Scoped endpoint handle; using it after its callback/Scope ends fails rather than reopening. @category services @since 0.9.0 */
export interface ClientShellConnection {
  /** Reads the latest accepted whole projection without marking agents seen. */
  readonly snapshot: () => Effect.Effect<ClientShellProjection, HerdrEndpointClosed>;
  /** Current projection followed by coalesced whole replacements; consume inside the session. */
  readonly projections: Stream.Stream<ClientShellProjection, HerdrEndpointFailure>;
  /** Live presentation instructions; a consumer exceeding the eight-message backlog fails the connection rather than losing effects silently. */
  readonly events: Stream.Stream<ClientShellPresentationEvent, HerdrEndpointFailure>;
  /** Connection-local surface interest and presentation state. */
  readonly surface: {
    /** Changes this connection's surface interest; acknowledgement is not frame delivery. */
    readonly set: (input: {
      readonly active: boolean;
    }) => Effect.Effect<
      ClientShellSurfaceAcknowledgement,
      EndpointRequestError | HerdrInvalidInput
    >;
    /** Reads the latest presentation lifecycle state. */
    readonly state: () => Effect.Effect<ClientShellSurfaceState, HerdrEndpointClosed>;
    /** Waits for a complete surface at the acknowledged projection floor, with a deadline. */
    readonly awaitReady: () => Effect.Effect<ClientShellSurface, HerdrEndpointFailure>;
    /** Coalesced lifecycle states; never exposes incomplete patches as complete frames. */
    readonly states: Stream.Stream<ClientShellSurfaceState, HerdrEndpointFailure>;
    /** Updates this client's active-tab viewport geometry. */
    readonly resize: (
      input: typeof ResizeInput.Encoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
  };
  /** Semantic text delivery to a stable target; never inferred from a stale focused ID. */
  readonly input: {
    /** Sends a semantic key press/repeat/release to an explicit pane. */
    readonly key: (
      paneId: PaneId,
      input: ClientShellKeyInputEncoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
    /** Sends cell/pixel mouse input to an explicit pane. */
    readonly mouse: (
      paneId: PaneId,
      input: ClientShellMouseInputEncoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
    /** Sends a semantic key to an explicitly identified popup. */
    readonly keyInPopup: (
      terminalId: TerminalId,
      input: ClientShellKeyInputEncoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
    /** Sends mouse input to an explicitly identified popup. */
    readonly mouseInPopup: (
      terminalId: TerminalId,
      input: ClientShellMouseInputEncoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
    /** Commits text to a popup without synthesizing a paste. */
    readonly textInPopup: (
      terminalId: TerminalId,
      input: typeof TextInput.Encoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
    /** Pastes multiline text as one semantic paste event to a pane. */
    readonly paste: (
      paneId: PaneId,
      input: typeof TextInput.Encoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
    /** Commits text without converting it to a paste or Enter. */
    readonly text: (
      paneId: PaneId,
      input: typeof TextInput.Encoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
    /** Pastes into an explicitly identified popup terminal. */
    readonly pasteInPopup: (
      terminalId: TerminalId,
      input: typeof TextInput.Encoded,
    ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
  };
  /** Commands discovered on this connection; arbitrary ID-only handles are rejected. */
  readonly commands: {
    /** Invokes a current discovered command using current endpoint context. */
    readonly invoke: (
      command: ClientShellCommand,
    ) => Effect.Effect<void, ClientShellOperationError>;
    /** Invokes a discovered command in an explicit workspace. */
    readonly invokeInWorkspace: (
      command: ClientShellCommand,
      workspaceId: WorkspaceId,
    ) => Effect.Effect<void, ClientShellOperationError>;
    /** Invokes a discovered command in a tab with an optional parent assertion. */
    readonly invokeInTab: (
      command: ClientShellCommand,
      tabId: TabId,
      input?: CommandTabInputEncoded,
    ) => Effect.Effect<void, ClientShellOperationError>;
    /** Invokes a discovered command with pane-bound selection coordinates. */
    readonly invokeInPane: (
      command: ClientShellCommand,
      paneId: PaneId,
      input?: CommandPaneInputEncoded,
    ) => Effect.Effect<void, ClientShellOperationError>;
  };
  /** Endpoint-owned announcement acknowledgement. */
  readonly productAnnouncements: {
    readonly dismiss: (
      input: ProductAnnouncementDismissInputEncoded,
    ) => Effect.Effect<void, ClientShellOperationError>;
  };
  /** Endpoint-owned release-note acknowledgement. */
  readonly releaseNotes: {
    readonly dismiss: (
      input: ReleaseNotesDismissInputEncoded,
    ) => Effect.Effect<void, ClientShellOperationError>;
  };
  /** Reports outer-terminal focus for this connection, not a global pane-focus operation. */
  readonly setFocused: (
    focused: boolean,
  ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
  /** Updates this connection's mouse-capture preference. */
  readonly setMouseCapture: (
    enabled: boolean,
  ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
  /**
   * Forwards one outer (host) terminal default color, palette batch (1–256 entries), or
   * light/dark appearance so pane applications choose matching colors. Fire-and-forget: Herdr
   * sends no acknowledgement, and an oversized palette is rejected rather than split.
   */
  readonly setHostTheme: (
    input: ClientShellHostThemeInputEncoded,
  ) => Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>;
  /** Reads connection liveness without probing a second socket. */
  readonly connectionState: () => Effect.Effect<"ready" | "closed">;
  /** Waits until the connection fails or its owner closes it, preserving the termination reason. */
  readonly awaitClosed: () => Effect.Effect<never, HerdrEndpointFailure>;
}
/** Client-shell acquisition is lazy; ordinary SDK construction opens no endpoint. @category services @since 0.9.0 */
export interface IClientShellService {
  /** Owns a connection for the callback and preserves callback errors and requirements. */
  readonly withConnection: <A, E, R>(
    input: ClientShellConnectInputEncoded,
    use: (connection: ClientShellConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | HerdrEndpointConnectError, R>;
  /** Advanced acquisition for callers composing their own scoped resource lifetime. */
  readonly connectScoped: (
    input: ClientShellConnectInputEncoded,
  ) => Effect.Effect<ClientShellConnection, HerdrEndpointConnectError, Scope.Scope>;
  /** Each consumption opens an inactive connection and closes it when consumption ends. */
  readonly projections: (
    input: ClientShellConnectInputEncoded,
  ) => Stream.Stream<ClientShellProjection, HerdrEndpointConnectError>;
}
/** Yieldable client-shell endpoint capability. @category services @since 0.9.0 */
export class ClientShellService extends Context.Service<ClientShellService, IClientShellService>()(
  "@herdr/sdk/ClientShellService",
) {}

/** Constructs lazy endpoint acquisition using the shared API configuration and compatibility gate. @category constructors @since 0.9.0 */
export const makeClientShellService = Effect.gen(function* () {
  const config = yield* HerdrConfig;
  const transport = yield* HerdrTransport;
  const acquire = (input: ClientShellConnectInputEncoded) =>
    Effect.gen(function* () {
      const parsed = yield* decodeHerdrInput(
        "ClientShellService.connectScoped",
        parseConnect,
        input,
      );
      yield* transport.request("ping", {});
      const timeoutMs = parsed.timeoutMs ?? 10_000;
      const maximumBytes = parsed.maximumMessageBytes ?? 32 * 1024 * 1024;
      const wire = yield* acquireEndpointConnection({
        socketPath: parsed.socketPath ?? join(dirname(config.socketPath), "herdr-client.sock"),
        timeoutMs,
        maximumBytes,
        // Start inactive so activation always establishes an acknowledged revision floor.
        hello: JSON.stringify({
          generation: 1,
          cell_width_px: parsed.cellPixels.width,
          cell_height_px: parsed.cellPixels.height,
          surface_size: { cols: parsed.surface.columns, rows: parsed.surface.rows },
          pixel_mouse: false,
          direct_graphics: false,
          endpoint_keybindings: parsed.endpointKeybindings ?? false,
          mouse_capture: parsed.mouseCapture ?? false,
          surface_active: false,
          snapshot_codecs: ["shell.snapshot.v1"],
          surface_codecs: ["shell.surface.v1"],
          input_codecs: ["shell.input.semantic.v1"],
          blob_codecs: ["shell.blob.v1"],
        }),
      });
      const firstProjection = yield* Deferred.make<ClientShellProjection, HerdrEndpointFailure>();
      const projectionChanges = yield* PubSub.sliding<ClientShellProjection>(1);
      const surfaceChanges = yield* PubSub.sliding<ClientShellSurfaceState>(1);
      const presentationEvents = yield* PubSub.dropping<ClientShellPresentationEvent>(8);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* PubSub.shutdown(projectionChanges);
          yield* PubSub.shutdown(surfaceChanges);
          yield* PubSub.shutdown(presentationEvents);
        }),
      );
      const surfaceLock = yield* Semaphore.make(1);
      let currentProjection: ClientShellProjection | undefined;
      let currentSurface: ClientShellSurface | undefined;
      let surfaceState: ClientShellSurfaceState = { status: "inactive" };
      let commands = new WeakSet<ClientShellCommand>();
      let healthPong: Deferred.Deferred<void> | undefined;
      // Herdr sends a completion companion before the snapshot with the same boot and revision.
      let pendingCompletions: ClientShellAgentCompletions | undefined;
      // Herdr resends the agent-view companion before every snapshot while a view is active,
      // and once with a null view when it is cleared; a snapshot without a match has no view.
      // Only a companion newer than the current snapshot waits here.
      let pendingAgentView: ClientShellAgentViewProjection | undefined;
      // The companions attached to currentProjection, if any; the first matching view wins.
      let attachedAgentView: ClientShellAgentViewProjection | undefined;
      let attachedCompletions: ClientShellAgentCompletions | undefined;
      const publishSurface = (state: ClientShellSurfaceState) =>
        Effect.gen(function* () {
          surfaceState = state;
          yield* PubSub.publish(surfaceChanges, state);
        });
      const acceptSurface = (surface: ClientShellSurface) =>
        Effect.gen(function* () {
          if (currentProjection === undefined || surface.bootId !== currentProjection.bootId)
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("revision"));
          if (surface.projectionRevision > currentProjection.revision)
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("revision"));
          if (
            currentSurface !== undefined &&
            surface.surfaceRevision <= currentSurface.surfaceRevision
          )
            return;
          const complete = yield* Result.match(
            retainClientShellGraphics(currentSurface, surface, maximumBytes),
            { onFailure: Effect.fail, onSuccess: Effect.succeed },
          );
          currentSurface = complete;
          if (
            (surfaceState.status === "active" || surfaceState.status === "awaitingSurface") &&
            surface.projectionRevision >= surfaceState.projectionFloor
          ) {
            yield* publishSurface({
              status: "active",
              bootId: surface.bootId,
              projectionFloor: surfaceState.projectionFloor,
              surface: complete,
            });
          }
        });
      yield* wire.installHandler((message) =>
        Effect.gen(function* () {
          if (message.kind === "control") {
            if (message.name === "endpoint.health.pong.v1") {
              if (healthPong !== undefined) yield* Deferred.succeed(healthPong, undefined);
              return;
            }
            if (message.name === "endpoint.agent-completions.v1") {
              // Optional companion: malformed data is ignored like any unknown optional control.
              const parsedCompletions = parseAgentCompletions(message.data);
              if (Option.isNone(parsedCompletions)) return;
              const completions = parsedCompletions.value;
              // Mirrors v0.9.5 client/shell/endpoint_agent_state.rs: a pending slot never moves backwards.
              if (
                pendingCompletions?.bootId === completions.bootId &&
                pendingCompletions.revision >= completions.revision
              )
                return;
              pendingCompletions = completions;
              return;
            }
            if (message.name === "endpoint.agent-view.v1") {
              // Like upstream, a malformed envelope is ignored; only the inner view can be unrecognized.
              const parsedAgentView = parseAgentViewProjection(message.data);
              if (Option.isNone(parsedAgentView)) return;
              const companion = parsedAgentView.value;
              const current = currentProjection;
              // Mirrors v0.9.5 client/shell/endpoints.rs: attach a companion matching the current
              // snapshot directly and never move a slot backwards. An older companion needs no
              // guard: it can only wait in pending, where no newer snapshot can match it.
              if (current?.bootId === companion.bootId && current.revision === companion.revision) {
                if (attachedAgentView !== undefined) return;
                attachedAgentView = companion;
                currentProjection = {
                  ...current,
                  agentView: classifyClientShellAgentView(companion),
                };
                yield* PubSub.publish(projectionChanges, currentProjection);
                return;
              }
              if (
                pendingAgentView?.bootId === companion.bootId &&
                pendingAgentView.revision >= companion.revision
              )
                return;
              pendingAgentView = companion;
              return;
            }
            if (message.name === "shell.snapshot.v1") {
              const decoded = yield* parseProjection(message.data).pipe(
                Effect.mapError(() => new HerdrEndpointInvalidMessage("schema")),
              );
              yield* wire.bindBoot(decoded.bootId);
              // Like upstream, an older snapshot is dropped before it can consume companions for a
              // newer one, while an equal-revision snapshot replaces the current projection.
              if (currentProjection !== undefined && decoded.revision < currentProjection.revision)
                return;
              const replacesCurrentRevision = currentProjection?.revision === decoded.revision;
              const matchesSnapshot = (
                companion: ClientShellAgentCompletions | ClientShellAgentViewProjection | undefined,
              ) => companion?.bootId === decoded.bootId && companion.revision === decoded.revision;
              // A matching pending companion wins; otherwise an equal-revision replacement keeps the
              // companions already attached to that revision, and a newer snapshot starts without.
              const completionsCompanion = pendingCompletions;
              pendingCompletions = undefined;
              attachedCompletions = matchesSnapshot(completionsCompanion)
                ? completionsCompanion
                : replacesCurrentRevision
                  ? attachedCompletions
                  : undefined;
              const completions = attachedCompletions;
              const agentViewCompanion = pendingAgentView;
              pendingAgentView = undefined;
              attachedAgentView = matchesSnapshot(agentViewCompanion)
                ? agentViewCompanion
                : replacesCurrentRevision
                  ? attachedAgentView
                  : undefined;
              const agentView: ClientShellAgentView =
                attachedAgentView === undefined
                  ? { status: "none" }
                  : classifyClientShellAgentView(attachedAgentView);
              const projection =
                completions !== undefined
                  ? {
                      ...decoded,
                      agentView,
                      agents: decoded.agents.map((agent) => ({
                        ...agent,
                        completionSeq: Object.hasOwn(completions.completions, agent.paneId)
                          ? Option.fromNullishOr(completions.completions[agent.paneId])
                          : Option.none(),
                      })),
                    }
                  : { ...decoded, agentView };
              currentProjection = projection;
              if (
                surfaceState.status === "active" &&
                surfaceState.surface.projectionRevision < projection.revision
              ) {
                yield* publishSurface({
                  status: "awaitingSurface",
                  bootId: projection.bootId,
                  projectionFloor: projection.revision,
                });
              }
              for (const command of projection.commands) commands.add(command);
              yield* Deferred.succeed(firstProjection, projection);
              yield* PubSub.publish(projectionChanges, projection);
              return;
            }
            if (message.name.startsWith("shell.snapshot."))
              return yield* Effect.fail(new HerdrEndpointInvalidMessage("unsupported_message"));
            return; // Unknown optional named controls are explicitly ignorable in generation 1.
          }
          if (message.kind === "surface") {
            const surface = yield* parseSurface(message.surface).pipe(
              Effect.mapError(() => new HerdrEndpointInvalidMessage("schema")),
            );
            return yield* acceptSurface(surface);
          }
          if (message.kind === "patch") {
            const patch = yield* parsePatch(message.patch).pipe(
              Effect.mapError(() => new HerdrEndpointInvalidMessage("schema")),
            );
            if (currentSurface === undefined)
              return yield* Effect.fail(new HerdrEndpointInvalidMessage("revision"));
            const surface = yield* Result.match(
              applyClientShellSurfacePatch(currentSurface, patch),
              { onFailure: Effect.fail, onSuccess: Effect.succeed },
            );
            return yield* acceptSurface(surface);
          }
          // Direct file delivery is not negotiated; never read arbitrary server-supplied paths.
          if (message.kind === "graphicsFile")
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("unsupported_message"));
          if (
            message.kind === "shutdown" ||
            message.kind === "response" ||
            message.kind === "graphicsRetired"
          )
            return;
          const event = yield* parsePresentationEvent(message).pipe(
            Effect.mapError(() => new HerdrEndpointInvalidMessage("schema")),
          );
          if (!(yield* PubSub.publish(presentationEvents, event)))
            return yield* Effect.fail(new HerdrEndpointInvalidMessage("resource_limit"));
        }),
      );
      yield* Deferred.await(firstProjection).pipe(
        Effect.raceFirst(wire.failure),
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(new HerdrEndpointRequestTimeout("connect")),
        }),
      );
      const projections = Stream.unwrap(
        Effect.gen(function* () {
          yield* wire.ensureHealthy;
          const subscription = yield* PubSub.subscribe(projectionChanges);
          if (currentProjection === undefined) return yield* Effect.fail(new HerdrEndpointClosed());
          return Stream.concat(
            Stream.make(currentProjection),
            Stream.fromSubscription(subscription),
          );
        }),
      ).pipe(Stream.interruptWhen(wire.failure));
      const surfaceStates = Stream.unwrap(
        Effect.gen(function* () {
          yield* wire.ensureHealthy;
          const subscription = yield* PubSub.subscribe(surfaceChanges);
          return Stream.concat(Stream.make(surfaceState), Stream.fromSubscription(subscription));
        }),
      ).pipe(Stream.interruptWhen(wire.failure));
      const assertCommand = (command: ClientShellCommand) =>
        Effect.gen(function* () {
          yield* wire.ensureOpen;
          if (
            !commands.has(command) ||
            command.action === "unknown" ||
            !currentProjection?.commands.some((current) => current.commandId === command.commandId)
          )
            return yield* Effect.fail(new HerdrEndpointStaleReference());
        });
      const sendText = (
        target: "pane" | "popup",
        id: string,
        input: typeof TextInput.Encoded,
        mode: "paste" | "text",
      ) =>
        Effect.gen(function* () {
          const parsedText = yield* decodeHerdrInput(
            "ClientShellConnection.input",
            parseText,
            input,
          );
          yield* wire.write(() => encodeEndpointText(target, id, parsedText.text, mode));
        });
      const sendKey = (target: "pane" | "popup", id: string, input: ClientShellKeyInputEncoded) =>
        Effect.gen(function* () {
          const key = yield* decodeHerdrInput("ClientShellConnection.input.key", parseKey, input);
          yield* wire.write(() => encodeEndpointKey(target, id, key));
        });
      const sendMouse = (
        target: "pane" | "popup",
        id: string,
        input: ClientShellMouseInputEncoded,
      ) =>
        Effect.gen(function* () {
          const mouse = yield* decodeHerdrInput(
            "ClientShellConnection.input.mouse",
            parseMouse,
            input,
          );
          yield* wire.write(() => encodeEndpointMouse(target, id, mouse));
        });
      const parseBoolean = Schema.decodeEffect(Schema.Boolean);
      const preference = (name: "focus" | "mouseCapture", input: boolean) =>
        Effect.gen(function* () {
          const value = yield* decodeHerdrInput(
            "ClientShellConnection.preference",
            parseBoolean,
            input,
          );
          yield* wire.write(() => encodeEndpointPreference(name, value));
        });
      const connection: ClientShellConnection = {
        snapshot: () =>
          Effect.gen(function* () {
            yield* wire.ensureOpen;
            if (currentProjection === undefined)
              return yield* Effect.fail(new HerdrEndpointClosed());
            return currentProjection;
          }),
        projections,
        events: Stream.fromPubSub(presentationEvents).pipe(Stream.interruptWhen(wire.failure)),
        surface: {
          set: (input) =>
            surfaceLock.withPermit(
              Effect.gen(function* () {
                const interest = yield* decodeHerdrInput(
                  "ClientShellConnection.surface.set",
                  parseSurfaceSet,
                  input,
                );
                yield* wire.ensureOpen;
                if (currentProjection === undefined)
                  return yield* Effect.fail(new HerdrEndpointClosed());
                const previousState = surfaceState;
                yield* publishSurface({ status: interest.active ? "activating" : "deactivating" });
                const response = yield* wire.request("client_shell.surface.set", interest).pipe(
                  Effect.tapError((error) => {
                    // A definite rejection leaves interest unchanged; uncertain outcomes invalidate the session.
                    if (
                      error._tag !== "HerdrServerError" &&
                      error._tag !== "HerdrEndpointUnsupportedMethod"
                    )
                      return wire.fail(new HerdrEndpointInvalidMessage("schema"));
                    return publishSurface(
                      previousState.status === "active" &&
                        currentProjection !== undefined &&
                        previousState.surface.projectionRevision < currentProjection.revision
                        ? {
                            status: "awaitingSurface",
                            bootId: currentProjection.bootId,
                            projectionFloor: currentProjection.revision,
                          }
                        : previousState,
                    );
                  }),
                );
                const acknowledgement = yield* parseAcknowledgement(response.result).pipe(
                  Effect.mapError(() => new HerdrEndpointInvalidMessage("schema")),
                );
                if (acknowledgement.active !== interest.active)
                  return yield* Effect.fail(new HerdrEndpointInvalidMessage("revision"));
                if (!interest.active) {
                  yield* publishSurface({ status: "inactive" });
                  return acknowledgement;
                }
                yield* publishSurface({
                  status: "awaitingSurface",
                  bootId: currentProjection.bootId,
                  projectionFloor: acknowledgement.projectionRevision,
                });
                if (
                  currentSurface !== undefined &&
                  currentSurface.projectionRevision >= acknowledgement.projectionRevision
                ) {
                  yield* publishSurface({
                    status: "active",
                    bootId: currentProjection.bootId,
                    projectionFloor: acknowledgement.projectionRevision,
                    surface: currentSurface,
                  });
                }
                return acknowledgement;
              }).pipe(
                Effect.tapError((error) =>
                  error instanceof HerdrEndpointInvalidMessage ? wire.fail(error) : Effect.void,
                ),
              ),
            ),
          state: () =>
            Effect.gen(function* () {
              yield* wire.ensureOpen;
              return surfaceState;
            }),
          states: surfaceStates,
          awaitReady: () =>
            surfaceStates.pipe(
              Stream.filter(
                (state): state is Extract<ClientShellSurfaceState, { readonly status: "active" }> =>
                  state.status === "active",
              ),
              Stream.map((state) => state.surface),
              Stream.runHead,
              Effect.flatMap((surface) =>
                Option.isSome(surface)
                  ? Effect.succeed(surface.value)
                  : Effect.fail(new HerdrEndpointClosed()),
              ),
              Effect.timeoutOrElse({
                duration: timeoutMs,
                orElse: () => Effect.fail(new HerdrEndpointRequestTimeout("surface")),
              }),
            ),
          resize: (input) =>
            Effect.gen(function* () {
              const size = yield* decodeHerdrInput(
                "ClientShellConnection.surface.resize",
                parseResize,
                input,
              );
              yield* wire.write(() =>
                encodeEndpointResize(
                  size.surface.columns,
                  size.surface.rows,
                  size.cellPixels.width,
                  size.cellPixels.height,
                  false,
                ),
              );
            }),
        },
        input: {
          key: (id, input) => sendKey("pane", id, input),
          mouse: (id, input) => sendMouse("pane", id, input),
          keyInPopup: (id, input) => sendKey("popup", id, input),
          mouseInPopup: (id, input) => sendMouse("popup", id, input),
          textInPopup: (id, input) => sendText("popup", id, input, "text"),
          paste: (id, input) => sendText("pane", id, input, "paste"),
          text: (id, input) => sendText("pane", id, input, "text"),
          pasteInPopup: (id, input) => sendText("popup", id, input, "paste"),
        },
        commands: {
          invoke: (command) =>
            Effect.gen(function* () {
              yield* assertCommand(command);
              yield* wire.request("command.invoke", { commandId: command.commandId });
            }),
          invokeInWorkspace: (command, workspaceId) =>
            Effect.gen(function* () {
              yield* assertCommand(command);
              yield* wire.request("command.invoke", { commandId: command.commandId, workspaceId });
            }),
          invokeInTab: (command, tabId, input = {}) =>
            Effect.gen(function* () {
              yield* assertCommand(command);
              const target = yield* decodeHerdrInput(
                "ClientShellConnection.commands.invokeInTab",
                parseTabCommand,
                input,
              );
              yield* wire.request("command.invoke", {
                commandId: command.commandId,
                tabId,
                ...(target.expectedWorkspaceId === undefined
                  ? {}
                  : { workspaceId: target.expectedWorkspaceId }),
              });
            }),
          invokeInPane: (command, paneId, input = {}) =>
            Effect.gen(function* () {
              yield* assertCommand(command);
              const target = yield* decodeHerdrInput(
                "ClientShellConnection.commands.invokeInPane",
                parsePaneCommand,
                input,
              );
              yield* wire.request("command.invoke", {
                commandId: command.commandId,
                paneId,
                ...(target.expectedWorkspaceId === undefined
                  ? {}
                  : { workspaceId: target.expectedWorkspaceId }),
                ...(target.expectedTabId === undefined ? {} : { tabId: target.expectedTabId }),
                ...(target.selection === undefined
                  ? {}
                  : { selection: { paneId, ...target.selection } }),
              });
            }),
        },
        productAnnouncements: {
          dismiss: (input) =>
            Effect.gen(function* () {
              const identity = yield* decodeHerdrInput(
                "ClientShellConnection.productAnnouncements.dismiss",
                parseAnnouncement,
                input,
              );
              yield* wire.request("product_announcement.dismiss", identity);
            }),
        },
        releaseNotes: {
          dismiss: (input) =>
            Effect.gen(function* () {
              const identity = yield* decodeHerdrInput(
                "ClientShellConnection.releaseNotes.dismiss",
                parseNotes,
                input,
              );
              yield* wire.request("release_notes.dismiss", identity);
            }),
        },
        setFocused: (focused) => preference("focus", focused),
        setMouseCapture: (enabled) => preference("mouseCapture", enabled),
        setHostTheme: (input) =>
          Effect.gen(function* () {
            const update = yield* decodeHerdrInput(
              "ClientShellConnection.setHostTheme",
              parseHostTheme,
              input,
            );
            yield* wire.write(() => encodeEndpointHostTheme(update));
          }),
        awaitClosed: () => wire.failure,
        connectionState: () =>
          wire.ensureOpen.pipe(
            Effect.as("ready" as const),
            Effect.catch(() => Effect.succeed("closed" as const)),
          ),
      };
      const health = Effect.gen(function* () {
        yield* Effect.sleep(parsed.healthIntervalMs ?? 10_000);
        const pong = yield* Deferred.make<void>();
        healthPong = pong;
        yield* wire.write(() => encodeEndpointControl("endpoint.health.ping.v1", "{}"));
        yield* Deferred.await(pong).pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new HerdrEndpointRequestTimeout("health")),
          }),
        );
        healthPong = undefined;
      }).pipe(Effect.forever, Effect.raceFirst(wire.failure), Effect.catch(wire.fail));
      yield* health.pipe(Effect.forkScoped);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          currentProjection = undefined;
          currentSurface = undefined;
          surfaceState = { status: "closed" };
          commands = new WeakSet();
        }),
      );
      if (parsed.initialSurface === "active") yield* connection.surface.set({ active: true });
      return connection;
    });
  const connectScoped = defineHerdrOperation(
    "ClientShellService.connectScoped",
    (input: ClientShellConnectInputEncoded) =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(yield* Scope.Scope);
        return yield* acquire(input).pipe(
          Scope.provide(scope),
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void,
          ),
        );
      }),
  );
  return ClientShellService.of({
    connectScoped,
    withConnection: (input, use) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connectScoped(input);
          return yield* use(connection).pipe(Effect.raceFirst(connection.awaitClosed()));
        }),
      ),
    projections: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const connection = yield* connectScoped({ ...input, initialSurface: "inactive" });
          return connection.projections;
        }),
      ),
  });
});
/** Provides lazy endpoint sessions with visible configuration and API transport dependencies. @category layers @since 0.9.0 */
export const clientShellServiceLayerWithoutDependencies = Layer.effect(
  ClientShellService,
  makeClientShellService,
);
/** Production client-shell Layer; connections remain lazy and callback/stream owned. @category layers @since 0.9.0 */
export const clientShellServiceLayer = clientShellServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
  Layer.provide(herdrConfigLayer),
);
