import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigProvider, Duration, Effect, Option } from "effect";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import {
  HerdrConfig,
  type HerdrConfigOptions,
  herdrConfigLayerFromOptions,
  makeHerdrConfig,
} from "./herdr-config.ts";
import { HerdrConfigurationError } from "./herdr-errors.ts";

interface HerdrTestAmbientConfig {
  readonly APPDATA?: string;
  readonly HERDR_CONFIG_DIR?: string;
  readonly HERDR_REQUEST_TIMEOUT?: string;
  readonly HERDR_SESSION?: string;
  readonly HERDR_SOCKET_PATH?: string;
  readonly XDG_CONFIG_HOME?: string;
}

const configDirectory = join(tmpdir(), "herdr-config");
const exactSocketPath = join(tmpdir(), "exact.sock");
const explicitSocketPath = join(tmpdir(), "explicit.sock");

test("ambient socket path takes precedence without decoding ignored session settings", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const config = yield* loadHerdrConfig({
        HERDR_SOCKET_PATH: exactSocketPath,
        HERDR_SESSION: "../ignored-invalid-session",
        HERDR_CONFIG_DIR: "ignored-relative-directory",
        HERDR_REQUEST_TIMEOUT: "2 seconds",
      });
      expect(config.socketPath).toBe(exactSocketPath);
      expect(Option.isNone(config.session)).toBe(true);
      expect(Duration.toMillis(config.requestTimeout)).toBe(2_000);
    }),
  ));

test("ambient session resolves beneath the configured Herdr directory", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const config = yield* loadHerdrConfig({
        HERDR_SESSION: "work",
        HERDR_CONFIG_DIR: configDirectory,
      });
      expect(config.socketPath).toBe(join(configDirectory, "sessions", "work", "herdr.sock"));
      expect(Option.getOrUndefined(config.session)).toBe("work");
      expect(Duration.toMillis(config.requestTimeout)).toBe(5_000);
    }),
  ));

test("explicit options take precedence over malformed ambient selectors", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const config = yield* loadHerdrConfig(
        {
          HERDR_SOCKET_PATH: "relative-ambient-socket",
          HERDR_SESSION: "../invalid-ambient-session",
          HERDR_REQUEST_TIMEOUT: "not a duration",
        },
        {
          socketPath: explicitSocketPath,
          requestTimeout: Duration.seconds(3),
          application: { name: "config-test", version: "1.0.0" },
        },
      );
      const application = Option.getOrThrow(config.application);
      expect(config.socketPath).toBe(explicitSocketPath);
      expect(Duration.toMillis(config.requestTimeout)).toBe(3_000);
      expect(application.name).toBe("config-test");
      expect(Option.getOrUndefined(application.version)).toBe("1.0.0");
    }),
  ));

test("invalid selected ambient socket fails instead of falling through to a session", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const error = yield* loadHerdrConfig({
        HERDR_SOCKET_PATH: "relative-socket",
        HERDR_SESSION: "valid-session",
        HERDR_CONFIG_DIR: configDirectory,
      }).pipe(Effect.flip);
      expect(error).toBeInstanceOf(HerdrConfigurationError);
      expect(error._tag).toBe("HerdrConfigurationError");
      expect(error.operation).toBe("loadHerdrConfig");
    }),
  ));

test("selected timeout strings retain deadline validation after duration decoding", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      for (const timeout of ["-1 seconds", "not a duration"]) {
        const error = yield* loadHerdrConfig({
          HERDR_SOCKET_PATH: exactSocketPath,
          HERDR_REQUEST_TIMEOUT: timeout,
        }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(HerdrConfigurationError);
        expect(error.operation).toBe("loadHerdrConfig");
      }
      const config = yield* loadHerdrConfig({
        HERDR_SOCKET_PATH: exactSocketPath,
        HERDR_REQUEST_TIMEOUT: "0 seconds",
      });
      expect(Duration.toMillis(config.requestTimeout)).toBe(0);
    }),
  ));

test("encoded config options retain mutually exclusive socket and session validation", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const error = yield* loadHerdrConfig(
        {},
        { socketPath: explicitSocketPath, session: "valid-session" },
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(HerdrConfigurationError);
      expect(error.operation).toBe("loadHerdrConfig");
    }),
  ));

test("configuration Layer exposes the resolved yieldable service", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const providerLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({ HERDR_CONFIG_DIR: configDirectory }),
      );
      const config = yield* HerdrConfig.pipe(
        Effect.provide(herdrConfigLayerFromOptions({ session: "layer-session" })),
        Effect.provide(providerLayer),
      );
      expect(config.socketPath).toBe(
        join(configDirectory, "sessions", "layer-session", "herdr.sock"),
      );
    }),
  ));

function loadHerdrConfig(ambient: HerdrTestAmbientConfig, options: HerdrConfigOptions = {}) {
  return makeHerdrConfig(options).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(ambient))),
  );
}
