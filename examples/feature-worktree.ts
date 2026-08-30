import { Effect } from "effect";
import { HerdrSdk } from "@herdr/sdk";
import { runHerdrExample } from "./example-runtime.ts";

const featureWorktree = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const repositoryPath = herdr.ids.absolutePath(process.cwd());
  const branchName = process.argv[2] ?? "feature/herdr-sdk-example";
  const created = yield* herdr.worktrees.create({
    cwd: repositoryPath,
    branch: branchName,
    base: "main",
    label: `Feature: ${branchName}`,
    focus: true,
    trustRepository: true,
  });

  yield* herdr.panes.sendText(created.rootPane.id, "git status --short\n");
  yield* Effect.logInfo(
    `Created branch ${branchName} in worktree ${created.worktree.path} and opened workspace ${created.workspace.id}`,
  );
});

await runHerdrExample(featureWorktree);
