import { runHerdrTest } from "./herdr-test-runtime.ts";
import { test } from "vite-plus/test";
import { executeHerdrEvidenceRecipe } from "./herdr-evidence-scenarios.ts";

// Controls: explicit fixture endpoint, fixed workspace response, caller-owned request ID.
// Hypothesis: Domain input becomes snake-case wire input; wire output becomes domain output.
test("sdk learning: request-wire-result", (context) =>
  runHerdrTest(context, executeHerdrEvidenceRecipe("request-wire-result")));

// Controls: corrupt only the first ping; retry explicitly on the same SDK without a retry policy.
// Hypothesis: Compatibility failure is recoverable; successful compatibility is shared across namespaces.
test("sdk learning: compatibility-recovery", (context) =>
  runHerdrTest(context, executeHerdrEvidenceRecipe("compatibility-recovery")));

// Controls: acceptance and one event arrive together; observe close, never sleep to guess readiness.
// Hypothesis: A finite event consumer normalizes its event and releases the scoped subscription socket.
test("sdk learning: scoped-subscription", (context) =>
  runHerdrTest(context, executeHerdrEvidenceRecipe("scoped-subscription")));

// Controls: two distinct tiny payloads; capture their bytes, then let the writer escape its scope.
// Hypothesis: Concurrent graphics writes serialize complete frames; scope closure invalidates the writer.
test("sdk learning: graphics-writer", (context) =>
  runHerdrTest(context, executeHerdrEvidenceRecipe("graphics-writer")));
