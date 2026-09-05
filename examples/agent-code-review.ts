import { Duration, Effect } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const agentCodeReview = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const repositoryPath = herdr.ids.absolutePath(process.cwd());
  const reviewerPane = yield* herdr.panes.split(undefined, {
    direction: "right",
    ratio: 0.5,
    cwd: repositoryPath,
    focus: false,
  });
  const reviewerName = herdr.ids.agentName("sdk-reviewer");

  yield* herdr.agents.start({
    name: reviewerName,
    kind: "pi",
    paneId: reviewerPane.id,
    timeoutMs: Duration.toMillis(Duration.minutes(2)),
  });
  const reviewer = yield* herdr.agents.prompt(
    { name: reviewerName },
    {
      text: [
        "Review the current git changes.",
        "Focus on correctness, public API compatibility, and missing tests.",
        "Do not edit files. Summarize actionable findings when finished.",
      ].join(" "),
      wait: {
        until: ["done", "blocked"],
        timeoutMs: Duration.toMillis(Duration.minutes(10)),
      },
    },
    { requestTimeout: Duration.minutes(11) },
  );

  yield* herdr.notifications.show({
    title: "SDK review finished",
    body: `Reviewer stopped with status ${reviewer.status}`,
    sound: reviewer.status === "blocked" ? "request" : "done",
  });
});

runHerdrExample(agentCodeReview);
