# Effect 4.0.0-beta.105 scopes and resources for the Herdr SDK

## Scope of this note

This note uses only the vendored Effect 4.0.0-beta.105 repository. Public API declarations and vendored AI guidance are the primary references; implementation and tests are cited where lifecycle details need confirmation.

## The ownership model

A `Scope` is a lifetime boundary. An acquisition that requires `Scope.Scope` does not own its own lifetime: it registers cleanup in the scope supplied by its caller. The code that creates or supplies that scope owns the lifetime and must keep the resource inside it. `Effect.scoped` creates a scope, runs the effect with it, and closes it on success, typed failure, or interruption. Sequential scopes are the default and run finalizers in reverse registration order; explicitly parallel scopes run them concurrently. A finalizer added after a scope has already closed runs immediately with the stored exit. Child scopes close with their parent and detach when closed independently. See `repos/effect/packages/effect/src/Scope.ts:1-31`, `:205-234`, `:302-375`, and `:377-490`.

This yields the central rule for Herdr: **the owner of a socket is the scope whose finalizer closes it**. Returning a socket-backed value beyond that scope is invalid even if TypeScript still permits access to the plain value.

## Effect-level resource APIs

### `Effect.acquireRelease`

`Effect.acquireRelease(acquire, release)` returns a scoped effect. After successful acquisition, it registers `release(resource, scopeExit)` in the current scope; the resource remains live until that scope closes. Acquisition is uninterruptible by default, closing the gap in which a resource could be created but its finalizer not registered. `{ interruptible: true }` restores interruption during acquisition. The release effect has a `never` typed-error channel and may require services; those services are captured from the acquisition context so they remain available when finalization happens later. See `repos/effect/packages/effect/src/Effect.ts:6480-6544` and the implementation at `repos/effect/packages/effect/src/internal/effect.ts:3935-3952`.

Consequences:

- If acquisition fails, no finalizer is registered.
- If default uninterruptible acquisition receives an interruption, interruption is deferred until registration is safe; the scope then closes and releases the acquired resource. The vendored test confirms release on interruption (`repos/effect/packages/effect/test/Effect.test.ts:946-981`).
- If interruptible acquisition is selected and is interrupted before producing a resource, no release callback can run. The acquisition adapter itself must cancel and clean up any partially created external handle.
- Scope finalizers are cleanup, not a suitable typed failure boundary. A graceful close whose failure matters to callers should be an explicit operation; the registered finalizer should still perform a best-effort, non-failing fallback close/destroy.

The vendored resource guide demonstrates the intended Layer use: acquire a transporter inside `Layer.effect`; the Layer's scope keeps it alive and closes it when the Layer is torn down (`repos/effect/ai-docs/src/01_effect/05_resources/10_acquire-release.ts:22-50`).

### `Effect.acquireUseRelease`

`Effect.acquireUseRelease(acquire, use, release)` brackets one complete workflow and requires no ambient `Scope`. Acquisition and release are uninterruptible; `use` runs with the caller's inherited interruptibility restored. Release runs after every exit from `use`, including interruption, but only after successful acquisition. Its `Exit<A, E>` describes the use phase. Unlike `acquireRelease`, release may have a typed error, and a release failure fails the whole bracket even when use succeeded. See `repos/effect/packages/effect/src/Effect.ts:6595-6676` and `repos/effect/packages/effect/src/internal/effect.ts:4165-4180`.

Tests establish two important interruption cases:

- interruption during the protected acquisition can be deferred until acquisition succeeds, after which use may be skipped and release still runs (`repos/effect/packages/effect/test/Effect.test.ts:130-177`);
- interruption of `use` is passed to release and remains the fiber exit (`repos/effect/packages/effect/test/Effect.test.ts:1602-1643`).

Use this API for a one-shot Herdr request whose connection is acquired, used through one response, and closed before the request effect returns. Use `acquireRelease` instead when the acquired writer must be returned and used by later effects in a caller-owned scope.

### `Effect.scoped`, `scopedWith`, and finalizers

`Effect.scoped(effect)` removes the effect's `Scope` requirement and closes the created scope as soon as the whole effect exits. It is appropriate for a complete local workflow, but not around acquisition alone if the returned resource is used afterward (`repos/effect/packages/effect/src/Effect.ts:6390-6429`).

`Effect.scopedWith(f)` creates a scope, passes it explicitly to `f`, and closes it when `f` exits (`repos/effect/packages/effect/src/Effect.ts:6431-6473`). The implementation passes the scope as a value; it does **not** install it as the ambient `Scope` service for arbitrary scoped effects. Use `Scope.addFinalizer(scope, ...)` directly or `Scope.provide(scope)(scopedEffect)` where needed (`repos/effect/packages/effect/src/internal/effect.ts:3926-3933`).

Prefer `acquireRelease` over manually separating acquisition and `Effect.addFinalizer`; the former makes successful acquisition and registration interruption-safe. `Effect.addFinalizer` registers an exit-aware callback on the ambient scope and captures its required services. With an explicit scope value, `Scope.addFinalizer` registers an exit-agnostic effect and `Scope.addFinalizerExit` receives the scope-closing `Exit`; both run immediately if registration happens after closure. Finalizers have no typed error channel, but defects are still reflected while closing the scope, so cleanup should avoid throwing. These lower-level APIs are appropriate for cleanup not naturally represented as an acquired value (`repos/effect/packages/effect/src/Effect.ts:6680-6727`; `repos/effect/packages/effect/src/Scope.ts:302-375`; `repos/effect/packages/effect/src/internal/effect.ts:3775-3853`).

## Effect-level versus Layer-level ownership

| Question                     | Effect-level resource                                                                  | Layer-level resource                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| What owns the lifetime?      | The scope supplied to `acquireRelease`, or the bracket itself for `acquireUseRelease`. | The scope used to build/provide/launch the Layer.                                   |
| What should it model?        | Per-operation, per-subscription, or caller-scoped dynamic handles.                     | Stable services and process/subsystem lifecycle work.                               |
| How is it shared?            | Only when the caller deliberately shares the same enclosing scope/value.               | The same Layer identity is memoized within the active memo-map lineage.             |
| When does cleanup happen?    | At enclosing scope closure, or immediately after `use`.                                | After the last observing build scope closes; failed builds close their child scope. |
| Can the value safely escape? | No, not beyond the owning scope.                                                       | The service may be used only while its built Layer context remains alive.           |

A Layer does not make a dynamic handle intrinsically application-wide; it merely binds acquisition to Layer build lifetime and adds memoization semantics. Conversely, a scoped Effect can construct a stable service, and `Layer.effect` is the adapter that transfers that service's ownership to the Layer build scope.

## Layer-level acquisition and lifecycle

### Effect 4 has no `Layer.scoped`

In v4, old `Layer.scoped`, `Layer.scopedContext`, and `Layer.scopedDiscard` were merged into `Layer.effect`, `Layer.effectContext`, and `Layer.effectDiscard`. These constructors supply the Layer build scope to the input effect and remove `Scope.Scope` from the resulting Layer's requirements (`repos/effect/migration/annotations/effect__Layer.yaml:121-130`; public implementation at `repos/effect/packages/effect/src/Layer.ts:972-1111`). Code for beta.105 should not call `Layer.scoped`.

- `Layer.effect(Service, acquisition)` provides one service. Use it whether acquisition is scoped or unscoped.
- `Layer.effectContext(acquisition)` provides a whole `Context`.
- `Layer.effectDiscard(effect)` performs scoped initialization or starts lifecycle work while providing no service.

For background work, `effectDiscard` must start the task with `Effect.forkScoped`; directly running a non-terminating task would prevent Layer construction from completing. Closing the Layer scope interrupts the scoped fiber. The canonical example is `repos/effect/ai-docs/src/01_effect/05_resources/20_layer-side-effects.ts:9-28`.

### Build scopes

`Layer.build(layer)` is itself scoped: it requires `Scope.Scope`, builds against that scope, and returns a `Context`. `Layer.buildWithScope(layer, scope)` makes ownership explicit. `Effect.provide(program, layer)` creates a scope, builds the Layer in it, runs the entire provided program, then closes the scope; thus Layer resources remain live for the provided program, including interruption cleanup (`repos/effect/packages/effect/src/Layer.ts:667-775`; `repos/effect/packages/effect/src/internal/layer.ts:9-22`). `Layer.launch` is the long-running form: build in a scope, wait forever, and close on interruption (`repos/effect/packages/effect/src/Layer.ts:2163-2209`).

Layer construction uses child scopes. If a build fails, its child scope is closed, so resources acquired earlier in that failed build are not leaked (`repos/effect/packages/effect/src/Layer.ts:302-347`).

### Memoization is identity-based sharing with lifetime tracking

Normal Layer constructors such as `effectContext` use automatic memoization. Reusing the **same Layer value** under one memo map builds it once. Each observing build scope registers a reference-like finalizer; the memoized resource's private scope closes only when its final observer closes. The implementation is in `repos/effect/packages/effect/src/Layer.ts:185-263` and `:394-458`; cross-scope behavior is tested at `repos/effect/packages/effect/test/Layer.test.ts:466-531`.

Important boundaries:

- Sharing is by Layer object identity, not by equivalent code or service tag.
- Separate top-level `Effect.scoped(Layer.build(layer))` calls create new ambient memo maps and rebuild; sharing within one composition still works (`repos/effect/packages/effect/test/Layer.test.ts:51-77`).
- `Effect.provide` shares ambient memoization by default; `{ local: true }` forces a local build (`repos/effect/packages/effect/src/Effect.ts:5790-5879`; test at `repos/effect/packages/effect/test/Effect.test.ts:3425-3447`).
- `Layer.fresh` deliberately opts out and should be reserved for truly independent instances (`repos/effect/packages/effect/src/Layer.ts:2087-2161`).
- `ManagedRuntime` builds once across many imperative runs and releases on `dispose`; it is the appropriate bridge only when the host needs a reusable long-lived runtime (`repos/effect/packages/effect/test/ManagedRuntime.test.ts:5-34`, `:45-68`).

Layer memoization should share stable services such as `HerdrTransport`; it should **not** be used to represent a per-request or per-subscription socket.

## Streams and socket resources

A Stream must keep acquisitions alive for its entire consumption, not merely while constructing the Stream value.

- `Stream.scoped` supplies a scope for a Stream that still requires `Scope` and closes it when stream execution completes (`repos/effect/packages/effect/src/Stream.ts:1638-1668`).
- `Stream.unwrap(effectProducingStream)` accepts a scoped effect and evaluates it in the channel's execution scope, so its resources stay open for the resulting Stream's lifetime (`repos/effect/packages/effect/src/Stream.ts:1607-1635`; underlying behavior at `repos/effect/packages/effect/src/Channel.ts:6759-6820`).
- `Stream.callback` gives callback setup a scoped queue, forks setup in the channel scope, shuts the queue down on closure, and interrupts the setup fiber. This is suitable for event-emitter APIs when listener removal and socket close are registered in that scope (`repos/effect/packages/effect/src/Stream.ts:658-701`; `repos/effect/packages/effect/src/Channel.ts:459-535`).
- Normal stream runners consume within channel-managed execution. `Stream.toPull` is the exception for manual pulling: it returns a pull requiring a caller-owned scope and the pull must not escape it (`repos/effect/packages/effect/src/Stream.ts:10782-10812`).
- `Stream.onExit` and `Stream.ensuring` are useful observers/finalizers, but acquisition should still use scoped acquisition so interruption cannot occur between opening and cleanup registration (`repos/effect/packages/effect/src/Stream.ts:9574-9620` and `:9768-9804`).

For Node resources, the vendored adapter already encodes ownership:

- `NodeSocket.makeNet({ path, ... })` supports Unix-domain connection options and closes/destroys the underlying `node:net` socket when its enclosing socket-run scope closes. It removes event listeners in a finalizer and models the writer as a scoped acquisition whose finalizer ends the writable side (`repos/effect/packages/platform-node-shared/src/NodeSocket.ts:39-90`, `:92-240`).
- `Socket.Socket.writer` explicitly requires `Scope.Scope`; it cannot truthfully be exposed as an unscoped writer (`repos/effect/packages/effect/src/unstable/socket/Socket.ts:45-91`).
- `NodeStream.fromReadable` destroys the readable on stream completion by default and removes listeners in its scope finalizer. Setting `closeOnDone: false` deliberately transfers closure responsibility elsewhere (`repos/effect/packages/platform-node-shared/src/NodeStream.ts:29-66`, `:332-398`).

## Common failure modes

1. **Escaping a scoped resource:** `const writer = yield* Effect.scoped(openWriter)` closes it before the next line can safely use it. Scope the complete use workflow instead.
2. **Scoping Stream construction instead of consumption:** acquiring a socket in an `Effect.scoped` that merely returns a Stream closes the socket before the Stream runs. Use `Stream.unwrap`, `Stream.callback` scoped setup, or `Stream.scoped` around a Scope-requiring Stream.
3. **Manual acquire/finalizer gap:** opening a socket and only later calling `addFinalizer` can leak on interruption. Use `acquireRelease`.
4. **Unclosed manual scope:** `Scope.make` transfers closure responsibility to the caller. Prefer structured `Effect.scoped`; if manual control is necessary, always pair with `Scope.close`.
5. **Wrong `scopedWith` assumption:** its callback receives a scope value but scoped acquisitions need `Scope.provide(scope)` unless they use that value directly.
6. **Layering dynamic sockets:** putting each event subscription or graphics writer in a shared Layer can accidentally memoize and share one connection. Keep dynamic resources in method-returned Effect/Stream values.
7. **Recreating a supposedly shared Layer:** equivalent Layer expressions are not the same memoization key. Construct `herdrTransportLayer` once and reuse that value throughout root composition.
8. **Forcing freshness accidentally:** `Layer.fresh` and `{ local: true }` defeat intended transport sharing and compatibility caching.
9. **Hanging Layer acquisition:** a long-running `Layer.effectDiscard` effect must be forked scoped; otherwise build never finishes.
10. **Unbounded protected acquisition:** `acquireUseRelease` acquisition is uninterruptible. A socket connect used there needs its own finite open timeout; otherwise fiber interruption can remain deferred behind a hung connect.
11. **Cleanup as typed business failure:** `acquireRelease` finalizers cannot fail in the typed channel. Keep an explicit graceful shutdown/write protocol when callers need its result, and register an infallible destroy fallback.
12. **Disabling adapter closure without a new owner:** `NodeStream.fromReadable({ closeOnDone: false })` leaks unless another documented scope closes the stream.

## Concrete Herdr recommendations

### `HerdrTransport`

- Provide one stable `HerdrTransport` service with `Layer.effect`. Let it capture parsed socket path, timeout policy, codecs, request-ID generation, and a memoized compatibility result. Reuse the exact transport Layer value when providing all child Layers; do not use `Layer.fresh`.
- Do not open a permanent socket merely because the service is Layer-managed. Keep ordinary request sockets dynamic. Implement each one-shot request as `acquireUseRelease(openSocket, exchangeOneResponse, closeOrDestroy)` so success, decode failure, timeout, and interruption all release the socket before return; because acquisition is protected, `openSocket` must enforce a finite connection timeout. If connect itself must be immediately interruptible, instead use a cancellable acquisition with `acquireRelease(..., { interruptible: true })` around the complete scoped request workflow and ensure cancellation destroys any partially created socket.
- If transport construction starts a background task, acquire it in the Layer scope or fork it with `forkScoped`; otherwise a configuration-only transport needs no release finalizer.
- Prefer `NodeSocket.makeNet({ path })` when its channel/socket model fits the protocol. If raw `node:net` is retained for precise handshake behavior, wrap connection acquisition immediately in `Effect.acquireRelease` and make the finalizer remove listeners and destroy/end the socket without a typed failure.

### Event subscriptions

- Return a cold `Stream.Stream<Event, EventStreamError>`; each consumption should open one fresh subscription socket. Do not acquire the socket when the service method merely constructs the Stream.
- Use `Stream.unwrap` for the scoped open-and-handshake effect, then a callback/channel stream whose setup registers data/error/end listeners and whose finalizer removes them and destroys the socket. Alternatively, drive `NodeSocket.run` inside `Stream.callback`; its setup fiber and connection then share the Stream execution scope.
- Treat fiber interruption as cancellation, not as `EventStreamError`. Scope closure must interrupt pending reads, remove listeners, shut down the queue, and close the socket. Translate a clean remote end into stream completion and malformed/oversized frames or transport failures into the typed stream error channel.
- Bound buffering deliberately. A callback producer must use a queue strategy consistent with the event-loss contract rather than silently inheriting an unsuitable dropping/sliding policy.

### Pane graphics streams

- Model `openStream` as `Effect.Effect<PaneGraphicsWriter, OpenGraphicsError, Scope.Scope>`. Acquire and complete the handshake with `Effect.acquireRelease`; register an infallible fallback that removes listeners and ends/destroys the socket.
- Keep `PaneGraphicsWriter.write` as an Effect with typed frame/transport/write errors. The writer should close over the scoped socket or scoped `Socket.writer`; it must not expose the raw socket or a manual `close()` as the primary ownership mechanism.
- Require callers to scope the complete sequence: acquire writer, write zero or more validated frames, then leave the scope. If graceful protocol shutdown can fail meaningfully, expose it as an explicit writer operation while retaining scope finalization as the leak-proof fallback.
- Do not make graphics writers Layers and do not memoize them. Every `openStream` invocation owns an independent connection and caller scope.
