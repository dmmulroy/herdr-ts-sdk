/**
 * Shared fixture-only assertion recipes for learning tests and development evidence.
 * @since 0.8.2
 */
import { Deferred, Effect, Exit, Stream } from "effect";
import { expect } from "vite-plus/test";
import {
  HerdrAbsolutePath,
  HerdrGraphicsStreamClosed,
  HerdrInvalidResponse,
  HerdrSdk,
  herdrSdkLayerFromOptions,
} from "./index.ts";
import { HerdrRawTestResponse, startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";
import type { WorkspaceInfo } from "./generated/wire-success-response.ts";
import type {
  sdkEvidenceCheckSchema,
  SdkEvidenceScenarioId,
} from "../scripts/sdk-evidence-scenario.mjs";

const workspace = {
  workspace_id: "workspace-learning",
  number: 1,
  label: "Local recipe",
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: "tab-learning",
  agent_status: "idle",
} satisfies WorkspaceInfo;

/** Shared assertion-bearing request-wire-result learning recipe; local fixtures only. */
const requestWireResultRecipe = (observe: EvidenceObservation) =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request) =>
        Effect.succeed(
          request.method === "workspace.get"
            ? { id: request.id, result: { type: "workspace_info", workspace } }
            : makeHerdrSuccessResponse(request),
        ),
      );
      const result = yield* runLearningSdk(
        server.socketPath,
        Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          return yield* sdk.workspaces.get(sdk.ids.workspace("workspace-learning"), {
            requestId: "learning-request",
          });
        }),
      );
      const request = server.requests.find((request) => request.method === "workspace.get");
      yield* observeAssertion(
        observe,
        "wire-request",
        "request",
        "Encoded request and ID",
        "learning-request workspace.get workspace-learning",
        JSON.stringify(request),
        () =>
          expect(request).toEqual({
            id: "learning-request",
            method: "workspace.get",
            params: { workspace_id: "workspace-learning" },
          }),
      );
      yield* observeAssertion(
        observe,
        "domain-result",
        "result",
        "Normalized domain result",
        "workspace-learning Local recipe 1",
        JSON.stringify({ id: result.id, label: result.label, paneCount: result.paneCount }),
        () =>
          expect(result).toMatchObject({
            id: "workspace-learning",
            label: "Local recipe",
            paneCount: 1,
          }),
      );
      yield* observeAssertion(
        observe,
        "wire-field-absent",
        "result",
        "Wire field stays private",
        "false",
        String(Object.hasOwn(result, "workspace_id")),
        () => expect(result).not.toHaveProperty("workspace_id"),
      );
    }),
  );

/** Shared assertion-bearing compatibility-recovery learning recipe; local fixtures only. */
const compatibilityRecoveryRecipe = (observe: EvidenceObservation, fixtureFailure: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      let pings = 0;
      const server = yield* startHerdrTestServer((request) =>
        Effect.sync(() => {
          if (request.method === "ping" && ++pings === 1)
            return fixtureFailure
              ? {
                  id: request.id,
                  error: { code: "fixture_rejected", message: "Fixture failure injection" },
                }
              : new HerdrRawTestResponse("{broken\n");
          return makeHerdrSuccessResponse(request);
        }),
      );
      yield* runLearningSdk(
        server.socketPath,
        Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const failure = yield* sdk.workspaces.list().pipe(Effect.flip);
          yield* observeAssertion(
            observe,
            "malformed-response",
            "blocked",
            "Malformed ping rejected",
            "HerdrInvalidResponse",
            failure._tag,
            () => expect(failure).toBeInstanceOf(HerdrInvalidResponse),
          );
          const methods = server.requests.map((request) => request.method);
          yield* observeAssertion(
            observe,
            "request-blocked",
            "blocked",
            "Workspace request blocked",
            '["ping"]',
            JSON.stringify(methods),
            () => expect(methods).toEqual(["ping"]),
          );
          yield* Effect.all([sdk.workspaces.list(), sdk.popups.close()], {
            concurrency: "unbounded",
          });
          yield* sdk.workspaces.list();
        }),
      );
      yield* observeAssertion(
        observe,
        "compatibility-shared",
        "recovery",
        "Successful ping shared",
        "2",
        String(pings),
        () => expect(pings).toBe(2),
      );
      const lists = server.requests.filter((request) => request.method === "workspace.list");
      yield* observeAssertion(
        observe,
        "workspace-recovered",
        "recovery",
        "Workspace requests recovered",
        "2",
        String(lists.length),
        () => expect(lists).toHaveLength(2),
      );
      const popups = server.requests.filter((request) => request.method === "popup.close");
      yield* observeAssertion(
        observe,
        "popup-recovered",
        "recovery",
        "Other namespace recovered",
        "1",
        String(popups.length),
        () => expect(popups).toHaveLength(1),
      );
    }),
  );

/** Shared assertion-bearing scoped-subscription learning recipe; local fixtures only. */
const scopedSubscriptionRecipe = (observe: EvidenceObservation) =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* startHerdrTestServer((request) =>
        Effect.sync(() => {
          const response = makeHerdrSuccessResponse(request);
          if (request.method !== "events.subscribe") return response;
          return new HerdrRawTestResponse(
            [
              JSON.stringify(response),
              JSON.stringify({
                event: "workspace_created",
                data: { type: "workspace_created", workspace },
              }),
              "",
            ].join("\n"),
          );
        }),
      );
      yield* runLearningSdk(
        server.socketPath,
        Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const events = yield* sdk.events
            .subscribe([{ type: "workspace.created" }])
            .pipe(Stream.take(1), Stream.runCollect);
          yield* observeAssertion(
            observe,
            "event-count",
            "accepted",
            "One event consumed",
            "1",
            String(events.length),
            () => expect(events).toHaveLength(1),
          );
          yield* observeAssertion(
            observe,
            "event-normalized",
            "accepted",
            "Domain event normalized",
            "workspace.created workspace-learning",
            events[0]?.type === "workspace.created"
              ? `${events[0].type} ${events[0].workspace.id}`
              : (events[0]?.type ?? "missing"),
            () =>
              expect(events[0]).toMatchObject({
                type: "workspace.created",
                workspace: { id: "workspace-learning" },
              }),
          );
          yield* server.waitFor("close", 2);
        }),
      );
      const open = server.openSocketMethods();
      yield* observeAssertion(
        observe,
        "subscription-closed",
        "cleanup",
        "Subscription socket closed",
        "events.subscribe absent",
        JSON.stringify(open),
        () => expect(open).not.toContain("events.subscribe"),
      );
    }),
  );

/** Shared assertion-bearing graphics-writer learning recipe; local fixtures only. */
const graphicsWriterRecipe = (observe: EvidenceObservation) =>
  Effect.scoped(
    Effect.gen(function* () {
      const received = yield* Deferred.make<void>();
      const run = Effect.runForkWith(yield* Effect.context<never>());
      const chunks: Buffer[] = [];
      const server = yield* startHerdrTestServer((request, socket) =>
        Effect.sync(() => {
          if (request.method === "pane.graphics.stream") {
            socket.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
              // Payloads have no newline: two header newlines and both payloads complete the observation.
              const bytes = Buffer.concat(chunks);
              const secondHeader = bytes.indexOf(10, bytes.indexOf(10) + 1);
              if (secondHeader >= 0 && bytes.length >= secondHeader + 4) {
                run(Deferred.succeed(received, undefined));
              }
            });
          }
          return makeHerdrSuccessResponse(request);
        }),
      );
      const frame = (byte: number) => ({
        format: "png" as const,
        imageWidth: 1,
        imageHeight: 1,
        data: Uint8Array.of(byte, byte, byte),
      });
      yield* runLearningSdk(
        server.socketPath,
        Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const writer = yield* Effect.scoped(
            Effect.gen(function* () {
              const acquired = yield* sdk.panes.graphics.openStream(sdk.ids.pane("pane-learning"));
              yield* Effect.all([acquired.write(frame(1)), acquired.write(frame(2))], {
                concurrency: "unbounded",
              });
              yield* Deferred.await(received);
              return acquired;
            }),
          );
          const closed = yield* writer.write(frame(3)).pipe(Effect.flip);
          yield* observeAssertion(
            observe,
            "writer-closed",
            "cleanup",
            "Escaped writer invalidated",
            "HerdrGraphicsStreamClosed",
            closed._tag,
            () => expect(closed).toBeInstanceOf(HerdrGraphicsStreamClosed),
          );
          yield* server.waitFor("close", 2);
        }),
      );
      const bytes = Buffer.concat(chunks);
      let offset = 0;
      const payloads: number[][] = [];
      for (let index = 0; index < 2; index++) {
        const newline = bytes.indexOf(10, offset);
        yield* observeAssertion(
          observe,
          `frame-${index}-header`,
          "frames",
          "Complete header boundary",
          `greater than ${offset}`,
          String(newline),
          () => expect(newline).toBeGreaterThan(offset),
        );
        const header: unknown = JSON.parse(bytes.subarray(offset, newline).toString("utf8"));
        yield* observeAssertion(
          observe,
          `frame-${index}-metadata`,
          "frames",
          "Frame header normalized",
          "png 3 bytes 1x1",
          bytes.subarray(offset, newline).toString("utf8").slice(0, 1024),
          () =>
            expect(header).toMatchObject({
              format: "png",
              data_length: 3,
              image_width: 1,
              image_height: 1,
            }),
        );
        payloads.push([...bytes.subarray(newline + 1, newline + 4)]);
        offset = newline + 4;
      }
      yield* observeAssertion(
        observe,
        "frames-serialized",
        "frames",
        "Distinct complete payloads",
        "[1,1,1] and [2,2,2]",
        JSON.stringify(payloads),
        () =>
          expect(payloads).toEqual(
            expect.arrayContaining([
              [1, 1, 1],
              [2, 2, 2],
            ]),
          ),
      );
      yield* observeAssertion(
        observe,
        "no-extra-bytes",
        "frames",
        "Frame bytes consumed exactly",
        String(bytes.length),
        String(offset),
        () => expect(offset).toBe(bytes.length),
      );
    }),
  );

// The only SDK composition point supplies a fixture path, never ambient Herdr discovery.
function runLearningSdk<A, E>(socketPath: string, recipe: Effect.Effect<A, E, HerdrSdk>) {
  return recipe.pipe(
    Effect.provide(herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(socketPath) })),
    Effect.timeout("3 seconds"),
  );
}

function observeAssertion(
  observe: EvidenceObservation,
  id: string,
  chapterId: string,
  label: string,
  expected: string,
  observed: string,
  assertion: () => void,
) {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(Effect.sync(assertion));
    observe({
      id,
      chapterId,
      label,
      expected,
      observed,
      status: Exit.isSuccess(exit) ? "passed" : "failed",
    });
    return yield* exit;
  });
}

/** Observed check emitted synchronously at an assertion boundary, never as telemetry. */
type EvidenceObservation = (check: typeof sdkEvidenceCheckSchema.Type) => void;

/**
 * Run the original learning assertions through the same fixture recipe used by evidence.
 * @category Testing
 * @since 0.8.2
 */
export function executeHerdrEvidenceRecipe(
  id: SdkEvidenceScenarioId,
  checks: Array<typeof sdkEvidenceCheckSchema.Type> = [],
  options: { fixtureFailure?: boolean } = {},
): Effect.Effect<
  void,
  Effect.Error<
    ReturnType<
      | typeof requestWireResultRecipe
      | typeof compatibilityRecoveryRecipe
      | typeof scopedSubscriptionRecipe
      | typeof graphicsWriterRecipe
    >
  >
> {
  const observe: EvidenceObservation = (check) => {
    checks.push(check);
  };
  switch (id) {
    case "request-wire-result":
      return requestWireResultRecipe(observe);
    case "compatibility-recovery":
      return compatibilityRecoveryRecipe(observe, options.fixtureFailure ?? false);
    case "scoped-subscription":
      return scopedSubscriptionRecipe(observe);
    case "graphics-writer":
      return graphicsWriterRecipe(observe);
  }
}
