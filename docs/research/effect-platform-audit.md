# Effect Platform and Resource-Lifecycle Audit

## Scope and baseline

This audit covers the Effect-native `src/` implementation, its composition graph, tests, generated
wire boundary, and the Effect `4.0.0-beta.105` source pinned under `repos/effect`. It evaluates
opportunities to replace project-owned infrastructure with Effect or Effect Platform primitives
without changing Herdr's protocol, error, timeout, ordering, or resource-ownership semantics.

The SDK implementation is substantially Effect-native:

- configuration is an Effect `Config` recipe exposed through a contextual service and Layers;
- namespace capabilities are contextual services with dependency-preserving and ready Layers;
- request operations are named Effects with typed expected failures;
- protocol compatibility is memoized once per transport service with `Effect.cached`;
- long-lived sockets and observers are scope-owned with `Effect.acquireRelease`;
- event subscriptions are cold `Stream`s; and
- graphics writers require `Scope.Scope`, with a finalizer-backed escaped-use guard.

The copied [coding standards](../coding-standards.md) are byte-for-byte identical to
`/Users/dmmulroy/Code/personal/overseer/docs/coding-standards.md`. Their Effect service, Layer,
schema, error, and composition guidance was used in this review.

The initial audit changed no production code. The follow-up implementation described below adopted
the approved read-path and lifecycle changes without changing the public SDK contract.

## Executive decision

Do not perform a blanket replacement of `node:net` with `NodeSocket`. The strongest opportunity is
a focused transport prototype that uses Effect Platform's pull-based `NodeStream` adapter for
socket reads, while retaining Herdr's custom bounded line framing and explicit close-on-cancel
write behavior. Evaluate `NodeSocket.makeNet({ path, openTimeout })` in that prototype, but adopt it
only if the implementation preserves the protocol-specific invariants listed below.

| Priority | Decision                           | Candidate                                                                     | Reason                                                                                                                                                                                                    |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Prototype                          | `@effect/platform-node/NodeStream` for response and event reads               | It provides pull-based Node readable integration, scope finalization, and stream-native error mapping, reducing manual listener state and avoiding the current unbounded event queue.                     |
| P1       | Prototype with constraints         | `@effect/platform-node/NodeSocket.makeNet({ path })`                          | It natively supports Unix-domain sockets and scope-owned connection cleanup, but its callback/channel read path is unbounded and its writer does not close the connection when a write is interrupted.    |
| P1       | Retain custom behavior             | bounded newline framing and handshake remainder handoff                       | Effect's NDJSON decoder has no byte limit and accepts an unterminated final line, while Herdr requires a maximum frame size, premature-close failure, and exact remainder bytes for streaming handshakes. |
| P1       | Retain                             | current public `Scope.Scope` ownership for subscriptions and graphics writers | The lifetime model is correct and test-covered; dynamic per-operation sockets should not become application-lifetime Layers.                                                                              |
| P2       | Improve during transport prototype | event read backpressure and incremental buffering                             | `Stream.callback` is unbounded by default and the current repeated `Buffer.concat` can copy the accumulated prefix on every fragment.                                                                     |
| P2       | Add selectively                    | transport span attributes / optional metrics                                  | Existing named spans are good; safe method, phase, result, and duration attributes would improve diagnosis without adding an exporter to the SDK.                                                         |
| P3       | Consider for non-I/O unit tests    | `@effect/vitest` and `TestClock`                                              | Useful for pure deadline/scheduling logic, but not a replacement for the real Unix-socket timeout and finalizer tests.                                                                                    |
| —        | Reject for this protocol           | Pool, automatic retry, PubSub, keyed Cache, scoped transport Layer            | Each conflicts with current one-request-per-socket, independent-subscription, or uncertain-mutation semantics.                                                                                            |

## Implementation outcome

The focused prototype passed and is now the transport implementation:

- one-shot responses, stream handshakes, and event subscriptions read through Effect Platform's
  pull-based `NodeStream` adapter;
- one shared incremental line splitter enforces the one-mebibyte byte ceiling, requires a newline,
  avoids repeated whole-prefix copies, and preserves exact post-handshake remainder chunks;
- ordinary request sockets use `Effect.acquireUseRelease`, while long-lived socket ownership stays
  in the caller's `Scope.Scope` through `Effect.acquireRelease`;
- event decoding is pull-driven and ordered, so a slow consumer applies Node readable backpressure
  instead of filling an unbounded callback queue;
- graphics writes use a one-permit `Semaphore`, keeping each header-plus-payload frame atomic, and
  timeout/interruption closes and permanently invalidates the writer; and
- transport spans now carry the safe low-cardinality `herdr.method`, `herdr.operation`, and
  `herdr.result_type` attributes. Request IDs and metrics were not added because the SDK has no
  opt-in telemetry policy that establishes their cardinality and export behavior.

`NodeSocket` was evaluated and deliberately not adopted. Its unbounded callback queue and writer
cancellation behavior still conflict with event backpressure and close-on-uncertain-frame
requirements. The raw Unix connection and write adapters therefore remain private transport code.

The implementation imports `NodeStream` from the exact
`@effect/platform-node-shared@4.0.0-beta.105` package rather than the aggregate
`@effect/platform-node` package. At verification time, the aggregate package resolved an unrelated
`undici@8` dependency requiring Node 22.19 even though this SDK supports Node 20, and also installed
unused Redis and HTTP dependencies. The narrow package supports Node 18+, occupies approximately
868 KiB installed, and adds only its `ws` and `@types/ws` dependencies. Against the pre-prototype
audit build, `dist/index.mjs` changed from 335.52 kB / 43.32 kB gzip to 336.40 kB / 44.09 kB gzip
(+0.88 kB raw, +0.77 kB gzip).

## Current flow and ownership audit

### Configuration and domain boundaries

`HerdrConfig` already uses a single `Config.all` recipe, explicit-before-ambient precedence, schema
parsing, and dependency-preserving Layers
([source](../../src/herdr-config.ts#L79)). The explicit resolution code is intentional:
malformed selected input must fail rather than fall through to a lower-precedence source. Replacing
it with generic `Config.orElse` fallback would weaken that contract.

Keep the small `node:path` and `node:os` calls. Effect Platform's `Path` is a contextual service,
but `HerdrAbsolutePath` is a pure schema filter
([source](../../src/herdr-domain.ts#L103)); injecting a service into this pure domain rule
would worsen the boundary. The configuration module's platform path construction is already
isolated and deterministic enough that a `Path` Layer would add graph surface without meaningful
lifecycle or testing value.

### Namespace services, schemas, and errors

The namespace services follow the repository standard: each constructor yields `HerdrTransport`,
each dependency-preserving Layer retains that requirement, and each ready Layer provides the
production transport. Their operations parse encoded input before use and decode wire results at
the boundary. There is no platform resource hidden in these modules, so adding `Layer.scoped`,
`Scope`, `Queue`, or platform services to them would be abstraction leakage.

The schema/model and error modules already use Effect `Schema`, branded domain types,
`Option.Option`, and schema-backed tagged errors. No alternate platform package improves those
flows. The generated wire files and generator script are build-time boundaries; native Node file
APIs remain appropriate there.

### Layer composition

The root graph constructs one configuration Layer and one shared transport, supplies that transport
to all namespace Layers, then constructs the aggregate SDK
([source](../../src/herdr-sdk.ts#L156)). This correctly prevents each namespace ready Layer
from creating its own compatibility cache inside the aggregate graph.

Do not convert the transport to `Layer.scoped`. The transport service itself owns no connection;
ordinary requests create one short-lived socket, and subscriptions/graphics streams create dynamic
resources in the caller's scope. An application-lifetime socket Layer would misstate cardinality and
resource ownership.

`Effect.cached` is the correct primitive for the one protocol-compatibility result
([source](../../src/herdr-transport.ts#L265)). `Cache` or `ScopedCache` would add keys,
capacity, and invalidation policies that this single immutable memo does not have.

## Socket and stream findings

### What `NodeSocket` provides

The pinned `NodeSocket.makeNet` accepts Node `NetConnectOpts`, which includes Unix-domain
`{ path }`, plus `openTimeout`. It registers a scope finalizer before connecting and closes or
destroys the connection when the scope ends
([source](../../repos/effect/packages/platform-node-shared/src/NodeSocket.ts#L45)). Its adapted
socket exposes a scoped writer and removes read listeners in a finalizer
([source](../../repos/effect/packages/platform-node-shared/src/NodeSocket.ts#L108)).

Those are real reductions in project-owned lifecycle machinery. They can replace much of
`connectSocket`, `closeSocket`, and observer listener registration
([source](../../src/herdr-transport.ts#L451)).

However, direct adoption currently has four semantic gaps:

1. `Socket.toChannel` feeds incoming `data` events into a default `Queue.make()`
   ([source](../../repos/effect/packages/effect/src/unstable/socket/Socket.ts#L386)). The default
   queue capacity is infinite
   ([source](../../repos/effect/packages/effect/src/Queue.ts#L406)), so this adapter does not apply
   Node readable backpressure to a slow event consumer.
2. handler Effects from `NodeSocket.fromDuplex` run through a `FiberSet`
   ([source](../../repos/effect/packages/platform-node-shared/src/NodeSocket.ts#L119)). Effectful
   per-chunk work can therefore overlap; Herdr framing must keep state mutation synchronous or
   serialize decoded chunks explicitly.
3. the scoped writer's individual write callback has no cancellation finalizer
   ([source](../../repos/effect/packages/platform-node-shared/src/NodeSocket.ts#L203)). The current
   transport deliberately destroys a socket when a backpressured write is interrupted
   ([source](../../src/herdr-transport.ts#L489)), and the graphics timeout test depends on
   that close-on-uncertain-frame behavior.
4. consumers that need the typed socket API and errors cross the `effect/unstable/socket` surface,
   even though the Node package entry point itself is published. This beta API and the added
   `@effect/platform-node` dependency should be isolated behind `HerdrTransport`.

Therefore `NodeSocket` is a prototype candidate, not an automatic replacement. Its use must remain
private to the transport adapter, map `SocketError.reason` into the existing Herdr phase taxonomy,
and explicitly close the owning socket/scope on interrupted or timed-out graphics writes.

### Why `NodeStream` is the stronger read primitive

`NodeStream.fromReadable` and `fromReadableChannel` expose Node readables as pull-based Effect
streams/channels and destroy the readable during scope finalization
([source](../../repos/effect/packages/platform-node-shared/src/NodeStream.ts#L30)). The implementation
uses the Node `readable` event plus `.read()` demand and removes listeners in a scope finalizer
([source](../../repos/effect/packages/platform-node-shared/src/NodeStream.ts#L332)).

That is a better match for event subscriptions than the current `Stream.callback`, which is
documented as unbounded by default
([source](../../repos/effect/packages/effect/src/Stream.ts#L660)). The present callback emits with
`Queue.offerUnsafe`
([source](../../src/event-service.ts#L69)); simply adding a bounded `bufferSize` would not
create backpressure because `offerUnsafe` returns `false` when a non-sliding bounded queue is full
([source](../../repos/effect/packages/effect/src/Queue.ts#L680)). A pull-based Node adapter avoids
choosing between silent event loss and unbounded memory.

Recommended prototype shape:

1. acquire the raw Unix socket in an interruptible scoped Effect;
2. write the request with the existing close-on-interrupt guarantee;
3. expose incoming bytes through `NodeStream.fromReadableChannel`;
4. run a custom channel transformer that enforces the one-megabyte byte limit, requires a newline,
   and returns both the decoded first record and exact post-newline remainder;
5. for `events.subscribe`, continue with the same pull stream and decode bounded event records in
   order; and
6. for `pane.graphics.stream`, retain a scoped serialized writer that destroys the connection on a
   partial/timed-out frame.

This design can use `Effect.acquireRelease`, `Effect.scopedWith`, `Channel`, and `Stream` while
keeping the Herdr-specific protocol state in one transport adapter.

### Why built-in NDJSON is not a drop-in decoder

The pinned `Ndjson.decode` composes text decoding with `Channel.splitLines` and `JSON.parse`, and its
only option is `ignoreEmptyLines`
([source](../../repos/effect/packages/effect/src/unstable/encoding/Ndjson.ts#L154)). It has no maximum
line-byte option. `Channel.splitLines` also flushes a final unterminated fragment when upstream ends
([source](../../repos/effect/packages/effect/src/Channel.ts#L6565)).

That differs from Herdr in three important ways:

- one-shot and streaming handshakes fail if the peer closes before a newline;
- every response/event line has an explicit byte ceiling; and
- the first handshake read must preserve any bytes coalesced after its newline so the event or
  binary graphics phase receives them
  ([source](../../src/herdr-transport.ts#L518)).

The NDJSON encoder may be used for tests or ordinary outbound records, but replacing the production
decoder would require a custom bounded framing stage anyway. A custom `Channel` is clearer than
wrapping the built-in and trying to recover already-buffered protocol state.

## Scope and finalizer audit

The current resource ownership is correct:

- one-shot `exchangeWireLine` removes listeners and destroys the socket on success, failure,
  timeout interruption, and external interruption
  ([source](../../src/herdr-transport.ts#L645));
- long-lived sockets are acquired with `Effect.acquireRelease`, so failed handshakes and closed
  caller scopes destroy them
  ([source](../../src/herdr-transport.ts#L278));
- observer listeners are installed through another scoped `acquireRelease`, and handshake remainder
  bytes are delivered before the socket resumes
  ([source](../../src/herdr-transport.ts#L327));
- graphics writers expose `Scope.Scope` at the API and mark escaped writers closed during
  finalization
  ([source](../../src/pane-service.ts#L363)); and
- a timed-out graphics write interrupts `writeSocketPayload`, whose callback finalizer destroys the
  socket.

Possible cleanup after a successful platform prototype:

- express one-shot ownership with `Effect.acquireUseRelease` if acquisition, use, and release remain
  visible as distinct steps; or
- keep `Effect.acquireRelease` plus a local scope when the read channel needs to outlive handshake
  parsing.

This would improve readability, not fix a current leak. Do not remove the graphics writer's closed
guard: JavaScript callers can escape a value beyond its type-level scope, and the guard turns that
misuse into the existing typed error.

## Other Effect built-ins considered

### Useful, low-risk additions

- **Tracing annotations.** Named namespace and transport Effects already create useful spans. Add
  safe low-cardinality attributes such as operation/method and terminal phase, plus request ID only
  if the telemetry policy treats it as safe. Do not install an exporter or global tracer from this
  library.
- **Metrics behind an opt-in integration.** Effect `Metric` counters/timers could record request
  outcomes, latency, open stream count, and frame-size rejection. Names must be SDK-prefixed and
  must not force an OpenTelemetry dependency. This is secondary to transport correctness.
- **`@effect/vitest` / `TestClock`.** Use for pure timing policy tests if such logic is extracted.
  Keep the existing real Unix-socket tests for kernel backpressure, interruption, and descriptor
  closure.
- **`Deferred`.** If the `NodeSocket` prototype runs its read loop in a scoped fiber, a `Deferred`
  is a suitable private handshake result channel. It should not appear in the public SDK API.

### Correctly not adopted

- **`Pool`.** Herdr ordinary operations use one request and one response per connection, while each
  subscription/graphics stream has dedicated state. Reusing a socket would require a new
  multiplexing protocol.
- **`Schedule` / automatic retry.** A connection or read failure after a write has an uncertain
  outcome. Retrying mutating methods could duplicate effects. Any future retry policy must be
  method-specific, explicitly opt-in, and based on server-supported idempotency—not a transport
  default.
- **`PubSub`.** Each `events.subscribe` call owns its own server subscription and filter set. Shared
  fan-out would change connection, filtering, failure, and cancellation semantics.
- **keyed `Cache` / `ScopedCache`.** There is no keyed expensive lookup with a reusable lifetime.
  `Effect.cached` already exactly models the one compatibility check.
- **`Ref` for the graphics closed flag.** The flag is mutated synchronously only by the scope
  finalizer and read synchronously before a write. A `Ref` would add Effect sequencing without a
  concurrency invariant to protect.
- **Effect `Random` for request UUIDs.** The stable Random service provides numeric randomness but no
  UUID constructor. `node:crypto.randomUUID` remains the clearest standard implementation; if
  deterministic IDs become necessary, introduce a small `RequestIdGenerator` service rather than
  synthesizing UUIDs from numeric random values.
- **Effect Platform `Path` / `FileSystem` in domain schemas.** The path predicate is pure and the SDK
  does not perform production filesystem I/O. Contextual platform services would make schema use
  harder for no resource-lifecycle benefit.
- **ready Layers inside other ready Layers.** The aggregate SDK correctly composes
  dependency-preserving Layers at the root. Providing each namespace's ready Layer would duplicate
  transport construction and compatibility memoization.

## Verification after transport adoption

The public transport and SDK seams now prove all of the following:

1. Unix `{ path }` connection errors map to `HerdrTransportError` with the correct operation and
   `connect` phase.
2. connection, handshake, ordinary request, and graphics-write deadlines preserve the existing
   `HerdrRequestTimeout` contract and close the descriptor.
3. an interrupted ordinary request, event subscription, handshake, and graphics write closes the
   socket exactly once and removes listeners.
4. a response over one mebibyte fails before unbounded accumulation; a peer EOF without newline is
   `premature_close`.
5. handshake and first event/frame bytes coalesced in one kernel read are delivered exactly once and
   in order.
6. split UTF-8 code points and highly fragmented lines decode correctly without quadratic copying.
7. a slow event consumer applies bounded Node read backpressure without dropping or reordering
   events.
8. concurrent graphics writes are serialized as whole header-plus-payload frames, and a timed-out
   partial write permanently closes the writer/socket.
9. protocol compatibility remains one cached check per aggregate SDK Layer, including concurrent
   first requests.
10. package/build checks quantify the added `@effect/platform-node` installation and bundle impact.

The final verification run passed all 40 tests across 12 files. The event-backpressure, fragmented
UTF-8, socket-finalization, graphics-timeout, and concurrent-frame tests also passed in three
consecutive focused runs. `vp check` reported no formatting, lint, or type errors, and `vp run build`
completed successfully for the Node 20 target.

## Implemented sequence

1. Added characterization tests for coalesced handshake remainder, EOF without newline, fragmented
   UTF-8, slow event consumption, concurrent graphics writes, and platform-error translation.
2. Built a private bounded byte-line stream transformer with no public API changes.
3. Replaced event, response, and handshake reads with `NodeStream.fromReadable`; verified
   backpressure, ordering, and cleanup behavior.
4. Evaluated `NodeSocket.makeNet` separately and retained the custom connection and write adapters
   because close-on-cancel behavior is still required.
5. Isolated the platform import and generic socket error mapping inside `herdr-transport.ts`,
   recorded dependency and bundle measurements, and removed only the superseded read listeners and
   callback queue.

The expected outcome is a smaller and more declarative transport boundary, not more Layers or more
Effect types in public namespace APIs.
