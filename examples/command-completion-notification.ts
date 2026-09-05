import { Duration, Effect, Option } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const buildCompletionMarker = "HERDR_BUILD_FINISHED";

const commandCompletionNotification = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const repositoryPath = herdr.ids.absolutePath(process.cwd());
  const commandPane = yield* herdr.panes.split(undefined, {
    direction: "down",
    ratio: 0.35,
    cwd: repositoryPath,
    focus: false,
  });

  yield* herdr.panes.sendText(
    commandPane.id,
    `pnpm run build; code=$?; printf '\\n${buildCompletionMarker}:%s\\n' "$code"\n`,
  );
  const completed = yield* herdr.panes.waitForOutput(
    commandPane.id,
    {
      source: "recent_unwrapped",
      lines: 200,
      // Match only the emitted result, not the shell's echo of the command above.
      match: { type: "regex", value: `^${buildCompletionMarker}:[0-9]+$` },
      timeoutMs: Duration.toMillis(Duration.minutes(10)),
      stripAnsi: true,
    },
    { requestTimeout: Duration.minutes(11) },
  );
  const matchedLine = Option.getOrElse(
    completed.matchedLine,
    () => `${buildCompletionMarker}:unknown`,
  );
  const succeeded = matchedLine.endsWith(":0");

  yield* herdr.notifications.show({
    title: succeeded ? "Build succeeded" : "Build needs attention",
    body: matchedLine,
    sound: succeeded ? "done" : "request",
  });
});

runHerdrExample(commandCompletionNotification);
