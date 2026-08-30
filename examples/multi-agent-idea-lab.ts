import { Duration, Effect } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const ideaTopic =
  process.argv.slice(2).join(" ") || "Invent a delightful way to teach Effect resource safety";
const runSuffix = process.pid.toString();

const multiAgentIdeaLab = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const repositoryPath = herdr.ids.absolutePath(process.cwd());
  const created = yield* herdr.workspaces.create({
    cwd: repositoryPath,
    focus: true,
    label: `Idea lab: ${ideaTopic.slice(0, 32)}`,
  });
  const challengerPane = yield* herdr.panes.split(created.rootPane.id, {
    direction: "right",
    ratio: 0.5,
    cwd: repositoryPath,
    focus: false,
  });
  const synthesizerPane = yield* herdr.panes.split(challengerPane.id, {
    direction: "down",
    ratio: 0.5,
    cwd: repositoryPath,
    focus: false,
  });
  const explorerName = herdr.ids.agentName(`idea-explorer-${runSuffix}`);
  const challengerName = herdr.ids.agentName(`idea-challenger-${runSuffix}`);
  const synthesizerName = herdr.ids.agentName(`idea-synthesizer-${runSuffix}`);

  yield* Effect.all(
    [
      herdr.agents.start({
        name: explorerName,
        kind: "codex",
        paneId: created.rootPane.id,
      }),
      herdr.agents.start({ name: challengerName, kind: "codex", paneId: challengerPane.id }),
      herdr.agents.start({ name: synthesizerName, kind: "codex", paneId: synthesizerPane.id }),
    ],
    { concurrency: "unbounded" },
  );

  yield* Effect.all(
    [
      herdr.agents.prompt(
        { name: explorerName },
        {
          text: `Explore surprising, ambitious approaches to this topic: ${ideaTopic}. Return five concrete concepts with their user value.`,
          wait: { until: ["done", "blocked"], timeoutMs: Duration.toMillis(Duration.minutes(8)) },
        },
        { requestTimeout: Duration.minutes(9) },
      ),
      herdr.agents.prompt(
        { name: challengerName },
        {
          text: `Act as a constructive skeptic for this topic: ${ideaTopic}. Identify hidden assumptions, failure modes, and three unconventional alternatives.`,
          wait: { until: ["done", "blocked"], timeoutMs: Duration.toMillis(Duration.minutes(8)) },
        },
        { requestTimeout: Duration.minutes(9) },
      ),
    ],
    { concurrency: "unbounded" },
  );

  const [exploration, challenge] = yield* Effect.all(
    [
      herdr.agents.read({ name: explorerName }, { source: "recent_unwrapped", lines: 100 }),
      herdr.agents.read({ name: challengerName }, { source: "recent_unwrapped", lines: 100 }),
    ],
    { concurrency: "unbounded" },
  );
  const context = [exploration.text, challenge.text].map((text) => text.slice(-6_000)).join("\n\n");

  yield* herdr.agents.prompt(
    { name: synthesizerName },
    {
      text: `Synthesize the two research transcripts below into one feasible, original proposal for: ${ideaTopic}. Include a smallest experiment and success criteria.\n\n${context}`,
      wait: { until: ["done", "blocked"], timeoutMs: Duration.toMillis(Duration.minutes(8)) },
    },
    { requestTimeout: Duration.minutes(9) },
  );
  yield* herdr.agents.focus({ name: synthesizerName });
  yield* herdr.notifications.show({
    title: "Idea lab synthesis ready",
    body: `Explorer and challenger results were combined for “${ideaTopic.slice(0, 80)}”`,
    sound: "done",
  });
});

await runHerdrExample(multiAgentIdeaLab);
