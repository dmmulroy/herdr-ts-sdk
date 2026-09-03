import { Effect } from "effect";
import { HerdrSdk } from "@rudironsoni/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const developmentWorkspace = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const repositoryPath = herdr.ids.absolutePath(process.cwd());
  const created = yield* herdr.workspaces.create({
    cwd: repositoryPath,
    focus: true,
    label: "SDK development",
  });
  const testPane = yield* herdr.panes.split(created.rootPane.id, {
    direction: "right",
    ratio: 0.5,
    cwd: repositoryPath,
    focus: false,
    rightClick: "pane",
  });

  yield* Effect.all(
    [
      herdr.panes.sendText(created.rootPane.id, "pnpm dev\n"),
      herdr.panes.sendText(testPane.id, "pnpm test -- --run\n"),
    ],
    { concurrency: "unbounded" },
  );

  yield* Effect.logInfo(
    `Development workspace ${created.workspace.id} is running the build watcher and test suite`,
  );
});

await runHerdrExample(developmentWorkspace);
