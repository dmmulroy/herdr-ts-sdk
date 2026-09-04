/**
 * Resolves and provides immutable Herdr SDK configuration.
 *
 * Configuration selects a Unix socket from explicit options or ambient inputs, validates request deadlines and caller identity, and exposes Layers for production and controlled composition.
 *
 * @since 0.8.2
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Config, Context, Duration, Effect, Layer, Option, Schema } from "effect";
import {
  HerdrAbsolutePath,
  type HerdrAbsolutePath as HerdrAbsolutePathValue,
  HerdrSessionName,
  type HerdrSessionName as HerdrSessionNameValue,
  parseHerdrAbsolutePath,
  parseHerdrSessionName,
} from "./herdr-domain.ts";
import { HerdrConfigurationError } from "./herdr-errors.ts";

const DEFAULT_REQUEST_TIMEOUT = Duration.seconds(5);

/**
 * Wire protocol versions accepted during the Herdr compatibility handshake.
 *
 * @category constants
 * @since 0.8.2
 */
export const SUPPORTED_HERDR_PROTOCOLS = [17, 18, 19, 20, 21] as const;

/**
 * Narrows a number to a supported Herdr wire protocol version.
 *
 * @category guards
 * @since 0.8.2
 */
export function isSupportedHerdrProtocol(
  protocol: number,
): protocol is (typeof SUPPORTED_HERDR_PROTOCOLS)[number] {
  return (SUPPORTED_HERDR_PROTOCOLS as readonly number[]).includes(protocol);
}

/**
 * Finite, non-negative deadline for ordinary Herdr transport requests.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrRequestDeadline = Schema.Duration.check(
  Schema.makeFilter((value) =>
    Duration.isFinite(value) && !Duration.isNegative(value)
      ? undefined
      : "must be a finite, non-negative duration",
  ),
);

/**
 * Parsed deadline for ordinary Herdr transport requests.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrRequestDeadline = typeof HerdrRequestDeadline.Type;

/**
 * Application identity sent during the Herdr compatibility handshake.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrApplication = Schema.Struct({
  name: Schema.NonEmptyString,
  version: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
});

/**
 * Parsed application identity sent during the Herdr compatibility handshake.
 *
 * @category models
 * @since 0.8.2
 */
export interface HerdrApplication extends Schema.Schema.Type<typeof HerdrApplication> {}

/**
 * Supported Herdr wire protocol version.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrProtocolVersion = Schema.Literals(SUPPORTED_HERDR_PROTOCOLS);

/**
 * Supported Herdr wire protocol version.
 *
 * @category models
 * @since 0.8.2
 */
export type HerdrProtocolVersion = typeof HerdrProtocolVersion.Type;

/**
 * Explicit SDK configuration accepted by {@link makeHerdrConfig}.
 *
 * @category schemas
 * @since 0.8.2
 */
export const HerdrConfigOptions = Schema.Struct({
  socketPath: Schema.optionalKey(HerdrAbsolutePath),
  session: Schema.optionalKey(HerdrSessionName),
  requestTimeout: Schema.optionalKey(HerdrRequestDeadline),
  application: Schema.optionalKey(HerdrApplication),
}).check(
  Schema.makeFilter((value) =>
    value.socketPath === undefined || value.session === undefined
      ? undefined
      : "socketPath and session are mutually exclusive",
  ),
);

/**
 * External representation of explicit Herdr SDK configuration.
 *
 * @category models
 * @since 0.8.2
 */
export interface HerdrConfigOptions extends Schema.Codec.Encoded<typeof HerdrConfigOptions> {}

const parseHerdrConfigOptions = Schema.decodeUnknownEffect(HerdrConfigOptions);
const parseHerdrDurationFromString = Schema.decodeUnknownEffect(Schema.DurationFromString);
const parseHerdrRequestDeadline = Schema.decodeUnknownEffect(HerdrRequestDeadline);

/**
 * Immutable configuration consumed by Herdr SDK services.
 *
 * @category services
 * @since 0.8.2
 */
export interface IHerdrConfig {
  /** Resolved local socket used for every Herdr request. */
  readonly socketPath: HerdrAbsolutePathValue;
  /** Named session that selected the socket, or `None` for an exact/default socket. */
  readonly session: Option.Option<HerdrSessionNameValue>;
  /** Default local deadline for ordinary transport requests. */
  readonly requestTimeout: HerdrRequestDeadline;
  /** Optional application identity included in the compatibility handshake. */
  readonly application: Option.Option<HerdrApplication>;
  /** Wire protocols this SDK accepts at handshake. */
  readonly supportedProtocols: typeof SUPPORTED_HERDR_PROTOCOLS;
}

/**
 * Yieldable Effect service containing resolved Herdr SDK configuration.
 *
 * @category services
 * @since 0.8.2
 */
export class HerdrConfig extends Context.Service<HerdrConfig, IHerdrConfig>()(
  "@rudironsoni/sdk/HerdrConfig",
) {}

const ambientHerdrConfig = Config.all({
  socketPath: Config.option(Config.string("HERDR_SOCKET_PATH")),
  session: Config.option(Config.string("HERDR_SESSION")),
  configDirectory: Config.option(Config.string("HERDR_CONFIG_DIR")),
  xdgConfigHome: Config.option(Config.string("XDG_CONFIG_HOME")),
  appData: Config.option(Config.string("APPDATA")),
  requestTimeout: Config.option(Config.string("HERDR_REQUEST_TIMEOUT")),
});

type AmbientHerdrConfig = Config.Success<typeof ambientHerdrConfig>;
type ParsedHerdrConfigOptions = typeof HerdrConfigOptions.Type;

/**
 * Effect Config recipe that resolves ambient Herdr SDK configuration.
 *
 * @category configuration
 * @since 0.8.2
 */
export const herdrConfigRecipe: Config.Config<IHerdrConfig> = ambientHerdrConfig.pipe(
  Config.mapOrFail((ambient) =>
    resolveHerdrConfig({}, ambient).pipe(Effect.mapError((cause) => new Config.ConfigError(cause))),
  ),
);

const makeHerdrConfigEffect = Effect.fn("HerdrConfig.make")(
  function* (options: HerdrConfigOptions) {
    const parsedOptions = yield* parseHerdrConfigOptions(options);
    const ambient = yield* ambientHerdrConfig;
    const config = yield* resolveHerdrConfig(parsedOptions, ambient);
    return HerdrConfig.of(config);
  },
  Effect.mapError((cause) => new HerdrConfigurationError(cause)),
);

/**
 * Constructs Herdr configuration using explicit options before ambient configuration.
 *
 * @category constructors
 * @since 0.8.2
 */
export function makeHerdrConfig(
  options: HerdrConfigOptions = {},
): Effect.Effect<HerdrConfig["Service"], HerdrConfigurationError> {
  return makeHerdrConfigEffect(options);
}

/**
 * Provides Herdr configuration while preserving the active ConfigProvider.
 *
 * @category layers
 * @since 0.8.2
 */
export const herdrConfigLayerWithoutDependencies: Layer.Layer<
  HerdrConfig,
  HerdrConfigurationError
> = Layer.effect(HerdrConfig, makeHerdrConfig());

/**
 * Production Layer that loads Herdr configuration from the active ConfigProvider.
 *
 * @category layers
 * @since 0.8.2
 */
export const herdrConfigLayer: Layer.Layer<HerdrConfig, HerdrConfigurationError> =
  herdrConfigLayerWithoutDependencies;

/**
 * Provides Herdr configuration resolved from explicit and ambient options.
 *
 * @category layers
 * @since 0.8.2
 */
export function herdrConfigLayerFromOptions(
  options: HerdrConfigOptions,
): Layer.Layer<HerdrConfig, HerdrConfigurationError> {
  return Layer.effect(HerdrConfig, makeHerdrConfig(options));
}

/**
 * Provides an already parsed Herdr configuration value.
 *
 * @category layers
 * @since 0.8.2
 */
export function herdrConfigLayerFromValue(config: IHerdrConfig): Layer.Layer<HerdrConfig> {
  return Layer.succeed(HerdrConfig, HerdrConfig.of(config));
}

function resolveHerdrConfig(
  options: ParsedHerdrConfigOptions,
  ambient: AmbientHerdrConfig,
): Effect.Effect<IHerdrConfig, Schema.SchemaError> {
  return Effect.gen(function* () {
    const selection = yield* resolveHerdrSocketSelection(options, ambient);
    const requestTimeout = yield* resolveHerdrRequestTimeout(options, ambient);

    return {
      ...selection,
      requestTimeout,
      application: Option.fromNullishOr(options.application),
      supportedProtocols: SUPPORTED_HERDR_PROTOCOLS,
    };
  });
}

function resolveHerdrSocketSelection(
  options: ParsedHerdrConfigOptions,
  ambient: AmbientHerdrConfig,
): Effect.Effect<Pick<IHerdrConfig, "socketPath" | "session">, Schema.SchemaError> {
  return Effect.gen(function* () {
    if (options.socketPath !== undefined) {
      return { socketPath: options.socketPath, session: Option.none() };
    }

    if (options.session !== undefined) {
      const configDirectory = yield* resolveHerdrConfigDirectory(ambient);
      return {
        socketPath: HerdrAbsolutePath.make(
          join(configDirectory, "sessions", options.session, "herdr.sock"),
        ),
        session: Option.some(options.session),
      };
    }

    if (Option.isSome(ambient.socketPath)) {
      const socketPath = yield* parseHerdrAbsolutePath(ambient.socketPath.value);
      return { socketPath, session: Option.none() };
    }

    const configDirectory = yield* resolveHerdrConfigDirectory(ambient);
    if (Option.isSome(ambient.session)) {
      const session = yield* parseHerdrSessionName(ambient.session.value);
      return {
        socketPath: HerdrAbsolutePath.make(
          join(configDirectory, "sessions", session, "herdr.sock"),
        ),
        session: Option.some(session),
      };
    }

    return {
      socketPath: HerdrAbsolutePath.make(join(configDirectory, "herdr.sock")),
      session: Option.none(),
    };
  });
}

function resolveHerdrRequestTimeout(
  options: ParsedHerdrConfigOptions,
  ambient: AmbientHerdrConfig,
): Effect.Effect<HerdrRequestDeadline, Schema.SchemaError> {
  if (options.requestTimeout !== undefined) return Effect.succeed(options.requestTimeout);
  if (Option.isNone(ambient.requestTimeout)) {
    return Effect.succeed(HerdrRequestDeadline.make(DEFAULT_REQUEST_TIMEOUT));
  }

  return parseHerdrDurationFromString(ambient.requestTimeout.value).pipe(
    Effect.flatMap(parseHerdrRequestDeadline),
  );
}

function resolveHerdrConfigDirectory(
  ambient: AmbientHerdrConfig,
): Effect.Effect<HerdrAbsolutePathValue, Schema.SchemaError> {
  if (Option.isSome(ambient.configDirectory)) {
    return parseHerdrAbsolutePath(ambient.configDirectory.value);
  }

  if (process.platform === "win32") {
    if (Option.isSome(ambient.appData)) {
      return parseHerdrAbsolutePath(ambient.appData.value).pipe(
        Effect.map((base) => HerdrAbsolutePath.make(join(base, "herdr"))),
      );
    }
    return Effect.succeed(HerdrAbsolutePath.make(join(homedir(), "herdr")));
  }

  if (Option.isSome(ambient.xdgConfigHome)) {
    return parseHerdrAbsolutePath(ambient.xdgConfigHome.value).pipe(
      Effect.map((base) => HerdrAbsolutePath.make(join(base, "herdr"))),
    );
  }
  return Effect.succeed(HerdrAbsolutePath.make(join(homedir(), ".config", "herdr")));
}
