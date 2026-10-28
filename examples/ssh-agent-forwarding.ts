import { Effect, Option } from "effect";
import { HerdrSdk } from "herdr-sdk";
import { runHerdrExample } from "./example-runtime.ts";

const sshAgentForwarding = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;
  const server = yield* herdr.server.ping();
  const supported = Option.match(server.capabilities, {
    onNone: () => false,
    onSome: (capabilities) => capabilities.sshAgentRegistration,
  });
  if (!supported) {
    return yield* Effect.logWarning(
      `Herdr ${server.version} does not accept SSH agent registration on this platform`,
    );
  }
  const socketPath = process.env.SSH_AUTH_SOCK;
  if (socketPath === undefined || socketPath === "") {
    return yield* Effect.logWarning("Set SSH_AUTH_SOCK to the agent socket you want to forward");
  }

  // The registration lasts exactly as long as this callback; interruption releases it.
  yield* herdr.server.sshAgent.withRegistration({ socketPath }, (registration) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `Offered SSH agent ${registration.socketPath} to Herdr panes; interrupt the process to stop`,
      );
      return yield* registration.awaitClosed();
    }),
  );
});

runHerdrExample(sshAgentForwarding);
