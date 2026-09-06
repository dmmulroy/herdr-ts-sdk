# Coding Standards

These standards apply to the Effect-native Node SDK under `src/`, its `.mjs` tooling, and its
fixture-based tests. This repository is one package: `src/index.ts` is the public entrypoint,
`schema/herdr-api.schema.json` owns the wire contract, and generated snake-case types stay inside
wire adapters. Read [architecture](architecture.md) before changing behavior and use
[agent workflow](agent-workflow.md) to find the owning implementation and focused verification.

## Boundary parsing and type evidence

Parse public encoded inputs at the service operation that accepts them. Parse socket frames,
server results, environment values, files, subprocess output, and other external representations at
the adapter that owns them. Inner workflows receive domain or application values rather than raw
wire objects.

Choose the parser from the value's provenance:

| Input evidence                                                                                          | Required handling                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw socket JSON, untyped process output, or another unknown external value                              | Decode from `unknown` at the owning adapter into the strongest meaningful type. Type declarations and generated wire types do not establish runtime integrity. |
| A known encoded representation, such as a declared `*Encoded` input, environment string, or JSON string | Use a typed decoder for that representation and still validate its contents.                                                                                   |
| An already established domain value                                                                     | Pass it through unchanged; preserve its type and avoid repeated parsing.                                                                                       |
| A newly computed constrained value or patched state                                                     | Establish the new invariant with the owning schema constructor or refinement.                                                                                  |

Preserve the precise domain, library, or platform type supplied by its owner. Never widen a known
value to `unknown`, `object`, a primitive, or a generic record for implementation convenience, and
never erase type evidence and assert it back later. Chained `as unknown as T` / `as any as T`,
equivalent widen-then-assert flows, explicit `any`, and non-null assertions are prohibited escape
hatches.

A type assertion is permitted only at the smallest unavoidable platform boundary after independent
runtime evidence has established the invariant. The value must retain its original precise type;
the assertion must not chain through `unknown` or `any`; and a safety comment must identify the
platform limitation, runtime evidence, and focused verification. Redesign any assertion that cannot
meet every condition.

A field brand, `satisfies`, or a static type proves only what established it. It cannot prove a new
range, cross-field relationship, or state transition. Keep the runtime refinement that owns that
fact after representation translation. Do not encode an established domain value to JSON merely to
parse it back into the same type.

For every parsing change, identify the producer, the evidence already established, the remaining
invariants, and the validation removed, retained, or moved. A typed-decoder substitution can improve
type evidence without removing runtime work; report those outcomes separately.

## Parser APIs and public compatibility

Instantiate reusable codecs once near their owning schema. Keep low-level unknown decoders private
to the adapter unless callers genuinely need a public codec boundary. Application-facing parser
functions have a domain name, the actual encoded input type, and a unary signature unless consumers
need another domain input. A private codec may expose library parse options internally; the wrapper
must expose only application-required arguments.

```ts
const decodeConfiguredSession = Schema.decodeEffect(HerdrSessionName);

function parseConfiguredSession(
  input: string,
): Effect.Effect<HerdrSessionName, Schema.SchemaError> {
  return decodeConfiguredSession(input);
}
```

`Schema.decodeEffect` requires the codec's exact `Encoded` type. Known provenance does not make a
broader type assignable to a narrower encoded union: for example, a raw `string` is not a
`Schema.Literals` encoded union. Define a codec whose encoded side truthfully matches the source, or
retain an honest unknown decoder at the external boundary. Never cast or alias the value to force a
typed decoder.

At a raw socket boundary, `unknown` remains truthful and belongs on the private adapter decoder:

```ts
const decodeWorkspaceResponse = Schema.decodeUnknownEffect(Workspace);
```

This is not a blanket ban on decoder factories or `unknown`; provenance determines the correct API.
The parser exports and schema constructors already exposed from `src/index.ts` are established
public encoded-input contracts. Preserve their signatures and behavior unless an explicit public
API migration is authorized. New internal parser cleanup must not silently narrow, remove, or
replace those exports.

## Public SDK and service boundaries

Preserve the existing public constructors, encoded input aliases, service interfaces, and root SDK
exports. Public operations accept the established encoded forms and parse them before protocol
encoding. Generated snake-case request and response types remain private to
`herdr-wire-encoder.ts`, `herdr-wire-parser.ts`, and the transport boundary.

Each protocol namespace owns its interface, `Context.Service` class, constructor, dependency-
preserving Layer, and ready production Layer. Keep requirements visible in
`<capability>LayerWithoutDependencies`; select implementations with `Layer.provide` at the
composition root. The exported `make<Capability>` constructors are intentional public SDK seams,
including constructors that accept established options. Runtime composition normally uses Layers,
but preserving these constructor exports takes precedence over copied rules from other projects.

`HerdrSdk` aggregates the exact configured namespace service values and does not proxy every
operation. Keep nested capabilities such as pane graphics and plugin resources parent-owned unless
they gain an independent dependency or lifecycle.

Represent ordinary internal absence with `Option` where the owning schema does so. Preserve
optional properties and nullish representations in public encoded inputs and on the wire when the
protocol requires them; translate at the service or wire boundary rather than changing the public
contract.

## Wire compatibility and representation precedence

Select a current or compatibility representation from explicit protocol, version, discriminator,
or source evidence before decoding. Once stronger current evidence is selected, malformed current
data fails as `HerdrInvalidResponse`; it must not fall through to a weaker legacy interpretation or
lose the raw correlation evidence needed to diagnose the response.

The SDK does not own Herdr's persistence. If a future SDK cache or migration is introduced, its
owner must preserve atomic updates, receipts, pending or uncertain external effects, tombstones,
and compensation evidence. Generic storage annotations are not runtime validation, and malformed
higher-priority data must not be rescued by lower-priority legacy data.

## Effect workflows, failures, and resources

Use `Effect.gen(function* () { ... })` or a generator-based `Effect.fn` for dependency retrieval,
sequential effects, branching, loops, and named intermediate values. Use `.pipe(...)` for one pure
result transform and cross-cutting policy such as error translation, timeout, tracing, retry, or
Layer provision. Keep effect order and interruption behavior visible.

Expected failures use the narrowest truthful tagged error union. Translate known tags explicitly
when variants need different policy; use `Effect.mapError` when the complete source channel has one
intentional meaning, as in schema-boundary classification. Preserve interruption and distinguish
transport failure, timeout, malformed response, unsupported protocol/result/event, server rejection,
and uncertain graphics writes. Read [error guidance](errors.md) when changing failures, while using
Herdr SDK vocabulary and socket outcomes rather than HTTP or Overseer examples.

Own sockets, event subscriptions, graphics writers, temporary directories, and child processes with
`Scope` and acquisition/finalization. Ordinary requests use scoped acquisition around one socket.
A timed-out or interrupted write invalidates its writer when the remote frame outcome is uncertain.
Adapt unavoidable Node callbacks once at the edge; keep inner workflows Effect-native.

Import stable Effect modules as named namespace exports from the `effect` package root:

```ts
import { Effect, Layer, Option, Schema } from "effect";
```

Use narrow public entrypoints for unstable modules. Confirm APIs against installed declarations;
`repos/effect/` is read-only reference material and may represent a different revision.

## Cohesion and complexity

Use the repository's installed Vite+ lint configuration as the enforcement authority. This SDK has
no documented project-specific numeric complexity ceiling or installed custom anti-slop plugin.
Do not copy thresholds or rule catalogs from another repository.

Reduce complexity by extracting cohesive domain, protocol, lifecycle, or resource responsibilities.
An extraction must preserve precise input, success, error, and Effect requirement types plus effect
and transaction order. A lower branch count, forwarding helper, speculative generic, dispatch
table, option bag, suppression, or new service is not by itself a simpler design. Remove an option,
helper, or export only after checking public entrypoints and external compatibility as well as local
consumers.

Read [slop-prevention proposals](slop-prevention.md) only when proposing parser-API lint, complexity
policy, or unused-export tooling. That document records candidates and evidence requirements, not
current enforcement.

## Testing

Test behavior through `HerdrSdk` or the owning service interface against isolated local socket
fixtures. Replace dependencies with complete, behaviorally faithful service or Layer
implementations that cross the same interface as production. Do not replace project modules with
module mocks or use partial mocks that weaken production behavior. Tests must not use ambient
sessions, personal panes, or a developer socket. Real-Herdr integration remains a separately
selected, disposable-session workflow; examples are not verification.

Add focused tests for application-owned transformations, normalization, compatibility, framing,
resource cleanup, interruption, and previously regressed boundaries. Straightforward schema brands
and structs do not need tests that merely repeat their declarations. Boundary failures should be
tested through their public operation when they produce caller-visible errors.

Parsing and compatibility changes require the applicable evidence:

- valid current and compatibility representations;
- malformed higher-priority data that is not rescued by weaker evidence;
- independent cross-field or computed-invariant regressions;
- the complete public parser function type when its contract changes: input, arity, success, error,
  and Effect requirements; and
- separate evidence for runtime work removed versus decoder/API renaming.

Lifecycle tests preserve uncertain external mutation outcomes and use observable fixture gates
rather than sleeps. A native process restart is stronger recovery evidence than reconstructing an
in-memory service; state that limitation when only reconstruction was tested.

## Comments and JSDoc

Every exported TypeScript or JavaScript symbol has JSDoc at its original declaration. Every public
method and property of an exported class also has JSDoc. State the sharpest caller-visible fact the
signature cannot show: invariants, ownership, resource lifetime, expected typed failures, side
effects, or protocol compatibility. Re-exports rely on the original declaration.

Use durable, searchable Herdr vocabulary in names, comments, and error messages. Keep generated
wire spellings inside adapters and avoid generic names that hide the owning domain.

## Verification

Use [agent workflow](agent-workflow.md#verification-commands) for command selection. For a focused
documentation change, check formatting, local links, and the scoped diff without running live
examples or real-Herdr workflows. Broader verification is evidence only for the stages it actually
runs; report exact commands, outcomes, and checks not run.
