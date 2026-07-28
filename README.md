# @herdr/sdk

A Stripe-style TypeScript client for Herdr's local JSON socket API.

- plural resource namespaces such as `herdr.workspaces` and `herdr.panes`
- camel-cased inputs and readonly outputs
- branded IDs and validating ID/path helpers
- typed `HerdrError` failures
- normalized async event streams
- raw-byte pane graphics APIs
- schema-generated private wire types

## Requirements

- Node.js 20 or newer
- Herdr protocol **18**
- a running local Herdr session

The package is ESM-only and does not depend on the Herdr binary package.

## Install

```sh
pnpm add @herdr/sdk
```

## Use

```ts
import Herdr from "@herdr/sdk";

const herdr = new Herdr({ session: "work" });

const created = await herdr.workspaces.create({
  cwd: herdr.ids.absolutePath("/repo"),
  label: "api",
  focus: false,
});

const pane = await herdr.panes.split(created.rootPane.id, {
  direction: "right",
  ratio: 0.4,
});

await herdr.panes.sendText(pane.id, "pnpm test\n");
```

Select the active/default Herdr session with `new Herdr()`, a named session with
`new Herdr({ session: "work" })`, or an exact socket path with
`new Herdr({ socketPath: herdr.ids.absolutePath("/path/to/herdr.sock") })`.
When no selector is supplied, the client honors `HERDR_SOCKET_PATH`, then
`HERDR_SESSION`, then uses the default config-directory socket.

## Errors and cancellation

Server, protocol, validation, timeout, cancellation, and socket failures reject
with `HerdrError`. Server error codes remain open strings for forward
compatibility.

```ts
import Herdr, { HerdrError } from "@herdr/sdk";

const herdr = new Herdr();
const controller = new AbortController();

try {
  await herdr.agents.wait(
    { name: herdr.ids.agentName("reviewer") },
    { until: ["done", "blocked"] },
    { signal: controller.signal, requestTimeoutMs: 120_000 },
  );
} catch (error) {
  if (error instanceof HerdrError) console.error(error.code, error.requestId);
}
```

`requestTimeoutMs` is a local transport deadline. Operation fields named
`timeoutMs` are server-owned waits. Mutations are never retried automatically.

## Events

```ts
const stream = await herdr.events.subscribe([
  { type: "workspace.created" },
  { type: "pane.agent_status_changed", paneId },
] as const);

for await (const event of stream) {
  console.log(event.type);
}
```

Lifecycle and specialized wire envelopes are normalized to the same dot-named
`type` discriminant. Call `stream.close()` to cancel locally.

## Development

This repository uses Vite+ for project creation, package management, formatting,
linting, typechecking, tests, task execution, and packaging.

```sh
vp install
vp run generate  # regenerate private wire types from the bundled JSON Schema
vp check
vp test
vp run build
```

The bundled schema is `schema/herdr-api.schema.json`. Generation verifies that
every schema request method has a correlated result discriminant; the binary
`pane.graphics.stream` method is included explicitly because the upstream JSON
Schema intentionally skips it.
