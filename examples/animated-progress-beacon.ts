import { Effect } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const beaconWidth = 64;
const beaconHeight = 16;
const beaconLayerId = "animated-progress-beacon";
const frameCount = 48;

function makeBeaconFrame(frameIndex: number): Uint8Array {
  const pixels = new Uint8Array(beaconWidth * beaconHeight * 4);
  const pulseCenter = (frameIndex / frameCount) * (beaconWidth + 16) - 8;

  for (let row = 0; row < beaconHeight; row += 1) {
    for (let column = 0; column < beaconWidth; column += 1) {
      const pixelOffset = (row * beaconWidth + column) * 4;
      const horizontalDistance = Math.abs(column - pulseCenter);
      const verticalDistance = Math.abs(row - beaconHeight / 2);
      const intensity = Math.max(0, 1 - horizontalDistance / 12 - verticalDistance / 10);
      pixels[pixelOffset] = Math.round(40 + intensity * 30);
      pixels[pixelOffset + 1] = Math.round(70 + intensity * 170);
      pixels[pixelOffset + 2] = Math.round(110 + intensity * 140);
      pixels[pixelOffset + 3] = Math.round(70 + intensity * 185);
    }
  }
  return pixels;
}

const animatedProgressBeacon = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const currentPane = yield* herdr.panes.current();
  const capabilities = yield* herdr.panes.graphics.info(currentPane.id);

  if (!capabilities.paneVisible) {
    return yield* Effect.logWarning(`Pane ${currentPane.id} is not currently visible`);
  }

  yield* Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* herdr.panes.graphics.openLayerStream(currentPane.id, {
        layerId: beaconLayerId,
        zIndex: 60,
      });
      yield* Effect.forEach(
        Array.from({ length: frameCount }, (_, frameIndex) => frameIndex),
        (frameIndex) =>
          writer
            .write({
              format: "rgba",
              imageWidth: beaconWidth,
              imageHeight: beaconHeight,
              data: makeBeaconFrame(frameIndex),
              placement: { viewportCol: 0, viewportRow: 0, gridCols: 16, gridRows: 4 },
            })
            .pipe(Effect.andThen(Effect.sleep("50 millis"))),
        { discard: true },
      );
    }),
  ).pipe(
    Effect.ensuring(
      herdr.panes.graphics
        .clearLayer(currentPane.id, { layerId: beaconLayerId })
        .pipe(Effect.ignore),
    ),
  );
});

await runHerdrExample(animatedProgressBeacon);
