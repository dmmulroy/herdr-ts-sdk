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

test.each(["invalid UTF-8", "UTF-8 BOM"])(
  "event subscriptions reject %s instead of normalizing the wire bytes",
  async (encoding) => {
    const subscriptionClosed = Deferred.makeUnsafe<void>();
    const server = await startHerdrTestServer((request, socket) => {
      const response = makeHerdrSuccessResponse(request);
      if (request.method !== "events.subscribe") return response;
      const eventBytes = Buffer.from(
        `${JSON.stringify({
          event: "workspace_created",
          data: { type: "workspace_created", workspace: { ...workspace, label: "!" } },
        })}\n`,
      );
      if (encoding === "invalid UTF-8") eventBytes[eventBytes.indexOf("!")] = 0xff;
      socket.once("close", () => Effect.runSync(Deferred.succeed(subscriptionClosed, undefined)));
      socket.write(
        Buffer.concat([
          Buffer.from(`${JSON.stringify(response)}\n`),
          encoding === "UTF-8 BOM" ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
          eventBytes,
        ]),
      );
      return new HerdrRawTestResponse("");
    });

    try {
      const failure = await runWithSdk(
        server.socketPath,
        Effect.gen(function* () {
          const herdr = yield* HerdrSdk;
          return yield* herdr.events
            .subscribe([{ type: "workspace.created" }] as const)
            .pipe(Stream.runHead, Effect.flip);
        }),
      );
      expect(failure).toMatchObject({ _tag: "HerdrInvalidResponse", reason: "malformed_json" });
      await Effect.runPromise(Deferred.await(subscriptionClosed));
      expect(server.openSocketMethods()).not.toContain("events.subscribe");
    } finally {
      await server.close();
    }
  },
);

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

test("reusing a cold subscription opens independent sockets without replaying prior events", async () => {
  let subscriptionCount = 0;
  const server = await startHerdrTestServer((request) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method !== "events.subscribe") return response;
    subscriptionCount += 1;
    return new HerdrRawTestResponse(
      `${JSON.stringify(response)}\n${JSON.stringify({
        event: "workspace_created",
        data: {
          type: "workspace_created",
          workspace: { ...workspace, label: `Subscription ${subscriptionCount}` },
        },
      })}\n`,
    );
  });

  try {
    const events = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const subscription = herdr.events.subscribe([{ type: "workspace.created" }] as const);
        expect(subscriptionCount).toBe(0);
        const first = yield* Stream.runHead(subscription);
        const next = yield* Effect.all(
          [Stream.runHead(subscription), Stream.runHead(subscription)],
          { concurrency: "unbounded" },
        );
        return [first, ...next];
      }),
    );
    expect(subscriptionCount).toBe(3);
    expect(
      events
        .map((event) => (event._tag === "Some" ? event.value.workspace.label : "missing"))
        .sort(),
    ).toEqual(["Subscription 1", "Subscription 2", "Subscription 3"]);
  } finally {
    await server.close();
  }
});

test.each([
  { suffix: "{bad", reason: "malformed_json" },
  { suffix: "x".repeat(1024 * 1024 + 1), reason: "oversized_frame" },
])("event subscriptions deliver the valid prefix before $reason", async ({ suffix, reason }) => {
  const server = await startHerdrTestServer((request) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method !== "events.subscribe") return response;
    return new HerdrRawTestResponse(
      [
        JSON.stringify(response),
        ...["First", "Second"].map((label) =>
          JSON.stringify({
            event: "workspace_created",
            data: { type: "workspace_created", workspace: { ...workspace, label } },
          }),
        ),
        suffix,
        "",
      ].join("\n"),
    );
  });

  try {
    const labels: string[] = [];
    const failure = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* herdr.events.subscribe([{ type: "workspace.created" }] as const).pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              labels.push(event.workspace.label);
            }),
          ),
          Effect.flip,
        );
      }),
    );
    expect(labels).toEqual(["First", "Second"]);
    expect(failure).toMatchObject({ _tag: "HerdrInvalidResponse", reason });
  } finally {
    await server.close();
  }
});

test("interrupting an accepted idle subscription closes its socket before the SDK scope ends", async () => {
  const accepted = Deferred.makeUnsafe<void>();
  const closed = Deferred.makeUnsafe<void>();
  const server = await startHerdrTestServer((request, socket) => {
    if (request.method === "events.subscribe") {
      socket.once("close", () => Effect.runSync(Deferred.succeed(closed, undefined)));
      socket.write(`${JSON.stringify(makeHerdrSuccessResponse(request))}\n`, () =>
        Effect.runSync(Deferred.succeed(accepted, undefined)),
      );
      return new HerdrRawTestResponse("");
    }
    return makeHerdrSuccessResponse(request);
  });

  try {
    await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        const fiber = yield* herdr.events
          .subscribe([{ type: "workspace.created" }] as const)
          .pipe(Stream.runDrain, Effect.forkChild);
        yield* Deferred.await(accepted);
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(closed);
        expect(server.openSocketMethods()).not.toContain("events.subscribe");
      }),
    );
  } finally {
    await server.close();
  }
});

test.each([
  { event: "workspace_created", data: {} },
  { event: "pane.scroll_changed", data: {} },
  { event: "workspace_created", data: { type: "workspace_updated", workspace } },
])("event subscriptions reject malformed known envelopes: $event", async (envelope) => {
  const subscriptionClosed = Deferred.makeUnsafe<void>();
  const server = await startHerdrTestServer((request, socket) => {
    const response = makeHerdrSuccessResponse(request);
    if (request.method !== "events.subscribe") return response;
    socket.once("close", () => Effect.runSync(Deferred.succeed(subscriptionClosed, undefined)));
    return new HerdrRawTestResponse(`${JSON.stringify(response)}\n${JSON.stringify(envelope)}\n`);
  });

  try {
    const failure = await runWithSdk(
      server.socketPath,
      Effect.gen(function* () {
        const herdr = yield* HerdrSdk;
        return yield* herdr.events
          .subscribe([
            { type: "workspace.created" },
            { type: "workspace.updated" },
            { type: "pane.scroll_changed", paneId: "pane-1" },
          ])
          .pipe(Stream.runHead, Effect.flip);
      }),
    );
    expect(failure).toBeInstanceOf(HerdrInvalidResponse);
    expect(failure).toMatchObject({ reason: "schema_mismatch" });
    await Effect.runPromise(Deferred.await(subscriptionClosed));
    expect(server.openSocketMethods()).not.toContain("events.subscribe");
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
