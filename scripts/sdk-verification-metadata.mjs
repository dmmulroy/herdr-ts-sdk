import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";

const protocolNumber = Schema.Int.check(Schema.isGreaterThan(0));
const releaseVersion = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/));
const protocolManifest = Schema.Struct({
  version: releaseVersion,
  herdr: Schema.Struct({
    version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/)),
    protocol: protocolNumber,
    upstreamCommit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  }),
});
const protocolSchema = Schema.Struct({ protocol: protocolNumber });
const parseProtocolManifest = Schema.decodeEffect(Schema.fromJsonString(protocolManifest));
const parseProtocolSchema = Schema.decodeEffect(Schema.fromJsonString(protocolSchema));

/**
 * SDK versions track the targeted Herdr release: `MAJOR.MINOR` match Herdr and the SDK patch is
 * `herdrPatch * 100 + sdkRevision`, so Herdr 0.9.5 maps to SDK 0.9.500–0.9.599.
 *
 * @param {string} sdkVersion
 * @param {string} herdrVersion
 * @returns {string | undefined} the mismatch detail, or `undefined` when aligned
 */
export const checkSdkVersionTracksHerdrVersion = (sdkVersion, herdrVersion) => {
  const [sdkMajor = NaN, sdkMinor = NaN, sdkPatch = NaN] = sdkVersion.split(/[.-]/).map(Number);
  const [herdrMajor = NaN, herdrMinor = NaN, herdrPatch = NaN] = herdrVersion
    .split(".")
    .map(Number);
  if (
    sdkMajor === herdrMajor &&
    sdkMinor === herdrMinor &&
    Math.floor(sdkPatch / 100) === herdrPatch
  ) {
    return undefined;
  }
  return `package.json version ${sdkVersion} must be ${herdrMajor}.${herdrMinor}.${herdrPatch * 100}–${herdrMajor}.${herdrMinor}.${herdrPatch * 100 + 99} for herdr.version ${herdrVersion}`;
};

/** Compare bundled protocol metadata only; the recorded upstream commit is not independently verified. */
export const checkVerificationProtocol = Effect.fn("checkVerificationProtocol")(
  /** @param {string} directory */
  function* (directory) {
    const fs = yield* FileSystem.FileSystem;
    const manifest = yield* parseProtocolManifest(
      yield* fs.readFileString(join(directory, "package.json")),
    );
    const schema = yield* parseProtocolSchema(
      yield* fs.readFileString(join(directory, "schema/herdr-api.schema.json")),
    );
    if (manifest.herdr.protocol !== schema.protocol) {
      return { status: "fail", detail: "package.json herdr.protocol must equal schema.protocol" };
    }
    const versionMismatch = checkSdkVersionTracksHerdrVersion(
      manifest.version,
      manifest.herdr.version,
    );
    if (versionMismatch !== undefined) {
      return { status: "fail", detail: versionMismatch };
    }
    return {
      status: "pass",
      detail: `Herdr ${manifest.herdr.version}; protocol ${schema.protocol}; recorded upstreamCommit ${manifest.herdr.upstreamCommit} (not independently verified)`,
    };
  },
  Effect.catch((error) =>
    Effect.succeed({
      status: "fail",
      detail: `Protocol metadata unavailable or invalid (${error._tag})`,
    }),
  ),
);
