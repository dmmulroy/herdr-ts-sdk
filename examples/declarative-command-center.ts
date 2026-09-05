import { Effect } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const declarativeCommandCenter = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const repositoryPath = herdr.ids.absolutePath(process.cwd());
  const created = yield* herdr.workspaces.create({
    cwd: repositoryPath,
    focus: true,
    label: "Project command center",
  });

  const layout = yield* herdr.layouts.apply({
    workspaceId: created.workspace.id,
    replaceTabId: created.tab.id,
    tabLabel: "Build · Test · Git",
    focus: true,
    root: {
      type: "split",
      direction: "right",
      ratio: 0.62,
      first: {
        type: "pane",
        label: "Build watcher",
        cwd: repositoryPath,
        command: ["pnpm", "dev"],
      },
      second: {
        type: "split",
        direction: "down",
        ratio: 0.55,
        first: {
          type: "pane",
          label: "Test suite",
          cwd: repositoryPath,
          command: ["pnpm", "test", "--", "--run"],
        },
        second: {
          type: "pane",
          label: "Repository status",
          cwd: repositoryPath,
          command: ["git", "status", "--short", "--branch"],
        },
      },
    },
  });

  yield* Effect.logInfo(`Applied a reproducible three-pane command center in tab ${layout.tabId}`);
});

runHerdrExample(declarativeCommandCenter);
