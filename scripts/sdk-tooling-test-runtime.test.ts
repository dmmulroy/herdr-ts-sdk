import { Deferred, Effect, FileSystem } from "effect";
import { afterAll, expect, test } from "vite-plus/test";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";

// This inner gate can release the resource even if the runner stops forwarding all signals.
const teardown = Effect.runSync(Deferred.make<void>());
let timeoutSignal: AbortSignal | undefined;
let releasedDirectory: string | undefined;
let finalized = false;
let pending: Promise<void> = Promise.resolve();

test.fails("Vitest timeout aborts a tooling test that still owns a Node resource", (context) => {
  timeoutSignal = context.signal;
  pending = runSdkToolingTest(
    context,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          finalized = true;
        }),
      );
      const fs = yield* FileSystem.FileSystem;
      releasedDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-test-cancel-" });
      yield* Deferred.await(teardown);
    }),
  );
  return pending;
}, 500);

test("Vitest cancellation finishes finalizers and removes the owned directory", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      expect(timeoutSignal?.aborted).toBe(true);
      // Await the actual runtime exit, not a scheduler sleep or an explicit Fiber.interrupt.
      yield* Effect.promise(() => pending.catch(() => {})).pipe(Effect.timeout("1 second"));
      expect(finalized).toBe(true);
      expect(releasedDirectory).toBeDefined();
      if (releasedDirectory === undefined)
        return yield* Effect.die("Tooling resource not acquired");
      const fs = yield* FileSystem.FileSystem;
      expect(yield* fs.exists(releasedDirectory)).toBe(false);
    }),
  ));

afterAll(() => {
  Effect.runSync(Deferred.succeed(teardown, undefined));
  return pending.catch(() => {});
});
