# `herdr-sdk`

Effect-native TypeScript access to Herdr's local Unix-socket API.

The SDK exposes every Herdr operation as a typed `Effect`, decodes public inputs and wire responses
with Effect Schema, represents live events as `Stream`, and owns long-lived connection cleanup
with `Scope`. The root `HerdrSdk` service keeps the convenient namespace-oriented API while preserving
precise errors, dependencies, and interruption.

```ts
import { Effect } from "effect";
import { HerdrSdk, herdrSdkLayer } from "herdr-sdk";

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

- SDK version: `0.9.5` (unreleased baseline)
- Minimum Herdr release: `0.9.5`; supported wire protocol: **22 only**
- Effect: `4.0.0-beta.105`
- Runtime: Node.js 20 or newer on a platform supported by Herdr's local socket server

The SDK verifies protocol compatibility before ordinary requests and shares that compatibility
result across the Layer graph. A server on another protocol fails with
`HerdrUnsupportedProtocol`; install matching Herdr and SDK releases instead of bypassing the check.

Herdr 0.9.1–0.9.5 kept protocol 22, so the protocol check cannot tell them apart. This SDK targets
the 0.9.5 API: it adds `panes.clear`, `panes.link.resolve`, and `server.sshAgent`, which earlier
servers answer with `unknown_method` (a `HerdrServerError`), and it no longer offers the
`pane.graphics.*` socket API that 0.9.2 removed. Applications draw images by writing standard Kitty
graphics to their own pane's terminal output.

Install from npm:

```sh
pnpm add herdr-sdk
```

Then import from `herdr-sdk`.

### Versioning

SDK versions track the Herdr release they target. `MAJOR.MINOR` match Herdr, and the SDK patch is
`herdrPatch * 100 + sdkRevision`:

| Herdr | SDK                                  |
| ----- | ------------------------------------ |
| 0.9.5 | `0.9.500`, then `0.9.501`, `0.9.502` |
| 0.9.6 | `0.9.600`                            |
| 1.0.0 | `1.0.0`, then `1.0.1`                |

`package.json` records the targeted release in `herdr.version`; verification fails when the SDK
version does not fall in that release's range.

### Releasing

Pushing a `vX.Y.Z` tag that matches `package.json`'s `version` runs
[`.github/workflows/release.yml`](.github/workflows/release.yml): it runs full verification,
builds and checks the packed package, publishes to npm with provenance (prerelease versions such
as `v1.0.0-beta.1` publish under the `next` dist-tag), and creates a GitHub Release with the
tarball attached. Bump and tag with `pnpm exec bumpp <version>`, passing the version explicitly
(for example `0.9.501`), and update `herdr.version` when retargeting a new Herdr release.

## API shape

`HerdrSdk` is a yieldable `Context.Service`. It aggregates independently implemented namespace
services; it does not proxy or duplicate their operations.

```ts
const program = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;

  const created = yield* herdr.workspaces.createInDirectory(process.cwd(), {
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

Ordinary socket operations accept `HerdrTransportRequestOptionsEncoded` as their final optional argument. Client-shell sessions instead configure their bounded deadlines at acquisition:

```ts
import { Duration } from "effect";

yield * herdr.server.ping({ requestTimeout: Duration.seconds(2) });
```

`requestTimeout` is the local SDK deadline and accepts an Effect `Duration`; duration strings are
accepted only through the `HERDR_REQUEST_TIMEOUT` environment variable. Server-owned waits have a
separate `timeoutMs` in their input. When both apply, make the request deadline longer than the
server wait so the server can return its typed result first.

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
import { HerdrSdk, herdrSdkLayerFromOptions } from "herdr-sdk";

const sdkLayer = herdrSdkLayerFromOptions({
  session: "work",
  requestTimeout: Duration.seconds(10),
  application: { name: "release-console", version: "1.4.0" },
});

const protocol = await Effect.runPromise(
  Effect.gen(function* () {
    return (yield* HerdrSdk).config.supportedProtocol;
  }).pipe(Effect.provide(sdkLayer)),
);
```

Configuration exports:

| API                                   | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `HerdrRequestDeadline`                | Schema for finite, non-negative Effect durations.                 |
| `HerdrApplication`                    | Schema for compatibility-handshake caller identity.               |
| `HerdrProtocolVersion`                | Literal schema for protocol `22`.                                 |
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
import { WorkspaceService, workspaceServiceLayer } from "herdr-sdk";

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

Nested capability contracts are exported as `IClientWindowTitle`, `IServerSshAgent`,
`ServerSshAgentRegistration`, `IPaneInteraction`, `IAgentView`, `IPluginActions`, `IPluginLogs`,
and `IPluginPanes`. The pure
identifier-constructor contract is `IHerdrIds`.

### Service construction export index

This table spells out every direct-service symbol so callers and coding agents can find the exact
composition entrypoint without deriving its spelling from the convention above.

| Namespace            | Interface and service                                       | Constructor                      | Requirement-preserving Layer                         | Production Layer                  |
| -------------------- | ----------------------------------------------------------- | -------------------------------- | ---------------------------------------------------- | --------------------------------- |
| clientShell          | `IClientShellService`, `ClientShellService`                 | `makeClientShellService`         | `clientShellServiceLayerWithoutDependencies`         | `clientShellServiceLayer`         |
| commands             | `ICommandService`, `CommandService`                         | `makeCommandService`             | `commandServiceLayerWithoutDependencies`             | `commandServiceLayer`             |
| productAnnouncements | `IProductAnnouncementService`, `ProductAnnouncementService` | `makeProductAnnouncementService` | `productAnnouncementServiceLayerWithoutDependencies` | `productAnnouncementServiceLayer` |
| releaseNotes         | `IReleaseNotesService`, `ReleaseNotesService`               | `makeReleaseNotesService`        | `releaseNotesServiceLayerWithoutDependencies`        | `releaseNotesServiceLayer`        |
| server               | `IServerService`, `ServerService`                           | `makeServerService`              | `serverServiceLayerWithoutDependencies`              | `serverServiceLayer`              |
| session              | `ISessionService`, `SessionService`                         | `makeSessionService`             | `sessionServiceLayerWithoutDependencies`             | `sessionServiceLayer`             |
| notifications        | `INotificationService`, `NotificationService`               | `makeNotificationService`        | `notificationServiceLayerWithoutDependencies`        | `notificationServiceLayer`        |
| client               | `IClientService`, `ClientService`                           | `makeClientService`              | `clientServiceLayerWithoutDependencies`              | `clientServiceLayer`              |
| workspaces           | `IWorkspaceService`, `WorkspaceService`                     | `makeWorkspaceService`           | `workspaceServiceLayerWithoutDependencies`           | `workspaceServiceLayer`           |
| worktrees            | `IWorktreeService`, `WorktreeService`                       | `makeWorktreeService`            | `worktreeServiceLayerWithoutDependencies`            | `worktreeServiceLayer`            |
| tabs                 | `ITabService`, `TabService`                                 | `makeTabService`                 | `tabServiceLayerWithoutDependencies`                 | `tabServiceLayer`                 |
| panes                | `IPaneService`, `PaneService`                               | `makePaneService`                | `paneServiceLayerWithoutDependencies`                | `paneServiceLayer`                |
| layouts              | `ILayoutService`, `LayoutService`                           | `makeLayoutService`              | `layoutServiceLayerWithoutDependencies`              | `layoutServiceLayer`              |
| agents               | `IAgentService`, `AgentService`                             | `makeAgentService`               | `agentServiceLayerWithoutDependencies`               | `agentServiceLayer`               |
| events               | `IEventService`, `EventService`                             | `makeEventService`               | `eventServiceLayerWithoutDependencies`               | `eventServiceLayer`               |
| integrations         | `IIntegrationService`, `IntegrationService`                 | `makeIntegrationService`         | `integrationServiceLayerWithoutDependencies`         | `integrationServiceLayer`         |
| plugins              | `IPluginService`, `PluginService`                           | `makePluginService`              | `pluginServiceLayerWithoutDependencies`              | `pluginServiceLayer`              |
| popups               | `IPopupService`, `PopupService`                             | `makePopupService`               | `popupServiceLayerWithoutDependencies`               | `popupServiceLayer`               |

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

### `server.sshAgent`

| Operation                                | Result and behavior                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `withRegistration(input, use, options?)` | Registers an SSH agent socket for the callback and releases it on every exit path. |
| `registerScoped(input, options?)`        | Advanced acquisition; the registration lasts until the caller's `Scope` closes.    |

Herdr panes reach SSH agents through a session-local agent address. Registration offers another
absolute, user-owned agent socket on the server host for as long as its connection stays open;
Herdr keeps a working agent it inherited and otherwise selects the earliest live registration.
Check `PingResult.capabilities` for `sshAgentRegistration` first: unsupported servers answer with
`ssh_agent_unavailable`, and rejected sockets with `invalid_ssh_agent`. If Herdr closes the
registration first, `withRegistration` interrupts the callback and fails with
`HerdrSshAgentRegistrationClosed`.

```ts
const forwardAgent = (socketPath: string) =>
  Effect.gen(function* () {
    const herdr = yield* HerdrSdk;
    yield* herdr.server.sshAgent.withRegistration({ socketPath }, (registration) =>
      registration.awaitClosed(),
    );
  });
```

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

| Operation                                                  | Result and behavior                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `create(input?, options?)`                                 | Uses the server's default directory policy and atomically returns a workspace, initial tab, and root pane. |
| `createInDirectory(cwd, input?, options?)`                 | Creates in an explicit absolute directory.                                                                 |
| `createFromWorkspace(sourceWorkspaceId, input?, options?)` | Uses the source workspace's directory policy; does not clone its topology.                                 |
| `list(options?)`                                           | Lists workspaces in display order.                                                                         |
| `get(id, options?)`                                        | Reads one workspace.                                                                                       |
| `focus(id, options?)`                                      | Focuses and returns one workspace.                                                                         |
| `rename(id, label, options?)`                              | Replaces a workspace label.                                                                                |
| `move(id, input, options?)`                                | Moves a workspace to an insertion index.                                                                   |
| `moveBlock(ids, input?, options?)`                         | Moves a contiguous workspace block before an optional anchor.                                              |
| `reportMetadata(id, input, options?)`                      | Replaces or removes source-owned metadata tokens.                                                          |
| `close(id, options?)`                                      | Closes one workspace.                                                                                      |
| `closeGroup(id, options?)`                                 | Closes the contiguous group containing a workspace.                                                        |

Creation input is `WorkspaceCreateOptionsEncoded` (`focus`, `label`, `env`). Directory intent is selected by the method, not a public tagged union. The former `create({ cwd })` input is removed; use `createInDirectory(cwd)`.

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

| Operation                                        | Result and behavior                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `split(paneId, input, options?)`                 | Splits a target or focused pane.                                                                          |
| `swap(input, options?)`                          | Swaps a pane by direction or explicit identifier.                                                         |
| `move(paneId, input, options?)`                  | Moves a pane to a tab or new container.                                                                   |
| `zoom(paneId?, input?, options?)`                | Toggles or sets pane zoom.                                                                                |
| `layout(paneId?, options?)`                      | Returns the containing `PaneLayoutSnapshot`.                                                              |
| `processInfo(paneId?, options?)`                 | Returns foreground and process-tree information.                                                          |
| `neighbor(paneId, direction, options?)`          | Finds a directional neighbor.                                                                             |
| `edges(paneId?, options?)`                       | Reports which layout edges contain the pane.                                                              |
| `focusDirection(direction, input?, options?)`    | Moves focus directionally.                                                                                |
| `resize(direction, input?, options?)`            | Resizes a pane by terminal cells.                                                                         |
| `scroll(paneId, { offsetFromBottom }, options?)` | Sets scroll offset and returns pane information.                                                          |
| `editScrollback(paneId, options?)`               | Opens the focused pane's scrollback in its configured editor.                                             |
| `selection.read(paneId, input, options?)`        | Reads absolute-coordinate text with an optional content revision guard.                                   |
| `copyMotion(paneId, input, options?)`            | Computes a cursor position and content revision without typing input.                                     |
| `copySearch(paneId, input, options?)`            | Searches an exact content revision; query limit is 4096 UTF-8 bytes, match window is at most 1024 ranges. |
| `link.resolve(paneId, input, options?)`          | Returns the viewport regions covered by the link under a cell, without side effects.                      |
| `link.activate(paneId, input, options?)`         | Resolves a visible link and invokes a matching plugin; does not open a browser.                           |
| `clear(paneId, options?)`                        | Clears screen and scrollback, keeping the current prompt line; full-screen apps are left alone.           |
| `list(input?, options?)`                         | Lists panes, optionally within a workspace.                                                               |
| `current(input?, options?)`                      | Resolves the caller or foreground pane.                                                                   |
| `get(id, options?)`                              | Reads one pane.                                                                                           |
| `focus(id, options?)`                            | Focuses and returns one pane.                                                                             |
| `rename(id, label, options?)`                    | Replaces or clears a pane label.                                                                          |
| `setInputRouting(id, input, options?)`           | Chooses whether right-click belongs to Herdr or the pane application.                                     |
| `sendText(id, text, options?)`                   | Sends literal terminal text.                                                                              |
| `sendKeys(id, keys, options?)`                   | Sends named keys.                                                                                         |
| `sendInput(id, input, options?)`                 | Sends text and named keys as one input operation.                                                         |
| `read(id, input, options?)`                      | Reads visible, recent, or recent-unwrapped output.                                                        |
| `waitForOutput(id, input, options?)`             | Waits server-side for a substring or regular-expression match.                                            |
| `reportAgent(id, input, options?)`               | Reports source-owned agent state, optionally with a `resumeArgv` restart command.                         |
| `reportAgentSession(id, input, options?)`        | Attaches an upstream agent-session reference, optionally with a `resumeArgv` restart command.             |
| `reportMetadata(id, input, options?)`            | Replaces or removes source-owned pane metadata.                                                           |
| `clearAgentAuthority(id, input?, options?)`      | Clears agent-report authority, optionally by version.                                                     |
| `releaseAgent(id, input, options?)`              | Releases one source-owned agent report.                                                                   |
| `close(id, options?)`                            | Closes one pane.                                                                                          |

Selection/copy/link operations preserve `stale_content` and do not retry coordinates against new text. Copy search's `total` can exceed `matches.length`. Content revisions are distinct from endpoint projection and surface revisions.

`resumeArgv` lets an agent tell Herdr how to reopen its exact session after a server restart. It is
parsed by `HerdrResumeArgv` before any request: one to 64 arguments, at most 8 KiB of UTF-8, no
apostrophes or control characters, and a first element that is a plain command name rather than a
path. Herdr keeps it only while the same `source` and `agent` hold the pane, so report agent state
before attaching it; otherwise the server rejects the report with `resume_not_accepted`.

```ts
const reportResumableSession = (sessionId: string) =>
  Effect.gen(function* () {
    const herdr = yield* HerdrSdk;
    const pane = yield* herdr.panes.current();
    yield* herdr.panes.reportAgent(pane.id, {
      source: "custom:my-agent",
      agent: "my-agent",
      state: "working",
    });
    yield* herdr.panes.reportAgentSession(pane.id, {
      source: "custom:my-agent",
      agent: "my-agent",
      sessionId,
      resumeArgv: ["my-agent", "--resume", sessionId],
    });
  });
```

`reportMetadata` controls presentation, not agent lifecycle. For example:

```ts
const describeTask = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const pane = yield* herdr.panes.current();
  yield* herdr.panes.reportMetadata(pane.id, {
    source: "my-tool",
    title: "Fix login tests",
    stateLabels: { working: "Running tests", blocked: "Needs review" },
    tokens: { model: "my-model", ticket: "APP-123", oldToken: null },
  });
});
```

- `stateLabels` accepts any subset of `idle`, `working`, `blocked`, `done`, and `unknown`.
  Unknown keys fail rather than being silently removed.
- Ordinary reports replace that source's title, displayed agent name, and label table;
  omitted previous presentation fields do not survive. Explicit clear operations are separate.
- Tokens update individually; `null` removes a token. A pane or workspace token patch accepts
  at most 16 entries, with names matching `^[A-Za-z0-9_-]{1,32}$`.
- Use `reportAgent` for lifecycle state consumed by waits and notifications. Custom tokens such
  as `$model` need corresponding sidebar configuration to appear there.

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

Agent targets accept an explicit `kind` and exactly one selector:

```ts
const byPane = { kind: "pane", paneId: "pane-1" } as const;
const byName = { kind: "agent", name: "worker" } as const;
```

Existing `{ paneId: "pane-1" }` and `{ name: "worker" }` calls still work; parsing supplies
`kind`. Supplying both selectors, or a `kind` that disagrees with its selector, fails in types
and at runtime—even if one selector is invalid. `kind` is SDK-only; wire requests still send
one `target`. Layout targets likewise select either a tab or pane, and pane swaps select either
a direction or a source/target pane pair.

`HerdrJsonValue` accepts JSON values only: nonfinite numbers and class instances such as `Date`
are rejected. Parsed layout ratios and request deadlines retain their validated types;
encoded inputs still accept ordinary numbers and Effect durations. When manually constructing
parsed values, use `HerdrSplitRatio.make(0.5)` or `HerdrRequestDeadline.make(Duration.seconds(5))`
instead of assigning an unchecked scalar.

Protocol-22 prompt success acknowledges ordered text and Enter writes, not a new turn. A non-working prompt with `wait` requires observed working/blocked activity before a settled state can satisfy it; the server can return `agent_prompt_stalled`. Timeouts/stalls do not prove non-delivery. The SDK neither duplicates this state machine nor retries prompts. API seen state and each TUI client's Done badge may differ.

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
import { HerdrSdk } from "herdr-sdk";

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

Subscriptions are live-only rather than replay streams. Each execution captures its selection
when parsing begins; later caller mutation cannot change that execution's request or event filter.
One-shot waits follow the same rule. Interrupting the consumer releases the socket.

Event history is bounded. A subscriber that falls behind fails with `HerdrEventsLost` rather than
silently skipping events. Treat cached state as stale: resubscribe, wait for the new subscription to
start, and reconcile through authoritative reads such as `session.snapshot`, using events as
invalidation signals. Snapshots and events share no sequence boundary, so do not replay buffered
events onto a snapshot.

```ts
import { Effect, Stream } from "effect";
import { HerdrSdk } from "herdr-sdk";

const watchWorkspaces = (onChange: Effect.Effect<void>): Effect.Effect<void, unknown, HerdrSdk> =>
  Effect.gen(function* () {
    const herdr = yield* HerdrSdk;
    yield* herdr.events.subscribe([{ type: "workspace.created" }] as const).pipe(
      Stream.runForEach(() => onChange),
      Effect.catchTag("HerdrEventsLost", () => Effect.andThen(onChange, watchWorkspaces(onChange))),
    );
  });
```

### `integrations`

| Operation                     | Result and behavior                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `list(options?)`              | Returns executable availability and `notInstalled`, `current`, or `outdated` installation state. |
| `install(target, options?)`   | Installs a built-in `codex`, `qwen`, or `antigravity_cli` integration.                           |
| `uninstall(target, options?)` | Removes a built-in integration.                                                                  |

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

### Commands and endpoint notices

- `commands.invoke(commandId, options?)`: uses current server context.
- `commands.invokeInWorkspace(commandId, workspaceId, options?)`.
- `commands.invokeInTab(commandId, tabId, input?, options?)`: optional `expectedWorkspaceId`.
- `commands.invokeInPane(commandId, paneId, input?, options?)`: optional parent assertions and `selection`; the selection's pane ID is derived, not duplicated.
- `productAnnouncements.dismiss({ version, id }, options?)`.
- `releaseNotes.dismiss({ version }, options?)`.

Command IDs are opaque endpoint-issued identities, not shell text. All target methods share the `command.invoke` wire API. Stale identities and server failures remain errors, without retries.

### `clientShell`

`withConnection(input, use)` owns the endpoint session for an Effect callback; callback success, failure, interruption, or terminal connection failure closes its resources. `connectScoped(input)` is the advanced explicit-Scope form. `projections(input)` is a cold, inactive connection-owning stream; each consumption opens its own connection.

```ts
const inspectShell = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  return yield* herdr.clientShell.withConnection(
    {
      surface: { columns: 100, rows: 30 },
      cellPixels: { width: 8, height: 16 },
    },
    (shell) =>
      Effect.gen(function* () {
        const snapshot = yield* shell.snapshot();
        yield* shell.surface.set({ active: true });
        const surface = yield* shell.surface.awaitReady();
        return { workspaceCount: snapshot.workspaces.length, cells: surface.frame.cells.length };
      }),
  );
});
```

The connection uses generation-1 binary framing on **`herdr-client.sock`**, not newline-delimited API JSON. Its default path is alongside the configured API socket; an explicit session input `socketPath` overrides the client endpoint. The configured API socket must refer to the same server for the protocol-22 check. On Windows, endpoint paths use the same named-pipe translation as ordinary transport.

Connection input also accepts `initialSurface` (`inactive` by default), `mouseCapture`, `endpointKeybindings`, `timeoutMs` (10 seconds), `healthIntervalMs` (10 seconds), and `maximumMessageBytes` (32 MiB maximum/default). Surface and cell dimensions are explicit; the SDK does not inspect or resize the developer's terminal.

Connection operations:

- `snapshot()`, `projections`: current metadata and coalesced replacement projections. `agentView` carries the full active agent-view definition (filter and sort) as `{ status: "active", view }`, `{ status: "none" }`, or `{ status: "unrecognized" }` for a view this SDK cannot decode.
- `surface.set({ active })`, `surface.state()`, `surface.states`, `surface.awaitReady()`, `surface.resize(input)`.
- `input.paste(paneId, { text })`, `input.text(paneId, { text })`, `input.key(paneId, input)`, `input.mouse(paneId, input)`; explicit popup-terminal variants are `pasteInPopup`, `textInPopup`, `keyInPopup`, `mouseInPopup`.
- `commands.invoke` / `invokeInWorkspace` / `invokeInTab` / `invokeInPane`: same target intent as socket commands, but the first argument is a discovered `ClientShellCommand` from this connection's snapshot.
- `productAnnouncements.dismiss(input)`, `releaseNotes.dismiss(input)`.
- `setFocused(boolean)`, `setMouseCapture(boolean)`, `connectionState()`, `awaitClosed()`.
- `setHostTheme(input)`: forwards the outer terminal's theme so pane applications choose matching colors. It accepts `{ kind: "defaultColor", target: "foreground" | "background", color: { r, g, b } }`, `{ kind: "palette", colors: [{ index, color }] }` (1–256 entries; larger batches are rejected, not split), or `{ kind: "appearance", appearance: "dark" | "light" }`. A background color also infers appearance unless one was set explicitly. The server sends no acknowledgement.
- `events`: live semantic notifications and host presentation instructions; the SDK does not execute clipboard, graphics escapes, sound, or window-title effects itself.

`client_shell.surface.set` is connection-local. An activation ACK establishes a projection floor, not delivered presentation; wait for `surface.awaitReady()` separately. Patches require an exact base and are applied before publishing complete surfaces. Graphics asset bytes are retained for coalesced scenes. `direct_graphics` is deliberately not negotiated: server-supplied graphics file paths are never opened. This SDK is an endpoint client, not a host TUI renderer or saved-SSH-machine manager.

Projection/state streams coalesce whole replacements. Presentation events are live-only with an eight-message backlog; overflow fails the connection rather than silently dropping effects or blocking health traffic. At most 32 requests are pending; each frame and the aggregate buffered response bytes are bounded by `maximumMessageBytes`, with at most 4096 chunks per response. Ambiguous endpoint write/request timeouts invalidate the connection; server rejections and missing advertised methods do not. No mutation is automatically retried. Handles and connection-bound streams must be used inside the owning callback/Scope; escaped handles fail after closure.

### `ids`

`ids` is the root namespace for the exported `herdrIds` value. It is pure schema-owned data, not an
Effect service, and provides synchronous constructors that reject invalid values:

| Constructor           | Result              |
| --------------------- | ------------------- |
| `command(value)`      | `HerdrCommandId`    |
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
`parseHerdrInsertIndex`, `parseHerdrResumeArgv`, and `parseHerdrPopupSize`.

## Schema and model catalog

Public data is schema-owned. A schema value such as `Workspace` also owns the corresponding
`Workspace` TypeScript type. Operation inputs additionally expose `...Encoded` interfaces when the
ergonomic caller representation differs from the normalized type.

Protocol-22 interaction models are exported from `herdr-pane-interaction-models.ts`; endpoint projection, surface, lifecycle, and graphics schemas from `herdr-client-shell-models.ts`; semantic key/mouse inputs from `herdr-client-shell-input.ts`. Connection input and ownership interfaces belong to `client-shell-service.ts`. All are re-exported by `herdr-sdk`; generated wire contracts remain private.

### Domain primitives

`HerdrEnvironment`, `HerdrMetadataTokens`, `HerdrMetadataTokenPatch`, `HerdrKeySequence`,
`WorkspaceId`, `TabId`, `PaneId`, `TerminalId`, `PluginId`, `PluginActionId`, `PluginLogId`,
`AgentName`, `HerdrAbsolutePath`, `HerdrSessionName`, `HerdrMilliseconds`,
`HerdrUnixMilliseconds`, `HerdrUnixSeconds`, `HerdrRevision`, `HerdrStateChangeSequence`,
`HerdrSplitRatio`, `HerdrMetadataTtl`, `HerdrInsertIndex`, `HerdrResumeArgv`, and
`HerdrPopupSize`.

### Server, client, and resource models

`AgentStatus`, `ReportedAgentState`, `AgentSessionReferenceKind`, `AgentSessionReference`,
`ServerCapabilities`, `PingResult`, `ConfigReloadResult`, `AgentManifest`, `AgentManifestStatus`,
`NotificationShowResult`, `ClientWindowTitleResult`, `WorkspaceWorktree`, `Workspace`, `Tab`,
`PaneScroll`, `Pane`, `Agent`, and `SessionSnapshot`. `Pane.restoreError` explains a failed shell or
directory restore; `Agent.completionSequence` marks an idle transition that completed work,
independent of whether a client has seen it.

### Workspace, server, notification, integration, worktree, and tab operations

`WorkspaceCreateOptions`, `WorkspaceCreateResult`, `WorkspaceMetadataReportInput`,
`WorkspaceMoveInput`, `WorkspaceMoveBlockInput`, `ServerLiveHandoffInput`,
`ServerSshAgentRegisterInput`, `NotificationShowInput`,
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

### Pane interaction and layouts

`PaneLinkActivateInput`, `PaneLinkActivatedResult`, `PaneLinkResolveInput`, `PaneLinkRegion`,
`PaneLinkResolvedResult`, and the other pane interaction models; `LayoutNode`, `LayoutTarget`,
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

`WorkspaceCreateOptionsEncoded`, `WorkspaceMetadataReportInputEncoded`,
`WorkspaceMoveInputEncoded`, `WorkspaceMoveBlockInputEncoded`, `ServerLiveHandoffInputEncoded`,
`ServerSshAgentRegisterInputEncoded`, `PaneLinkResolveInputEncoded`,
`NotificationShowInputEncoded`, `WorktreeListInputEncoded`, `WorktreeCreateInputEncoded`,
`WorktreeOpenInputEncoded`, `WorktreeRemoveInputEncoded`, `TabCreateInputEncoded`,
`TabListInputEncoded`, `TabMoveInputEncoded`, `PaneInputRoutingInputEncoded`,
`PaneSplitInputEncoded`, `PaneSwapInputEncoded`, `PaneMoveInputEncoded`, `PaneZoomInputEncoded`,
`PaneFocusDirectionInputEncoded`, `PaneResizeInputEncoded`, `PaneListInputEncoded`,
`PaneCurrentInputEncoded`, `PaneReadInputEncoded`, `PaneInputEncoded`,
`PaneWaitForOutputInputEncoded`, `PaneAgentReportInputEncoded`,
`PaneAgentSessionReportInputEncoded`, `PaneMetadataReportInputEncoded`,
`PaneClearAgentAuthorityInputEncoded`, `PaneReleaseAgentInputEncoded`, `LayoutTargetEncoded`,
`LayoutApplyInputEncoded`, `LayoutSetSplitRatioInputEncoded`, `AgentTargetEncoded`,
`AgentStartInputEncoded`, `AgentWaitInputEncoded`, `AgentPromptInputEncoded`,
`AgentViewSetInputEncoded`, `AgentViewClearInputEncoded`, `EventSubscriptionSpecEncoded`,
`EventMatchEncoded`, `EventWaitInputEncoded`, `PluginLinkInputEncoded`,
`PluginFilterInputEncoded`, `PluginActionInvokeInputEncoded`, `PluginLogListInputEncoded`, and
`PluginPaneOpenInputEncoded`.

## Errors

Expected failures remain values in the Effect error channel and are recoverable with
`Effect.catchTag` or `Effect.catchTags`.

| Error                             | Meaning                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `HerdrConfigurationError`         | Explicit or ambient configuration could not be decoded or resolved.           |
| `HerdrInvalidInput`               | A public operation could not parse caller input.                              |
| `HerdrTransportError`             | Unix-socket connect, read, write, or premature-close failure.                 |
| `HerdrRequestTimeout`             | A local SDK deadline elapsed; the server outcome may be uncertain.            |
| `HerdrInvalidResponse`            | Malformed, oversized, mismatched, missing, or schema-invalid server response. |
| `HerdrUnsupportedProtocol`        | Server and SDK protocol versions differ.                                      |
| `HerdrUnsupportedResult`          | An operation returned an unsupported success discriminant.                    |
| `HerdrUnsupportedEvent`           | A stream or wait received an unsupported event discriminant.                  |
| `HerdrServerError`                | The server rejected a request with an open-code error response.               |
| `HerdrEventsLost`                 | A subscription fell behind retained history; resubscribe and reconcile.       |
| `HerdrSshAgentRegistrationClosed` | Herdr closed an SSH agent registration before its owner released it.          |

`HerdrTransportRequestError` is the common request error union. `HerdrTransportMethodError<Method>`
adds method-specific result failures. `EventOperationError` adds `HerdrUnsupportedEvent` for event
operations and `EventSubscriptionError` further adds `HerdrEventsLost` for live subscriptions;
`ServerOperationError` and `WorkspaceOperationError` name their namespace request unions, and
`ServerSshAgentRegistrationError` names how an accepted registration can end.

```ts
const resilientPing = herdr.server
  .ping()
  .pipe(
    Effect.catchTag("HerdrUnsupportedProtocol", (error) =>
      Effect.logError(
        `Herdr protocol ${error.actualProtocol} is incompatible with ${error.supportedProtocol}`,
      ),
    ),
  );
```

Endpoint failures are separate typed errors: `HerdrEndpointNegotiationError`, `HerdrEndpointTransportError`, `HerdrEndpointRequestTimeout`, `HerdrEndpointClosed`, `HerdrEndpointUnsupportedMethod`, `HerdrEndpointStaleReference`, and `HerdrEndpointInvalidMessage`. Diagnostics classify the phase/reason without retaining frame bodies. `HerdrEndpointConnectError` and `ClientShellOperationError` are error unions, not wrapping classes.

## Advanced transport API

`HerdrTransport` is public for infrastructure integrations that genuinely need raw protocol access.
Its `request` method remains method-indexed, and `openStream` is limited to the
`HerdrStreamWireMethod` connections, `events.subscribe` and `server.ssh_agent.register`, whose
sockets stay open for the acquiring scope. Most applications should use namespace services instead.

Transport exports are `HerdrTransport`, `HerdrTransportRequestOptions`,
`HerdrTransportRequestOptionsEncoded`, `HerdrStreamWireMethod`, `HerdrTransportRequestError`,
`HerdrTransportMethodError`, `herdrTransportLayerWithoutDependencies`, and
`herdrTransportLayer`.

## Examples

The [`examples/`](examples/) directory contains ten executable, type-checked programs. Start
with the focused recipes, then explore the multi-agent idea lab, declarative command center,
and attention-sorted agent rescue view.

```sh
pnpm run example -- examples/session-inventory.ts
pnpm run example -- examples/multi-agent-idea-lab.ts "Design a safer release workflow"
```

See [`examples/README.md`](examples/README.md) for prerequisites, side effects, and the complete
catalog.

## Development

Start with [AGENTS.md](AGENTS.md), the [architecture](docs/architecture.md), and the
[agent workflow](docs/agent-workflow.md) for task-to-file/test navigation, learning routes,
verification safety, and subagent handoffs. [package.json](package.json) is the command source of
truth. The matching Effect source in `repos/effect/` is read-only reference material; production
code imports the installed package, never vendored source.

With dependencies already installed, run from the repository root:

```sh
pnpm run doctor
pnpm run verify:quick
./node_modules/.bin/vitest run src/herdr-sdk.test.ts
pnpm run verify
```

Quick verification checks formatting, lint, types, public docs, and examples. Full verification
adds generated drift, runtime suites, and an isolated package consumer. See the
[workflow command table](docs/agent-workflow.md#verification-commands) for focused checks and
`pnpm run lab --list` for fixture-only executable learning recipes. For opt-in OpenTelemetry
export, a loopback viewer, and agent-readable trace queries, follow
[local tracing](docs/local-tracing.md). No SDK import starts telemetry or a viewer.

A globally managed `pnpm` launcher may bootstrap dependencies. For strict no-bootstrap checks,
use `node scripts/sdk-doctor.mjs` and `node scripts/sdk-verify.mjs quick` (or `full` / `generated`).

Tests use isolated local fixtures, never live Herdr control.
Runtime tests do not check `.tst.ts` inference contracts;
those require typechecking. Live [examples](examples/README.md) have explicit side effects and
are not verification commands.

`pnpm run check` checks formatting, lint, types, public docs, and examples without fixing files.
Keep writing commands separate from shared-checkout verification: `pnpm run generate` rewrites
private wire contracts from `schema/herdr-api.schema.json`, and `pnpm run build` regenerates before
producing package output. Direct Vite+ formatting without `--check` and fixing with `--fix` also
write files. Generated wire contracts
remain private; [src/index.ts](src/index.ts) owns the public entrypoint.

## License

MIT
