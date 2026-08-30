import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  AgentManifest,
  AgentManifestStatus,
  ConfigReloadResult,
  PingResult,
  ServerLiveHandoffInput,
  type ServerLiveHandoffInputEncoded,
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
const parseServerLiveHandoffInput = Schema.decodeUnknownEffect(ServerLiveHandoffInput);

/** Expected failure union for server lifecycle and compatibility operations. */
export type ServerOperationError = HerdrTransportRequestError;

/** Server lifecycle, compatibility, configuration, and manifest capability. */
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
}

/** Yieldable Effect service for Herdr server operations. */
export class ServerService extends Context.Service<ServerService, IServerService>()(
  "@herdr/sdk/ServerService",
) {}

/** Constructs server operations while preserving the shared transport requirement. */
export const makeServerService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  return ServerService.of({
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

/** Provides server operations while retaining the shared transport requirement. */
export const serverServiceLayerWithoutDependencies: Layer.Layer<
  ServerService,
  never,
  HerdrTransport
> = Layer.effect(ServerService, makeServerService);

/** Production server-service Layer using the ambient Herdr transport graph. */
export const serverServiceLayer = serverServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
