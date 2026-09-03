import { Effect } from "effect";
import { HerdrSdk } from "@rudironsoni/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const overlayWidth = 32;
const overlayHeight = 16;
const overlayLayerId = "build-status";

function makeStatusOverlayPixels(): Uint8Array {
  const pixels = new Uint8Array(overlayWidth * overlayHeight * 4);
  for (let pixel = 0; pixel < overlayWidth * overlayHeight; pixel += 1) {
    const offset = pixel * 4;
    const row = Math.floor(pixel / overlayWidth);
    const column = pixel % overlayWidth;
    const highlighted = (row + column) % 2 === 0;
    pixels[offset] = highlighted ? 34 : 16;
    pixels[offset + 1] = highlighted ? 197 : 120;
    pixels[offset + 2] = highlighted ? 94 : 55;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

const graphicsStatusOverlay = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const currentPane = yield* herdr.panes.current();
  const capabilities = yield* herdr.panes.graphics.info(currentPane.id);

  if (!capabilities.paneVisible) {
    return yield* Effect.logWarning(`Pane ${currentPane.id} is not currently visible`);
  }

  yield* Effect.gen(function* () {
    yield* herdr.panes.graphics.set(currentPane.id, {
      format: "rgba",
      imageWidth: overlayWidth,
      imageHeight: overlayHeight,
      data: makeStatusOverlayPixels(),
      layerId: overlayLayerId,
      zIndex: 50,
      placement: { viewportCol: 0, viewportRow: 0, gridCols: 4, gridRows: 2 },
    });
    yield* Effect.logInfo(
      `Showing ${overlayLayerId} using ${capabilities.cellWidthPx}×${capabilities.cellHeightPx} pixel cells`,
    );
    yield* Effect.sleep("5 seconds");
  }).pipe(
    Effect.ensuring(
      herdr.panes.graphics
        .clearLayer(currentPane.id, { layerId: overlayLayerId })
        .pipe(Effect.ignore),
    ),
  );
});

await runHerdrExample(graphicsStatusOverlay);
