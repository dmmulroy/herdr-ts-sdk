# Herdr SDK v1 parity ledger

This ledger maps the Effect-native v1 surface to implementation and public-seam tests.
Generated snake-case contracts remain private transport details. Use the named executable tests
as evidence; this document is not a record of the latest verification run.

Protocol rows establish public dispatch and a representative success path. Variant-sensitive
behavior such as overloaded plugin results, recursive inputs, stream framing, teardown, and typed
failure classification is tracked separately in the cross-cutting table.

`covered` means a named test exercises the stated dispatch or behavior, not that every variant,
fault schedule, operating system, or resource lifetime is proven. Lifecycle confidence comes from
focused failure/cleanup tests and repeated synchronized scenarios, separately from dispatch breadth.

## Protocol operations

| Wire method                     | Public operation                                | Owning Effect service | Implementation                | Public-seam test                | Status  |
| ------------------------------- | ----------------------------------------------- | --------------------- | ----------------------------- | ------------------------------- | ------- |
| `ping`                          | `server.ping`                                   | `ServerService`       | `src/server-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `server.stop`                   | `server.stop`                                   | `ServerService`       | `src/server-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `server.live_handoff`           | `server.liveHandoff`                            | `ServerService`       | `src/server-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `server.reload_config`          | `server.reloadConfig`                           | `ServerService`       | `src/server-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `server.agent_manifests`        | `server.getAgentManifests`                      | `ServerService`       | `src/server-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `server.reload_agent_manifests` | `server.reloadAgentManifests`                   | `ServerService`       | `src/server-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `session.snapshot`              | `session.snapshot`                              | `SessionService`      | `src/session-service.ts`      | `src/herdr-full-parity.test.ts` | covered |
| `notification.show`             | `notifications.show`                            | `NotificationService` | `src/notification-service.ts` | `src/herdr-full-parity.test.ts` | covered |
| `client.window_title.set`       | `client.windowTitle.set`                        | `ClientService`       | `src/client-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `client.window_title.clear`     | `client.windowTitle.clear`                      | `ClientService`       | `src/client-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `workspace.create`              | `workspaces.create`                             | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.list`                | `workspaces.list`                               | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.get`                 | `workspaces.get`                                | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.focus`               | `workspaces.focus`                              | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.rename`              | `workspaces.rename`                             | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.move`                | `workspaces.move`                               | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.move_block`          | `workspaces.moveBlock`                          | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.report_metadata`     | `workspaces.reportMetadata`                     | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `workspace.close`               | `workspaces.close`, `.closeGroup`               | `WorkspaceService`    | `src/workspace-service.ts`    | `src/herdr-full-parity.test.ts` | covered |
| `worktree.list`                 | `worktrees.list`                                | `WorktreeService`     | `src/worktree-service.ts`     | `src/herdr-full-parity.test.ts` | covered |
| `worktree.create`               | `worktrees.create`                              | `WorktreeService`     | `src/worktree-service.ts`     | `src/herdr-full-parity.test.ts` | covered |
| `worktree.open`                 | `worktrees.open`                                | `WorktreeService`     | `src/worktree-service.ts`     | `src/herdr-full-parity.test.ts` | covered |
| `worktree.remove`               | `worktrees.remove`                              | `WorktreeService`     | `src/worktree-service.ts`     | `src/herdr-full-parity.test.ts` | covered |
| `tab.create`                    | `tabs.create`                                   | `TabService`          | `src/tab-service.ts`          | `src/herdr-full-parity.test.ts` | covered |
| `tab.list`                      | `tabs.list`                                     | `TabService`          | `src/tab-service.ts`          | `src/herdr-full-parity.test.ts` | covered |
| `tab.get`                       | `tabs.get`                                      | `TabService`          | `src/tab-service.ts`          | `src/herdr-full-parity.test.ts` | covered |
| `tab.focus`                     | `tabs.focus`                                    | `TabService`          | `src/tab-service.ts`          | `src/herdr-full-parity.test.ts` | covered |
| `tab.rename`                    | `tabs.rename`                                   | `TabService`          | `src/tab-service.ts`          | `src/herdr-full-parity.test.ts` | covered |
| `tab.move`                      | `tabs.move`                                     | `TabService`          | `src/tab-service.ts`          | `src/herdr-full-parity.test.ts` | covered |
| `tab.close`                     | `tabs.close`                                    | `TabService`          | `src/tab-service.ts`          | `src/herdr-full-parity.test.ts` | covered |
| `pane.split`                    | `panes.split`                                   | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.swap`                     | `panes.swap`                                    | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.move`                     | `panes.move`                                    | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.zoom`                     | `panes.zoom`                                    | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.layout`                   | `panes.layout`                                  | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.process_info`             | `panes.processInfo`                             | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.neighbor`                 | `panes.neighbor`                                | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.edges`                    | `panes.edges`                                   | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.focus_direction`          | `panes.focusDirection`                          | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.resize`                   | `panes.resize`                                  | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.list`                     | `panes.list`                                    | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.current`                  | `panes.current`                                 | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.get`                      | `panes.get`                                     | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.focus`                    | `panes.focus`                                   | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.input.set`                | `panes.setInputRouting`                         | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.rename`                   | `panes.rename`                                  | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.send_text`                | `panes.sendText`                                | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.send_keys`                | `panes.sendKeys`                                | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.send_input`               | `panes.sendInput`                               | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.read`                     | `panes.read`                                    | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.wait_for_output`          | `panes.waitForOutput`                           | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.report_agent`             | `panes.reportAgent`                             | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.report_agent_session`     | `panes.reportAgentSession`                      | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.report_metadata`          | `panes.reportMetadata`                          | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.clear_agent_authority`    | `panes.clearAgentAuthority`                     | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.release_agent`            | `panes.releaseAgent`                            | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.close`                    | `panes.close`                                   | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.graphics.info`            | `panes.graphics.info`                           | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.graphics.set`             | `panes.graphics.set`                            | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.graphics.clear`           | `panes.graphics.clear`, `.clearLayer`           | `PaneService`         | `src/pane-service.ts`         | `src/herdr-full-parity.test.ts` | covered |
| `pane.graphics.stream`          | `panes.graphics.openStream`, `.openLayerStream` | `PaneService`         | `src/pane-service.ts`         | `src/pane-graphics.test.ts`     | covered |
| `layout.export`                 | `layouts.export`                                | `LayoutService`       | `src/layout-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `layout.apply`                  | `layouts.apply`                                 | `LayoutService`       | `src/layout-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `layout.set_split_ratio`        | `layouts.setSplitRatio`                         | `LayoutService`       | `src/layout-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `agent.list`                    | `agents.list`                                   | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.get`                     | `agents.get`                                    | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.read`                    | `agents.read`                                   | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.explain`                 | `agents.explain`                                | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.send_keys`               | `agents.sendKeys`                               | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.rename`                  | `agents.rename`                                 | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.focus`                   | `agents.focus`                                  | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.start`                   | `agents.start`                                  | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.prompt`                  | `agents.prompt`                                 | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.wait`                    | `agents.wait`                                   | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.view.set`                | `agents.view.set`                               | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `agent.view.clear`              | `agents.view.clear`                             | `AgentService`        | `src/agent-service.ts`        | `src/herdr-full-parity.test.ts` | covered |
| `events.subscribe`              | `events.subscribe`                              | `EventService`        | `src/event-service.ts`        | `src/event-service.test.ts`     | covered |
| `events.wait`                   | `events.wait`                                   | `EventService`        | `src/event-service.ts`        | `src/event-service.test.ts`     | covered |
| `integration.install`           | `integrations.install`                          | `IntegrationService`  | `src/integration-service.ts`  | `src/herdr-full-parity.test.ts` | covered |
| `integration.uninstall`         | `integrations.uninstall`                        | `IntegrationService`  | `src/integration-service.ts`  | `src/herdr-full-parity.test.ts` | covered |
| `plugin.link`                   | `plugins.link`                                  | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.list`                   | `plugins.list`                                  | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.unlink`                 | `plugins.unlink`                                | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.enable`                 | `plugins.enable`                                | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.disable`                | `plugins.disable`                               | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.action.list`            | `plugins.actions.list`                          | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.action.invoke`          | `plugins.actions.invoke`                        | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.log.list`               | `plugins.logs.list`                             | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.pane.open`              | `plugins.panes.open`                            | `PluginService`       | `src/plugin-service.ts`       | `src/plugin-service.test.ts`    | covered |
| `plugin.pane.focus`             | `plugins.panes.focus`                           | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `plugin.pane.close`             | `plugins.panes.close`                           | `PluginService`       | `src/plugin-service.ts`       | `src/herdr-full-parity.test.ts` | covered |
| `popup.close`                   | `popups.close`                                  | `PopupService`        | `src/popup-service.ts`        | `src/herdr-full-parity.test.ts` | covered |

## Cross-cutting parity

| Behavior                                                                                            | Rewrite owner               | Public-seam coverage                                              | Status  |
| --------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- | ------- |
| Explicit options → `HERDR_SOCKET_PATH` → `HERDR_SESSION` → platform default precedence              | `src/herdr-config.ts`       | `src/herdr-config.test.ts`                                        | covered |
| Invalid selected configuration fails without fallback                                               | `src/herdr-config.ts`       | `src/herdr-config.test.ts`                                        | covered |
| Application-owned absolute-path, session-name, and popup-percentage filters                         | `src/herdr-domain.ts`       | `src/herdr-domain.test.ts`                                        | covered |
| Public input failures are classified before transport, including recursive layouts and split ratios | Service boundary parsers    | `src/herdr-input-boundaries.test.ts`                              | covered |
| Request ID generation and response correlation                                                      | `src/herdr-transport.ts`    | `src/herdr-transport.test.ts`                                     | covered |
| Method-indexed request encoding, recursive inputs, and opaque record key preservation               | `src/herdr-wire-encoder.ts` | `src/herdr-wire-encoder.test.ts`, `src/herdr-wire-encoder.tst.ts` | covered |
| NDJSON framing, malformed JSON, and one-MiB line limit                                              | `src/herdr-transport.ts`    | `src/herdr-transport.test.ts`                                     | covered |
| Server error translation with open server codes                                                     | `src/herdr-transport.ts`    | `src/herdr-transport.test.ts`                                     | covered |
| Local request deadlines                                                                             | `src/herdr-transport.ts`    | `src/herdr-transport.test.ts`                                     | covered |
| Protocol-21 check and one shared memoized compatibility result                                      | `src/herdr-transport.ts`    | `src/herdr-transport.test.ts`                                     | covered |
| One-shot socket cleanup on success, failure, timeout, and interruption                              | `src/herdr-transport.ts`    | `src/herdr-transport.test.ts`                                     | covered |
| Event type normalization, subscription filtering, and generic narrowing                             | `src/event-service.ts`      | `src/event-service.test.ts`                                       | covered |
| Live-only subscription acceptance and snapshot-plus-buffer bootstrap                                | `src/event-service.ts`      | `src/event-service.test.ts`                                       | covered |
| Coalesced stream-handshake/event bytes and unsupported subscription events                          | `src/event-service.ts`      | `src/event-service.test.ts`                                       | covered |
| Cold event streams close sockets on completion, failure, and interruption                           | `src/herdr-transport.ts`    | `src/event-service.test.ts`                                       | covered |
| Graphics frame parsing, 512-KiB one-shot limit, and 16-MiB stream limit                             | `src/pane-service.ts`       | `src/pane-graphics.test.ts`                                       | covered |
| Graphics writer acquisition, writes, and scoped finalization                                        | `src/herdr-transport.ts`    | `src/pane-graphics.test.ts`                                       | covered |
| Layered BGRA graphics, capability metadata, direct-file frames, acknowledgements, and async errors  | `src/pane-service.ts`       | `src/pane-graphics.test.ts`                                       | covered |
| Graphics write deadline interrupts and destroys a backpressured stream socket                       | `src/herdr-transport.ts`    | `src/pane-graphics.test.ts`                                       | covered |
| Plugin pane placement/result overload correlation                                                   | `src/plugin-service.ts`     | `src/plugin-service.test.ts`                                      | covered |
| Independent namespace Layer requirements                                                            | Service modules             | `src/herdr-layers.tst.ts`                                         | covered |
| One shared configuration and transport in the root production graph                                 | `src/herdr-sdk.ts`          | `src/herdr-sdk.test.ts`                                           | covered |
| Stripe-style root caller inference                                                                  | `src/herdr-sdk.ts`          | `src/herdr-sdk.tst.ts`                                            | covered |
| Event and operation-specific error inference                                                        | Public service interfaces   | `src/herdr-sdk.tst.ts`                                            | covered |
| Effect-native public package entrypoint                                                             | `src/index.ts`              | `src/herdr-sdk.test.ts`                                           | covered |
| Effect-native README examples                                                                       | `README.md`                 | package build/typecheck                                           | covered |
| Root tooling excludes read-only `repos/effect/`                                                     | project configuration       | formatting, lint, typecheck, tests, package build                 | covered |
