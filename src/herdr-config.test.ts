import { ConfigProvider, Duration, Effect, Option } from "effect";
import { expect, test } from "vite-plus/test";
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

test("ambient socket path takes precedence without decoding ignored session settings", async () => {
  const config = await loadHerdrConfig({
    HERDR_SOCKET_PATH: "/tmp/exact.sock",
    HERDR_SESSION: "../ignored-invalid-session",
    HERDR_CONFIG_DIR: "ignored-relative-directory",
    HERDR_REQUEST_TIMEOUT: "2 seconds",
  });

  expect(config.socketPath).toBe("/tmp/exact.sock");
  expect(Option.isNone(config.session)).toBe(true);
  expect(Duration.toMillis(config.requestTimeout)).toBe(2_000);
});

test("ambient session resolves beneath the configured Herdr directory", async () => {
  const config = await loadHerdrConfig({
    HERDR_SESSION: "work",
    HERDR_CONFIG_DIR: "/tmp/herdr-config",
  });

  expect(config.socketPath).toBe("/tmp/herdr-config/sessions/work/herdr.sock");
  expect(Option.getOrUndefined(config.session)).toBe("work");
  expect(Duration.toMillis(config.requestTimeout)).toBe(5_000);
});

test("explicit options take precedence over malformed ambient selectors", async () => {
  const config = await loadHerdrConfig(
    {
      HERDR_SOCKET_PATH: "relative-ambient-socket",
      HERDR_SESSION: "../invalid-ambient-session",
      HERDR_REQUEST_TIMEOUT: "not a duration",
    },
    {
      socketPath: "/tmp/explicit.sock",
      requestTimeout: Duration.seconds(3),
      application: { name: "config-test", version: "1.0.0" },
    },
  );

  const application = Option.getOrThrow(config.application);
  expect(config.socketPath).toBe("/tmp/explicit.sock");
  expect(Duration.toMillis(config.requestTimeout)).toBe(3_000);
  expect(application.name).toBe("config-test");
  expect(Option.getOrUndefined(application.version)).toBe("1.0.0");
});

test("invalid selected ambient socket fails instead of falling through to a session", async () => {
  const error = await loadHerdrConfigError({
    HERDR_SOCKET_PATH: "relative-socket",
    HERDR_SESSION: "valid-session",
    HERDR_CONFIG_DIR: "/tmp/herdr-config",
  });

  expect(error).toBeInstanceOf(HerdrConfigurationError);
  expect(error._tag).toBe("HerdrConfigurationError");
  expect(error.operation).toBe("loadHerdrConfig");
});

test("configuration Layer exposes the resolved yieldable service", async () => {
  const providerLayer = ConfigProvider.layer(
    ConfigProvider.fromUnknown({ HERDR_CONFIG_DIR: "/tmp/herdr-config" }),
  );
  const config = await Effect.runPromise(
    HerdrConfig.pipe(
      Effect.provide(herdrConfigLayerFromOptions({ session: "layer-session" })),
      Effect.provide(providerLayer),
    ),
  );

  expect(config.socketPath).toBe("/tmp/herdr-config/sessions/layer-session/herdr.sock");
});

function loadHerdrConfig(ambient: HerdrTestAmbientConfig, options: HerdrConfigOptions = {}) {
  return Effect.runPromise(
    makeHerdrConfig(options).pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(ambient))),
    ),
  );
}

function loadHerdrConfigError(ambient: HerdrTestAmbientConfig) {
  return Effect.runPromise(
    makeHerdrConfig().pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(ambient))),
      Effect.flip,
    ),
  );
}
