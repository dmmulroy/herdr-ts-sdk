# `@rudironsoni/sdk`

Effect-native TypeScript access to Herdr's local Unix-socket API.

The SDK exposes every Herdr operation as a typed `Effect`, decodes public inputs and wire responses
with Effect Schema, represents live events as `Stream`, and owns graphics-stream cleanup with
`Scope`. The root `HerdrSdk` service keeps the convenient namespace-oriented API while preserving
precise errors, dependencies, and interruption.

```ts
import { Effect } from "effect";
import { HerdrSdk, herdrSdkLayer } from "@rudironsoni/sdk";

const program = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const session = yield* herdr.session.snapshot();

  return {
    workspaces: session.workspaces.length,
    agents: session.agents.length,
  };
});

const summary = await Effect.runPromise(program.pipe(Effect.provide(herdrSdkLayer)));
```

## Status and compatibility

- SDK version: `0.8.2`
- Herdr wire protocol: `17`, `18`, `19`, `20`, and `21`
- Effect: `4.0.0-beta.105`
- Runtime: Node.js 20 or newer on a platform supported by Herdr's local socket server

The SDK verifies protocol compatibility before ordinary requests and shares that compatibility
result across the Layer graph. A server outside protocols 17, 18, 19, 20, and 21 fails with
`HerdrUnsupportedProtocol`.

`@rudironsoni/sdk` is published to GitHub Packages. Point your package manager at the GitHub npm
registry for the `@rudironsoni` scope, then install the package. GitHub Packages requires a
personal access token with the `read:packages` scope for installs, even for public repositories:

```ini
# ~/.npmrc or project .npmrc
@rudironsoni:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
pnpm install @rudironsoni/sdk
```

Alternatively, build and pack this repository directly:

```sh
git clone https://github.com/rudironsoni/herdr-ts-sdk.git
cd herdr-ts-sdk
pnpm install
pnpm run build
pnpm pack
```

Then install the generated tarball in the consuming project and import from `@rudironsoni/sdk`.

## API shape

`HerdrSdk` is a yieldable `Context.Service`. It aggregates independently implemented namespace
services; it does not proxy or duplicate their operations.

```ts
const program = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;

  const created = yield* herdr.workspaces.create({
    cwd: herdr.ids.absolutePath(process.cwd()),
    label: "SDK demo",
    focus: true,
  });

  yield* herdr.panes.sendText(created.rootPane.id, "pnpm test -- --run\n");
});
```

An operation has the ordinary Effect shape `Effect.Effect<Success, Error, Requirements>`:

- `Success` is a schema-decoded domain value.
- `Error` is the narrow union of expected failures for that operation.
- `Requirements` identifies services the caller must provide.
- Fiber interruption owns cancellation; the API does not expose `AbortSignal`.

All service methods accept `HerdrTransportRequestOptionsEncoded` as their final optional argument:

```ts
yield * herdr.server.ping({ requestTimeout: "2 seconds" });
```

`requestTimeout` is the local SDK deadline. Server-owned waits have a separate `timeoutMs` in their
input. When both apply, make the request deadline longer than the server wait so the server can
return its typed result first.

## Configuration

The production Layer resolves one immutable `HerdrConfig` and shares it with one
`HerdrTransport`. Socket selection uses this precedence:

1. Explicit `socketPath`
2. Explicit `session`
3. `HERDR_SOCKET_PATH`
4. `HERDR_SESSION`
5. The platform default Herdr socket

Selected invalid input fails with `HerdrConfigurationError`; it never silently falls through to a
lower-precedence source. `socketPath` and `session` are mutually exclusive.

| Option or environment value                | Meaning                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `socketPath` / `HERDR_SOCKET_PATH`         | Exact absolute Unix-socket path.                                                  |
| `session` / `HERDR_SESSION`                | Session name resolved below the Herdr configuration directory.                    |
| `requestTimeout` / `HERDR_REQUEST_TIMEOUT` | Default finite, non-negative local request deadline; defaults to five seconds.    |
| `application`                              | Optional non-empty application name and version sent during compatibility checks. |
| `HERDR_CONFIG_DIR`                         | Explicit Herdr configuration directory used for session/default sockets.          |
| `XDG_CONFIG_HOME`                          | Unix configuration root used when `HERDR_CONFIG_DIR` is absent.                   |
| `APPDATA`                                  | Windows configuration root used when `HERDR_CONFIG_DIR` is absent.                |

Use explicit options when an application owns SDK configuration:

```ts
import { Effect, Duration } from "effect";
import { HerdrSdk, herdrSdkLayerFromOptions } from "@rudironsoni/sdk";

const sdkLayer = herdrSdkLayerFromOptions({
  session: "work",
  requestTimeout: Duration.seconds(10),
  application: { name: "release-console", version: "1.4.0" },
});

const protocol = await Effect.runPromise(
  Effect.gen(function* () {
    return (yield* HerdrSdk).config.supportedProtocols;
  }).pipe(Effect.provide(sdkLayer)),
);
```

Configuration exports:

| API                                   | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `HerdrRequestDeadline`                | Schema for finite, non-negative Effect durations.                 |
| `HerdrApplication`                    | Schema for compatibility-handshake caller identity.               |
| `HerdrProtocolVersion`                | Literal schema for protocols `17`, `18`, `19`, `20`, and `21`.    |
| `HerdrConfigOptions`                  | Schema for explicit SDK options.                                  |
| `HerdrConfig` / `IHerdrConfig`        | Yieldable service and resolved configuration shape.               |
| `herdrConfigRecipe`                   | Ambient Effect `Config` recipe.                                   |
| `makeHerdrConfig`                     | Resolves explicit and ambient configuration into a service value. |
| `herdrConfigLayer`                    | Production configuration Layer.                                   |
| `herdrConfigLayerWithoutDependencies` | Layer that retains the active `ConfigProvider` requirement.       |
| `herdrConfigLayerFromOptions`         | Layer with explicit options ahead of ambient configuration.       |
| `herdrConfigLayerFromValue`           | Layer for an already parsed configuration value.                  |

## Root and direct-service Layers

Most applications should provide `herdrSdkLayer`, which exposes only `HerdrSdk` after composing and
memoizing the production graph:

```ts
program.pipe(Effect.provide(herdrSdkLayer));
```

Advanced applications can depend on one service directly:

```ts
import { Effect } from "effect";
import { WorkspaceService, workspaceServiceLayer } from "@rudironsoni/sdk";

const labels = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService;
  return (yield* workspaces.list()).map((workspace) => workspace.label);
}).pipe(Effect.provide(workspaceServiceLayer));
```

Every namespace module follows the same public construction convention:

| Export shape                            | Meaning                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| `I<Name>Service`                        | Exact service interface, including nested capabilities.      |
| `<Name>Service`                         | Yieldable `Context.Service` key.                             |
| `make<Name>Service`                     | Service constructor retaining `HerdrTransport` requirements. |
| `<name>ServiceLayerWithoutDependencies` | Layer whose required infrastructure remains visible.         |
| `<name>ServiceLayer`                    | Production-ready Layer using ambient SDK configuration.      |

The root equivalents are `IHerdrSdk`, `HerdrSdk`, `makeHerdrSdk`,
`herdrSdkLayerWithoutDependencies`, `herdrSdkLayer`, and `herdrSdkLayerFromOptions`.

Nested capability contracts are exported as `IClientWindowTitle`, `IPaneGraphics`,
`PaneGraphicsWriter`, `IAgentView`, `IPluginActions`, `IPluginLogs`, and `IPluginPanes`. The pure
identifier-constructor contract is `IHerdrIds`.

### Service construction export index

This table spells out every direct-service symbol so callers and coding agents can find the exact
composition entrypoint without deriving its spelling from the convention above.

| Namespace     | Interface and service                         | Constructor               | Requirement-preserving Layer                  | Production Layer           |
| ------------- | --------------------------------------------- | ------------------------- | --------------------------------------------- | -------------------------- |
| server        | `IServerService`, `ServerService`             | `makeServerService`       | `serverServiceLayerWithoutDependencies`       | `serverServiceLayer`       |
| session       | `ISessionService`, `SessionService`           | `makeSessionService`      | `sessionServiceLayerWithoutDependencies`      | `sessionServiceLayer`      |
| notifications | `INotificationService`, `NotificationService` | `makeNotificationService` | `notificationServiceLayerWithoutDependencies` | `notificationServiceLayer` |
| client        | `IClientService`, `ClientService`             | `makeClientService`       | `clientServiceLayerWithoutDependencies`       | `clientServiceLayer`       |
| workspaces    | `IWorkspaceService`, `WorkspaceService`       | `makeWorkspaceService`    | `workspaceServiceLayerWithoutDependencies`    | `workspaceServiceLayer`    |
| worktrees     | `IWorktreeService`, `WorktreeService`         | `makeWorktreeService`     | `worktreeServiceLayerWithoutDependencies`     | `worktreeServiceLayer`     |
| tabs          | `ITabService`, `TabService`                   | `makeTabService`          | `tabServiceLayerWithoutDependencies`          | `tabServiceLayer`          |
| panes         | `IPaneService`, `PaneService`                 | `makePaneService`         | `paneServiceLayerWithoutDependencies`         | `paneServiceLayer`         |
| layouts       | `ILayoutService`, `LayoutService`             | `makeLayoutService`       | `layoutServiceLayerWithoutDependencies`       | `layoutServiceLayer`       |
| agents        | `IAgentService`, `AgentService`               | `makeAgentService`        | `agentServiceLayerWithoutDependencies`        | `agentServiceLayer`        |
| events        | `IEventService`, `EventService`               | `makeEventService`        | `eventServiceLayerWithoutDependencies`        | `eventServiceLayer`        |
| integrations  | `IIntegrationService`, `IntegrationService`   | `makeIntegrationService`  | `integrationServiceLayerWithoutDependencies`  | `integrationServiceLayer`  |
| plugins       | `IPluginService`, `PluginService`             | `makePluginService`       | `pluginServiceLayerWithoutDependencies`       | `pluginServiceLayer`       |
| popups        | `IPopupService`, `PopupService`               | `makePopupService`        | `popupServiceLayerWithoutDependencies`        | `popupServiceLayer`        |

## Complete namespace reference

Every operation below is available from `yield* HerdrSdk`. Resource identifiers are branded values
constructed through `herdr.ids` or returned by another SDK operation.

### `server`

| Operation                        | Result and behavior                                            |
| -------------------------------- | -------------------------------------------------------------- |
| `ping(options?)`                 | Returns `PingResult` and verifies protocol compatibility.      |
| `stop(options?)`                 | Requests a graceful server stop.                               |
| `liveHandoff(input?, options?)`  | Hands the running server to a compatible executable.           |
| `reloadConfig(options?)`         | Reloads server configuration and returns `ConfigReloadResult`. |
| `getAgentManifests(options?)`    | Returns current `AgentManifestStatus`.                         |
| `reloadAgentManifests(options?)` | Refreshes and returns all `AgentManifest` values.              |

### `session`

| Operation            | Result and behavior                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `snapshot(options?)` | Returns one consistent `SessionSnapshot` containing resources, focus, agents, and protocol state. |

### `notifications`

| Operation               | Result and behavior                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| `show(input, options?)` | Displays a foreground notification and returns `NotificationShowResult`. |

### `client.windowTitle`

| Operation              | Result and behavior                                 |
| ---------------------- | --------------------------------------------------- |
| `set(title, options?)` | Sets a persistent foreground-client title override. |
| `clear(options?)`      | Clears the title override.                          |

### `workspaces`

| Operation                             | Result and behavior                                           |
| ------------------------------------- | ------------------------------------------------------------- |
| `create(input?, options?)`            | Atomically returns a workspace, initial tab, and root pane.   |
| `list(options?)`                      | Lists workspaces in display order.                            |
| `get(id, options?)`                   | Reads one workspace.                                          |
| `focus(id, options?)`                 | Focuses and returns one workspace.                            |
| `rename(id, label, options?)`         | Replaces a workspace label.                                   |
| `move(id, input, options?)`           | Moves a workspace to an insertion index.                      |
| `moveBlock(ids, input?, options?)`    | Moves a contiguous workspace block before an optional anchor. |
| `reportMetadata(id, input, options?)` | Replaces or removes source-owned metadata tokens.             |
| `close(id, options?)`                 | Closes one workspace.                                         |
| `closeGroup(id, options?)`            | Closes the contiguous group containing a workspace.           |

### `worktrees`

| Operation                               | Result and behavior                                               |
| --------------------------------------- | ----------------------------------------------------------------- |
| `list(input?, options?)`                | Resolves a trusted repository source and lists its Git worktrees. |
| `create(input, options?)`               | Creates a worktree plus its workspace, tab, and root pane.        |
| `open(input, options?)`                 | Opens an existing worktree by path or branch.                     |
| `remove(workspaceId, input?, options?)` | Removes the worktree associated with a workspace.                 |

Worktree operations require `trustRepository: true` before Herdr executes Git commands for a
caller-supplied directory.

### `tabs`

| Operation                     | Result and behavior                          |
| ----------------------------- | -------------------------------------------- |
| `create(input?, options?)`    | Creates a tab and root pane together.        |
| `list(input?, options?)`      | Lists tabs, optionally within one workspace. |
| `get(id, options?)`           | Reads one tab.                               |
| `focus(id, options?)`         | Focuses and returns one tab.                 |
| `rename(id, label, options?)` | Replaces a tab label.                        |
| `move(id, input, options?)`   | Moves a tab to an insertion index.           |
| `close(id, options?)`         | Closes one tab.                              |

### `panes`

| Operation                                     | Result and behavior                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `split(paneId, input, options?)`              | Splits a target or focused pane.                                      |
| `swap(input, options?)`                       | Swaps a pane by direction or explicit identifier.                     |
| `move(paneId, input, options?)`               | Moves a pane to a tab or new container.                               |
| `zoom(paneId?, input?, options?)`             | Toggles or sets pane zoom.                                            |
| `layout(paneId?, options?)`                   | Returns the containing `PaneLayoutSnapshot`.                          |
| `processInfo(paneId?, options?)`              | Returns foreground and process-tree information.                      |
| `neighbor(paneId, direction, options?)`       | Finds a directional neighbor.                                         |
| `edges(paneId?, options?)`                    | Reports which layout edges contain the pane.                          |
| `focusDirection(direction, input?, options?)` | Moves focus directionally.                                            |
| `resize(direction, input?, options?)`         | Resizes a pane by terminal cells.                                     |
| `list(input?, options?)`                      | Lists panes, optionally within a workspace.                           |
| `current(input?, options?)`                   | Resolves the caller or foreground pane.                               |
| `get(id, options?)`                           | Reads one pane.                                                       |
| `focus(id, options?)`                         | Focuses and returns one pane.                                         |
| `rename(id, label, options?)`                 | Replaces or clears a pane label.                                      |
| `setInputRouting(id, input, options?)`        | Chooses whether right-click belongs to Herdr or the pane application. |
| `sendText(id, text, options?)`                | Sends literal terminal text.                                          |
| `sendKeys(id, keys, options?)`                | Sends named keys.                                                     |
| `sendInput(id, input, options?)`              | Sends text and named keys as one input operation.                     |
| `read(id, input, options?)`                   | Reads visible, recent, or recent-unwrapped output.                    |
| `waitForOutput(id, input, options?)`          | Waits server-side for a substring or regular-expression match.        |
| `reportAgent(id, input, options?)`            | Reports source-owned agent state.                                     |
| `reportAgentSession(id, input, options?)`     | Attaches an upstream agent-session reference.                         |
| `reportMetadata(id, input, options?)`         | Replaces or removes source-owned pane metadata.                       |
| `clearAgentAuthority(id, input?, options?)`   | Clears agent-report authority, optionally by version.                 |
| `releaseAgent(id, input, options?)`           | Releases one source-owned agent report.                               |
| `close(id, options?)`                         | Closes one pane.                                                      |

### `panes.graphics`

| Operation                                   | Result and behavior                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `info(paneId, options?)`                    | Returns cell dimensions, visibility, formats, direct-file transport, layer limits, and mouse capability. |
| `set(paneId, frame, options?)`              | Replaces one graphics layer with an inline PNG, RGB, RGBA, or BGRA frame.                                |
| `clear(paneId, options?)`                   | Clears every graphics layer for the pane.                                                                |
| `clearLayer(paneId, input?, options?)`      | Clears one named layer or the primary layer.                                                             |
| `openStream(paneId, options?)`              | Acquires a scope-owned multi-frame `PaneGraphicsWriter`.                                                 |
| `openLayerStream(paneId, input?, options?)` | Acquires a writer for one stable layer and z-index.                                                      |

`PaneGraphicsWriter.write` sends inline frames. `writeFile` submits immutable direct-file RGBA or
BGRA frames and returns `PaneGraphicsFrameAcknowledgement`. Writers have no manual `close`; their
socket belongs to the acquisition scope.

```ts
const draw = Effect.scoped(
  Effect.gen(function* () {
    const herdr = yield* HerdrSdk;
    const pane = yield* herdr.panes.current();
    const writer = yield* herdr.panes.graphics.openLayerStream(pane.id, {
      layerId: "status",
      zIndex: 10,
    });

    yield* writer.write({
      format: "rgba",
      imageWidth: 1,
      imageHeight: 1,
      data: Uint8Array.of(34, 197, 94, 255),
    });
  }),
);
```

One-shot inline writes are limited to 512 KiB; streamed inline frames are limited to 16 MiB.

### `layouts`

| Operation                                | Result and behavior                                      |
| ---------------------------------------- | -------------------------------------------------------- |
| `export(target?, options?)`              | Exports one tab as a recursive `LayoutDescription`.      |
| `apply(input, options?)`                 | Creates or replaces a tab from a recursive `LayoutNode`. |
| `setSplitRatio(target, input, options?)` | Updates a split addressed by a boolean tree path.        |

### `agents`

| Operation                          | Result and behavior                                            |
| ---------------------------------- | -------------------------------------------------------------- |
| `list(options?)`                   | Lists every detected or SDK-launched agent.                    |
| `get(target, options?)`            | Reads an agent by pane or assigned name.                       |
| `read(target, input, options?)`    | Reads terminal output through an agent target.                 |
| `explain(target, options?)`        | Returns schema-less detection diagnostics as `HerdrJsonValue`. |
| `sendKeys(target, keys, options?)` | Sends named keys to an agent.                                  |
| `rename(target, name, options?)`   | Assigns or clears a stable agent name.                         |
| `focus(target, options?)`          | Focuses an agent pane.                                         |
| `start(input, options?)`           | Launches a named agent and returns its command line.           |
| `prompt(target, input, options?)`  | Sends a prompt with an optional server-owned wait policy.      |
| `wait(target, input?, options?)`   | Waits for requested lifecycle states.                          |

### `agents.view`

| Operation                 | Result and behavior                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `set(input, options?)`    | Activates or updates the persistent foreground agent view with recursive filters and ordered sort terms. |
| `clear(input?, options?)` | Clears the view, optionally only when owned by one source.                                               |

### `events`

| Operation                       | Result and behavior                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `subscribe(specs, options?)`    | Returns a cold, live-only typed `Stream`; acquisition acceptance defines the sequence start. |
| `wait(match, input?, options?)` | Waits for one matching event and preserves its match-specific result type.                   |

Literal subscription tuples narrow the emitted event union:

```ts
import { Effect, Stream } from "effect";
import { HerdrSdk } from "@rudironsoni/sdk";

const monitor = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const pane = yield* herdr.panes.current();

  yield* herdr.events
    .subscribe([
      { type: "workspace.created" },
      { type: "pane.agent_status_changed", paneId: pane.id },
    ] as const)
    .pipe(Stream.runForEach((event) => Effect.logInfo(event.type)));
});
```

Subscriptions are live-only rather than replay streams. Interrupting the consumer releases the
socket.

### `integrations`

| Operation                     | Result and behavior                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| `install(target, options?)`   | Installs a built-in `codex`, `qwen`, or `antigravity_cli` integration. |
| `uninstall(target, options?)` | Removes a built-in integration.                                        |

### `plugins`

| Operation                | Result and behavior                                   |
| ------------------------ | ----------------------------------------------------- |
| `link(input, options?)`  | Links a plugin manifest from an absolute path.        |
| `list(input?, options?)` | Lists installed plugins, optionally selecting one ID. |
| `unlink(id, options?)`   | Unlinks one plugin.                                   |
| `enable(id, options?)`   | Enables one plugin.                                   |
| `disable(id, options?)`  | Disables one plugin.                                  |

Nested plugin capabilities:

| Namespace and operation                         | Result and behavior                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `plugins.actions.list(input?, options?)`        | Lists actions, optionally for one plugin.                                                                                         |
| `plugins.actions.invoke(id, input?, options?)`  | Invokes a qualified or plugin-scoped action.                                                                                      |
| `plugins.logs.list(input?, options?)`           | Lists recent plugin command logs.                                                                                                 |
| `plugins.panes.open(pluginId, input, options?)` | Opens popup, overlay, split, tab, or zoomed plugin UI; popup placement returns `void`, persistent placements return `PluginPane`. |
| `plugins.panes.focus(paneId, options?)`         | Focuses a plugin-owned pane.                                                                                                      |
| `plugins.panes.close(paneId, options?)`         | Closes a plugin-owned pane.                                                                                                       |

### `popups`

| Operation         | Result and behavior                 |
| ----------------- | ----------------------------------- |
| `close(options?)` | Closes the active foreground popup. |

### `ids`

`ids` is the root namespace for the exported `herdrIds` value. It is pure schema-owned data, not an
Effect service, and provides synchronous constructors that reject invalid values:

| Constructor           | Result              |
| --------------------- | ------------------- |
| `workspace(value)`    | `WorkspaceId`       |
| `tab(value)`          | `TabId`             |
| `pane(value)`         | `PaneId`            |
| `terminal(value)`     | `TerminalId`        |
| `plugin(value)`       | `PluginId`          |
| `pluginAction(value)` | `PluginActionId`    |
| `pluginLog(value)`    | `PluginLogId`       |
| `agentName(value)`    | `AgentName`         |
| `absolutePath(value)` | `HerdrAbsolutePath` |

For untrusted input, prefer the Effect parsers: `parseWorkspaceId`, `parseTabId`, `parsePaneId`,
`parseTerminalId`, `parsePluginId`, `parsePluginActionId`, `parsePluginLogId`, `parseAgentName`,
`parseHerdrAbsolutePath`, `parseHerdrSessionName`, `parseHerdrMilliseconds`,
`parseHerdrUnixMilliseconds`, `parseHerdrUnixSeconds`, `parseHerdrRevision`,
`parseHerdrStateChangeSequence`, `parseHerdrSplitRatio`, `parseHerdrMetadataTtl`,
`parseHerdrInsertIndex`, `parseHerdrImageDimension`, `parseHerdrByteLength`, and
`parseHerdrPopupSize`.

## Schema and model catalog

Public data is schema-owned. A schema value such as `Workspace` also owns the corresponding
`Workspace` TypeScript type. Operation inputs additionally expose `...Encoded` interfaces when the
ergonomic caller representation differs from the normalized type.

### Domain primitives

`HerdrEnvironment`, `HerdrMetadataTokens`, `HerdrMetadataTokenPatch`, `HerdrKeySequence`,
`WorkspaceId`, `TabId`, `PaneId`, `TerminalId`, `PluginId`, `PluginActionId`, `PluginLogId`,
`AgentName`, `HerdrAbsolutePath`, `HerdrSessionName`, `HerdrMilliseconds`,
`HerdrUnixMilliseconds`, `HerdrUnixSeconds`, `HerdrRevision`, `HerdrStateChangeSequence`,
`HerdrSplitRatio`, `HerdrMetadataTtl`, `HerdrInsertIndex`, `HerdrImageDimension`,
`HerdrByteLength`, and `HerdrPopupSize`.

### Server, client, and resource models

`AgentStatus`, `ReportedAgentState`, `AgentSessionReferenceKind`, `AgentSessionReference`,
`ServerCapabilities`, `PingResult`, `ConfigReloadResult`, `AgentManifest`, `AgentManifestStatus`,
`NotificationShowResult`, `ClientWindowTitleResult`, `WorkspaceWorktree`, `Workspace`, `Tab`,
`PaneScroll`, `Pane`, `Agent`, and `SessionSnapshot`.

### Workspace, server, notification, integration, worktree, and tab operations

`WorkspaceCreateInput`, `WorkspaceCreateResult`, `WorkspaceMetadataReportInput`,
`WorkspaceMoveInput`, `WorkspaceMoveBlockInput`, `ServerLiveHandoffInput`, `NotificationShowInput`,
`IntegrationTarget`, `IntegrationChangeResult`, `WorktreeSourceInfo`, `Worktree`,
`WorktreeListResult`, `WorktreeCreateResult`, `WorktreeOpenResult`, `WorktreeRemoveResult`,
`WorktreeListInput`, `WorktreeCreateInput`, `WorktreeOpenInput`, `WorktreeRemoveInput`,
`TabCreateInput`, `TabCreateResult`, `TabListInput`, and `TabMoveInput`.

### Pane, terminal, and geometry operations

`PaneDirection`, `SplitDirection`, `PaneReadSource`, `PaneReadFormat`, `PaneLayoutRect`,
`PaneLayoutSnapshot`, `PaneReadResult`, `PaneOutputMatchResult`, `PaneSwapResult`, `PaneMoveResult`,
`PaneZoomResult`, `PaneProcess`, `PaneProcessInfo`, `PaneNeighborResult`, `PaneEdgesResult`,
`PaneFocusDirectionResult`, `PaneResizeResult`, `PaneRightClickTarget`, `PaneInputRoutingInput`,
`PaneSplitInput`, `PaneSwapInput`, `PaneMoveDestination`, `PaneMoveInput`, `PaneZoomMode`,
`PaneZoomInput`, `PaneFocusDirectionInput`, `PaneResizeInput`, `PaneListInput`, `PaneCurrentInput`,
`PaneReadInput`, `PaneInput`, `PaneOutputMatch`, `PaneWaitForOutputInput`, `PaneAgentReportInput`,
`PaneAgentSessionReportInput`, `PaneMetadataReportInput`, `PaneClearAgentAuthorityInput`, and
`PaneReleaseAgentInput`.

### Graphics and layouts

`PaneGraphicsFileFormat`, `PaneGraphicsInfo`, `PaneGraphicsPlacement`, `PaneGraphicsFormat`,
`PaneGraphicsFrame`, `PaneGraphicsSetFrame`, `PaneGraphicsLayerInput`, `PaneGraphicsStreamInput`,
`PaneGraphicsFileFrame`, `PaneGraphicsFrameAcknowledgement`, `LayoutNode`, `LayoutTarget`,
`LayoutApplyInput`, `LayoutSetSplitRatioInput`, and `LayoutDescription`.

### Agents and events

`HerdrJsonValue`, `AgentTarget`, `AgentStartInput`, `AgentStartResult`, `AgentWaitInput`,
`AgentPromptInput`, `AgentViewState`, `AgentViewField`, `AgentViewValue`, `AgentViewFilter`,
`AgentViewSortField`, `AgentViewSort`, `AgentViewSetInput`, `AgentViewClearInput`, `HerdrEvent`,
`EventForSubscription`, `EventForMatch`, `LifecycleSubscriptionType`, `EventSubscriptionSpec`,
`EventMatch`, and `EventWaitInput`.

### Plugins

`PluginPlatform`, `PluginActionContext`, `PluginPanePlacement`, `PluginSource`,
`PluginManifestCommand`, `PluginManifestAction`, `PluginManifestEventHook`, `PluginManifestPane`,
`PluginManifestLinkHandler`, `InstalledPlugin`, `PluginAction`, `PluginInvocationContext`,
`PluginInvocationContextInput`, `PluginCommandLog`, `PluginActionInvocation`, `PluginPane`,
`PluginSourceInput`, `PluginLinkInput`, `PluginFilterInput`, `PluginActionInvokeInput`,
`PluginLogListInput`, `PluginPaneOpenInput`, `PluginUnlinkResult`, and `PluginPaneCloseResult`.

### Ergonomic encoded input types

Encoded interfaces describe the exact caller representation accepted before schema normalization:

`WorkspaceCreateInputEncoded`, `WorkspaceMetadataReportInputEncoded`,
`WorkspaceMoveInputEncoded`, `WorkspaceMoveBlockInputEncoded`, `ServerLiveHandoffInputEncoded`,
`NotificationShowInputEncoded`, `WorktreeListInputEncoded`, `WorktreeCreateInputEncoded`,
`WorktreeOpenInputEncoded`, `WorktreeRemoveInputEncoded`, `TabCreateInputEncoded`,
`TabListInputEncoded`, `TabMoveInputEncoded`, `PaneInputRoutingInputEncoded`,
`PaneSplitInputEncoded`, `PaneSwapInputEncoded`, `PaneMoveInputEncoded`, `PaneZoomInputEncoded`,
`PaneFocusDirectionInputEncoded`, `PaneResizeInputEncoded`, `PaneListInputEncoded`,
`PaneCurrentInputEncoded`, `PaneReadInputEncoded`, `PaneInputEncoded`,
`PaneWaitForOutputInputEncoded`, `PaneAgentReportInputEncoded`,
`PaneAgentSessionReportInputEncoded`, `PaneMetadataReportInputEncoded`,
`PaneClearAgentAuthorityInputEncoded`, `PaneReleaseAgentInputEncoded`,
`PaneGraphicsFrameEncoded`, `PaneGraphicsSetFrameEncoded`, `PaneGraphicsLayerInputEncoded`,
`PaneGraphicsStreamInputEncoded`, `PaneGraphicsFileFrameEncoded`, `LayoutTargetEncoded`,
`LayoutApplyInputEncoded`, `LayoutSetSplitRatioInputEncoded`, `AgentTargetEncoded`,
`AgentStartInputEncoded`, `AgentWaitInputEncoded`, `AgentPromptInputEncoded`,
`AgentViewSetInputEncoded`, `AgentViewClearInputEncoded`, `EventSubscriptionSpecEncoded`,
`EventMatchEncoded`, `EventWaitInputEncoded`, `PluginLinkInputEncoded`,
`PluginFilterInputEncoded`, `PluginActionInvokeInputEncoded`, `PluginLogListInputEncoded`, and
`PluginPaneOpenInputEncoded`.

## Errors

Expected failures remain values in the Effect error channel and are recoverable with
`Effect.catchTag` or `Effect.catchTags`.

| Error                       | Meaning                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `HerdrConfigurationError`   | Explicit or ambient configuration could not be decoded or resolved.           |
| `HerdrInvalidInput`         | A public operation could not parse caller input.                              |
| `HerdrTransportError`       | Unix-socket connect, read, write, or premature-close failure.                 |
| `HerdrRequestTimeout`       | A local SDK deadline elapsed; the server outcome may be uncertain.            |
| `HerdrInvalidResponse`      | Malformed, oversized, mismatched, missing, or schema-invalid server response. |
| `HerdrUnsupportedProtocol`  | Server protocol is outside 17, 18, 19, 20, and 21.                            |
| `HerdrUnsupportedResult`    | An operation returned an unsupported success discriminant.                    |
| `HerdrUnsupportedEvent`     | A stream or wait received an unsupported event discriminant.                  |
| `HerdrServerError`          | The server rejected a request with an open-code error response.               |
| `HerdrInvalidFrame`         | Graphics data or dimensions are invalid.                                      |
| `HerdrImageTooLarge`        | A graphics payload exceeds its write-mode byte limit.                         |
| `HerdrGraphicsStreamClosed` | A graphics writer was used after its owning scope closed.                     |

`HerdrTransportRequestError` is the common request error union. `HerdrTransportMethodError<Method>`
adds method-specific result failures. `EventOperationError` adds `HerdrUnsupportedEvent` for event
operations; `ServerOperationError` and `WorkspaceOperationError` name their namespace request
unions; graphics methods add their frame, size, or lifecycle errors.

```ts
const resilientPing = herdr.server
  .ping()
  .pipe(
    Effect.catchTag("HerdrUnsupportedProtocol", (error) =>
      Effect.logError(
        `Herdr protocol ${error.actualProtocol} is incompatible with ${error.supportedProtocols.join(", ")}`,
      ),
    ),
  );
```

## Advanced transport API

`HerdrTransport` is public for infrastructure integrations that genuinely need raw protocol access.
Its `request` method remains method-indexed, `openStream` is limited to `events.subscribe` and
`pane.graphics.stream`, and `writeStreamBytes` preserves typed socket failures. Most applications
should use namespace services instead.

Transport exports are `HerdrTransport`, `HerdrTransportRequestOptions`,
`HerdrTransportRequestOptionsEncoded`, `HerdrTransportRequestError`,
`HerdrTransportMethodError`, `herdrTransportLayerWithoutDependencies`, and
`herdrTransportLayer`.

## Examples

The [`examples/`](examples/) directory contains eleven executable, type-checked programs. Start
with the focused recipes, then explore the multi-agent idea lab, declarative command center,
animated graphics beacon, and attention-sorted agent rescue view.

```sh
pnpm run example -- examples/session-inventory.ts
pnpm run example -- examples/multi-agent-idea-lab.ts "Design a safer release workflow"
```

See [`examples/README.md`](examples/README.md) for prerequisites, side effects, and the complete
catalog.

## Development

This repository vendors the matching Effect source under `repos/effect/` as read-only reference
material. Production code imports the installed `effect` package, never the vendored repository.

```sh
pnpm install
pnpm run check
pnpm test -- --run
pnpm run build
```

- `pnpm run generate` regenerates private wire types from `schema/herdr-api.schema.json`.
- `pnpm run check` formats, lints, typechecks, and compiles every example.
- `pnpm test -- --run` runs the repository test suite once.
- `pnpm run build` regenerates wire types and produces `dist/index.mjs` plus declarations.

Generated snake-case wire contracts are private. The public entrypoint exports the Effect-native
SDK, configuration, domain schemas, normalized models, typed errors, transport options, namespace
services, constructors, and Layers.

## License

MIT
