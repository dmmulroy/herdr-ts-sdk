import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, PlatformError } from "effect";
import { expect, test } from "vite-plus/test";
import path from "node:path";
import {
  createSdkEvidenceBundle,
  finalizeSdkEvidenceBundle,
  fingerprintSdkEvidenceSource,
  readSdkEvidenceBundle,
  renderSdkEvidenceReview,
  resolveSdkEvidenceArtifact,
  writeSdkEvidenceArtifact,
  type SdkEvidenceManifest,
} from "./sdk-evidence-bundle.mjs";
import { runSdkToolingTest } from "./sdk-tooling-test-runtime.ts";
import { runVerificationCommand } from "./sdk-verification-process.mjs";

const repositoryRoot = process.cwd();
const fixtureManifest = (bundle: { id: string; createdAt: string }): SdkEvidenceManifest => ({
  version: 1,
  id: bundle.id,
  createdAt: bundle.createdAt,
  scenario: { id: "fixture", title: "Fixture recovery" },
  claim: '<script>alert("x")</script> [link](javascript:alert)\u001b[31m',
  source: {
    revision: "test",
    dirty: true,
    fingerprint: "fixture",
    files: [],
    limitations: ["Nonatomic source snapshot"],
  },
  reproduction: { executable: "node", args: ["scripts/sdk-evidence.mjs", "run", "fixture"] },
  checks: [
    {
      id: "recovered",
      chapterId: "recovery",
      label: "Recovery",
      expected: "ready",
      observed: "ready",
      status: "passed",
    },
  ],
  chapters: [
    {
      id: "recovery",
      title: "Recovery",
      caption: "Observed fixture result",
      checkIds: ["recovered"],
      sourceStartMs: 1,
      sourceEndMs: 2,
      playbackStartMs: 1000,
    },
  ],
  outcomes: {
    product: { status: "passed" },
    telemetry: { status: "unavailable", detail: "not HTTP accepted" },
    viewer: { status: "unavailable" },
    recording: { status: "not-requested" },
    render: { status: "not-requested" },
    cleanup: { status: "passed" },
  },
  artifacts: [],
  limitations: ["No live Herdr control"],
  related: [],
});

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const parentDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "sdk-evidence-test-" });
  const bundle = yield* createSdkEvidenceBundle({ parentDirectory, repositoryRoot });
  return { fs, parentDirectory, bundle, manifest: fixtureManifest(bundle) };
});

test("allocation is unique and incomplete until reviews and manifest are finalized", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, parentDirectory, bundle, manifest } = yield* fixture;
      const second = yield* createSdkEvidenceBundle({ parentDirectory, repositoryRoot });
      expect(second.id).not.toBe(bundle.id);
      expect(Exit.isFailure(yield* Effect.exit(readSdkEvidenceBundle(bundle.directory)))).toBe(
        true,
      );
      expect(yield* fs.exists(path.join(bundle.directory, "evidence.incomplete.json"))).toBe(true);
      yield* finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest });
      expect(yield* readSdkEvidenceBundle(bundle.directory)).toEqual(manifest);
      expect(yield* fs.exists(path.join(bundle.directory, "review.md"))).toBe(true);
      expect(yield* fs.exists(path.join(bundle.directory, "review.html"))).toBe(true);
      expect(yield* fs.exists(path.join(bundle.directory, "evidence.incomplete.json"))).toBe(false);
    }),
  ));

test("execution classification roundtrips and cannot be changed by rerendering", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { parentDirectory } = yield* fixture;
      for (const executionKind of [undefined, "fixture", "isolated-herdr"] as const) {
        const bundle = yield* createSdkEvidenceBundle({ parentDirectory, repositoryRoot });
        const original = fixtureManifest(bundle);
        const manifest = executionKind === undefined ? original : { ...original, executionKind };
        yield* finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest });
        expect(yield* readSdkEvidenceBundle(bundle.directory)).toEqual(manifest);
        const alternate = executionKind === "isolated-herdr" ? "fixture" : "isolated-herdr";
        const failure = yield* finalizeSdkEvidenceBundle({
          directory: bundle.directory,
          manifest: { ...manifest, executionKind: alternate },
        }).pipe(Effect.flip);
        expect(failure.reason).toBe("identity-mismatch");
        if (executionKind === undefined) {
          yield* finalizeSdkEvidenceBundle({
            directory: bundle.directory,
            manifest: { ...manifest, executionKind: "fixture" },
          });
        }
      }
    }),
  ));

test("unavailable real prerequisites persist without claiming product failure or UI success", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { bundle, manifest } = yield* fixture;
      const unavailable: SdkEvidenceManifest = {
        ...manifest,
        executionKind: "isolated-herdr",
        checks: [],
        chapters: [],
        outcomes: {
          ...manifest.outcomes,
          product: { status: "unavailable", errorTag: "SdkHerdrSandboxError" },
          recording: { status: "unavailable", detail: "Required recorder is unavailable." },
        },
      };
      yield* finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest: unavailable });
      const stored = yield* readSdkEvidenceBundle(bundle.directory);
      expect(stored).toEqual(unavailable);
      const review = renderSdkEvidenceReview(stored);
      for (const rendered of [review.html, review.markdown, review.text]) {
        expect(rendered).toContain("Product: unavailable");
        expect(rendered).not.toContain("Product: failed");
        expect(rendered).not.toContain("Fixture evidence only");
        expect(rendered).toContain("recording: unavailable");
      }
    }),
  ));

test("unknown persisted execution classification fails inspection instead of becoming fixture proof", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, bundle, manifest } = yield* fixture;
      yield* fs.writeFileString(
        path.join(bundle.directory, "evidence.json"),
        JSON.stringify({ ...manifest, executionKind: "ambient-herdr" }),
      );
      const failure = yield* readSdkEvidenceBundle(bundle.directory).pipe(Effect.flip);
      expect(failure.reason).toBe("invalid-manifest");
    }),
  ));

test("review classification never invents UI capture success from product checks or scenario names", () => {
  const original = fixtureManifest({ id: "ev-test", createdAt: "2026-01-01T00:00:00.000Z" });
  for (const executionKind of [undefined, "fixture", "isolated-herdr"] as const) {
    const base = {
      ...original,
      scenario: { id: "herdr-sdk-workflow", title: "Herdr SDK workflow" },
      artifacts: [{ id: "review-poster", kind: "frame" as const, path: "poster.png" }],
    };
    const manifest = executionKind === undefined ? base : { ...base, executionKind };
    const review = renderSdkEvidenceReview(manifest);
    for (const rendered of [review.html, review.markdown, review.text]) {
      expect(rendered).toMatch(/recording: not\\?-requested/);
      expect(rendered).toContain("telemetry: unavailable");
      expect(rendered).toContain(
        executionKind === "isolated-herdr"
          ? "this classification alone does not establish successful UI capture"
          : "Fixture evidence only; live Herdr UI was not exercised",
      );
    }
    expect(review.html).toContain(
      executionKind === "isolated-herdr"
        ? "Captured isolated Herdr recording frame"
        : "Captured fixture recording frame",
    );
  }
});

test("review escapes narrative and preserves independent outcomes and both clocks", () => {
  const manifest = fixtureManifest({ id: "ev-test", createdAt: "2026-01-01T00:00:00.000Z" });
  const review = renderSdkEvidenceReview({
    ...manifest,
    outcomes: { ...manifest.outcomes, recording: { status: "passed" } },
  });
  expect(review.html).not.toContain("<script>");
  expect(review.html).not.toContain("\u001b");
  expect(review.html).toContain("&lt;script&gt;");
  expect(review.html).toContain("product: passed");
  expect(review.html).toContain("telemetry: unavailable");
  expect(review.html).toContain('id="recovery"');
  expect(review.html).toContain("edited playback: 1000 ms");
  expect(review.markdown).not.toContain("[link](javascript:");
  expect(review.text).not.toContain("&quot;");
  expect(review.text).not.toContain("\\[link");
  expect(review.markdown).toContain('    ["node","scripts/sdk-evidence.mjs","run","fixture"]');
});

test("unsafe artifact paths and symlink escapes cannot be read or written", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, parentDirectory, bundle } = yield* fixture;
      yield* fs.writeFileString(path.join(parentDirectory, "secret.txt"), "outside sentinel");
      yield* fs.symlink(parentDirectory, path.join(bundle.directory, "escape"));
      for (const artifactPath of [
        "../secret.txt",
        "%2e%2e/secret.txt",
        "/tmp/secret.txt",
        "escape/secret.txt",
        "a\\b",
        "./secret.txt",
        "https://evil.test",
      ]) {
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              writeSdkEvidenceArtifact({
                directory: bundle.directory,
                path: artifactPath,
                content: "overwrite",
              }),
            ),
          ),
        ).toBe(true);
        expect(
          Exit.isFailure(
            yield* Effect.exit(resolveSdkEvidenceArtifact(bundle.directory, artifactPath)),
          ),
        ).toBe(true);
      }
      expect(yield* fs.readFileString(path.join(parentDirectory, "secret.txt"))).toBe(
        "outside sentinel",
      );
    }),
  ));

test("canonical repository parent is rejected through a symlink", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, parentDirectory } = yield* fixture;
      const link = path.join(parentDirectory, "repo");
      yield* fs.symlink(repositoryRoot, link);
      expect(
        Exit.isFailure(
          yield* Effect.exit(createSdkEvidenceBundle({ repositoryRoot, parentDirectory: link })),
        ),
      ).toBe(true);
    }),
  ));

test("failed manifest validation never publishes a final manifest", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, bundle, manifest } = yield* fixture;
      const invalid = { ...manifest, checks: [...manifest.checks, ...manifest.checks] };
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest: invalid }),
          ),
        ),
      ).toBe(true);
      expect(yield* fs.exists(path.join(bundle.directory, "evidence.json"))).toBe(false);
      const missingArtifact = {
        ...manifest,
        artifacts: [{ id: "missing", kind: "video" as const, path: "missing.mp4" }],
      };
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest: missingArtifact }),
          ),
        ),
      ).toBe(true);
      expect(yield* fs.exists(path.join(bundle.directory, "evidence.json"))).toBe(false);
    }),
  ));

test("rerender changes presentation independently and includes offline video controls", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, bundle, manifest } = yield* fixture;
      yield* finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest });
      yield* writeSdkEvidenceArtifact({
        directory: bundle.directory,
        path: "presentation/review.mp4",
        content: "synthetic fixture",
      });
      const updated: SdkEvidenceManifest = {
        ...manifest,
        artifacts: [{ id: "video", kind: "video", path: "presentation/review.mp4" }],
        outcomes: { ...manifest.outcomes, render: { status: "passed" } },
      };
      yield* finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest: updated });
      const read = yield* readSdkEvidenceBundle(bundle.directory);
      expect(read.outcomes.product).toEqual(manifest.outcomes.product);
      expect(read.outcomes.render.status).toBe("passed");
      expect(yield* fs.readFileString(path.join(bundle.directory, "review.html"))).toContain(
        '<video controls preload="metadata"',
      );
    }),
  ));

test("oversized and malformed stored manifests fail bounded inspection", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, bundle } = yield* fixture;
      for (const content of ["{invalid", " ".repeat(1024 * 1024 + 1)]) {
        yield* fs.writeFileString(path.join(bundle.directory, "evidence.json"), content);
        expect(Exit.isFailure(yield* Effect.exit(readSdkEvidenceBundle(bundle.directory)))).toBe(
          true,
        );
      }
    }),
  ));

test("source fingerprint distinguishes an owned clean checkout from changed and untracked bytes", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "evidence-source-" });
      const git = (args: readonly string[]) =>
        runVerificationCommand("git", ["-C", directory, ...args], {
          capture: true,
          env: {
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: path.join(directory, "no-global-config"),
          },
        });
      yield* fs.writeFileString(path.join(directory, "source.txt"), "original\n");
      for (const args of [
        ["init"],
        ["add", "source.txt"],
        [
          "-c",
          "user.name=Evidence Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-m",
          "fixture",
        ],
      ]) {
        const result = yield* git(args);
        expect(result.status, result.output).toBe("pass");
      }
      const capture = () =>
        fingerprintSdkEvidenceSource({ repositoryRoot: directory, files: ["source.txt"] });
      const clean = yield* capture();
      expect(clean.dirty).toBe(false);
      yield* fs.writeFileString(path.join(directory, "source.txt"), "changed\n");
      const changed = yield* capture();
      expect(changed.dirty).toBe(true);
      expect(changed.fingerprint).not.toBe(clean.fingerprint);
      expect(changed.revision).toBe(clean.revision);
      yield* fs.writeFileString(path.join(directory, "source.txt"), "original\n");
      yield* fs.writeFileString(path.join(directory, "untracked.txt"), "untracked\n");
      const untracked = yield* capture();
      expect(untracked.dirty).toBe(true);
      expect(untracked.fingerprint).toBe(clean.fingerprint);
      for (const source of [clean, changed, untracked]) {
        expect(source.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(source.files).toEqual(["source.txt"]);
        expect(JSON.stringify(source)).not.toContain(directory);
        expect(source.limitations.join(" ")).toContain("not an atomic snapshot");
      }
    }),
  ));

test("read detects substituted artifacts and reports missing snapshots without inventing success", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, parentDirectory, bundle, manifest } = yield* fixture;
      yield* writeSdkEvidenceArtifact({
        directory: bundle.directory,
        path: "trace.json",
        content: "{}",
      });
      yield* finalizeSdkEvidenceBundle({
        directory: bundle.directory,
        manifest: { ...manifest, artifacts: [{ id: "trace", kind: "trace", path: "trace.json" }] },
      });
      yield* fs.remove(path.join(bundle.directory, "trace.json"));
      const missing = yield* readSdkEvidenceBundle(bundle.directory);
      expect(missing.limitations.join(" ")).toContain("Artifact trace is missing");
      expect(missing.outcomes.product.status).toBe("passed");
      yield* fs.writeFileString(path.join(parentDirectory, "external.json"), "outside");
      yield* fs.symlink(
        path.join(parentDirectory, "external.json"),
        path.join(bundle.directory, "trace.json"),
      );
      const exit = yield* Effect.exit(readSdkEvidenceBundle(bundle.directory));
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  ));

test("rerender cannot relabel the original product assertion or source evidence", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { bundle, manifest } = yield* fixture;
      yield* finalizeSdkEvidenceBundle({ directory: bundle.directory, manifest });
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            finalizeSdkEvidenceBundle({
              directory: bundle.directory,
              manifest: { ...manifest, claim: "A different claim" },
            }),
          ),
        ),
      ).toBe(true);
      expect(yield* readSdkEvidenceBundle(bundle.directory)).toEqual(manifest);
    }),
  ));

test("parallel allocations cannot collide and failed reference integrity never finalizes", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { parentDirectory, bundle, manifest } = yield* fixture;
      const allocations = yield* Effect.all(
        Array.from({ length: 8 }, () =>
          createSdkEvidenceBundle({ parentDirectory, repositoryRoot }),
        ),
        { concurrency: "unbounded" },
      );
      expect(new Set(allocations.map((allocation) => allocation.id)).size).toBe(8);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            finalizeSdkEvidenceBundle({
              directory: bundle.directory,
              manifest: { ...manifest, chapters: [] },
            }),
          ),
        ),
      ).toBe(true);
    }),
  ));

test.for(["succeeds", "fails"] as const)(
  "interruption before the incomplete marker preserves typed errors when cleanup %s",
  (cleanup, context) =>
    runSdkToolingTest(
      context,
      Effect.gen(function* () {
        const { fs, parentDirectory, bundle } = yield* fixture;
        const markerStarted = yield* Deferred.make<void>();
        const writeFileString: typeof fs.writeFileString = (filePath, content, options) =>
          path.basename(filePath) === "evidence.incomplete.json"
            ? Deferred.succeed(markerStarted, undefined).pipe(Effect.andThen(Effect.never))
            : fs.writeFileString(filePath, content, options);
        const remove: typeof fs.remove = (filePath, options) =>
          cleanup === "fails"
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: filePath,
                  description: "secret-storage-error",
                }),
              )
            : fs.remove(filePath, options);
        const fiber = yield* createSdkEvidenceBundle({ repositoryRoot, parentDirectory }).pipe(
          Effect.provideService(FileSystem.FileSystem, { ...fs, writeFileString, remove }),
          Effect.forkScoped,
        );
        yield* Deferred.await(markerStarted);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        // acquireUseRelease reports a failed release instead of the interrupted use.
        expect(Exit.hasInterrupts(exit)).toBe(cleanup === "succeeds");
        expect(Exit.hasDies(exit)).toBe(false);
        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.filter(Cause.isFailReason).map(({ error }) => error)).toEqual(
            cleanup === "fails"
              ? [expect.objectContaining({ _tag: "SdkEvidenceBundleError", reason: "storage" })]
              : [],
          );
        }
        expect(JSON.stringify(exit)).not.toContain(parentDirectory);
        expect(JSON.stringify(exit)).not.toContain("secret-storage-error");
        const entries = yield* fs.readDirectory(parentDirectory);
        expect(entries).toContain(bundle.id);
        expect(entries).toHaveLength(cleanup === "fails" ? 2 : 1);
        for (const entry of entries.filter((id) => id !== bundle.id)) {
          expect(yield* fs.readDirectory(path.join(parentDirectory, entry))).toEqual([]);
        }
        expect(yield* fs.exists(path.join(bundle.directory, "evidence.incomplete.json"))).toBe(
          true,
        );
      }),
    ),
);

test("artifact cleanup failures remain typed even after publication succeeds", (context) =>
  runSdkToolingTest(
    context,
    Effect.gen(function* () {
      const { fs, bundle } = yield* fixture;
      const remove: typeof fs.remove = (filePath) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "remove",
            pathOrDescriptor: filePath,
            description: "secret-storage-error",
          }),
        );
      const error = yield* writeSdkEvidenceArtifact({
        directory: bundle.directory,
        path: "scenario.json",
        content: "{}",
      }).pipe(Effect.provideService(FileSystem.FileSystem, { ...fs, remove }), Effect.flip);
      expect(error).toMatchObject({ _tag: "SdkEvidenceBundleError", reason: "storage" });
      expect(JSON.stringify(error)).not.toContain(bundle.directory);
      expect(JSON.stringify(error)).not.toContain("secret-storage-error");
      expect(yield* fs.readFileString(path.join(bundle.directory, "scenario.json"))).toBe("{}");
      expect(yield* fs.exists(path.join(bundle.directory, "evidence.incomplete.json"))).toBe(true);
      expect(yield* fs.exists(path.join(bundle.directory, "evidence.json"))).toBe(false);
    }),
  ));

test("review uses the named captured poster with an escaped offline image fallback", () => {
  const manifest = fixtureManifest({ id: "ev-test", createdAt: "2026-01-01T00:00:00.000Z" });
  const review = renderSdkEvidenceReview({
    ...manifest,
    artifacts: [
      { id: "video", kind: "video", path: 'review".mp4' },
      { id: "other-frame", kind: "frame", path: "other.png" },
      { id: "review-poster", kind: "frame", path: 'frames/payoff".png' },
    ],
  });
  expect(review.html).toContain('src="review&quot;.mp4" poster="frames/payoff&quot;.png"');
  expect(review.html).toContain(
    '<img src="frames/payoff&quot;.png" width="900" alt="Captured fixture recording frame">',
  );
  expect(review.html).not.toContain('poster="other.png"');
  expect(review.html).toContain("img-src 'self'");
  expect(review.html).toContain("View captured frame if video does not load");
  expect(review.text).not.toContain("&quot;");
});

test("review selects a sole frame but never guesses between unnamed frames", () => {
  const manifest = fixtureManifest({ id: "ev-test", createdAt: "2026-01-01T00:00:00.000Z" });
  const artifacts: SdkEvidenceManifest["artifacts"] = [
    { id: "video", kind: "video", path: "review.mp4" },
    { id: "capture", kind: "frame", path: "frames/capture.png" },
  ];
  expect(renderSdkEvidenceReview({ ...manifest, artifacts }).html).toContain(
    'poster="frames/capture.png"',
  );
  const ambiguous = renderSdkEvidenceReview({
    ...manifest,
    artifacts: [...artifacts, { id: "second", kind: "frame", path: "frames/second.png" }],
  });
  expect(ambiguous.html).not.toContain(" poster=");
  expect(ambiguous.html).not.toContain("<img ");
});

test("trace review links are exact and controls cannot reorder displayed narrative", () => {
  const manifest = fixtureManifest({ id: "ev-test", createdAt: "2026-01-01T00:00:00.000Z" });
  const review = renderSdkEvidenceReview({
    ...manifest,
    claim: "fixture\u009b31m\u202eevil",
    traceBookmarks: [
      {
        id: "trace",
        label: "Observed recovery",
        chapterId: "recovery",
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        viewerUrl: "http://127.0.0.1:8000",
      },
    ],
    limitations: ["duplicate", "duplicate"],
  });
  const link = `http://127.0.0.1:8000/traces/${"a".repeat(32)}?span=${"b".repeat(16)}`;
  for (const rendered of [review.html, review.markdown, review.text]) {
    expect(rendered).not.toMatch(/[\u009b\u202e]/);
    expect(rendered).toContain(link);
    expect(rendered.match(/duplicate/g)).toHaveLength(1);
    expect(rendered).toContain("Not recorded");
  }
});
