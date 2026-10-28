# Herdr SDK architecture

`herdr-sdk` targets Herdr 0.9.5 / protocol 22, with Effect-native API-socket and client-shell endpoint clients. The
Effect implementation under `src/` is the only supported package architecture; there is no Promise
client or cancellation compatibility facade.

## Public composition root

`HerdrSdk` is a yieldable Effect service and namespace aggregator. It exposes the exact configured
namespace service values and does not proxy their operations. `herdrSdkLayer` builds one shared
configuration and transport instance, while `herdrSdkLayerWithoutDependencies` keeps requirements
visible for application composition.

Each protocol-facing namespace owns an independent Effect service with its interface, contextual
service class, constructor, dependency-preserving Layer, and ready production Layer. Nested
capabilities such as pane interaction, SSH agent registration, and plugin resources remain parent-owned values because they do
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

`HerdrTransport` owns the ordinary API's Unix-socket or Windows named-pipe acquisition, request encoding,
correlation, bounded newline framing, response parsing, compatibility memoization, deadlines,
stream handshakes, and interruption-safe cleanup. Lifecycle subscriptions are live-only from server
acceptance; cache consumers bootstrap by buffering an accepted subscription across a session snapshot.

Ordinary requests own one socket through `Effect.acquireUseRelease`. Event subscriptions and SSH
agent registrations (`HerdrStreamWireMethod`) use scoped acquisition: their socket stays open after
the accepted response. Event consumption and callback-owned registrations hide ordinary Scope
management; explicit `registerScoped` acquisition remains available for advanced composition. Event
reads are pull-based and backpressured. A subscription that falls behind receives one correlated
`events_lost` error line and fails with `HerdrEventsLost`; the SDK never resumes it implicitly.
An SSH agent registration lasts exactly as long as its connection; a scoped watcher records a
server-side close, and the callback form interrupts its callback when that happens.

Herdr removed the `pane.graphics.*` socket API in 0.9.2. The SDK has no image transport: pane
applications emit standard Kitty graphics on their own terminal output.

### Client-shell endpoint ownership

[`client-shell-service.ts`](../src/client-shell-service.ts) owns lazy `withConnection`, advanced
`connectScoped`, and cold connection-owning `projections`. Its binary socket is separate from the
ordinary API socket; constructing the SDK opens neither. The configured API gate requires protocol
22, while the endpoint independently negotiates generation 1 and concrete snapshot/surface/input/blob codecs.

[`herdr-endpoint-transport.ts`](../src/herdr-endpoint-transport.ts) owns scoped acquisition, serialized
bounded writes, boot-bound request correlation, response chunk assembly, and terminal failure cleanup.
[`herdr-endpoint-codecs.ts`](../src/herdr-endpoint-codecs.ts) owns the generation-1 bincode field order;
it does not reuse newline framing. [`herdr-client-shell-state.ts`](../src/herdr-client-shell-state.ts)
owns exact-base patch validation and retained graphics assets for complete, coalesced scenes.

A surface-interest acknowledgement establishes a projection floor, not presentation delivery. The
service publishes active state only after a complete matching surface is available. Whole projections
and surfaces coalesce; required response chunks never drop. Slow presentation-event consumers fail
at a bounded backlog rather than blocking health/correlation. The endpoint never opens server-supplied
graphics file paths and does not negotiate direct graphics. Lost or ambiguous mutations are not retried.

The 0.9.5 server always sends an `endpoint.agent-completions.v1` companion before each snapshot. The
service attaches it to `ClientShellAgent.completionSeq` only when its boot ID and revision match that
snapshot, and ignores malformed companions. The `endpoint.agent-view.v1` companion precedes every
snapshot while a view is active (and once with a null view when cleared); like upstream, it binds to
`ClientShellProjection.agentView` per snapshot by boot and revision, so a snapshot without a match has no view.
A companion arriving after its matching snapshot attaches to it (first match wins); stale snapshots and
older companions never discard a newer pending one. As upstream, an equal-revision snapshot replaces the
projection and keeps companions already attached to that revision unless a matching pending one arrived. `agentView` is SDK-derived and absent from the wire payload.
A malformed envelope is ignored; a view that fails `AgentViewSetInput` decoding becomes `unrecognized`
without failing the connection. The SDK checks view structure only, not Herdr's server-side view limits.
`setHostTheme` writes the `ClientShellHostTheme` message (tag 17), never a pane-input event.
The SDK does not request the optional `surface_reuse`, `surface_delta`, or `surface_scroll` encodings.

### Public-input ergonomics

Workspace creation separates default, explicit-directory, and source-workspace intent into named
methods sharing private dispatch. Command invocation similarly separates current/workspace/tab/pane
context; selection belongs only to the pane method. Both remove ambiguous cross-field combinations
without requiring caller-authored `_tag` values. The SSH agent callback form reuses its scoped
acquisition rather than a second lease implementation.

The baseline audit retains composable domain unions for pane destinations/swaps, layout targets,
agent targets, plugin placements, filters, and events: these are data values used in
scripted/declarative composition, not scope-owning operations. Existing exclusive-selector refinements
remain authoritative. No deprecated workspace input alias or alternate legacy creation parser remains.

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

For task-to-owner navigation, executable learning routes, safe verification, and the subagent
handoff contract, load [`agent-workflow.md`](agent-workflow.md). The canonical agent entrypoint is
[`AGENTS.md`](../AGENTS.md); dependency versions and command definitions remain in
[`package.json`](../package.json), rather than duplicated here.
