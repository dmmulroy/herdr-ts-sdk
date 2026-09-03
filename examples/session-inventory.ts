import { Effect, Option } from "effect";
import { HerdrSdk } from "@rudironsoni/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const sessionInventory = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const snapshot = yield* herdr.session.snapshot();
  const agentStatusCounts = snapshot.agents.reduce((counts, agent) => {
    counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  yield* Effect.sync(() => {
    console.table(
      snapshot.workspaces.map((workspace) => ({
        workspace: workspace.label,
        id: workspace.id,
        panes: workspace.paneCount,
        tabs: workspace.tabCount,
        focused: workspace.focused,
        agentStatus: workspace.agentStatus,
      })),
    );
    console.table(
      [...agentStatusCounts].map(([status, count]) => ({ agentStatus: status, count })),
    );
  });
  yield* Effect.logInfo(
    `Session protocol ${snapshot.protocol}; focused workspace ${Option.getOrElse(snapshot.focusedWorkspaceId, () => "none")}`,
  );
});

await runHerdrExample(sessionInventory);
