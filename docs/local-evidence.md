# Local evidence

Evidence is development tooling, not a published SDK API. An evidence bundle connects an
execution, its assertion results, and optional presentation or trace observations. A user-supplied
claim is **untrusted narrative**, not an assertion and not a verified conclusion.

## Produce a bundle

Run from this checkout with installed dependencies. Discover the current recipes rather than
assuming a separate catalog in this guide:

```sh
node scripts/sdk-evidence.mjs list
node scripts/sdk-evidence.mjs list --json
node scripts/sdk-evidence.mjs run compatibility-recovery --json
```

Fixture recipes need neither Terminal Control nor a trace viewer. They use isolated local
fixtures, not live Herdr control, ambient sessions, or personal panes. TypeScript recipes execute
through the installed Vitest boundary; these commands do not install dependencies.

### Primary real Herdr workflow (explicit opt-in)

```sh
node scripts/sdk-evidence.mjs run herdr-sdk-workflow --record --json
node scripts/sdk-evidence.mjs run herdr-sdk-workflow --record --trace --json
```

Selecting `herdr-sdk-workflow` is explicit consent to start a **fresh disposable isolated real
Herdr session**. This scenario requires recording; it never accepts a caller-selected socket,
session, or working directory and never attaches to ambient/default sessions or personal panes.
Normal tests remain fixture-only. Prerequisites include installed Herdr, Terminal Control, and
its rendering tools; unavailable prerequisites must be reported explicitly, not replaced with a
fixture video or a replay of uncertain SDK calls.

The selected Herdr binary must speak the SDK's supported protocol; a matching version label alone
is not enough. Incompatible protocols produce the SDK's typed compatibility failure, never an
`expectedProtocol` override or a bypass. To select an already-installed compatible binary explicitly:

```sh
node scripts/sdk-evidence.mjs run herdr-sdk-workflow --record --herdr-executable /absolute/path/to/herdr --json
```

Binary selection changes only the executable, not ownership: the runner still creates its own
private session, configuration, root and socket. No build or installation is performed. Review the
bundle's sandbox status artifact for observed client/server versions and protocols; those facts
do not replace workflow assertions or prove UI capture. A local debug build may use `herdr-dev`
configuration paths; discovery must remain beneath the newly owned private root.

The sandbox owns a private temporary root, explicit named session and exact socket. Its clean
environment excludes caller IDs, shell hooks and credentials; private configuration disables
onboarding, background updates and manifest fetches. Only non-login `/bin/sh` shells are used.
Startup and shutdown may use the CLI; demonstration actions use the public SDK. Cleanup targets
only the owned session and processes, with an independently reported outcome.

The recording shows Herdr's actual TUI: create/focus a demo tab, split a pane, run controlled short
commands, assert topology and actual output, then close the split/tab and observe the landing
state. Socket acknowledgements alone do not prove visible UI transitions: source markers and
readable holds follow observed TUI states before the next SDK action. Check the actual capture,
assertions, and independent recording/cleanup outcomes before claiming the demonstration succeeded.

The manifest's top-level `executionKind` is `fixture` or `isolated-herdr`. Older version-1 bundles
without this field retain **fixture-only** interpretation, regardless of scenario title or claim.
The classification records the execution mode, not success or producer authenticity. Rerendering
cannot change it; failed real capture is not relabeled as fixture proof.

A failed UI observation gate stops the workflow without replay. If it prevents the subprocess from
publishing its final report, partial SDK checks may be lost even when earlier transcripts or source
markers survive. The product report then remains unavailable: those partial UI artifacts support
only the states actually captured, never implicit completion of the full workflow. A poster shows
one captured state, not the whole transition sequence; a render failure leaves the separate source
recording and asserted product outcome unchanged.

`--claim 'TEXT'` changes the narrative, not the assertions. Do not put secrets in it.
`--out /absolute/existing/parent` selects an existing parent outside the checkout; otherwise the
OS temporary directory is used. Each run creates its own private `ev-…` directory. Keep the
returned directory and bundle ID together: an ID alone is not a remote artifact address.

JSON command data is on stdout; diagnostics are on stderr. Read the independent manifest outcomes,
not just the process exit code. Product assertions, telemetry delivery, viewer presence, recording,
rendering, and cleanup answer different questions. An expected SDK error can support a passing
scenario when assertions verify that error and its consequences.

### Explicit CI artifact for PR review

The `SDK verification` GitHub Actions workflow has a manual `evidence` input, off by default.
For an explicitly requested review bundle, dispatch it against the PR branch:

```sh
gh workflow run sdk-verify.yml --ref BRANCH -f evidence=true
```

After full verification passes on Linux, that run collects the three fixture recipes
`scoped-subscription`, `graphics-writer`, and `request-wire-result`, then uploads their bundles
and the verification log as `sdk-review-evidence-COMMIT`. Link the downloadable Actions artifact
in the PR. It expires after 30 days and GitHub may require sign-in to download it. Ordinary push
and pull-request runs never upload evidence. No live Herdr, recording, or tracing is selected.
Review the downloaded manifests and their independent outcomes before presenting the artifact
as evidence; successful upload alone proves neither product behavior nor cleanup.

## Consume and review

Replace `BUNDLE_DIRECTORY` with the directory returned by the run:

```sh
node scripts/sdk-evidence.mjs inspect BUNDLE_DIRECTORY
node scripts/sdk-evidence.mjs inspect BUNDLE_DIRECTORY --json
node scripts/sdk-evidence.mjs inspect BUNDLE_DIRECTORY --chapter CHAPTER_ID
node scripts/sdk-evidence.mjs open BUNDLE_DIRECTORY
```

Discover chapter IDs from the manifest before selecting one. `inspect` reads evidence; it does not
execute the stored reproduction arguments, rerun SDK operations, or open a UI. `open` is an explicit
UI action on macOS/Linux and regenerates the offline review from the parsed manifest rather than
trusting stored HTML. The bundle also contains `review.md` and an offline `review.html` with relative
artifact links. Keep the directory intact when moving it. Bundle validation checks structure and
path safety, not producer authenticity; bundles are not signed.

A useful review sequence for a human or agent:

1. Check execution kind, scenario, claim, source revision, dirty-source fingerprint, and limitations.
2. Read product status and the individual checks' expected and observed values.
3. Review the relevant chapter, then supporting artifacts and trace observations if present.
4. Report a concrete check/chapter/span reference and what it establishes or fails to establish.

A handoff should name the bundle directory and ID, scenario, product result, relevant chapter/check,
missing evidence, and next review request. For example: “Review the recovery chapter; fixture
assertions passed, but live Herdr rendering was not exercised.” Use IDs actually present in that
bundle, not IDs copied from another run. Reproduction arguments are data for deliberate review,
not shell commands to execute blindly from an untrusted bundle.

The source fingerprint covers the files listed in the manifest, not the whole dependency graph.
It is not an atomic checkout snapshot: concurrent edits may change the source between fingerprinting
and execution. Compare the actual source/recipe scope before comparing two runs.

## Record and rerender

Fixture recording is optional; the real Herdr workflow requires it. Recording uses separately installed Terminal Control (`termctrl` 0.3.0) and its
video-rendering prerequisites, including `ffmpeg`. No command installs them. The terminal adapter
is intended for macOS/Linux; normal unrecorded verification does not require it.

```sh
node scripts/sdk-evidence.mjs run compatibility-recovery --record --preset review --json
node scripts/sdk-evidence.mjs render BUNDLE_DIRECTORY --preset walkthrough --json
```

A fixture SDK scenario executes **once**, at normal execution speed. It then presents gated pages labeled
“Observed fixture review” from the actual assertion report. These are post-run review pages, not a
live step-by-step reenactment of SDK operations. The source PTY recording retains the execution;
the edited video focuses on the observed-result pages. Page transcripts provide searchable text.
When capture succeeds, the offline review uses a frame from the last recorded review page as its
video poster and offers an image fallback. The accompanying poster-status JSON records the source
marker and time; a poster is not a separate assertion. Capture failure does not override product
or video-render outcomes. Rerendering another preset retains an existing poster from the same source.

For fixture review pages, `review` adds four-second holds; `walkthrough` adds six-second holds.
These presets edit presentation, not fixture timing. Chapter source times refer to the recorded **post-execution
review pages**. Playback times refer to the edited video. Neither measures SDK operation latency,
and chapter-to-trace links identify the whole execution, not an inferred phase-specific span.

`render` uses the existing recording and creates another presentation without rerunning SDK work.
Its outcome is independent of the original product result. Missing source recordings cannot be
reconstructed by rendering. For fixture recipes, unavailable recorder preflight permits one
unrecorded execution with that limitation. The real Herdr workflow instead reports unavailable
recording without substituting a fixture or unrecorded demonstration. Uncertain recording-start
failures are never blindly replayed.

Real-workflow chapter source times describe actual action/observed-UI intervals, not post-run
assertion pages. Edited playback time remains distinct from source time; neither is a latency
benchmark. Trace bookmarks may identify only the whole execution unless actual phase-specific
spans support a narrower mapping.

## Trace honesty

Tracing is explicit and separate from recording. Start a dedicated viewer yourself using the
[local tracing workflow](local-tracing.md); no evidence command implicitly starts or clears one.
A successful collector response means export acknowledgement, not viewer ingestion.

```sh
node scripts/sdk-evidence.mjs run compatibility-recovery --trace --json
node scripts/sdk-evidence.mjs run compatibility-recovery --record --trace --json
node scripts/sdk-evidence.mjs open BUNDLE_DIRECTORY --trace
```

For a separately started viewer on custom ports, set `HERDR_TRACE_ENDPOINT` and
`HERDR_TRACE_VIEWER_URL` as described in the tracing guide. Tracing still requires `--trace`;
ambient `HERDR_TRACE=1` alone does not enable an evidence run. The runner briefly polls for the
emitted root, then discovers run-associated and linked roots within bounded query budgets.
A still-absent trace stays unavailable. Explicit trace opening checks current viewer presence
before opening the bookmark; it does not restore expired viewer data.

Saved trace observations are bounded, sanitized query projections, **not raw OTLP archives**.
Missing spans, missing parents, linked-but-unavailable roots, dropped metadata, and truncated
projections limit the evidence. A main execution root alone does not prove that shared compatibility
work was captured. An absent trace never proves product success.

Viewer links are ephemeral loopback conveniences. They work only while the relevant viewer retains
that trace and are not accessible to remote reviewers. The supported bookmark form is
`/traces/TRACE_ID?span=SPAN_ID`; no event index is invented. Saved JSON remains useful offline but
cannot be reimported to recreate the original waterfall.

## Privacy, interruption, and retention

Terminal recordings, when requested, capture **input and output of the launched PTY**, not an
existing Herdr pane or browser UI. Fixture recordings do not establish how Herdr renders its UI;
real-workflow recordings support only the particular isolated TUI states actually captured, not
broader graphics or platform correctness. Telemetry
sanitization does not sanitize video, terminal source recordings, screenshots, or narrative text.
Cropping a video does not remove content from the raw recording.

Review every artifact before sharing. Local evidence commands never upload. The explicitly
selected CI artifact workflow above is the only supplied upload route; GitHub owns its retention. Keep generated evidence outside the checkout and remove only directories you
own when no longer needed. Temporary-directory storage is not a durability guarantee.

A final `evidence.json` is published after the review files. An interrupted initial run can retain
`evidence.incomplete.json` without a final manifest; that is incomplete evidence, not a successful
bundle. Forced termination cannot guarantee process cleanup or artifact finalization. Do not infer
success from partial files or silently treat a new run as completion of the original execution.
