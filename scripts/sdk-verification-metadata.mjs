import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";

const protocolNumber = Schema.Int.check(Schema.isGreaterThan(0));
const protocolManifest = Schema.Struct({
  herdr: Schema.Struct({
    protocol: protocolNumber,
    upstreamCommit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  }),
});
const protocolSchema = Schema.Struct({ protocol: protocolNumber });
const parseProtocolManifest = Schema.decodeEffect(Schema.fromJsonString(protocolManifest));
const parseProtocolSchema = Schema.decodeEffect(Schema.fromJsonString(protocolSchema));

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
    return {
      status: "pass",
      detail: `protocol ${schema.protocol}; recorded upstreamCommit ${manifest.herdr.upstreamCommit} (not independently verified)`,
    };
  },
  Effect.catch((error) =>
    Effect.succeed({
      status: "fail",
      detail: `Protocol metadata unavailable or invalid (${error._tag})`,
    }),
  ),
);
