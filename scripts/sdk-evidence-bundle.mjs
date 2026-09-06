import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Clock, Data, Effect, Exit, FileSystem, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const evidenceText = Schema.String.check(Schema.isMaxLength(4096));
const evidenceId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/));
const evidencePath = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]{0,239}$/),
  Schema.makeFilter((value) =>
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
  ),
);
const traceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));
const spanId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/));
const viewerUrl = Schema.String.check(
  Schema.isPattern(/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?\/?$/),
);
const milliseconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
/** @template {Schema.Top} S @param {S} schema */
const evidenceList = (schema) => Schema.Array(schema).check(Schema.isMaxLength(256));
const evidenceOutcome = Schema.Struct({
  status: Schema.Literals([
    "pending",
    "not-requested",
    "passed",
    "failed",
    "partial",
    "unavailable",
    "interrupted",
  ]),
  detail: Schema.optionalKey(evidenceText),
});
const evidenceSource = Schema.Struct({
  revision: evidenceText,
  dirty: Schema.Boolean,
  fingerprint: evidenceText,
  files: evidenceList(evidencePath),
  limitations: evidenceList(evidenceText),
});

/** Versioned offline evidence manifest; narrative never establishes assertion success. */
export const SdkEvidenceManifest = Schema.Struct({
  version: Schema.Literal(1),
  id: evidenceId,
  createdAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)),
  scenario: Schema.Struct({ id: evidenceId, title: evidenceText }),
  // Absent in original version-1 bundles: those retain fixture-only interpretation.
  executionKind: Schema.optionalKey(Schema.Literals(["fixture", "isolated-herdr"])),
  claim: evidenceText,
  source: evidenceSource,
  reproduction: Schema.Struct({ executable: evidenceText, args: evidenceList(evidenceText) }),
  checks: evidenceList(
    Schema.Struct({
      id: evidenceId,
      chapterId: evidenceId,
      label: evidenceText,
      expected: evidenceText,
      observed: evidenceText,
      status: Schema.Literals(["passed", "failed"]),
    }),
  ),
  chapters: evidenceList(
    Schema.Struct({
      id: evidenceId,
      title: evidenceText,
      caption: evidenceText,
      checkIds: evidenceList(evidenceId),
      sourceStartMs: Schema.optionalKey(milliseconds),
      sourceEndMs: Schema.optionalKey(milliseconds),
      playbackStartMs: Schema.optionalKey(milliseconds),
      traceIds: Schema.optionalKey(evidenceList(traceId)),
    }),
  ),
  outcomes: Schema.Struct({
    product: Schema.Struct({
      status: Schema.Literals(["passed", "failed", "interrupted", "unavailable"]),
      errorTag: Schema.optionalKey(evidenceText),
    }),
    telemetry: evidenceOutcome,
    viewer: evidenceOutcome,
    recording: evidenceOutcome,
    render: evidenceOutcome,
    cleanup: evidenceOutcome,
  }),
  artifacts: evidenceList(
    Schema.Struct({
      id: evidenceId,
      kind: Schema.Literals([
        "recording",
        "video",
        "frame",
        "transcript",
        "trace",
        "edit",
        "other",
      ]),
      path: evidencePath,
    }),
  ),
  traceIds: Schema.optionalKey(evidenceList(traceId)),
  traceBookmarks: Schema.optionalKey(
    evidenceList(
      Schema.Struct({
        id: evidenceId,
        label: evidenceText,
        chapterId: Schema.optionalKey(evidenceId),
        traceId,
        spanId: Schema.optionalKey(spanId),
        viewerUrl,
      }),
    ),
  ),
  limitations: evidenceList(evidenceText),
  related: evidenceList(
    Schema.Struct({
      id: evidenceId,
      relation: Schema.Literals(["reproduces", "compares-with", "supersedes"]),
    }),
  ),
}).check(
  Schema.makeFilter((manifest) => {
    const unique = /** @param {ReadonlyArray<{id:string}>} values */ (values) =>
      new Set(values.map((value) => value.id)).size === values.length;
    return (
      unique(manifest.chapters) &&
      unique(manifest.checks) &&
      unique(manifest.artifacts) &&
      unique(manifest.traceBookmarks ?? []) &&
      manifest.checks.every((check) =>
        manifest.chapters.some(
          (chapter) => chapter.id === check.chapterId && chapter.checkIds.includes(check.id),
        ),
      ) &&
      manifest.chapters.every(
        (chapter) =>
          chapter.checkIds.every((id) =>
            manifest.checks.some((check) => check.id === id && check.chapterId === chapter.id),
          ) &&
          (chapter.sourceEndMs === undefined ||
            chapter.sourceStartMs === undefined ||
            chapter.sourceEndMs >= chapter.sourceStartMs),
      ) &&
      (manifest.traceBookmarks ?? []).every(
        (bookmark) =>
          bookmark.chapterId === undefined ||
          manifest.chapters.some((chapter) => chapter.id === bookmark.chapterId),
      ) &&
      (manifest.outcomes.product.status !== "passed" ||
        (manifest.checks.length > 0 && manifest.checks.every((check) => check.status === "passed")))
    );
  }),
);
/** Parsed evidence bundle manifest, shared by orchestration and review. @typedef {typeof SdkEvidenceManifest.Type} SdkEvidenceManifest */
/** Parse persisted evidence with bounded fields and chapter/check reference integrity. */
export const parseSdkEvidenceManifest = Schema.decodeUnknownEffect(SdkEvidenceManifest);
const parseEvidenceJson = Schema.decodeEffect(Schema.fromJsonString(SdkEvidenceManifest));
const parseEvidencePath = Schema.decodeEffect(evidencePath);

/** Bound reads by bytes consumed, even if a file grows after stat. */
const readEvidenceBytes = Effect.fnUntraced(
  function* (/** @type {string} */ filePath, /** @type {number} */ maximumBytes) {
    const fs = yield* FileSystem.FileSystem;
    return yield* Stream.runFoldEffect(
      fs.stream(filePath, { chunkSize: 65536 }),
      () => Buffer.alloc(0),
      (bytes, chunk) =>
        bytes.length + chunk.length > maximumBytes
          ? Effect.fail(bundleError("too-large"))
          : Effect.succeed(Buffer.concat([bytes, chunk])),
    );
  },
);

/** Evidence storage failure; diagnostics deliberately omit paths and raw file contents. */
export class SdkEvidenceBundleError extends Data.TaggedError("SdkEvidenceBundleError") {
  /** @param {{reason:"unsafe-path"|"incomplete"|"invalid-manifest"|"storage"|"too-large"|"identity-mismatch"|"source-unavailable",message:string}} options */
  constructor(options) {
    super(options);
    /** Evidence bundle failure classification, without raw artifact contents. */
    this.reason = options.reason;
  }
}
/** @param {SdkEvidenceBundleError['reason']} reason */
const bundleError = (reason) =>
  new SdkEvidenceBundleError({
    reason,
    message: `SDK evidence bundle rejected (${reason}); inspect the private bundle and correct the input before retrying.`,
  });
/** @param {string} root @param {string} candidate */
const containsPath = (root, candidate) =>
  candidate === root ||
  (!path.relative(root, candidate).startsWith(`..${path.sep}`) &&
    path.relative(root, candidate) !== ".." &&
    !path.isAbsolute(path.relative(root, candidate)));

/** Resolve an existing relative artifact without allowing symlink escape from the bundle. */
export const resolveSdkEvidenceArtifact = Effect.fnUntraced(
  function* (/** @type {string} */ directory, /** @type {string} */ relativePath) {
    const fs = yield* FileSystem.FileSystem;
    const parsed = yield* parseEvidencePath(relativePath).pipe(
      Effect.mapError(() => bundleError("unsafe-path")),
    );
    const root = yield* fs.realPath(directory);
    const resolved = yield* fs.realPath(path.join(root, parsed));
    if (!containsPath(root, resolved)) return yield* Effect.fail(bundleError("unsafe-path"));
    const info = yield* fs.stat(resolved);
    if (info.type !== "File") return yield* Effect.fail(bundleError("unsafe-path"));
    return resolved;
  },
  Effect.catchTag("PlatformError", () => Effect.fail(bundleError("storage"))),
);

/** Allocate a private unique directory outside the repository; retain committed incomplete evidence on interruption.
 * Failed allocation cleanup remains a typed SdkEvidenceBundleError.
 */
export const createSdkEvidenceBundle = Effect.fnUntraced(
  function* (/** @type {{parentDirectory?:string, repositoryRoot:string}} */ options) {
    const fs = yield* FileSystem.FileSystem;
    const parent = options.parentDirectory ?? tmpdir();
    if (!path.isAbsolute(parent)) return yield* Effect.fail(bundleError("unsafe-path"));
    const root = yield* fs.realPath(options.repositoryRoot);
    const canonicalParent = yield* fs.realPath(parent);
    if (containsPath(root, canonicalParent)) return yield* Effect.fail(bundleError("unsafe-path"));
    const id = `ev-${yield* Effect.sync(randomUUID)}`;
    const directory = path.join(canonicalParent, id);
    const createdAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    return yield* Effect.acquireUseRelease(
      fs.makeDirectory(directory, { mode: 0o700 }).pipe(Effect.as(directory)),
      (ownedDirectory) =>
        fs
          .writeFileString(
            path.join(ownedDirectory, "evidence.incomplete.json"),
            JSON.stringify({ version: 1, id, createdAt, status: "incomplete" }),
            { mode: 0o600, flag: "wx" },
          )
          .pipe(Effect.as({ directory: ownedDirectory, id, createdAt })),
      (ownedDirectory, exit) =>
        Exit.isFailure(exit)
          ? fs
              .remove(ownedDirectory, { recursive: true, force: true })
              .pipe(Effect.mapError(() => bundleError("storage")))
          : Effect.void,
    );
  },
  Effect.catchTag("PlatformError", () => Effect.fail(bundleError("storage"))),
);

/** Write a bounded relative artifact atomically; existing symlink parents cannot redirect writes.
 * A typed cleanup failure can occur after publication; inspect the artifact before retrying.
 */
export const writeSdkEvidenceArtifact = Effect.fnUntraced(
  function* (/** @type {{directory:string,path:string,content:string|Uint8Array}} */ options) {
    const fs = yield* FileSystem.FileSystem;
    const relativePath = yield* parseEvidencePath(options.path).pipe(
      Effect.mapError(() => bundleError("unsafe-path")),
    );
    if (Buffer.byteLength(options.content) > 8 * 1024 * 1024)
      return yield* Effect.fail(bundleError("too-large"));
    const root = yield* fs.realPath(options.directory);
    const repositoryRoot = yield* fs.realPath(fileURLToPath(new URL("../", import.meta.url)));
    if (containsPath(repositoryRoot, root)) return yield* Effect.fail(bundleError("unsafe-path"));
    let parent = root;
    for (const segment of relativePath.split("/").slice(0, -1)) {
      const next = path.join(parent, segment);
      if (!(yield* fs.exists(next))) yield* fs.makeDirectory(next, { mode: 0o700 });
      parent = yield* fs.realPath(next);
      if (!containsPath(root, parent)) return yield* Effect.fail(bundleError("unsafe-path"));
    }
    const destination = path.join(parent, path.basename(relativePath));
    if (yield* fs.exists(destination)) yield* resolveSdkEvidenceArtifact(root, relativePath);
    const temporary = path.join(parent, `.evidence-${yield* Effect.sync(randomUUID)}.tmp`);
    yield* Effect.acquireUseRelease(
      fs
        .writeFile(temporary, Buffer.from(options.content), { mode: 0o600, flag: "wx" })
        .pipe(Effect.as(temporary)),
      (temporaryPath) => fs.rename(temporaryPath, destination),
      (temporaryPath) =>
        fs
          .remove(temporaryPath, { force: true })
          .pipe(Effect.mapError(() => bundleError("storage"))),
    );
  },
  Effect.catchTag("PlatformError", () => Effect.fail(bundleError("storage"))),
);

/** Read only a finalized bounded manifest; this never runs reproduction commands or opens a viewer. */
export const readSdkEvidenceBundle = Effect.fnUntraced(
  function* (/** @type {string} */ directory) {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(path.join(directory, "evidence.json"))))
      return yield* Effect.fail(bundleError("incomplete"));
    const manifestPath = yield* resolveSdkEvidenceArtifact(directory, "evidence.json");
    const info = yield* fs.stat(manifestPath);
    if (info.size > 1024 * 1024) return yield* Effect.fail(bundleError("too-large"));
    const manifest = yield* parseEvidenceJson(
      (yield* readEvidenceBytes(manifestPath, 1024 * 1024)).toString("utf8"),
    ).pipe(Effect.mapError(() => bundleError("invalid-manifest")));
    if (path.basename(path.resolve(directory)) !== manifest.id)
      return yield* Effect.fail(bundleError("identity-mismatch"));
    const warnings = [];
    for (const artifact of manifest.artifacts) {
      if (!(yield* fs.exists(path.join(directory, artifact.path)))) {
        const root = yield* fs.realPath(directory);
        let candidate = root;
        for (const segment of artifact.path.split("/")) {
          candidate = path.join(candidate, segment);
          const link = yield* fs.readLink(candidate).pipe(Effect.option);
          if (Option.isSome(link)) {
            const target = path.resolve(path.dirname(candidate), link.value);
            if (!containsPath(root, target)) return yield* Effect.fail(bundleError("unsafe-path"));
          }
          if (yield* fs.exists(candidate)) {
            candidate = yield* fs.realPath(candidate);
            if (!containsPath(root, candidate))
              return yield* Effect.fail(bundleError("unsafe-path"));
          }
        }
        warnings.push(`Artifact ${artifact.id} is missing; its evidence is unavailable.`);
      } else {
        yield* resolveSdkEvidenceArtifact(directory, artifact.path);
      }
    }
    return { ...manifest, limitations: [...manifest.limitations, ...warnings] };
  },
  Effect.catchTag("PlatformError", () => Effect.fail(bundleError("storage"))),
);

/** Remove terminal controls and directional formatting from displayed narrative. @param {string} text */
const cleanEvidenceText = (text) => text.replace(/[\p{Cc}\p{Cf}]/gu, " ");
/** Escape untrusted narrative as text, including terminal control characters. @param {string} text */
const escapeEvidenceHtml = (text) =>
  cleanEvidenceText(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
/** @param {string} text */
const escapeEvidenceMarkdown = (text) =>
  escapeEvidenceHtml(text).replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&");
/** Derive an exact loopback viewer link from parsed trace and span IDs; no event indexes are invented. @param {NonNullable<SdkEvidenceManifest['traceBookmarks']>[number]} bookmark */
export const sdkEvidenceBookmarkUrl = (bookmark) =>
  `${bookmark.viewerUrl.replace(/\/$/, "")}/traces/${bookmark.traceId}${bookmark.spanId === undefined ? "" : `?span=${bookmark.spanId}`}`;

/** Render terminal-safe plain text, Markdown and offline HTML; source time is never edited playback time. @param {SdkEvidenceManifest} manifest @param {{chapterId?:string}} options */
export function renderSdkEvidenceReview(manifest, options = {}) {
  const h = escapeEvidenceHtml;
  const m = escapeEvidenceMarkdown;
  const chapters = manifest.chapters.filter(
    (chapter) => options.chapterId === undefined || chapter.id === options.chapterId,
  );
  const outcomes = Object.entries(manifest.outcomes).map(
    ([name, outcome]) =>
      `${name}: ${outcome.status}${"errorTag" in outcome && outcome.errorTag ? ` — ${outcome.errorTag}` : ""}${"detail" in outcome && outcome.detail ? ` — ${outcome.detail}` : ""}`,
  );
  const limitations = [...new Set([...manifest.limitations, ...manifest.source.limitations])];
  const chapterTiming = /** @param {SdkEvidenceManifest['chapters'][number]} chapter */ (
    chapter,
  ) =>
    manifest.outcomes.recording.status === "not-requested"
      ? "Not recorded."
      : chapter.sourceStartMs === undefined &&
          chapter.sourceEndMs === undefined &&
          chapter.playbackStartMs === undefined
        ? "Chapter timing is unavailable; no source-to-video mapping is established."
        : `Source: ${chapter.sourceStartMs ?? "unmapped"}–${chapter.sourceEndMs ?? "unmapped"} ms; edited playback: ${chapter.playbackStartMs ?? "unmapped"} ms. Edited video is not a performance measurement.`;
  const isolatedHerdr = manifest.executionKind === "isolated-herdr";
  const executionLabel = isolatedHerdr
    ? "Isolated Herdr execution; this classification alone does not establish successful UI capture."
    : "Fixture evidence only; live Herdr UI was not exercised.";
  const frameLabel = isolatedHerdr
    ? "Captured isolated Herdr recording frame"
    : "Captured fixture recording frame";
  const header = `<h1>${h(manifest.scenario.title)}</h1><p><strong>Product: ${h(manifest.outcomes.product.status)}</strong> · ${h(executionLabel)}</p><p>Claim to review: ${h(manifest.claim)}</p><p>The claim is untrusted narrative. Assertions support only the named checks below.</p>`;
  const video = manifest.artifacts.find((artifact) => artifact.kind === "video");
  const frames = manifest.artifacts.filter((artifact) => artifact.kind === "frame");
  const poster =
    frames.find((artifact) => artifact.id === "review-poster") ??
    (frames.length === 1 ? frames[0] : undefined);
  const posterAttribute = poster === undefined ? "" : ` poster="${h(poster.path)}"`;
  const frameFallback =
    poster === undefined
      ? ""
      : `<details><summary>View captured frame if video does not load</summary><figure><a href="${h(poster.path)}"><img src="${h(poster.path)}" width="900" alt="${h(frameLabel)}"></a><figcaption>Frame from the source recording; not a separate assertion.</figcaption></figure></details>`;
  const payoff =
    (video === undefined
      ? "<p>No review video is available. Read the observed checks below.</p>"
      : `<p><a href="${h(video.path)}">Review video</a></p><video controls preload="metadata" width="900" src="${h(video.path)}"${posterAttribute}></video>`) +
    frameFallback;
  const sections = chapters
    .map((chapter) => {
      const checks = manifest.checks.filter((check) => check.chapterId === chapter.id);
      const times = chapterTiming(chapter);
      const traceLinks = (manifest.traceBookmarks ?? [])
        .filter((bookmark) => bookmark.chapterId === chapter.id)
        .map(
          (bookmark) => `<a href="${h(sdkEvidenceBookmarkUrl(bookmark))}">${h(bookmark.label)}</a>`,
        )
        .join(" · ");
      const playbackLink =
        video === undefined || chapter.playbackStartMs === undefined
          ? ""
          : `<a href="${h(video.path)}#t=${chapter.playbackStartMs / 1000}">Play chapter</a>`;
      return `<section id="${h(chapter.id)}"><h2>${h(chapter.title)}</h2><p>${h(chapter.caption)}</p><p>${h(times)}</p><p>${playbackLink} ${traceLinks}</p><ul>${checks.map((check) => `<li id="check-${h(check.id)}"><strong>${h(check.status)}: ${h(check.label)}</strong><br>Expected: ${h(check.expected)}<br>Observed: ${h(check.observed)}</li>`).join("")}</ul></section>`;
    })
    .join("\n");
  const artifacts = manifest.artifacts
    .map(
      (artifact) =>
        `<li><a href="${h(artifact.path)}">${h(artifact.id)} (${h(artifact.kind)})</a></li>`,
    )
    .join("");
  const bookmarks = (manifest.traceBookmarks ?? [])
    .map(
      (bookmark) =>
        `<li><a href="${h(sdkEvidenceBookmarkUrl(bookmark))}">${h(bookmark.label)}</a> (ephemeral viewer; availability is not guaranteed)</li>`,
    )
    .join("");
  const reproduction = JSON.stringify([
    manifest.reproduction.executable,
    ...manifest.reproduction.args,
  ]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width"><title>${isolatedHerdr ? "SDK isolated Herdr evidence" : "SDK fixture evidence"}</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:1rem;overflow-wrap:anywhere}video,img{max-width:100%;display:block}img{height:auto}figure{margin:1rem 0}li{margin:1rem 0}pre{white-space:pre-wrap}</style></head><body>${header}${payoff}<nav>${chapters.map((chapter) => `<a href="#${h(chapter.id)}">${h(chapter.title)}</a>`).join(" · ")}</nav><h2>Independent outcomes</h2><ul>${outcomes.map((outcome) => `<li>${h(outcome)}</li>`).join("")}</ul>${sections}<h2>Artifacts</h2><ul>${artifacts}</ul><h2>Trace bookmarks</h2><ul>${bookmarks}</ul><h2>Source</h2><p>${h(manifest.source.revision)}; dirty: ${manifest.source.dirty}; fingerprint: ${h(manifest.source.fingerprint)}</p><h2>Reproduction arguments (not executed)</h2><pre>${h(reproduction)}</pre><h2>Limitations</h2><ul>${limitations.map((text) => `<li>${h(text)}</li>`).join("")}</ul></body></html>`;
  const markdown =
    [
      `# ${m(manifest.scenario.title)}`,
      `**Product: ${m(manifest.outcomes.product.status)}** — ${executionLabel}`,
      `Claim to review: ${m(manifest.claim)}`,
      "The claim is untrusted narrative. Assertions support only the named checks below.",
      ...(video === undefined ? [] : [`[Review video](${video.path})`]),
      `Bundle: ${m(manifest.id)}`,
      "## Independent outcomes",
      ...outcomes.map((outcome) => `- ${m(outcome)}`),
      ...chapters.flatMap((chapter) => [
        `## ${m(chapter.title)} (${m(chapter.id)})`,
        m(chapter.caption),
        m(chapterTiming(chapter)),
        ...manifest.checks
          .filter((check) => check.chapterId === chapter.id)
          .map(
            (check) =>
              `- ${m(check.status)}: ${m(check.label)}; expected: ${m(check.expected)}; observed: ${m(check.observed)}`,
          ),
      ]),
      "## Artifacts",
      ...manifest.artifacts.map((artifact) => `- [${m(artifact.id)}](${artifact.path})`),
      "## Trace bookmarks",
      ...(manifest.traceBookmarks ?? []).map(
        (bookmark) =>
          `- [${m(bookmark.label)}](${sdkEvidenceBookmarkUrl(bookmark)}) — ephemeral viewer; availability is not guaranteed`,
      ),
      "## Reproduction arguments (not executed)",
      `    ${cleanEvidenceText(reproduction)}`,
      "## Source",
      m(
        `${manifest.source.revision}; dirty: ${manifest.source.dirty}; fingerprint: ${manifest.source.fingerprint}`,
      ),
      "## Limitations",
      ...limitations.map((text) => `- ${m(text)}`),
    ].join("\n\n") + "\n";
  const text =
    [
      manifest.scenario.title,
      `Product: ${manifest.outcomes.product.status} — ${executionLabel}`,
      `Claim to review: ${manifest.claim}`,
      "The claim is untrusted narrative. Assertions support only the named checks below.",
      `Bundle: ${manifest.id}`,
      ...(video === undefined ? [] : [`Review video: ${video.path}`]),
      "Independent outcomes",
      ...outcomes,
      ...chapters.flatMap((chapter) => [
        `${chapter.title} (${chapter.id})`,
        chapter.caption,
        chapterTiming(chapter),
        ...manifest.checks
          .filter((check) => check.chapterId === chapter.id)
          .map(
            (check) =>
              `${check.status}: ${check.label}\nExpected: ${check.expected}\nObserved: ${check.observed}`,
          ),
      ]),
      "Artifacts",
      ...manifest.artifacts.map((artifact) => `${artifact.id}: ${artifact.path}`),
      "Trace bookmarks",
      ...(manifest.traceBookmarks ?? []).map(
        (bookmark) => `${bookmark.label}: ${sdkEvidenceBookmarkUrl(bookmark)} (ephemeral viewer)`,
      ),
      "Reproduction arguments (not executed)",
      reproduction,
      "Source",
      `${manifest.source.revision}; dirty: ${manifest.source.dirty}; fingerprint: ${manifest.source.fingerprint}`,
      "Limitations",
      ...limitations,
    ]
      .map(cleanEvidenceText)
      .join("\n\n") + "\n";
  return { html, markdown, text };
}

/** Publish reviews before the manifest atomically; re-finalization updates presentation without rerunning scenarios. */
export const finalizeSdkEvidenceBundle = Effect.fnUntraced(
  function* (/** @type {{directory:string,manifest:SdkEvidenceManifest}} */ options) {
    const fs = yield* FileSystem.FileSystem;
    const manifest = yield* parseSdkEvidenceManifest(options.manifest).pipe(
      Effect.mapError(() => bundleError("invalid-manifest")),
    );
    if (path.basename(path.resolve(options.directory)) !== manifest.id)
      return yield* Effect.fail(bundleError("identity-mismatch"));
    const serialized = JSON.stringify(manifest, null, 2) + "\n";
    if (Buffer.byteLength(serialized) > 1024 * 1024)
      return yield* Effect.fail(bundleError("too-large"));
    if (yield* fs.exists(path.join(options.directory, "evidence.json"))) {
      const original = yield* readSdkEvidenceBundle(options.directory);
      const executionFacts = /** @param {SdkEvidenceManifest} evidence */ (evidence) =>
        JSON.stringify({
          id: evidence.id,
          createdAt: evidence.createdAt,
          scenario: evidence.scenario,
          executionKind: evidence.executionKind ?? "fixture",
          claim: evidence.claim,
          source: evidence.source,
          reproduction: evidence.reproduction,
          checks: evidence.checks,
          product: evidence.outcomes.product,
        });
      if (executionFacts(original) !== executionFacts(manifest))
        return yield* Effect.fail(bundleError("identity-mismatch"));
    }
    for (const artifact of manifest.artifacts)
      yield* resolveSdkEvidenceArtifact(options.directory, artifact.path);
    const review = renderSdkEvidenceReview(manifest);
    yield* writeSdkEvidenceArtifact({
      directory: options.directory,
      path: "review.md",
      content: review.markdown,
    });
    yield* writeSdkEvidenceArtifact({
      directory: options.directory,
      path: "review.html",
      content: review.html,
    });
    yield* writeSdkEvidenceArtifact({
      directory: options.directory,
      path: "evidence.json",
      content: serialized,
    });
    yield* fs.remove(path.join(options.directory, "evidence.incomplete.json"), { force: true });
    return manifest;
  },
  Effect.catchTag("PlatformError", () => Effect.fail(bundleError("storage"))),
);

/** Hash explicit relevant source bytes only, with bounded git metadata and concurrent-edit uncertainty. */
export const fingerprintSdkEvidenceSource = Effect.fnUntraced(
  function* (/** @type {{repositoryRoot:string,files:ReadonlyArray<string>}} */ options) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const files = [...new Set(options.files)].sort();
    if (files.length > 256) return yield* Effect.fail(bundleError("too-large"));
    const hash = createHash("sha256");
    let bytes = 0;
    let changed = false;
    for (const file of files) {
      const sourcePath = yield* resolveSdkEvidenceArtifact(options.repositoryRoot, file);
      const before = yield* fs.stat(sourcePath);
      bytes += Number(before.size);
      if (bytes > 8 * 1024 * 1024) return yield* Effect.fail(bundleError("too-large"));
      const content = yield* readEvidenceBytes(
        sourcePath,
        8 * 1024 * 1024 - (bytes - Number(before.size)),
      );
      const after = yield* fs.stat(sourcePath);
      changed ||=
        before.size !== after.size || JSON.stringify(before.mtime) !== JSON.stringify(after.mtime);
      hash.update(file).update("\0").update(content).update("\0");
    }
    const git = /** @param {ReadonlyArray<string>} args */ (args) =>
      Effect.gen(function* () {
        const process = yield* spawner.spawn(
          ChildProcess.make("git", ["--no-optional-locks", "-C", options.repositoryRoot, ...args], {
            extendEnv: false,
            env: {
              PATH: "/usr/bin:/bin",
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "ignore",
          }),
        );
        const output = yield* Stream.runFold(
          process.stdout,
          () => "",
          (text, chunk) => (text + Buffer.from(chunk).toString("utf8")).slice(0, 8192),
        );
        if ((yield* process.exitCode) !== 0)
          return yield* Effect.fail(bundleError("source-unavailable"));
        return output.trim();
      });
    const revision = yield* git(["rev-parse", "HEAD"]);
    const dirty = (yield* git(["status", "--porcelain", "--untracked-files=normal"])) !== "";
    return {
      revision,
      dirty,
      fingerprint: hash.digest("hex"),
      files,
      limitations: [
        "Fingerprint covers only the listed source files, not dependencies or artifacts.",
        "Source capture is not an atomic snapshot; concurrent edits before or after capture remain possible.",
        ...(changed
          ? ["A source file changed during capture; this fingerprint is uncertain."]
          : []),
      ],
    };
  },
  Effect.scoped,
  Effect.timeout("10 seconds"),
  Effect.catchTags({
    PlatformError: () => Effect.fail(bundleError("source-unavailable")),
    TimeoutError: () => Effect.fail(bundleError("source-unavailable")),
  }),
);
