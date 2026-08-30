# @herdr/sdk

An Effect-native TypeScript SDK for Herdr's local protocol-21 socket API.

- yieldable, independently composable services
- Stripe-style namespaces through `HerdrSdk`
- schema-owned resources, inputs, events, and branded identifiers
- granular typed failures
- cold Effect event streams
- scoped pane-graphics writers
- generated private wire contracts

## Requirements

- Node.js 20 or newer
- Effect `4.0.0-beta.105`
- Herdr protocol 21
- a running local Herdr session

The package is ESM-only and does not depend on the Herdr binary package.
Its bundled contract tracks Herdr `origin/master` commit
`4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c` (the protocol-21 revision audited
after v0.8.2). Unix-domain sockets and Herdr's Windows named-pipe mapping are
both supported.

## Install

```sh
pnpm add @herdr/sdk effect@4.0.0-beta.105
```

## Root SDK

`HerdrSdk` is a yieldable composition root. Its namespace values are the exact
independent service implementations from the Layer graph.

```ts
import { Effect } from "effect";
import { HerdrSdk, herdrSdkLayerFromOptions } from "@herdr/sdk";

const program = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;

  const created = yield* herdr.workspaces.create({
    cwd: herdr.ids.absolutePath("/repo"),
    label: "api",
    focus: false,
  });

  const pane = yield* herdr.panes.split(created.rootPane.id, {
    direction: "right",
    ratio: 0.4,
  });
  yield* herdr.panes.sendText(pane.id, "pnpm test\n");
  return created.workspace;
});

const workspace = await Effect.runPromise(
  program.pipe(Effect.provide(herdrSdkLayerFromOptions({ session: "work" }))),
);
```

Configuration selection is deterministic:

1. explicit `socketPath` or `session`
2. `HERDR_SOCKET_PATH`
3. `HERDR_SESSION`
4. the platform default socket

Invalid selected input fails; it never silently falls through to a lower-priority
source. `requestTimeout` accepts an Effect `Duration` and controls the local
transport deadline. Operation fields named `timeoutMs` remain server-owned waits.

## Direct service composition

Applications that need one capability can depend on that service directly. The
production service Layer supplies the ambient configuration and shared transport.

```ts
import { Effect } from "effect";
import { WorkspaceService, workspaceServiceLayer } from "@herdr/sdk";

const listWorkspaces = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService;
  return yield* workspaces.list();
}).pipe(Effect.provide(workspaceServiceLayer));
```

Every service also exports a `*LayerWithoutDependencies` variant that keeps its
transport requirement visible for application-level composition and tests.

## Typed failures and interruption

Expected failures remain in each operation's Effect error channel. Server codes
are open strings for forward compatibility, while transport, parsing, protocol,
timeout, and graphics failures use distinct schema-backed tagged errors.

```ts
import { Duration, Effect } from "effect";
import { HerdrSdk } from "@herdr/sdk";

const waitForReviewer = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  return yield* herdr.agents.wait(
    { name: herdr.ids.agentName("reviewer") },
    { until: ["done", "blocked"] },
    { requestTimeout: Duration.minutes(2) },
  );
}).pipe(
  Effect.catchTags({
    HerdrRequestTimeout: (error) => Effect.logWarning(error.message),
    HerdrServerError: (error) => Effect.logWarning(error.serverMessage),
  }),
);
```

Effect interruption owns cancellation. There is no `AbortSignal` API; interrupting
the fiber closes its socket.

## Events

`events.subscribe` returns a cold `Stream`. Each run acquires its own socket and
releases it when the stream completes, fails, or is interrupted. Protocol 21
subscriptions are live-only: the server starts their event sequence when it
accepts the request and does not replay retained lifecycle events.

To initialize a cache without a race, start consuming the subscription first,
buffer its events, obtain `session.snapshot`, install the snapshot, and then
apply the buffered events in order. A snapshot taken before the subscription is
accepted can miss changes that occur between those two operations.

```ts
import { Effect, Stream } from "effect";
import { HerdrSdk } from "@herdr/sdk";

const observe = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const paneId = herdr.ids.pane("workspace-1:pane-1");

  yield* herdr.events
    .subscribe([
      { type: "workspace.created" },
      { type: "pane.agent_status_changed", paneId },
    ] as const)
    .pipe(Stream.runForEach((event) => Effect.log(event.type)));
});
```

Literal subscription specifications narrow the event union returned by the
stream. `events.wait` remains a single Effect with the same match-specific
narrowing.

## Scoped pane graphics

One-shot graphics writes validate a 512-KiB limit. Multi-frame writes use a
scope-owned writer with a 16-MiB inline-frame limit; no manual `close()` is
exposed. Protocol 21 also supports BGRA pixels, named layers with stable
z-indexes, capability discovery, and immutable direct-file frames. Direct-file
writes return Herdr's correlated sequence/revision acknowledgement, while the
writer's background response loop retains asynchronous server failures for the
next operation.

```ts
import { Effect } from "effect";
import { HerdrSdk } from "@herdr/sdk";

const draw = Effect.scoped(
  Effect.gen(function* () {
    const herdr = yield* HerdrSdk;
    const paneId = herdr.ids.pane("workspace-1:pane-1");
    const writer = yield* herdr.panes.graphics.openLayerStream(paneId, {
      layerId: "status-overlay",
      zIndex: 10,
    });

    yield* writer.write({
      format: "rgba",
      imageWidth: 1,
      imageHeight: 1,
      data: Uint8Array.of(255, 0, 0, 255),
    });
  }),
);
```

## Development

This repository uses Vite+ for formatting, linting, typechecking, tests, and
packaging.

```sh
vp install
vp run generate
vp check
vp test
vp run build
```

The bundled schema is `schema/herdr-api.schema.json`. Generation verifies every
request method/result relationship. The binary `pane.graphics.stream` method is
included explicitly because the upstream JSON Schema intentionally omits it.

## Examples

The [`examples/`](examples/) directory contains eleven executable, type-checked workflows. They
range from focused SDK recipes to creative compositions such as a multi-agent idea lab, a
declarative command center, an animated graphics beacon, and an attention-sorted agent rescue view.
