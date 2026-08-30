import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import { HerdrUnsupportedResult } from "./herdr-errors.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

test("plugin pane overloads reject server results that contradict placement", async () => {
  const server = await startHerdrTestServer((request) => {
    if (request.method !== "plugin.pane.open") return makeHerdrSuccessResponse(request);
    if (request.params.placement === "popup") {
      return makeHerdrSuccessResponse({
        ...request,
        params: { ...request.params, placement: "overlay" },
      });
    }
    return { id: request.id, result: { type: "ok" } };
  });

  try {
    const failures = await Effect.runPromise(
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const pluginId = herdr.ids.plugin("plugin-1");
        const popup = yield* herdr.plugins.panes
          .open(pluginId, { entrypoint: "future", placement: "popup" })
          .pipe(Effect.flip);
        const overlay = yield* herdr.plugins.panes
          .open(pluginId, { entrypoint: "future", placement: "overlay" })
          .pipe(Effect.flip);
        return { overlay, popup };
      }).pipe(
        Effect.provide(
          herdrSdkLayerFromOptions({
            socketPath: HerdrAbsolutePath.make(server.socketPath),
          }),
        ),
      ),
    );

    expect(failures.popup).toBeInstanceOf(HerdrUnsupportedResult);
    expect(failures.popup).toMatchObject({ expectedType: "ok" });
    expect(failures.overlay).toBeInstanceOf(HerdrUnsupportedResult);
    expect(failures.overlay).toMatchObject({ expectedType: "plugin_pane_opened" });
  } finally {
    await server.close();
  }
});
