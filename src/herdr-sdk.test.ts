import { Effect, Option } from "effect";
import type { WorkspaceInfo } from "./generated/wire-success-response.ts";
import { HerdrAbsolutePath, HerdrSdk, herdrSdkLayerFromOptions } from "./index.ts";
import { expect, test } from "vite-plus/test";
import { startHerdrTestServer } from "./herdr-test-server.ts";

const workspace: WorkspaceInfo = {
  active_tab_id: "tab-1",
  agent_status: "idle",
  focused: true,
  label: "Workspace 1",
  number: 1,
  pane_count: 1,
  tab_count: 1,
  workspace_id: "workspace-1",
};

test("root SDK exposes Stripe-style namespaces sharing one compatibility check", async () => {
  const server = await startHerdrTestServer((request) => {
    switch (request.method) {
      case "ping":
        return {
          id: request.id,
          result: { type: "pong", version: "0.8.2", protocol: 21 },
        };
      case "workspace.list":
        return {
          id: request.id,
          result: { type: "workspace_list", workspaces: [workspace] },
        };
      case "popup.close":
        return { id: request.id, result: { type: "ok" } };
      default:
        return {
          id: request.id,
          error: { code: "unexpected_method", message: request.method },
        };
    }
  });

  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const workspaces = yield* herdr.workspaces.list();
        yield* herdr.popups.close();
        return {
          workspaces,
          socketPath: herdr.config.socketPath,
          noSession: Option.isNone(herdr.config.session),
          sameWorkspaceService: herdr.workspaces === (yield* HerdrSdk).workspaces,
        };
      }).pipe(
        Effect.provide(
          herdrSdkLayerFromOptions({
            socketPath: HerdrAbsolutePath.make(server.socketPath),
          }),
        ),
      ),
    );

    expect(result.workspaces[0]?.id).toBe("workspace-1");
    expect(result.socketPath).toBe(server.socketPath);
    expect(result.noSession).toBe(true);
    expect(result.sameWorkspaceService).toBe(true);
    expect(server.requests.filter((request) => request.method === "ping")).toHaveLength(1);
  } finally {
    await server.close();
  }
});
