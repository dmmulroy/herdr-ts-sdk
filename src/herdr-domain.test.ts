import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import {
  parseHerdrAbsolutePath,
  parseHerdrPopupSize,
  parseHerdrSessionName,
} from "./herdr-domain.ts";

test("custom domain filters reject unsafe paths and invalid percentage syntax", async () => {
  await expect(Effect.runPromise(parseHerdrAbsolutePath("relative/socket"))).rejects.toBeDefined();
  await expect(Effect.runPromise(parseHerdrSessionName("../escaped"))).rejects.toBeDefined();
  await expect(Effect.runPromise(parseHerdrPopupSize("101%"))).rejects.toBeDefined();
});

test("filesystem paths and session names reject embedded NUL bytes", async () => {
  await expect(
    Effect.runPromise(parseHerdrAbsolutePath("/tmp/herdr\u0000.sock")),
  ).rejects.toBeDefined();
  await expect(Effect.runPromise(parseHerdrSessionName("main\u0000other"))).rejects.toBeDefined();
});

test("custom popup-size parser preserves a valid percentage", async () => {
  const popupSize = await Effect.runPromise(parseHerdrPopupSize("80%"));

  expect(popupSize).toBe("80%");
});
