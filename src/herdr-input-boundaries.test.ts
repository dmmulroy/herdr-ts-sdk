import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import { HerdrInvalidInput } from "./herdr-errors.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

test("encoded layout targets and pane ratios are parsed before transport", async () => {
  const server = await startHerdrTestServer((request) => makeHerdrSuccessResponse(request));

  try {
    const failures = await Effect.runPromise(
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const paneId = herdr.ids.pane("pane-1");
        const invalidTarget = yield* herdr.layouts.export({ tabId: "" }).pipe(Effect.flip);
        const invalidRatio = yield* herdr.panes
          .move(paneId, {
            destination: {
              type: "tab",
              tabId: "tab-1",
              split: "right",
              ratio: 0,
            },
          })
          .pipe(Effect.flip);
        return { invalidRatio, invalidTarget };
      }).pipe(
        Effect.provide(
          herdrSdkLayerFromOptions({
            socketPath: HerdrAbsolutePath.make(server.socketPath),
          }),
        ),
      ),
    );

    expect(failures.invalidTarget).toBeInstanceOf(HerdrInvalidInput);
    expect(failures.invalidRatio).toBeInstanceOf(HerdrInvalidInput);
    expect(server.requests).toEqual([]);
  } finally {
    await server.close();
  }
});
