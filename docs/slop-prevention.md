# Slop-prevention proposals

Use this document only when evaluating parser-API lint, complexity policy, or unused-export tooling.
These are proposals, not installed rules. [Coding standards](coding-standards.md) owns current
engineering policy; `vite.config.ts` and installed Vite+ plugin entrypoints own actual enforcement.

## Narrow parser API candidate

A possible `no-exported-schema-decoder-factory` rule would identify directly exported
Schema-generated decoders, including export-list aliases, when they unintentionally expose
`ParseOptions` as application API. It must resolve Effect import aliases and exported bindings,
avoid unrelated same-name functions, and accept private-codec/unary-wrapper pairs.

The rule cannot infer the correct decoder from syntax alone. `Schema.decodeEffect` requires the
codec's exact `Encoded` type; a value being "known" does not make a broader `string` assignable to a
literal encoded union. Preserve an honest unknown decoder at the owning external boundary when its
source type is not assignable, or define a schema whose encoded type truthfully matches the source.
Never cast or alias a value merely to force typed decoding.

The SDK's existing exported parsers, constructors, and encoded-input aliases are public compatibility
contracts. A lint proposal must fixture those exports and must not turn adoption into an implicit API
migration. Acceptance requires tests for direct exports, renamed imports, export-list aliases,
unrelated factories, public low-level codecs, and existing SDK entrypoint compatibility.

## Native unnecessary-condition pilot

Evaluate the locally pinned native rule before proposing configuration. Review each diagnostic
against its producer: external declarations and generated wire types do not establish runtime
integrity. Intentional constant loops need explicit accommodation. The pilot detects statically
impossible conditions; it does not prove that repeated parsing, duplicate reads, compatibility
fallback, cross-field validation, or transaction order is correct.

Acceptance requires an honest correction or documented limitation for every diagnostic, plus
fixtures showing that required socket, process, configuration, and protocol validation remains.

## Complexity changes

Use diagnostics from this repository's installed configuration rather than importing another
project's threshold. Evaluate changes by cohesive responsibility and preserved input, error,
requirement, interruption, and resource-lifetime types. Branch-count reduction, forwarding helpers,
dispatch tables, suppressions, speculative generics, and option bags are not acceptance evidence.

Acceptance requires the focused behavior and type tests to continue crossing the public SDK or
service interface, with effect order and uncertain mutation outcomes unchanged.

## Unused-export audit

An SDK export can be externally consumed even when this checkout has no import. Any audit must
account for `src/index.ts`, package entrypoints, re-exports, dynamic and type-only users, tests, and
published compatibility. Prefer existing workspace-aware tooling before creating a custom analyzer.

Acceptance requires consumer evidence for every proposed removal and explicit authorization for any
public API change.

## Enforcement limits

JavaScript Oxlint plugins can use syntax and scope evidence supplied by the pinned plugin API; root
typechecking does not by itself grant them TypeScript inferred-type information. Verify the local
API before claiming a plugin limitation or capability. Keep syntax rules conservative and
alias-aware.

Repeated validation, additional refinements, duplicate reads, compatibility precedence, and
resource ordering are semantic data-flow concerns. Review and observable tests own them; a clean AST
rule result does not.
