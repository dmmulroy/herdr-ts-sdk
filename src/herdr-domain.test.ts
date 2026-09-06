import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import {
  parseHerdrAbsolutePath,
  parseHerdrPopupSize,
  parseHerdrSessionName,
} from "./herdr-domain.ts";

test("custom domain filters reject unsafe paths and invalid percentage syntax", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      expect(yield* parseHerdrAbsolutePath("relative/socket").pipe(Effect.flip)).toBeDefined();
      expect(yield* parseHerdrSessionName("../escaped").pipe(Effect.flip)).toBeDefined();
      expect(yield* parseHerdrPopupSize("101%").pipe(Effect.flip)).toBeDefined();
    }),
  ));

test("filesystem paths and session names reject embedded NUL bytes", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      expect(
        yield* parseHerdrAbsolutePath("/tmp/herdr\u0000.sock").pipe(Effect.flip),
      ).toBeDefined();
      expect(yield* parseHerdrSessionName("main\u0000other").pipe(Effect.flip)).toBeDefined();
    }),
  ));

test("custom popup-size parser preserves a valid percentage", (context) =>
  runHerdrTest(
    context,
    Effect.gen(function* () {
      const popupSize = yield* parseHerdrPopupSize("80%");
      expect(popupSize).toBe("80%");
    }),
  ));
