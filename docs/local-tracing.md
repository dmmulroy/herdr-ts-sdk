# Local tracing

Tracing is opt-in development tooling, not a published SDK API. SDK imports create no exporter,
collector connection, or viewer process. Native Effect spans remain available to application-owned
tracers. [Package scripts](../package.json) own command dispatch.

## Run and inspect

Use installed dependencies and a separately installed **otel-desktop-viewer 0.5.0**. These commands
never install anything. In a dedicated terminal:

```sh
node scripts/sdk-trace-viewer.mjs --check
node scripts/sdk-trace-viewer.mjs
```

The launcher binds loopback only, disables automatic browser opening, and owns an ephemeral
in-memory store. Open `http://127.0.0.1:8000` yourself. Ctrl+C stops only its child; it never stops,
clears, or reconfigures another viewer. Choose unused ports when sharing a machine:

```sh
node scripts/sdk-trace-viewer.mjs --http 19418 --grpc 19417 --browser-port 19400 --db-max-size 64MB
```

In another terminal, run a fixture-only experiment or focused test:

```sh
node scripts/sdk-lab.mjs --scenario graphics-writer --trace
node scripts/sdk-verification-cli.mjs test run src/pane-graphics.test.ts --trace
node scripts/sdk-verify.mjs generated --trace
```

For custom ports, set `HERDR_TRACE_ENDPOINT=http://127.0.0.1:19418/v1/traces` and
`HERDR_TRACE_VIEWER_URL=http://127.0.0.1:19400` for those commands. Defaults are the viewer's
standard HTTP collector and UI ports. `HERDR_TRACE=1` also enables tracing at these execution
boundaries, including direct Vitest runs using the test helper. Nothing starts a viewer implicitly.

Copy the **emitted** run/trace IDs into the read-only query commands. CLI trace diagnostics use
stderr; parse stdout alone for command data such as the lab catalog:

```sh
node scripts/sdk-trace-query.mjs list --run RUN_ID --json
node scripts/sdk-trace-query.mjs list --run RUN_ID --failed
node scripts/sdk-trace-query.mjs show TRACE_ID --json
```

Queries use `HERDR_TRACE_VIEWER_URL` or `--endpoint http://127.0.0.1:19400`. `--limit` and `--offset`
bound the displayed page; JSON is the same safe projection, not raw OTLP. Responses default to a
2 MB raw-byte budget. For a large verification trace, explicitly add `--max-response-mb 8`
(accepted range 1–8); output caps remain unchanged. Follow `show` hints for
linked traces, notably the shared compatibility check. `--failed` selects explicit failed or
interrupted execution outcomes: an expected, caught SDK error does not make its test fail.

## Interpret evidence honestly

- `sdk.execution` owns an execution's resources. Product finalizers finish before its root ends;
  exporter shutdown follows. CLI stages and subprocesses propagate the active W3C parent and run
  identity explicitly, without changing Herdr's wire protocol or mutating the parent environment.
- Transport phases distinguish compatibility waiting from the actual shared check, socket I/O,
  response waiting/decoding, and cleanup. Successful compatibility waiters link the shared root;
  failed waiters currently have no link. Socket-close spans measure the existing synchronous
  destroy call, not a later operating-system close notification.
- Graphics spans separate lock acquisition from acknowledgement waiting. Later writer calls link
  their acquisition rather than parenting themselves beneath an already-ended acquisition span.
  Subscriptions emit bounded lifetime counters and closure summaries before their span ends,
  including failure and interruption. There is no per-byte or per-event span flood.
- Product outcome and telemetry delivery are separate. `exported` means HTTP-accepted records,
  **not confirmed viewer ingestion**. `partial` and `unavailable` must not be treated as complete
  evidence. Query the viewer to confirm presence; look for dropped metadata, missing parents,
  cycles, linked work, and truncated pages. Successful work can have partial telemetry.
- Viewer search counts describe **matching spans**, not necessarily the entire trace. Listing
  combines multiple read snapshots, not an atomic database snapshot. This viewer has no server
  pagination: an oversized response fails safely rather than silently claiming a complete graph.
  Unknown or mixed outcomes remain explicit. A successful verification can contain intentionally
  failing nested experiments; inspect its execution root rather than inferring its verdict from
  every descendant. An absent trace is not evidence of success.

## Add a traced test or experiment

Use [runHerdrTest](../src/herdr-test-runtime.ts) at the Vitest boundary with explicit `TestContext`.
For parameterized cases use Vitest `test.for`, whose callback receives `(value, context)`;
`test.each` does not supply that context. Keep pure synchronous assertions pure. Existing
[property/runtime tests](../src/herdr-test-runtime.test.ts) demonstrate concurrent isolation,
interruption, and bounded property-case tracing without skipping actual test executions.
`sdk.execution_index` distinguishes repeated Effect bodies from retry attempts. Stress executions
carry their parsed seed/repetition controls for reproduction, not arbitrary environment values.

For a development Effect program, call `traceSdkExecution(input, effect)` from
[sdk-telemetry.mjs](../scripts/sdk-telemetry.mjs), then restore its returned `tracedExit` at your
existing runtime boundary. It owns the product Scope and exporter lifecycle; do not install a
second provider or force an early flush. The implementation owns configuration, identity, and
budget defaults. Trace-contract tests deliberately use an isolated
[recording collector](../scripts/sdk-telemetry-test-server.ts), not a shared viewer.

## Privacy and limits

The exporter reconstructs the complete outgoing trace/log payload, including native exception
and status fields. Approved keys **and constrained values** survive; arbitrary names, causes,
log bodies, payloads, terminal content, prompts, environment values, paths, and server messages
do not. Names/files become hashed test identities, not anonymous data. Ordinary local logging is
preserved; exported log bodies are redacted and correlated by trace/span identity.

[Metadata policy](../scripts/sdk-telemetry-execution.mjs),
[serialization](../scripts/sdk-telemetry-serialization.mjs), and
[export tests](../scripts/sdk-telemetry.test.ts) own the safety contract; do not duplicate an
operation allowlist in this guide. Span names and finite diagnostic tokens derive from this
checkout's source literals. Keep source files available when using these development tools.

Per-execution span/log budgets, metadata caps, bounded shutdown, per-test property-execution
limits, and bounded viewer storage intentionally limit evidence. The launcher has a maximum
session duration. Process crashes or forced kills cannot guarantee flushing. Do not check in
trace captures or failure artifacts; use isolated local fixtures, never live Herdr controls.
