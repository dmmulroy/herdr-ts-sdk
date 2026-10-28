/**
 * Controls Herdr server lifecycle and compatibility operations.
 *
 * The server service exposes ping, stop, live handoff, configuration reload, agent-manifest cache inspection, and connection-scoped SSH agent registration through the shared transport.
 *
 * @since 0.8.2
 */
import { Context, Deferred, Effect, Exit, Layer, Option, Schema, Scope, Stream } from "effect";
import type { HerdrAbsolutePath } from "./herdr-domain.ts";
import { HerdrSshAgentRegistrationClosed, type HerdrTransportError } from "./herdr-errors.ts";
import {
  AgentManifest,
  AgentManifestStatus,
  ConfigReloadResult,
  PingResult,
  ServerLiveHandoffInput,
  type ServerLiveHandoffInputEncoded,
  ServerSshAgentRegisterInput,
  type ServerSshAgentRegisterInputEncoded,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseAgentManifests = Schema.decodeUnknownEffect(Schema.Array(AgentManifest));
const parseAgentManifestStatus = Schema.decodeUnknownEffect(AgentManifestStatus);
const parseConfigReloadResult = Schema.decodeUnknownEffect(ConfigReloadResult);
const parsePingResult = Schema.decodeUnknownEffect(PingResult);
const parseServerLiveHandoffInput = Schema.decodeEffect(ServerLiveHandoffInput);
const parseServerSshAgentRegisterInput = Schema.decodeEffect(ServerSshAgentRegisterInput);

/**
 * Expected failure union for server lifecycle and compatibility operations.
 *
 * @category errors
 * @since 0.8.2
 */
export type ServerOperationError = HerdrTransportRequestError;

/**
 * Failure ending an accepted SSH agent registration before its owner released it.
 *
 * @category errors
 * @since 0.9.5
 */
export type ServerSshAgentRegistrationError = HerdrSshAgentRegistrationClosed | HerdrTransportError;

/**
 * Accepted SSH agent registration; Herdr keeps it only while this handle's connection is open.
 *
 * @category services
 * @since 0.9.5
 */
export interface ServerSshAgentRegistration {
  /** Wire request identifier of the accepted registration. */
  readonly requestId: string;
  /** Registered agent socket path on the server host. */
  readonly socketPath: HerdrAbsolutePath;
  /** Reads whether the registration connection is still open, without probing the server. */
  readonly registrationState: () => Effect.Effect<"registered" | "closed">;
  /** Waits until Herdr ends the registration, preserving why it ended; never succeeds. */
  readonly awaitClosed: () => Effect.Effect<never, ServerSshAgentRegistrationError>;
}

/**
 * Connection-scoped SSH agent registration behind Herdr's session-local agent address.
 *
 * Herdr rejects sockets that are not absolute and user-owned with `invalid_ssh_agent`, and reports
 * `ssh_agent_unavailable` when this server cannot manage agent forwarding.
 *
 * @category services
 * @since 0.9.5
 */
export interface IServerSshAgent {
  /**
   * Registers an agent socket for the callback; releases it on success, failure, and interruption.
   * If Herdr ends the registration first, the callback is interrupted and the closure is returned.
   */
  readonly withRegistration: <A, E, R>(
    input: ServerSshAgentRegisterInputEncoded,
    use: (registration: ServerSshAgentRegistration) => Effect.Effect<A, E, R>,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<A, E | ServerOperationError | ServerSshAgentRegistrationError, R>;
  /** Advanced acquisition whose registration lasts until the caller's Scope closes. */
  readonly registerScoped: (
    input: ServerSshAgentRegisterInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<ServerSshAgentRegistration, ServerOperationError, Scope.Scope>;
}

/**
 * Server lifecycle, compatibility, configuration, and manifest capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IServerService {
  /** Pings the server and verifies protocol compatibility. */
  readonly ping: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PingResult, ServerOperationError>;
  /** Requests a graceful Herdr server stop. */
  readonly stop: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, ServerOperationError>;
  /** Hands the running server to a compatible executable. */
  readonly liveHandoff: (
    input?: ServerLiveHandoffInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, ServerOperationError>;
  /** Reloads the running server's configuration. */
  readonly reloadConfig: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<ConfigReloadResult, ServerOperationError>;
  /** Reads the current agent-manifest cache status. */
  readonly getAgentManifests: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<AgentManifestStatus, ServerOperationError>;
  /** Refreshes agent manifests and returns the resulting set. */
  readonly reloadAgentManifests: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly AgentManifest[], ServerOperationError>;
  /** Connection-scoped SSH agent registration; check `ping` capabilities for `sshAgentRegistration`. */
  readonly sshAgent: IServerSshAgent;
}

/**
 * Yieldable Effect service for Herdr server operations.
 *
 * @category services
 * @since 0.8.2
 */
export class ServerService extends Context.Service<ServerService, IServerService>()(
  "herdr-sdk/ServerService",
) {}

/**
 * Constructs server operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeServerService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  const registerScoped: IServerSshAgent["registerScoped"] = (input, options = {}) =>
    Effect.gen(function* () {
      const parsed = yield* decodeHerdrInput(
        "ServerService.sshAgent.registerScoped",
        parseServerSshAgentRegisterInput,
        input,
      );
      const opened = yield* transport.openStream(
        "server.ssh_agent.register",
        { socketPath: parsed.socketPath },
        options,
      );
      const closed = yield* Deferred.make<never, ServerSshAgentRegistrationError>();
      // Herdr sends nothing after acceptance; the lease ends when either side closes the socket.
      // Forked after socket acquisition so owner release interrupts this watcher before closing.
      yield* opened.readBytes.pipe(
        Stream.runDrain,
        Effect.flatMap(() => Effect.fail(new HerdrSshAgentRegistrationClosed(opened.requestId))),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Deferred.failCause(closed, exit.cause) : Effect.void,
        ),
        Effect.forkScoped,
      );
      return {
        requestId: opened.requestId,
        socketPath: parsed.socketPath,
        registrationState: () =>
          Deferred.isDone(closed).pipe(Effect.map((done) => (done ? "closed" : "registered"))),
        awaitClosed: () => Deferred.await(closed),
      } satisfies ServerSshAgentRegistration;
    }).pipe(Effect.withSpan("ServerService.sshAgent.registerScoped"));

  return ServerService.of({
    sshAgent: {
      registerScoped,
      withRegistration: (input, use, options = {}) =>
        Effect.scoped(
          Effect.gen(function* () {
            const registration = yield* registerScoped(input, options);
            return yield* use(registration).pipe(Effect.raceFirst(registration.awaitClosed()));
          }),
        ),
    },
    ping: defineHerdrOperation("ServerService.ping", (options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("ping", {}, options);
        return yield* decodeHerdrWire(parsePingResult, response.result, response.requestId);
      }),
    ),
    stop: defineHerdrOperation("ServerService.stop", (options = {}) =>
      transport.request("server.stop", {}, options).pipe(Effect.asVoid),
    ),
    liveHandoff: defineHerdrOperation("ServerService.liveHandoff", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "ServerService.liveHandoff",
          parseServerLiveHandoffInput,
          input,
        );
        yield* transport.request(
          "server.live_handoff",
          {
            importExe: Option.getOrNull(parsed.importExe),
            expectedProtocol: Option.getOrNull(parsed.expectedProtocol),
            expectedVersion: Option.getOrNull(parsed.expectedVersion),
          },
          options,
        );
      }),
    ),
    reloadConfig: defineHerdrOperation("ServerService.reloadConfig", (options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("server.reload_config", {}, options);
        return yield* decodeHerdrWire(parseConfigReloadResult, response.result, response.requestId);
      }),
    ),
    getAgentManifests: defineHerdrOperation("ServerService.getAgentManifests", (options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("server.agent_manifests", {}, options);
        return yield* decodeHerdrWire(
          parseAgentManifestStatus,
          response.result,
          response.requestId,
        );
      }),
    ),
    reloadAgentManifests: defineHerdrOperation(
      "ServerService.reloadAgentManifests",
      (options = {}) =>
        Effect.gen(function* () {
          const response = yield* transport.request("server.reload_agent_manifests", {}, options);
          return yield* decodeHerdrWire(
            parseAgentManifests,
            response.result.manifests,
            response.requestId,
          );
        }),
    ),
  });
});

/**
 * Provides server operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const serverServiceLayerWithoutDependencies: Layer.Layer<
  ServerService,
  never,
  HerdrTransport
> = Layer.effect(ServerService, makeServerService);

/**
 * Production server-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const serverServiceLayer = serverServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
