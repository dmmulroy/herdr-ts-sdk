# Working on @herdr/sdk

## Start here

- Read [architecture](docs/architecture.md) before changing behavior.
- Use [package.json](package.json) for runtime/dependency versions and command definitions;
  [schema](schema/herdr-api.schema.json) owns the wire contract.
- Load [agent workflow](docs/agent-workflow.md) for the task-to-file/test map, learning routes,
  verification choices, and subagent task/handoff contract.
- [README](README.md) owns the public API guide; [parity ledger](docs/sdk-v1-parity.md) maps
  dispatch coverage. Neither replaces focused lifecycle/failure tests.

## Local rules

This is one Effect-native Node SDK. Apply the parsing, type-evidence, Effect imports/workflows,
typed errors, service/Layer, resource ownership, testing, naming, and JSDoc rules in
[coding standards](docs/coding-standards.md). Preserve established public encoded inputs and SDK
constructor exports; do not turn a focused change into an API migration. Read
[error guidance](docs/errors.md) when changing failures.

- Parse public inputs at service boundaries; keep generated snake-case types inside wire adapters.
- Keep narrow truthful Effect error/requirement channels and Scope-owned resource cleanup.
- Use idiomatic Effect for new production code, harnesses, tests, and `.mjs` tooling wherever
  possible: `Effect.gen`, scoped acquisition/finalization, and Effect concurrency primitives.
  Adapt unavoidable Node callbacks once at the edge; run Effects at CLI/Vitest boundaries.
  Do not retain parallel legacy Promise workflows or compatibility wrappers.
  Pure synchronous calculations should remain pure.
- Search existing owners before adding helpers; use domain-searchable names and attached JSDoc.
- Import installed packages, never vendored source. [repos/effect](repos/effect/) is read-only:
  inspect its own guidance and matching source/tests before guessing an Effect API. Installed
  exports/declarations are authoritative when vendored examples target a different API revision.
- Normal tests use isolated local fixtures through public SDK/service interfaces, never ambient
  sessions, personal panes, or a developer's socket. The explicitly selected real-Herdr evidence
  workflow may launch its own disposable session with private configuration and an exact owned
  socket. Real-Herdr integration tests remain opt-in; they must never attach to an existing session.
- For opt-in fixture/test/verification traces, follow [local tracing](docs/local-tracing.md).
  Keep product outcome separate from export acknowledgement and viewer ingestion; never assume
  missing or truncated spans prove success. Do not start or clear a shared viewer implicitly.
- For reviewable fixture or isolated real-Herdr demonstrations, follow [local evidence](docs/local-evidence.md).
  Keep checks, telemetry delivery, viewer observation, recording, rendering, and cleanup separate.
  Label fixture presentations separately from recordings of actual SDK-driven Herdr UI changes.
  Evidence is opt-in and stored outside the checkout; recordings include input as well as output.
  Use only owned disposable sessions and review artifacts before sharing; never upload automatically.
- Do not run live examples as verification. Consult [example safety notes](examples/README.md).
- Do not install dependencies, rewrite generated files, format/fix the whole repository, commit,
  or modify unrelated work unless the task explicitly authorizes it.

## Before handing off

Run focused tests with `./node_modules/.bin/vitest run <test-file>` from the repository root.
Use `pnpm run doctor`, `pnpm run verify:quick`, and `pnpm run verify` as described in the workflow.
For strict no-bootstrap checks, bypass managed package-manager launchers with
`node scripts/sdk-doctor.mjs` / `node scripts/sdk-verify.mjs quick` (or `full` / `generated`).
Use the workflow's verification guidance before broader checks. `check` checks by default;
`generate`, `build`, and formatting without `--check` write files. Inspect your scoped diff and report exact commands and outcomes,
remaining uncertainty, and any tooling/context friction. Keep execution notes in the handoff,
not tracked session artifacts or a permanent known-bugs ledger.
