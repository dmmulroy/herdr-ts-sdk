# Agent workflow

Read [AGENTS.md](../AGENTS.md) first. This guide is loaded on demand, not a second API catalog.
Versions and available commands belong to [package.json](../package.json); operation coverage
belongs to the [parity ledger](sdk-v1-parity.md).

## Find the owner and its verification

Paths below are relative to this document. Start with the smallest row that matches the change,
then follow its imports and callers. Normal runtime tests exercise local fixtures, not live Herdr;
real-Herdr evidence integration is separately opt-in and owns a fresh disposable session.

| Task                                                 | Implementation / contract                                                                                                        | Focused verification                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Public entrypoint, root composition                  | [index](../src/index.ts), [SDK](../src/herdr-sdk.ts)                                                                             | [SDK runtime](../src/herdr-sdk.test.ts), [SDK inference](../src/herdr-sdk.tst.ts), [Layer requirements](../src/herdr-layers.tst.ts) |
| Config selection, deadlines, platform paths          | [config](../src/herdr-config.ts)                                                                                                 | [config tests](../src/herdr-config.test.ts)                                                                                         |
| Public input/domain invariants                       | [domain](../src/herdr-domain.ts), [models](../src/herdr-models.ts), [schema boundary](../src/herdr-schema-boundary.ts)           | [input boundaries](../src/herdr-input-boundaries.test.ts), [domain behavior](../src/herdr-domain.test.ts)                           |
| Wire parameters, opaque records, recursive inputs    | [encoder](../src/herdr-wire-encoder.ts), [schema](../schema/herdr-api.schema.json)                                               | [encoder runtime](../src/herdr-wire-encoder.test.ts), [encoder inference](../src/herdr-wire-encoder.tst.ts)                         |
| Correlation, framing, compatibility, cleanup         | [transport](../src/herdr-transport.ts), [socket lines](../src/herdr-socket-lines.ts), [wire parser](../src/herdr-wire-parser.ts) | [transport tests](../src/herdr-transport.test.ts)                                                                                   |
| Live event acceptance, narrowing, bootstrap          | [event service](../src/event-service.ts)                                                                                         | [event tests](../src/event-service.test.ts), [SDK inference](../src/herdr-sdk.tst.ts)                                               |
| Graphics writes, acknowledgements, scope             | [pane service](../src/pane-service.ts), [transport](../src/herdr-transport.ts)                                                   | [graphics tests](../src/pane-graphics.test.ts)                                                                                      |
| Namespace dispatch / result variants                 | Service owner in [parity ledger](sdk-v1-parity.md)                                                                               | [dispatch tests](../src/herdr-full-parity.test.ts), plus the ledger's focused suite                                                 |
| Typed failures / safe diagnostics                    | [errors](../src/herdr-errors.ts), [error policy](errors.md)                                                                      | [error tests](../src/herdr-errors.test.ts), owning boundary suite                                                                   |
| Fixture synchronization / bounded metadata timelines | [test server](../src/herdr-test-server.ts), [wire fixtures](../src/herdr-wire-fixtures.ts)                                       | [fixture tests](../src/herdr-test-server.test.ts), plus consumers of the changed behavior                                           |
| Platform paths / repeated lifecycle schedules        | [config](../src/herdr-config.ts), [transport](../src/herdr-transport.ts)                                                         | [platform tests](../src/herdr-platform.test.ts), [stress tests](../src/herdr-stress.test.ts)                                        |
| Generation, packaging, executable docs               | [generator](../scripts/generate-wire-types.mjs), [package](../package.json), [examples](../examples/README.md)                   | [tooling tests](../scripts/sdk-tooling.test.ts)                                                                                     |

For telemetry changes, start with [local tracing](local-tracing.md):
[execution/export](../scripts/sdk-telemetry.mjs), [test boundary](../src/herdr-test-runtime.ts),
[query CLI](../scripts/sdk-trace-query.mjs), and their adjacent tests. Exported transport and stream
contracts live in [transport tracing tests](../src/herdr-transport-tracing.test.ts) and
[stream tracing tests](../src/herdr-stream-tracing.test.ts), alongside the ordinary behavior suites.

## Learning through executable behavior

Do not copy an Effect API cookbook into this repository. Trace one existing test through the
public service, its dependency-preserving Layer, and the local socket boundary. Run that test,
change one assertion or fixture input deliberately, observe the failure, and restore or turn the
experiment into a justified regression test. Keep temporary experiments out of tracked files.

The [learning tests](../src/herdr-learning.test.ts) own assertion-bearing recipes and hypothesis
comments. The [lab runner](../scripts/sdk-lab.mjs) derives its catalog from those declarations;
it accepts only a listed scenario, uses local fixtures, bounds execution, and cleans temporary output.
Run `pnpm run lab --list`, then `pnpm run lab --scenario <exact-id>`.
It is not an arbitrary code, shell, or live-socket runner.

Other useful routes (commands run from the repository root):

- Composition: `./node_modules/.bin/vitest run src/herdr-sdk.test.ts`; inspect the adjacent
  `.tst.ts` files for requirements and inference, which runtime Vitest does not check.
- Boundary parsing to wire encoding: `./node_modules/.bin/vitest run src/herdr-input-boundaries.test.ts src/herdr-wire-encoder.test.ts`.
- Resource lifetimes: `./node_modules/.bin/vitest run src/event-service.test.ts src/pane-graphics.test.ts`.
- Exact upstream Effect behavior: find the installed version in the package manifest, then read
  matching [vendored source](../repos/effect/) and its local guidance; never import or edit it.
  Confirm exports/signatures against the installed package when reference revisions disagree.
- Trace-driven experiments: follow [local tracing](local-tracing.md) to run a lab with `--trace`,
  query its emitted run ID, and inspect phase timing, outcome, cleanup, and linked shared work.

The [examples catalog](../examples/README.md) is for explicitly authorized application use.
Examples may send terminal input, launch agents, or change live state; they are not test fixtures.

## Verification commands

Run from the repository root with installed dependencies. These checks do not rewrite tracked
source/generated files or contact live Herdr. Temporary build/fixture output is scope-owned.
A globally managed `pnpm` launcher may bootstrap dependencies before running a package script.
For strict no-bootstrap verification, bypass that launcher: `node scripts/sdk-doctor.mjs` or
`node scripts/sdk-verify.mjs quick` (also accepts `full` or `generated`).

| Command                    | Evidence and limits                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run doctor`          | Reports runtime/tool/dependency/vendor/protocol alignment and an isolated socket bind/close probe; no installs, repairs, or independent upstream commit verification.                            |
| `pnpm run verify:quick`    | Format check, lint, types (including `.tst.ts` and tooling JS), public JSDoc, and example compilation; no runtime, generation drift, or package check. `pnpm run check` is the same quick route. |
| `pnpm run verify`          | Quick stages plus generated drift, runtime suites, and isolated package verification.                                                                                                            |
| `pnpm run test:runtime`    | Runtime Vitest suites, including tooling tests; not a substitute for typechecking.                                                                                                               |
| `pnpm run check:generated` | Regenerates into a temporary directory and compares with tracked wire files; reports drift without rewriting them.                                                                               |
| `pnpm run check:package`   | Builds/packs an offline temporary consumer and checks runtime imports/declarations using the installed dependency graph; does not prove registry dependency resolution.                          |
| `pnpm run test:platform`   | Host platform fixture coverage; a pass on one OS does not prove other operating systems.                                                                                                         |
| `pnpm run test:stress`     | Seeded repeated local lifecycle scenarios; reproduction controls live in [stress tests](../src/herdr-stress.test.ts), not a second defaults inventory.                                           |
| `pnpm run lab --list`      | Lists executable learning recipes; use `--scenario <exact-id>` for one bounded experiment.                                                                                                       |

Full verification is broader than a focused pass, not exhaustive scheduler or platform proof.
[Verification runner](../scripts/sdk-verification-runner.mjs) owns stage selection and deadlines;
[package scripts](../package.json) own command dispatch. Add `--trace` to a lab, runtime test
command, or verification run for opt-in local export. `pnpm run trace:viewer --check` checks the
separately installed viewer; `pnpm run trace:list` and `pnpm run trace:show -- <trace-id>` query it.
See [local tracing](local-tracing.md) for configuration, safety, and evidence limits.

## Verification discipline

1. Inspect `git status --short` and establish file ownership before editing a shared checkout.
2. Run the relevant runtime file with `./node_modules/.bin/vitest run <test-file>`.
3. Check compile-time `.tst.ts` contracts with the repository typecheck, not Vitest alone.
4. Select broader commands from [package.json](../package.json) after inspecting what they run.
   `check` is the non-mutating quick route. `generate` rewrites private wire files; `build`
   regenerates before packaging. Direct Vite+ formatting without `--check` and fixing with `--fix`
   write files. Do not use writing commands as verification in a shared checkout.
5. For guide edits, run `./node_modules/.bin/vitest run scripts/agent-context.test.ts`:
   [context tests](../scripts/agent-context.test.ts) check local inline links and documented package
   script names in the entrypoint/workflow guides, not historical research or arbitrary Markdown.
6. Inspect the scoped diff and report evidence separately from untested confidence. A dispatch
   pass is not proof of teardown, interruption, resource bounds, platform support, or packaging.

Use explicit local socket paths and bounded fixture waits. Synchronize tests on observed requests,
acceptance, writes, or close events rather than sleep-based timing guesses. Failure diagnostics
must be bounded metadata, never request/response bodies, terminal text, environment values, or
absolute paths. Do not add production logging just to debug a fixture.

## Evidence for review and handoff

Use [local evidence](local-evidence.md) when a change needs an explanatory demonstration or
trace-linked review. `pnpm run evidence --help` describes production and inspection commands;
the [evidence CLI](../scripts/sdk-evidence.mjs) is the no-bootstrap entrypoint.
Keep generated bundles outside the checkout and preserve their independent outcome fields.
`run herdr-sdk-workflow --record` explicitly launches a fresh isolated Herdr session and records
actual SDK-driven UI changes. Fixture recipes remain separately labeled; their post-run result
pages do not establish live UI behavior. Neither mode proves more than its named checks and
recorded observations.

The [live runner](../scripts/sdk-live-evidence-runner.mjs) composes the
[owned sandbox](../scripts/sdk-herdr-sandbox.mjs), [SDK workflow](../src/herdr-live-evidence.ts),
[subprocess bridge](../scripts/sdk-live-evidence.mjs), and
[terminal recorder](../scripts/sdk-terminal-control.mjs). Never add an ambient socket/session
fallback or use an existing personal session for integration verification.

In a handoff, provide the bundle directory and the specific check or chapter to inspect, along
with limitations and the reproduction command. Do not replace test results with a video, or
assume another agent can reach a localhost viewer. Portable snapshots remain evidence of their
recorded source revision/fingerprint; rerunning newer code creates new evidence.

## Subagent task contract

Send a small task that contains all of the following (inline in the agent prompt):

- **Goal and acceptance:** caller-observable behavior, smallest proving test, and non-goals.
- **Base and checkout:** comparison commit, shared checkout or isolated worktree, current branch.
- **Ownership:** exact writable paths; everything else is read-only unless reassigned.
- **Interfaces:** existing public seam to use, needed peer API and its owner, integration order.
- **Safety:** fixture-only tests, vendor read-only, no live control, installs, commits, broad fixes,
  generated rewrites, or tracked execution artifacts unless explicitly authorized.
- **Verification:** focused command first, broader checks owned by the coordinator if concurrent.
- **Delivery:** changes in the assigned checkout and the concise handoff below, not a report file.

Raise API needs and ownership conflicts before editing another agent's files. Address a peer only
by a confirmed name/target; otherwise ask the coordinator. Do not infer an agent identity from a
role. Peer edits are concurrent work, not changes to revert. The coordinator owns integration,
shared command definitions, cross-agent compatibility, and final verification.

## Subagent handoff contract

Return these facts in the terminal, keeping evidence reproducible:

- **Changed:** exact paths and behavior; any interface needed by peers.
- **Verified:** exact commands, outcome, and scope (runtime, type, package, platform, stress).
- **Uncertain/blocked:** failures with concrete evidence, tests not run, platform assumptions,
  remaining integration work, and whether a failure was observed before the change.
- **Friction:** one or two concrete navigation/tooling problems and the smallest useful fix;
  say none if there were none. Do not propose a framework or create a new inventory by default.

A passing focused suite is a scoped claim, not permission to label the whole initiative complete.
