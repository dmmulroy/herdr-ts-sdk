# Herdr SDK architecture

`@herdr/sdk` v1 is an Effect-native client for the local Herdr protocol-21 socket API. The
Effect implementation under `src/` is the only supported package architecture; there is no Promise
client or cancellation compatibility facade.

## Public composition root

`HerdrSdk` is a yieldable Effect service and namespace aggregator. It exposes the exact configured
namespace service values and does not proxy their operations. `herdrSdkLayer` builds one shared
configuration and transport instance, while `herdrSdkLayerWithoutDependencies` keeps requirements
visible for application composition.

Each protocol-facing namespace owns an independent Effect service with its interface, contextual
service class, constructor, dependency-preserving Layer, and ready production Layer. Nested
capabilities such as pane graphics and plugin resources remain parent-owned values because they do
not have independent dependencies or lifecycles.

## Domain and protocol boundaries

Effect Schema owns public identifiers, resources, inputs, events, constrained numbers, durations,
timestamps, and discriminated unions. Public encoded inputs are parsed at service boundaries before
inner workflows use them. Generated snake-case contracts remain private to the wire adapter.
[`herdr-wire-encoder.ts`](../src/herdr-wire-encoder.ts) owns method-indexed request encoding,
including recursive domain inputs while preserving opaque record keys. The transport delegates
encoding to it; response parsing belongs to [`herdr-wire-parser.ts`](../src/herdr-wire-parser.ts).

Expected failures use granular schema-backed tagged errors. Operation interfaces expose the
narrowest truthful error channel, while malformed external representations are translated at the
transport or service boundary.

## Transport and resources

`HerdrTransport` is the single deep adapter for Unix-socket or Windows named-pipe acquisition, request encoding,
correlation, bounded newline framing, response parsing, compatibility memoization, deadlines,
stream handshakes, and interruption-safe cleanup. Lifecycle subscriptions are live-only from server
acceptance; cache consumers bootstrap by buffering an accepted subscription across a session snapshot.

Ordinary requests own one socket through `Effect.acquireUseRelease`. Event subscriptions and pane
graphics streams acquire sockets in the caller's `Scope.Scope`. Event reads are pull-based and
backpressured. Graphics writes are serialized as complete frames, and a timed-out or interrupted
write closes and invalidates its writer because the remote frame outcome is uncertain.

## Observability

Service and transport boundaries emit native Effect spans without installing an exporter.
Opt-in [development tracing](local-tracing.md) supplies a scoped exporter at CLI/test execution
roots, closes product resources before export, and propagates subprocess parents explicitly.
The full outgoing payload is sanitized; telemetry delivery never replaces the product outcome.
Shared compatibility checks are independent roots linked by successful waiters. Stream summaries
belong to the resource lifetime, not merely the acquisition call.

## Verification

The public entrypoint is `src/index.ts`. Runtime tests cross `HerdrSdk` or service interfaces against
real local socket servers. Compile-time `.tst.ts` files verify public inference and Layer
requirements. The operation and cross-cutting coverage inventory is recorded in
[`sdk-v1-parity.md`](sdk-v1-parity.md). Dispatch coverage proves routing and representative
successes, not exhaustive lifecycle confidence. Framing, interruption, deadlines, stream acceptance,
and cleanup require the named focused suites and deterministic local fixture synchronization.
Normal tests must never connect to live Herdr control or select a developer's ambient session.
The opt-in [real-Herdr evidence workflow](local-evidence.md) is a separate integration boundary:
it launches a private disposable session and uses only that session's explicitly owned socket.

For task-to-owner navigation, executable learning routes, safe verification, and the subagent
handoff contract, load [`agent-workflow.md`](agent-workflow.md). The canonical agent entrypoint is
[`AGENTS.md`](../AGENTS.md); dependency versions and command definitions remain in
[`package.json`](../package.json), rather than duplicated here.
