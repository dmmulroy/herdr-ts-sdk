import { Duration, Effect, Option, Schema } from "effect";
import type { PaneInfo, TabInfo, WorkspaceInfo } from "./generated/wire-success-response.ts";
import { expect, test } from "vite-plus/test";
import { HerdrConfig, type IHerdrConfig } from "./herdr-config.ts";
import { HerdrAbsolutePath, WorkspaceId } from "./herdr-domain.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { herdrTransportLayerWithoutDependencies } from "./herdr-transport.ts";
import { WorkspaceService, workspaceServiceLayerWithoutDependencies } from "./workspace-service.ts";

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

const tab: TabInfo = {
  agent_status: "idle",
  focused: true,
  label: "Tab 1",
  number: 1,
  pane_count: 1,
  tab_id: "tab-1",
  workspace_id: "workspace-1",
};

const pane: PaneInfo = {
  agent_status: "idle",
  focused: true,
  pane_id: "pane-1",
  revision: 0,
  tab_id: "tab-1",
  terminal_id: "terminal-1",
  workspace_id: "workspace-1",
};

test("workspace service implements every workspace wire operation", async () => {
  const server = await startHerdrTestServer((request) => {
    switch (request.method) {
      case "ping":
        return {
          id: request.id,
          result: { type: "pong", version: "0.8.2", protocol: 21 },
        };
      case "workspace.create":
        return {
          id: request.id,
          result: {
            type: "workspace_created",
            workspace,
            tab,
            root_pane: pane,
          },
        };
      case "workspace.list":
      case "workspace.move":
      case "workspace.move_block":
        return {
          id: request.id,
          result: { type: "workspace_list", workspaces: [workspace] },
        };
      case "workspace.get":
      case "workspace.focus":
      case "workspace.rename":
        return {
          id: request.id,
          result: { type: "workspace_info", workspace },
        };
      case "workspace.report_metadata":
      case "workspace.close":
        return { id: request.id, result: { type: "ok" } };
      default:
        return {
          id: request.id,
          error: { code: "unexpected_method", message: request.method },
        };
    }
  });

  try {
    const results = await runWithWorkspaceService(
      server.socketPath,
      Effect.gen(function* () {
        const workspaces = yield* WorkspaceService;
        const id = WorkspaceId.make("workspace-1");
        const created = yield* workspaces.create({ label: "Created" });
        const listed = yield* workspaces.list();
        const found = yield* workspaces.get(id);
        yield* workspaces.focus(id);
        yield* workspaces.rename(id, "Renamed");
        yield* workspaces.move(id, { insertIndex: 0 });
        yield* workspaces.moveBlock([id], { beforeWorkspaceId: id });
        yield* workspaces.reportMetadata(id, {
          source: "test",
          tokens: { state: "ready", obsolete: null },
          sequence: 2,
          ttlMs: 1_000,
        });
        yield* workspaces.close(id);
        return { created, listed, found };
      }),
    );

    expect(results.created.workspace.id).toBe("workspace-1");
    expect(Option.isNone(results.created.workspace.worktree)).toBe(true);
    expect(results.created.rootPane.id).toBe("pane-1");
    expect(results.listed).toHaveLength(1);
    expect(results.found.id).toBe("workspace-1");
    expect(server.requests.map((request) => request.method)).toEqual([
      "ping",
      "workspace.create",
      "workspace.list",
      "workspace.get",
      "workspace.focus",
      "workspace.rename",
      "workspace.move",
      "workspace.move_block",
      "workspace.report_metadata",
      "workspace.close",
    ]);
    expect(server.requests[8]).toMatchObject({
      params: {
        seq: 2,
        source: "test",
        ttl_ms: 1_000,
        workspace_id: "workspace-1",
      },
    });
  } finally {
    await server.close();
  }
});

function runWithWorkspaceService<A, E>(
  socketPath: string,
  effect: Effect.Effect<A, E, WorkspaceService>,
): Promise<A> {
  const config: IHerdrConfig = {
    socketPath: Schema.decodeUnknownSync(HerdrAbsolutePath)(socketPath),
    session: Option.none(),
    requestTimeout: Duration.seconds(1),
    application: Option.none(),
    supportedProtocols: [18, 19, 20, 21],
  };
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(workspaceServiceLayerWithoutDependencies),
      Effect.provide(herdrTransportLayerWithoutDependencies),
      Effect.provideService(HerdrConfig, HerdrConfig.of(config)),
    ),
  );
}
