# Latest Herdr CLI ↔ TypeScript SDK gap audit

> Historical audit snapshot: the protocol-21 gaps identified here were implemented in the SDK
> after this report was written. Use `docs/sdk-v1-parity.md` for the current coverage ledger.

**Audit date:** 2026-08-30

**SDK under audit:** dirty working tree at `3d0b322edeac787432b87d5cb850d441f83e5194`

**Latest released Herdr:** `v0.8.2` at [`9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`](https://github.com/ogulcancelik/herdr/commit/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c)

**Latest reachable Herdr:** `origin/master` at [`4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c`](https://github.com/ogulcancelik/herdr/commit/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c), 47 commits after `v0.8.2`

## Executive summary

The SDK is a complete implementation of Herdr's **protocol-18** API, but it is not compatible with either the released Herdr `v0.8.2` server (**protocol 20**) or current `origin/master` (**protocol 21**). The SDK hard-codes protocol 18 in configuration, public types, and its compatibility error, then performs that compatibility check before every ordinary request and stream. Consequently, **all SDK operations fail against the two audited Herdr targets before their operation-specific payloads matter** ([SDK protocol literal](../../src/herdr-config.ts#L14-L16), [compatibility check](../../src/herdr-transport.ts#L277-L288), [request gate](../../src/herdr-transport.ts#L385-L402), [protocol error model](../../src/herdr-errors.ts#L136-L153)).

After that global blocker is removed, current `origin/master` exposes:

- **91 schema-declared JSON request methods**, versus 90 in the SDK schema;
- one additional schema-skipped streaming handshake, `pane.graphics.stream`, present in both but materially expanded upstream;
- **79 ordinary methods whose request/result schema is otherwise unchanged**;
- **11 existing ordinary methods with stale SDK inputs or results**;
- **1 missing ordinary method**, `pane.input.set`;
- **1 stale special stream protocol**, `pane.graphics.stream`.

The released `v0.8.2` gaps are pane right-click control, expanded pane graphics, and two integration targets. The post-release `origin/master` gaps are explicit workspace-group close, per-request worktree trust, and changed lifecycle-subscription timing. No event variant was added or removed between the SDK schema and current master, and the error envelope deliberately remains open-coded.

The most important model correction is:

- `qwen` and `antigravity_cli` are additions to **`IntegrationTarget`**, not to a closed agent-kind model. The SDK's `IntegrationTarget` omits both, so `integration.install` and `integration.uninstall` cannot type, send, or decode those released targets ([SDK enum](../../src/herdr-models.ts#L452-L478), [latest Herdr enum](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/integrations.rs#L15-L53)).
- `AgentStartInput.kind` remains an open non-empty string in the SDK. Newer kinds such as master-only `muse` therefore work at the model boundary already; adding named constants/documentation would improve discoverability but is **not a functional SDK gap**.

## 1. Scope, authority, and method

This audit used only first-party Herdr source and local repository source. One required background research pane gathered the source evidence; no nested researchers or secondary research panes were used.

### Comparison points

| Point                             | Commit/version                                                                                                                                                              | Observed API                  | Classification                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| SDK bundled schema                | local dirty tree at `3d0b322e…`                                                                                                                                             | protocol 18, schema version 1 | SDK baseline ([schema header](../../schema/herdr-api.schema.json#L1-L4)) |
| Canonical protocol-18 Herdr state | [`8843bbb0…`](https://github.com/ogulcancelik/herdr/commit/8843bbb0c4dc4e6b52ca5d0a6592ce80be56a19c) / [`6a04f6fc…`](https://github.com/ogulcancelik/herdr/commit/6a04f6fc) | protocol 18                   | SDK schema is canonically equal after JSON normalization                 |
| Released Herdr                    | [`v0.8.2`](https://github.com/ogulcancelik/herdr/tree/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c)                                                                             | protocol 20, schema version 1 | released gaps                                                            |
| Latest reachable Herdr            | [`origin/master@4a3b04f5`](https://github.com/ogulcancelik/herdr/tree/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c)                                                             | protocol 21, schema version 1 | release gaps plus master-only gaps                                       |

Current master still declares package version `0.8.2` ([`Cargo.toml`](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/Cargo.toml#L1-L4)), so it must be described as unreleased post-`v0.8.2` development, not as `v0.8.3`.

### Reproducibility checks performed

1. Fetched all reachable Herdr remotes and tags.
2. Exported and built `origin/master@4a3b04f5` separately, without changing either working tree.
3. Verified the built CLI reports `herdr --version` as `0.8.2`.
4. Verified `herdr api schema` reports protocol 21 and schema version 1.
5. Verified CLI-emitted schema equals the committed master schema byte-for-byte, SHA-256 `752ae3868d02d5d7ca420cfe31538f6d5fd079055e9b225b03b8eb1b3571d3ea`.
6. Semantically diffed the SDK schema against both the `v0.8.2` and master generated schemas. Herdr documents the installed CLI schema as the bundled socket contract ([schema command](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/cli-reference.mdx#L37-L47)).

The SDK tree was intentionally not reset: this report assesses its current, dirty v1 implementation. The SDK parity ledger says its 91 public rows—90 schema methods plus the special graphics stream—are covered at the protocol-18 public seam ([operation ledger](../sdk-v1-parity.md#L13-L107), [cross-cutting ledger](../sdk-v1-parity.md#L109-L137)).

## 2. Version and protocol gaps

### 2.1 Released `v0.8.2`: protocol 18 → 20

The SDK accepts exactly protocol 18 ([schema](../../schema/herdr-api.schema.json#L1-L4), [configuration](../../src/herdr-config.ts#L14-L42)). `v0.8.2` emits protocol 20. The intervening protocol bumps were:

| Protocol | First commit                                                                                         | Reason                                                     | SDK relevance                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 19       | [`b76adc15…`](https://github.com/ogulcancelik/herdr/commit/b76adc155d979705a353fd6dc87c702f9dfc6c22) | Preserve native key lifecycle across client/server routing | Internal client/server wire behavior, not a new JSON socket model, but it makes protocol-18 clients globally incompatible. |
| 20       | [`6f311498…`](https://github.com/ogulcancelik/herdr/commit/6f311498aeeb27c0973781961ef94e8d0016ed17) | Forward pane terminal bells                                | Also an internal client/server transport change, but it raises the same compatibility number emitted by the socket API.    |

This is not merely a warning. `ping` itself verifies the exact protocol, while every other request and both long-lived streams use the memoized compatibility check first ([SDK transport](../../src/herdr-transport.ts#L277-L308), [ping/ordinary dispatch](../../src/herdr-transport.ts#L364-L402)). Against `v0.8.2`, the observable SDK result is `HerdrUnsupportedProtocol(actualProtocol: 20, supportedProtocol: 18)`.

### 2.2 Master-only: protocol 20 → 21

Protocol 21 was introduced by explicit workspace-group close in [`d79fd746…`](https://github.com/ogulcancelik/herdr/commit/d79fd746a96ddb5642939c9727baefce642d78e6). Master's generated contract reports protocol 21 ([schema header](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/api/herdr-api.schema.json#L1-L4)). Against master, every SDK operation similarly fails with `HerdrUnsupportedProtocol(actualProtocol: 21, supportedProtocol: 18)`.

**Required action:** regenerate from protocol 21 and update every protocol literal/test. If the package must also support released protocol 20 or old protocol 18, it needs explicit versioned codecs/clients; changing the literal to 21 intentionally drops exact compatibility with 18 and 20.

## 3. Released `v0.8.2` SDK gaps

These gaps exist in the released `v0.8.2` contract, independently of the later master changes.

### 3.1 Missing operation: `pane.input.set`

`v0.8.2` added the ordinary request:

```json
{ "method": "pane.input.set", "params": { "pane_id": "w1:p1", "right_click": "pane" } }
```

It sets per-pane right-click routing to `herdr` or `pane`; `pane` forwards gestures only when the pane application requests mouse reporting ([Herdr contract and behavior](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L145-L164), [wire params](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/panes.rs#L17-L49)).

The SDK has no generated method-map entry and no pane-service operation for it. Its existing `sendInput` is terminal text/key input and is unrelated ([SDK `sendInput`](../../src/pane-service.ts#L643-L662)).

**Required SDK addition:** `panes.setInput` (or an equally explicit name), a `PaneRightClickTarget` model, request generation, tests, exports, and documentation.

### 3.2 Stale `pane.split` input

`PaneSplitParams` now accepts `right_click`, defaulting to `herdr` ([Herdr model](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/panes.rs#L27-L41)). The SDK's `PaneSplitInput` has no corresponding field ([SDK model](../../src/herdr-models.ts#L1007-L1018)).

Existing SDK calls remain valid because the server default is `herdr`, but callers cannot create a pane with right-click pass-through atomically.

### 3.3 Stale `IntegrationTarget` on install and uninstall

Herdr `v0.8.2` supports two targets absent from the SDK:

- `qwen`
- `antigravity_cli`

They are members of `IntegrationTarget`, used by both `integration.install` and `integration.uninstall` and returned in their success results ([Herdr enum](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/integrations.rs#L15-L53), [release changelog](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/CHANGELOG.md#L30-L53)). The SDK's closed `IntegrationTarget` stops at its older 15 variants ([SDK model](../../src/herdr-models.ts#L452-L478)); both service methods consume that closed type and decode the returned target through it ([SDK service](../../src/integration-service.ts#L14-L25), [result decode](../../src/integration-service.ts#L33-L53)).

Consequences after the protocol blocker is fixed but before this model is regenerated:

1. public TypeScript cannot pass either target;
2. bypassing the type still fails input validation or generated request typing;
3. a success response containing either target fails SDK response decoding.

This is **not** an `AgentKind` gap. `AgentStartInput.kind` is deliberately open, so new launch kinds—including master-only `muse`—need at most discoverability constants/docs.

### 3.4 Expanded one-shot pane graphics

Herdr's released graphics model adds:

| Operation/model                  | Released field/value                                                                                                             | SDK state                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pane.graphics.info` result      | required `pane_visible`; optional direct-file directory, formats, limits, damage support, max layers, pixel mouse, and transport | SDK returns only cell width/height and discards capability fields ([SDK model](../../src/herdr-models.ts#L993-L1005)). |
| `pane.graphics.set`              | optional `layer_id` (default `primary`)                                                                                          | Not exposed.                                                                                                           |
| `pane.graphics.set`              | `z_index`, default 0                                                                                                             | Not exposed.                                                                                                           |
| `pane.graphics.set` frame format | `bgra`                                                                                                                           | SDK's closed format accepts only `png`, `rgb`, and `rgba` ([SDK format/frame](../../src/herdr-models.ts#L1316-L1335)). |
| `pane.graphics.clear`            | optional `layer_id`                                                                                                              | SDK can clear only the default/primary layer ([implementation](../../src/pane-service.ts#L360-L362)).                  |

The authoritative Herdr fields are defined in the pane request structs ([set/clear/format](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/panes.rs#L285-L338)) and graphics-info result ([result model](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/response.rs#L165-L191)). The feature is experimental and may return `feature_disabled`; latest Herdr advertises a 16-layer limit and capability discovery through `pane.graphics.info` ([socket API](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L174-L203)).

### 3.5 Expanded special stream: `pane.graphics.stream`

`pane.graphics.stream` is intentionally schema-skipped because it changes from NDJSON request/response framing to a dedicated binary/file frame stream after its JSON handshake. It must therefore be audited separately from the 91 ordinary schema methods.

The SDK currently:

- opens the stream with only `{ paneId }` ([open](../../src/pane-service.ts#L363-L366));
- supports only inline header + raw bytes ([writer](../../src/pane-service.ts#L374-L406));
- does not consume the stream's read side after the handshake;
- returns `void` from each write ([writer interface](../../src/pane-service.ts#L110-L121)).

Released Herdr additionally supports:

- handshake `layer_id` and `z_index` ([stream params](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/panes.rs#L341-L364));
- `bgra` inline frames;
- immutable direct RGBA/BGRA file frames with `path`, `sequence`, `revision`, optional damage, and capability/size gating;
- `pane_graphics_frame_ack { sequence, revision }` only after terminal acceptance or safe fallback ([ack result](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/response.rs#L160-L169), [framing and ACK contract](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L205-L235));
- exclusive per-layer ownership and `stream_conflict` on concurrent layer use.

The old inline primary-layer path remains a valid subset, but the SDK cannot use direct/high-DPI transport, named layers, z-order, BGRA, damage metadata, revision safety, or acknowledgements. More seriously, because it never reads after handshake, post-handshake server error records are not surfaced to the writer as `HerdrServerError`.

**Required action:** model stream capabilities and layer options, add a read/ACK loop, correlate `sequence`/`revision`, surface asynchronous server errors, and preserve the old inline fallback.

### 3.6 Released behavior changes that do not require new SDK models

These are API-observable changes since the protocol-18 baseline, but are inherited from the upgraded server once protocol compatibility is restored:

- `agent.prompt` now rejects an already blocked agent with `agent_blocked` without sending input ([current contract](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L112-L118)).
- Agent start/prompt and pane creation gained stronger readiness behavior in [`7ae4b056…`](https://github.com/ogulcancelik/herdr/commit/7ae4b056a0ca478e584fa282c45b528134cc80c9), [`9351b058…`](https://github.com/ogulcancelik/herdr/commit/9351b058f34973016a5d5973297d0567513e67a4), and [`37644cab…`](https://github.com/ogulcancelik/herdr/commit/37644cabe0d0f8c96f3ae7cc2a985f54d631adff). The SDK already waits for the ordinary server response, so no extra client orchestration should duplicate those guarantees.
- API closing a workspace's last tab now closes the workspace ([`a79b3d55…`](https://github.com/ogulcancelik/herdr/commit/a79b3d558026d0703f848882d652bb5db65df26e)). This is server behavior, not a request-shape gap.
- Herdr `v0.8.2` made Windows generally available ([`9fac5172…`](https://github.com/ogulcancelik/herdr/commit/9fac51722653fa0b0b6a5786166fb18c763424e0)). Herdr uses a Unix socket on Unix and a named pipe on Windows, and explicitly makes raw clients responsible for the platform-native form ([transport contract](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L650-L691)). The SDK resolves Windows config paths but passes the resulting filesystem-looking path directly to Node `net.createConnection`; its transport is documented internally as Unix-socket-specific ([config resolution](../../src/herdr-config.ts#L215-L236), [transport connection/gate](../../src/herdr-transport.ts#L290-L315)). Portable Windows named-pipe resolution/connection therefore remains a platform capability gap unless callers supply an already usable native pipe endpoint.

## 4. `origin/master`-only gaps after `v0.8.2`

### 4.1 `workspace.close`: explicit worktree-group intent

Master changes `workspace.close` params from `WorkspaceTarget` to `WorkspaceCloseParams` with optional/default-false `close_group` ([Herdr model](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/workspaces.rs#L15-L24)). Closing a primary workspace while linked-worktree workspaces remain now returns `workspace_group_close_required` unless `close_group: true`; an explicit group close emits one `workspace.closed` event per workspace ([contract](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L410-L416)).

The SDK's `workspaces.close(id)` always sends only `{ workspaceId }` ([interface and implementation](../../src/workspace-service.ts#L81-L85), [dispatch](../../src/workspace-service.ts#L238-L240)). Ordinary single-workspace closes remain valid, but callers cannot express explicit group close.

**Required action:** add a close input/options model with `closeGroup`, preserve false/omitted default behavior, and test both generic failure and group-close event multiplicity.

### 4.2 Worktree per-request trust

Master adds `trust_repository` to all four worktree operations in [`095f1337…`](https://github.com/ogulcancelik/herdr/commit/095f1337d6502081658973ae3487dee8c6b34e1a). The field is default false on `worktree.list`, `create`, `open`, and `remove` ([Herdr request models](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/schema/worktrees.rs#L1-L59)). It trusts only the resolved repository for that request and does not modify Git configuration ([CLI contract](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/cli-reference.mdx#L138-L149)).

The SDK models and dispatchers omit it from every operation ([SDK worktree service](../../src/worktree-service.ts#L35-L57), [list/create encoding](../../src/worktree-service.ts#L69-L113), [open/remove encoding](../../src/worktree-service.ts#L115-L157)). Default safe requests remain valid; callers cannot opt into an independently verified repository, so those operations remain unusable for Git safe-directory ownership failures.

### 4.3 Lifecycle subscriptions no longer replay retained history

Commit [`20a500a7…`](https://github.com/ogulcancelik/herdr/commit/20a500a7f3fa272326418312e3b57107ee96f0c4) changes lifecycle subscriptions to begin at request acceptance. They do not replay events retained before that point ([current subscription contract](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L795-L815)). The implementation initializes event subscriptions at an acceptance-time start sequence ([subscription state](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/src/api/subscriptions.rs#L84-L115)).

This is a **behavior/documentation/test gap**, not a payload-model gap. The SDK does not implement replay itself and will naturally receive only live events after upgrading, but consumers must not depend on old retained-history behavior. Correct cache bootstrap remains: acknowledge a subscription, buffer it, obtain `session.snapshot`, install the snapshot, then apply buffered events ([Herdr bootstrap guidance](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L119-L134)).

### 4.4 Master-only agent-kind discoverability

Master adds `muse` to CLI-recognized agent kinds, but the socket `agent.start.kind` remains a string. The SDK's open `AgentStartInput.kind` therefore already accepts it. Optional named constants, CLI parity docs, or completion metadata would improve discovery; no codec or service change is required.

## 5. Events and errors

### 5.1 Event model parity

A semantic diff found **no additions, removals, or shape changes** in the generated lifecycle-event or subscription-event schemas between protocol 18, released protocol 20, and current protocol 21.

The 26 lifecycle variants remain:

- workspace: `created`, `updated`, `metadata_updated`, `closed`, `renamed`, `moved`, `reordered`, `focused`;
- worktree: `created`, `opened`, `removed`;
- tab: `created`, `closed`, `renamed`, `moved`, `focused`;
- pane: `created`, `closed`, `updated`, `focused`, `moved`, `output_changed`, `exited`, `agent_detected`, `agent_status_changed`;
- layout: `updated`.

The SDK already validates and normalizes generated lifecycle and subscription envelopes ([wire parser](../../src/herdr-wire-parser.ts#L1-L45)), and its parity ledger covers filtering, unsupported variants, coalesced handshake bytes, and cleanup ([event coverage](../sdk-v1-parity.md#L124-L126)).

The only current event gap is the **master-only no-history behavior** described above. Explicit group close also changes cardinality—one `workspace.closed` per member—but not the event model.

### 5.2 Error model parity and gaps

The wire error contract remains intentionally open: `error.code` and `error.message` are strings ([latest schema](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/api/herdr-api.schema.json#L6-L20)). The SDK correctly preserves arbitrary server codes in `HerdrServerError` ([SDK error](../../src/herdr-errors.ts#L199-L214)). Therefore new codes do **not** require a closed SDK error-enum regeneration.

Error-impact matrix:

| Error/condition                                                     | Status                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protocol_mismatch` / protocol 20 or 21                             | Global blocker; represented locally as `HerdrUnsupportedProtocol` before normal operations.                                                                  |
| `workspace_group_close_required`                                    | Parsed as generic `HerdrServerError`, but SDK cannot recover by sending `close_group: true` until its workspace API is expanded.                             |
| Git repository ownership/safe-directory rejection                   | Parsed generically, but SDK cannot set `trust_repository: true` until all four worktree inputs are expanded.                                                 |
| `feature_disabled`, `stream_conflict`, graphics validation failures | Ordinary/handshake errors are parsed generically. Post-handshake graphics-stream errors are currently not consumed and can be lost.                          |
| `pane_graphics_frame_ack`                                           | A success result, not an error. Missing from the protocol-18 generated result union and unused because the SDK never reads stream responses after handshake. |
| `agent_blocked` and newer readiness failures                        | Open server codes already parse correctly; no closed error-model change is required.                                                                         |
| `qwen` / `antigravity_cli` integration success                      | Not an error code: the closed SDK success decoder rejects the new `IntegrationTarget`, producing an SDK response-decoding failure.                           |

## 6. Complete operation-level matrix

The latest public socket surface is 91 ordinary schema methods plus the special `pane.graphics.stream` handshake.

> **Global caveat:** every row is presently unusable against protocol 20/21 because of the exact protocol-18 gate. “Unchanged” below means no additional operation-specific schema work was found after that gate is updated.

| Classification                                   | Count | Methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Required work                                                                                                                                                                                         |
| ------------------------------------------------ | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary, operation-specific schema unchanged    |    79 | `ping`; `server.stop`, `server.live_handoff`, `server.reload_config`, `server.agent_manifests`, `server.reload_agent_manifests`; `session.snapshot`; `notification.show`; `client.window_title.set`, `.clear`; `workspace.create`, `.list`, `.get`, `.focus`, `.rename`, `.move`, `.move_block`, `.report_metadata`; all 7 `tab.*`; all 12 `agent.*`; all 3 `layout.*`; both `events.*`; all 11 schema-declared `plugin.*`; `popup.close`; and all pane methods except those listed below | Regenerate/verify protocol-21 wire types and fixtures; no semantic request/result delta found. Full protocol-18 service mapping is source-cited in the [parity ledger](../sdk-v1-parity.md#L15-L107). |
| Existing ordinary method, stale at `v0.8.2`      |     6 | `integration.install`, `integration.uninstall`, `pane.split`, `pane.graphics.info`, `pane.graphics.set`, `pane.graphics.clear`                                                                                                                                                                                                                                                                                                                                                            | Add integration targets, right-click input, graphics capabilities/layers/z-index/BGRA.                                                                                                                |
| Missing at `v0.8.2`                              |     1 | `pane.input.set`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Add model, service operation, generation, tests, exports, docs.                                                                                                                                       |
| Existing ordinary method, master-only stale      |     5 | `workspace.close`, `worktree.list`, `worktree.create`, `worktree.open`, `worktree.remove`                                                                                                                                                                                                                                                                                                                                                                                                 | Add `closeGroup` and `trustRepository`.                                                                                                                                                               |
| Special schema-skipped stream, stale at `v0.8.2` |     1 | `pane.graphics.stream`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Add layer/z-index/BGRA/direct-file framing, ACK reads/correlation, and async error handling.                                                                                                          |

For avoidance of ambiguity, the 25 unchanged schema-declared pane methods are:

`pane.clear_agent_authority`, `pane.close`, `pane.current`, `pane.edges`, `pane.focus`, `pane.focus_direction`, `pane.get`, `pane.layout`, `pane.list`, `pane.move`, `pane.neighbor`, `pane.process_info`, `pane.read`, `pane.release_agent`, `pane.rename`, `pane.report_agent`, `pane.report_agent_session`, `pane.report_metadata`, `pane.resize`, `pane.send_input`, `pane.send_keys`, `pane.send_text`, `pane.swap`, `pane.wait_for_output`, and `pane.zoom`.

## 7. Intentional CLI-only orchestration and UI features

These should **not** be added to the ordinary generated socket method map merely to mirror CLI help. Herdr explicitly distinguishes CLI wrappers from the raw socket API ([socket API overview](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/socket-api.mdx#L8-L24)).

| CLI area                                                                                      | Classification                                                                     | SDK implication                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `herdr`, `--session`, `--no-session` launch/attach                                            | Process/session/TUI lifecycle orchestration                                        | Keep outside generated API. SDK socket selection for named sessions is useful and already exists ([SDK resolution](../../src/herdr-config.ts#L159-L197)). |
| `--remote`, remote keybinding selection, remote handoff                                       | SSH/remote client transport and interactive UI orchestration                       | Not a local socket API gap. A future remote SDK transport would be a separate capability.                                                                 |
| `update`, `update --handoff`, `channel show/set`                                              | Installer, release-channel, and live process handoff orchestration                 | `server.live_handoff` remains a real raw method and is already in the SDK; download/install/channel management is CLI-only.                               |
| `status`, `status server`, `status client`                                                    | Aggregated local binary/server/socket compatibility diagnostics                    | Do not invent socket methods; compose `ping` and local environment inspection only if an SDK convenience is desired.                                      |
| `--version`, `--default-config`, `--skill`, `api schema`, shell `completion(s)`               | Binary metadata/config/schema/skill/completion output                              | CLI-only. Schema ingestion belongs in SDK development tooling, not runtime service parity.                                                                |
| `api snapshot`                                                                                | JSON presentation wrapper over `session.snapshot`                                  | The SDK already exposes `session.snapshot`; no second API operation is needed.                                                                            |
| `config check`, `config reset-keys`                                                           | Local configuration validation, backup, and mutation                               | CLI/filesystem orchestration, not a socket API gap.                                                                                                       |
| `server` headless startup                                                                     | Starts/supervises a server process                                                 | CLI/process orchestration. `server.stop`, reload methods, and manifest status/reload are already raw methods.                                             |
| `server update-agent-manifests`                                                               | Fetch + reload + formatted status workflow                                         | CLI orchestration over local/network work; do not confuse it with existing `server.agent_manifests` and `server.reload_agent_manifests`.                  |
| `session list/attach/stop/delete`                                                             | Filesystem/process discovery and lifecycle across separate socket endpoints        | No corresponding ordinary session-management methods. `session.snapshot` is a different, real socket method and already exists.                           |
| `terminal attach`; `terminal session control/observe`                                         | Separate interactive client protocol and streaming terminal ownership              | Not NDJSON socket-schema methods. `client.window_title.set/clear` are ordinary methods and already exist.                                                 |
| CLI `--current`, environment-derived caller pane, text/raw/ANSI printing, exit statuses       | Argument resolution and presentation                                               | CLI convenience. The underlying `pane.current`, reads, waits, and targets remain SDK operations.                                                          |
| `pane run`                                                                                    | Convenience composition over `pane.send_input` with command text followed by Enter | The SDK already exposes `panes.sendInput`; no new wire method is required.                                                                                |
| `agent attach`                                                                                | Facade over direct terminal attach                                                 | CLI-only stream orchestration. Other `agent.*` automation methods are ordinary API operations.                                                            |
| `agent explain --file`                                                                        | Local fixture classification and formatted diagnostics                             | CLI-local. Live `agent.explain` is a socket method and already exists.                                                                                    |
| `integration status`                                                                          | Filesystem/config inspection and human presentation                                | Only install/uninstall are schema methods. A convenience could be hand-written, not generated as a wire method.                                           |
| `plugin install/uninstall/config-dir`                                                         | GitHub fetch/build/trust preview/managed-filesystem workflow                       | CLI orchestration. `plugin.link/unlink/list/enable/disable`, action/log, and managed pane operations are ordinary methods already represented by the SDK. |
| TUI keybindings, menus, pane border right-click behavior, visual focus and rendering features | Application UI                                                                     | Not SDK surface. Expose only the corresponding authoritative socket state/mutation when one exists, such as `pane.input.set`.                             |

The current CLI command families and examples are first-party documented in the [CLI reference](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/cli-reference.mdx#L10-L109), [terminal section](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/cli-reference.mdx#L324-L345), and [plugin section](https://github.com/ogulcancelik/herdr/blob/4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c/docs/next/website/src/content/docs/cli-reference.mdx#L389-L473).

## 8. Remediation plan

Recommended order:

1. **Choose the support policy.** Target protocol 21 only, or build explicit versioned 18/20/21 clients. Do not imply a protocol range while using one generated codec.
2. **Replace the bundled schema with master protocol 21 and regenerate.** This should produce 91 ordinary request methods and current response types.
3. **Add `pane.input.set` publicly.** Include `PaneRightClickTarget` and `PaneSplitInput.rightClick`.
4. **Correct `IntegrationTarget`.** Add `qwen` and `antigravity_cli` to request and success parsing. Keep `AgentStartInput.kind` open; optionally add discoverability constants without closing it.
5. **Expand one-shot graphics.** Add capabilities, `paneVisible`, layer IDs, z-index, BGRA, and layer-specific clear.
6. **Redesign the graphics stream.** Add capability negotiation, direct files, ACK/error read loop, revision correlation, and tests for hidden panes, fallback, timeout, and stream conflict.
7. **Add master close/trust inputs.** `WorkspaceCloseInput.closeGroup` and `trustRepository` on all four worktree operations.
8. **Update event semantics tests/docs.** Assert no pre-acceptance lifecycle replay and document snapshot + buffered subscription bootstrap.
9. **Decide Windows support explicitly.** Implement native named-pipe endpoint resolution/connection, or state and enforce Unix-only support rather than partially resolving Windows marker paths.
10. **Run parity at both boundaries.** Generated schema parity plus public Effect service tests, including closed input/result enums, special stream framing, and open server errors.

## 9. Requirement-by-requirement completeness check

| Audit requirement                         | Result   | Evidence location                                                                |
| ----------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Latest reachable app/CLI identified       | Complete | §1: `origin/master@4a3b04f5`, 47 commits after `v0.8.2`.                         |
| Released and unreleased changes separated | Complete | §3 contains `v0.8.2`; §4 contains master-only changes.                           |
| Protocol/version gaps                     | Complete | §2: 18 → 20 → 21 and global failure behavior.                                    |
| Operation gaps                            | Complete | §§3–4 and §6: all 91 ordinary methods plus special stream classified.            |
| Request/result model gaps                 | Complete | §§3.1–3.5 and §§4.1–4.2.                                                         |
| `IntegrationTarget` correction            | Complete | §3.3: `qwen` and `antigravity_cli`; agent kind remains open.                     |
| Event gaps                                | Complete | §4.3 and §5.1: no variant/shape delta; master timing change identified.          |
| Error gaps                                | Complete | §5.2: open error model, new actionable errors, stream error-loss gap.            |
| Behavior gaps                             | Complete | §3.6 and §4.3.                                                                   |
| Special graphics framing                  | Complete | §3.5 separates it from ordinary schema methods.                                  |
| CLI-only orchestration/UI distinguished   | Complete | §7.                                                                              |
| First-party/local citations               | Complete | SDK links are repository-local; Herdr links are exact first-party commits/files. |
| Research-process constraint               | Complete | One required background research pane; no nested or replacement researcher.      |

## Final assessment

The SDK is internally coherent for its protocol-18 source point, but it is **not a usable SDK for released Herdr `v0.8.2` or current master** because exact protocol checking blocks every call. Updating only the protocol literal would be unsafe: the SDK would still omit one ordinary method, expose stale shapes for 11 ordinary methods, incompletely implement the special graphics stream, reject two released integration targets, and miss master subscription semantics. The minimum credible “latest Herdr” release is therefore a protocol-21 regeneration plus the explicit service/model/stream work listed above, with CLI-only process and UI orchestration kept out of the generated socket API.
