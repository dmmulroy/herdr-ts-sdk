import { Effect, Option, Stream } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const liveAgentMonitor = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const currentPane = yield* herdr.panes.current();

  yield* Effect.logInfo(
    `Monitoring agent status in pane ${currentPane.id}; interrupt the process to stop`,
  );
  yield* herdr.events
    .subscribe([{ type: "pane.agent_status_changed", paneId: currentPane.id }] as const)
    .pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `Agent ${event.agentStatus} in pane ${event.paneId}: ${Option.getOrElse(event.displayAgent, () => "unnamed")}`,
          );
          if (event.agentStatus === "blocked" || event.agentStatus === "done") {
            yield* herdr.notifications.show({
              title: event.agentStatus === "blocked" ? "Agent needs input" : "Agent finished",
              body: `Pane ${event.paneId} is ${event.agentStatus}`,
              sound: event.agentStatus === "blocked" ? "request" : "done",
            });
          }
        }),
      ),
    );
});

runHerdrExample(liveAgentMonitor);
