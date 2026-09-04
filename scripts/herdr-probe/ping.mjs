import { Effect } from "effect";
import { HerdrSdk, herdrSdkLayerFromOptions } from "../../dist/index.mjs";

const socketPath = process.env.HERDR_SOCKET_PATH;
const expectedProtocol = Number(process.env.EXPECT_PROTOCOL);
const expectFailure = process.env.EXPECT_FAILURE === "1";

if (!socketPath) {
  console.error("HERDR_SOCKET_PATH is required");
  process.exit(1);
}

if (!Number.isInteger(expectedProtocol)) {
  console.error("EXPECT_PROTOCOL must be an integer");
  process.exit(1);
}

const ping = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  return yield* herdr.server.ping();
}).pipe(Effect.provide(herdrSdkLayerFromOptions({ socketPath })));

try {
  const value = await Effect.runPromise(ping);
  const result = { version: value.version, protocol: value.protocol };
  console.log(JSON.stringify(result));
  if (expectFailure) {
    console.error(`expected HerdrUnsupportedProtocol for protocol ${expectedProtocol}`);
    process.exit(1);
  }
  if (result.protocol !== expectedProtocol) {
    console.error(`expected protocol ${expectedProtocol}, got ${result.protocol}`);
    process.exit(1);
  }
} catch (error) {
  const failure =
    error && typeof error === "object" && "_tag" in error
      ? {
          _tag: error._tag,
          actualProtocol: error.actualProtocol,
          supportedProtocols: error.supportedProtocols,
        }
      : { _tag: "unknown", message: String(error) };
  console.log(JSON.stringify(failure));
  if (!expectFailure) {
    console.error(`expected protocol ${expectedProtocol} success`);
    process.exit(1);
  }
  if (failure._tag !== "HerdrUnsupportedProtocol" || failure.actualProtocol !== expectedProtocol) {
    console.error(`expected HerdrUnsupportedProtocol actualProtocol=${expectedProtocol}`);
    process.exit(1);
  }
}
