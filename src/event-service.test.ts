import type { Socket } from "node:net";
import { Deferred, Duration, Effect, Fiber, Stream } from "effect";
import { expect, test } from "vite-plus/test";
import { HerdrAbsolutePath } from "./herdr-domain.ts";
import {
  HerdrInvalidResponse,
  HerdrTransportError,
  HerdrUnsupportedEvent,
} from "./herdr-errors.ts";
import { HerdrSdk, herdrSdkLayerFromOptions } from "./herdr-sdk.ts";
import { HerdrRawTestResponse, startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

const workspace = {
  workspace_id: "workspace-1",
  number: 1,
  label: "Fixture",
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: "tab-1",
  agent_status: "idle",
};

test("event subscriptions normalize, filter, and close their scoped socket", async () => {
  const server = await startHerdrTestServer((request) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method === "events.subscribe") {
      return new HerdrRawTestResponse(
        [
          JSON.stringify(response),
          JSON.stringify({
            event: "workspace_updated",
            data: { type: "workspace_updated", workspace },
          }),
          JSON.stringify({
            event: "workspace_created",
            data: { type: "workspace_created", workspace },
          }),
          "",
        ].join("\n"),
      );
    }
    return response;
  });

  try {
    const event = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* Stream.runHead(
          herdr.events.subscribe([{ type: "workspace.created" }] as const),
        );
      }),
    );

    expect(event._tag).toBe("Some");
    if (event._tag === "Some") expect(event.value.type).toBe("workspace.created");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(server.openSocketMethods()).toEqual([]);
  } finally {
    await server.close();
  }
});

test("accepted live-only subscriptions safely buffer events across snapshot bootstrap", async () => {
  let subscriberSocket: Socket | undefined;
  let markSubscriptionAccepted: (() => void) | undefined;
  const subscriptionAccepted = new Promise<void>((resolve) => {
    markSubscriptionAccepted = resolve;
  });
  const server = await startHerdrTestServer((request, socket) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method === "events.subscribe") {
      subscriberSocket = socket;
      setTimeout(() => markSubscriptionAccepted?.(), 0);
    }
    if (request.method === "session.snapshot") {
      subscriberSocket?.write(
        `${JSON.stringify({
          event: "workspace_created",
          data: { type: "workspace_created", workspace },
        })}\n`,
      );
    }
    return response;
  });

  try {
    const result = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const eventFiber = yield* herdr.events
          .subscribe([{ type: "workspace.created" }] as const)
          .pipe(Stream.runHead, Effect.forkChild);
        yield* Effect.promise(() => subscriptionAccepted);
        const snapshot = yield* herdr.session.snapshot();
        const event = yield* Fiber.join(eventFiber);
        return { snapshot, event };
      }),
    );

    expect(result.snapshot).toBeDefined();
    expect(result.event._tag).toBe("Some");
    if (result.event._tag === "Some") expect(result.event.value.type).toBe("workspace.created");
    const methods = server.requests.map((request) => request.method);
    expect(methods.indexOf("events.subscribe")).toBeLessThan(methods.indexOf("session.snapshot"));
  } finally {
    await server.close();
  }
});

test("event subscriptions preserve an unknown server discriminant as a typed failure", async () => {
  const server = await startHerdrTestServer((request) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method !== "events.subscribe") return response;
    return new HerdrRawTestResponse(
      `${JSON.stringify(response)}\n${JSON.stringify({
        event: "pane.future_state",
        data: { type: "pane.future_state" },
      })}\n`,
    );
  });

  try {
    const failure = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* Stream.runHead(
          herdr.events.subscribe([{ type: "workspace.created" }] as const),
        ).pipe(Effect.flip);
      }),
    );
    expect(failure).toBeInstanceOf(HerdrUnsupportedEvent);
    expect(failure).toMatchObject({ eventType: "pane.future_state" });
  } finally {
    await server.close();
  }
});

test("event malformed-frame failure and interruption both finalize sockets", async () => {
  const malformedServer = await startHerdrTestServer((request, socket) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method === "events.subscribe") {
      setTimeout(() => socket.write("{bad\n"), 10);
    }
    return response;
  });

  try {
    const failure = await runWithSdk(
      malformedServer.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* Stream.runHead(
          herdr.events.subscribe([{ type: "workspace.created" }] as const),
        ).pipe(Effect.flip);
      }),
    );
    expect(failure).toBeInstanceOf(HerdrInvalidResponse);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(malformedServer.openSocketMethods()).toEqual([]);
  } finally {
    await malformedServer.close();
  }

  const interruptionServer = await startHerdrTestServer((request) =>
    makeHerdrSuccessResponse(request),
  );
  try {
    await runWithSdk(
      interruptionServer.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const fiber = yield* Stream.runDrain(
          herdr.events.subscribe([{ type: "workspace.created" }] as const),
        ).pipe(Effect.forkChild);
        yield* Effect.sleep(Duration.millis(10));
        yield* Fiber.interrupt(fiber);
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(interruptionServer.openSocketMethods()).toEqual([]);
  } finally {
    await interruptionServer.close();
  }
});

test("event subscriptions apply socket backpressure while consumers are busy", async () => {
  let eventWriteFinished = false;
  const largeWorkspace = { ...workspace, label: "x".repeat(32 * 1024) };
  const eventLine = `${JSON.stringify({
    event: "workspace_created",
    data: { type: "workspace_created", workspace: largeWorkspace },
  })}\n`;
  const server = await startHerdrTestServer((request, socket) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method === "events.subscribe") {
      setTimeout(() => {
        socket.write(eventLine.repeat(512), () => {
          eventWriteFinished = true;
        });
      }, 0);
    }
    return response;
  });

  try {
    const finishedWhileConsumerWasBusy = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const firstEventReceived = yield* Deferred.make<void>();
        const releaseConsumer = yield* Deferred.make<void>();
        const fiber = yield* herdr.events.subscribe([{ type: "workspace.created" }] as const).pipe(
          Stream.runForEach(() =>
            Deferred.succeed(firstEventReceived, undefined).pipe(
              Effect.andThen(Deferred.await(releaseConsumer)),
            ),
          ),
          Effect.forkChild,
        );

        yield* Deferred.await(firstEventReceived);
        yield* Effect.sleep(Duration.millis(250));
        const result = eventWriteFinished;
        yield* Deferred.succeed(releaseConsumer, undefined);
        yield* Fiber.interrupt(fiber);
        return result;
      }),
    );

    expect(finishedWhileConsumerWasBusy).toBe(false);
  } finally {
    await server.close();
  }
});

test("event subscriptions reject a partial final frame when the server closes", async () => {
  const server = await startHerdrTestServer((request, socket) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method === "events.subscribe") {
      setTimeout(() => socket.end('{"event":"workspace_created"'), 10);
    }
    return response;
  });

  try {
    const outcome = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* herdr.events.subscribe([{ type: "workspace.created" }] as const).pipe(
          Stream.runDrain,
          Effect.match({
            onFailure: (failure) => failure,
            onSuccess: () => undefined,
          }),
        );
      }),
    );

    expect(outcome).toBeInstanceOf(HerdrTransportError);
    expect(outcome).toMatchObject({ reason: "premature_close" });
  } finally {
    await server.close();
  }
});

test("event subscriptions decode UTF-8 characters fragmented across socket reads", async () => {
  const expectedLabel = "Fixture 🌱";
  const server = await startHerdrTestServer((request, socket) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method === "events.subscribe") {
      const eventBytes = Buffer.from(
        `${JSON.stringify({
          event: "workspace_created",
          data: {
            type: "workspace_created",
            workspace: { ...workspace, label: expectedLabel },
          },
        })}\n`,
      );
      const plantBytes = Buffer.from("🌱");
      const plantOffset = eventBytes.indexOf(plantBytes);
      setTimeout(() => {
        socket.write(eventBytes.subarray(0, plantOffset + 2));
        setTimeout(() => socket.write(eventBytes.subarray(plantOffset + 2)), 0);
      }, 0);
    }
    return response;
  });

  try {
    const event = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* Stream.runHead(
          herdr.events.subscribe([{ type: "workspace.created" }] as const),
        );
      }),
    );

    expect(event._tag).toBe("Some");
    if (event._tag === "Some") expect(event.value.workspace.label).toBe(expectedLabel);
  } finally {
    await server.close();
  }
});

test("event wait preserves an unknown server discriminant as a typed failure", async () => {
  const server = await startHerdrTestServer((request) => {
    if (request.method !== "events.wait") return makeHerdrSuccessResponse(request);
    return new HerdrRawTestResponse(
      `${JSON.stringify({
        id: request.id,
        result: {
          type: "wait_matched",
          event: { event: "pane.future_state", data: { type: "pane.future_state" } },
        },
      })}\n`,
    );
  });

  try {
    const failure = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* herdr.events.wait({ type: "workspace.created" }).pipe(Effect.flip);
      }),
    );
    expect(failure).toBeInstanceOf(HerdrUnsupportedEvent);
    expect(failure).toMatchObject({ eventType: "pane.future_state" });
  } finally {
    await server.close();
  }
});

function runWithSdk<A, E>(socketPath: string, effect: Effect.Effect<A, E, HerdrSdk>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(socketPath) })),
    ),
  );
}
