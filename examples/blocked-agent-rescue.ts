import { Effect, Option } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const rescueViewSource = "blocked-agent-rescue";

const blockedAgentRescue = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const agents = yield* herdr.agents.list();
  const blockedAgent = agents.find((agent) => agent.status === "blocked");

  if (blockedAgent === undefined) {
    yield* herdr.notifications.show({
      title: "No agents need rescue",
      body: `Checked ${agents.length} detected agents`,
      sound: "done",
    });
    return;
  }

  yield* herdr.agents.view.set({
    source: rescueViewSource,
    label: "Needs attention",
    filter: { op: "eq", field: "status", value: "blocked" },
    sort: [
      { field: "attention", order: "desc" },
      { field: "state_change_seq", order: "asc" },
    ],
  });
  yield* herdr.agents.focus({ paneId: blockedAgent.paneId });
  const recentOutput = yield* herdr.agents.read(
    { paneId: blockedAgent.paneId },
    { source: "recent_unwrapped", lines: 40, stripAnsi: true },
  );
  const agentLabel = Option.getOrElse(blockedAgent.displayAgent, () =>
    Option.getOrElse(blockedAgent.agent, () => "Agent"),
  );

  yield* Effect.sync(() => console.log(recentOutput.text));
  yield* herdr.notifications.show({
    title: `${agentLabel} needs input`,
    body: `Focused pane ${blockedAgent.paneId} and opened a filtered attention view`,
    sound: "request",
  });
});

await runHerdrExample(blockedAgentRescue);
