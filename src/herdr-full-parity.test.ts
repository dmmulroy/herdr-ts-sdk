import { Effect, Stream } from "effect";
import { wireResultTypesByMethod } from "./generated/wire-method-map.ts";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import { HerdrRawTestResponse, startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

test("every public namespace operation crosses the real Unix-socket seam", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request, socket) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            if (request.method === "pane.graphics.stream") {
              socket.removeAllListeners("data");
            }
            if (request.method === "events.subscribe") {
              const eventResponse = makeHerdrSuccessResponse({
                id: request.id,
                method: "events.wait",
                params: {
                  match_event: { event: "workspace_created", workspace_id: null },
                  timeout_ms: null,
                },
              });
              if (eventResponse.result.type !== "wait_matched") {
                throw new Error("Fixture generator returned the wrong events.wait result");
              }
              return new HerdrRawTestResponse(
                `${JSON.stringify(response)}\n${JSON.stringify(eventResponse.result.event)}\n`,
              );
            }
            return response;
          }),
        );

        yield* Effect.gen(function* () {
          const herdr = yield* HerdrSdk;
          const workspaceId = herdr.ids.workspace("workspace-1");
          const tabId = herdr.ids.tab("tab-1");
          const paneId = herdr.ids.pane("pane-1");
          const pluginId = herdr.ids.plugin("plugin-1");
          const actionId = herdr.ids.pluginAction("plugin-1.action-1");
          const agentName = herdr.ids.agentName("agent-1");
          const fixturePath = herdr.ids.absolutePath("/tmp/herdr-sdk-fixture");

          yield* herdr.server.stop();
          yield* herdr.server.liveHandoff({ importExe: fixturePath });
          yield* herdr.server.reloadConfig();
          yield* herdr.server.getAgentManifests();
          yield* herdr.server.reloadAgentManifests();
          yield* herdr.server.ping();
          yield* herdr.session.snapshot();
          yield* herdr.notifications.show({ title: "fixture" });
          yield* herdr.client.windowTitle.set("fixture");
          yield* herdr.client.windowTitle.clear();

          yield* herdr.workspaces.create({ cwd: fixturePath });
          yield* herdr.workspaces.list();
          yield* herdr.workspaces.get(workspaceId);
          yield* herdr.workspaces.focus(workspaceId);
          yield* herdr.workspaces.rename(workspaceId, "fixture");
          yield* herdr.workspaces.move(workspaceId, { insertIndex: 0 });
          yield* herdr.workspaces.moveBlock([workspaceId]);
          yield* herdr.workspaces.reportMetadata(workspaceId, {
            source: "fixture",
            tokens: { state: "ready" },
          });
          yield* herdr.workspaces.close(workspaceId);
          yield* herdr.workspaces.closeGroup(workspaceId);

          yield* herdr.worktrees.list({ cwd: fixturePath, trustRepository: true });
          yield* herdr.worktrees.create({
            cwd: fixturePath,
            branch: "fixture",
            trustRepository: true,
          });
          yield* herdr.worktrees.open({
            cwd: fixturePath,
            branch: "fixture",
            trustRepository: true,
          });
          yield* herdr.worktrees.remove(workspaceId, { trustRepository: true });

          yield* herdr.tabs.create({ workspaceId });
          yield* herdr.tabs.list({ workspaceId });
          yield* herdr.tabs.get(tabId);
          yield* herdr.tabs.focus(tabId);
          yield* herdr.tabs.rename(tabId, "fixture");
          yield* herdr.tabs.move(tabId, { insertIndex: 0 });
          yield* herdr.tabs.close(tabId);

          yield* herdr.panes.split(paneId, { direction: "right", rightClick: "pane" });
          yield* herdr.panes.swap({ paneId, direction: "right" });
          yield* herdr.panes.move(paneId, {
            destination: { type: "new_tab", workspaceId },
          });
          yield* herdr.panes.zoom(paneId, { mode: "toggle" });
          yield* herdr.panes.layout(paneId);
          yield* herdr.panes.processInfo(paneId);
          yield* herdr.panes.neighbor(paneId, "right");
          yield* herdr.panes.edges(paneId);
          yield* herdr.panes.focusDirection("right", { paneId });
          yield* herdr.panes.resize("right", { paneId, amount: 1 });
          yield* herdr.panes.list({ workspaceId });
          yield* herdr.panes.current({ callerPaneId: paneId });
          yield* herdr.panes.get(paneId);
          yield* herdr.panes.focus(paneId);
          yield* herdr.panes.rename(paneId, "fixture");
          yield* herdr.panes.setInputRouting(paneId, { rightClick: "herdr" });
          yield* herdr.panes.sendText(paneId, "fixture");
          yield* herdr.panes.sendKeys(paneId, ["Enter"]);
          yield* herdr.panes.sendInput(paneId, { text: "fixture", keys: ["Enter"] });
          yield* herdr.panes.read(paneId, { source: "visible" });
          yield* herdr.panes.waitForOutput(paneId, {
            source: "visible",
            match: { type: "substring", value: "fixture" },
          });
          yield* herdr.panes.reportAgent(paneId, {
            source: "fixture",
            agent: "codex",
            state: "working",
          });
          yield* herdr.panes.reportAgentSession(paneId, {
            source: "fixture",
            agent: "codex",
            sessionId: "session-1",
          });
          yield* herdr.panes.reportMetadata(paneId, {
            source: "fixture",
            tokens: { state: "ready" },
          });
          yield* herdr.panes.clearAgentAuthority(paneId);
          yield* herdr.panes.releaseAgent(paneId, {
            source: "fixture",
            agent: "codex",
          });
          yield* herdr.panes.close(paneId);
          yield* herdr.panes.graphics.info(paneId);
          yield* herdr.panes.graphics.set(paneId, {
            format: "png",
            imageWidth: 1,
            imageHeight: 1,
            data: Uint8Array.of(1),
            layerId: "overlay",
            zIndex: 2,
          });
          yield* herdr.panes.graphics.clear(paneId);
          yield* herdr.panes.graphics.clearLayer(paneId, { layerId: "overlay" });
          yield* Effect.scoped(
            Effect.gen(function* () {
              const writer = yield* herdr.panes.graphics.openLayerStream(paneId, {
                layerId: "overlay",
                zIndex: 2,
              });
              yield* writer.write({
                format: "png",
                imageWidth: 1,
                imageHeight: 1,
                data: Uint8Array.of(1),
              });
            }),
          );

          yield* herdr.layouts.export({ tabId });
          yield* herdr.layouts.apply({
            workspaceId,
            root: { type: "pane", paneId },
          });
          yield* herdr.layouts.setSplitRatio({ tabId }, { path: [], ratio: 0.5 });

          const target = { name: agentName };
          yield* herdr.agents.list();
          yield* herdr.agents.get(target);
          yield* herdr.agents.read(target, { source: "visible" });
          yield* herdr.agents.explain(target);
          yield* herdr.agents.sendKeys(target, ["Enter"]);
          yield* herdr.agents.rename(target, agentName);
          yield* herdr.agents.focus(target);
          yield* herdr.agents.start({ name: agentName, kind: "codex", paneId });
          yield* herdr.agents.prompt(target, { text: "fixture" });
          yield* herdr.agents.wait(target);
          yield* herdr.agents.view.set({ source: "fixture" });
          yield* herdr.agents.view.clear();

          yield* Stream.runHead(herdr.events.subscribe([{ type: "workspace.created" }] as const));
          yield* herdr.events.wait({ type: "workspace.created" });
          yield* herdr.integrations.install("codex");
          yield* herdr.integrations.uninstall("codex");
          yield* herdr.integrations.install("qwen");
          yield* herdr.integrations.install("antigravity_cli");

          yield* herdr.plugins.link({ path: fixturePath });
          yield* herdr.plugins.list({ pluginId });
          yield* herdr.plugins.unlink(pluginId);
          yield* herdr.plugins.enable(pluginId);
          yield* herdr.plugins.disable(pluginId);
          yield* herdr.plugins.actions.list({ pluginId });
          yield* herdr.plugins.actions.invoke(actionId, {
            pluginId,
            context: { workspaceId, focusedPaneId: paneId },
          });
          yield* herdr.plugins.logs.list({ pluginId, limit: 1 });
          yield* herdr.plugins.panes.open(pluginId, {
            entrypoint: "fixture",
            placement: "popup",
          });
          yield* herdr.plugins.panes.focus(paneId);
          yield* herdr.plugins.panes.close(paneId);
          yield* herdr.popups.close();
        }).pipe(
          Effect.provide(
            herdrSdkLayerFromOptions({
              socketPath: HerdrAbsolutePath.make(server.socketPath),
            }),
          ),
        );

        const observedMethods = new Set(server.requests.map((request) => request.method));
        expect([...observedMethods].sort()).toEqual(Object.keys(wireResultTypesByMethod).sort());
        const notification = server.requests.find(
          (request) => request.method === "notification.show",
        );
        if (notification?.method !== "notification.show") {
          throw new Error("Notification request was not recorded");
        }
        expect("sound" in notification.params).toBe(false);
        expect(server.requests.find((request) => request.method === "layout.apply")).toMatchObject({
          params: { root: { pane_id: "pane-1", type: "pane" } },
        });
        expect(
          server.requests.find((request) => request.method === "plugin.action.invoke"),
        ).toMatchObject({
          params: {
            context: { focused_pane_id: "pane-1", workspace_id: "workspace-1" },
          },
        });
        expect(
          server.requests.find(
            (request) =>
              request.method === "workspace.close" && request.params.close_group === true,
          ),
        ).toBeDefined();
        expect(
          server.requests.find((request) => request.method === "pane.input.set"),
        ).toMatchObject({
          params: { pane_id: "pane-1", right_click: "herdr" },
        });
        expect(
          server.requests.find(
            (request) =>
              request.method === "pane.graphics.stream" && request.params.layer_id === "overlay",
          ),
        ).toMatchObject({ params: { z_index: 2 } });
        yield* server.waitFor("close", server.requests.length);
        expect(server.openSocketMethods()).toEqual([]);
      }),
    ),
  ));
