import { join } from "node:path";
import { Deferred, Effect, Exit, Fiber, FileSystem, Schema } from "effect";
import { makeHerdrSuccessResponse } from "../src/herdr-wire-fixtures.ts";
import { expect, expectTypeOf, test } from "vite-plus/test";
import {
  parseSdkLiveEvidenceConfig,
  runSdkLiveEvidence,
  sdkLiveEvidenceConfigSchema,
} from "./sdk-live-evidence.mjs";
import { verificationNodeLayer } from "./sdk-verification-process.mjs";
import { startHerdrTestServer } from "../src/herdr-test-server.ts";

test("live configuration parser exposes only its validated JSON string boundary", (context) => {
  expectTypeOf(parseSdkLiveEvidenceConfig).toEqualTypeOf<
    (input: string) => Effect.Effect<typeof sdkLiveEvidenceConfigSchema.Type, Schema.SchemaError>
  >();
  // Rejected calls are compile-time contracts, never workflow execution.
  expectTypeOf(() => {
    // @ts-expect-error Configuration enters as JSON text, not an untyped object.
    parseSdkLiveEvidenceConfig({});
    // @ts-expect-error Library parsing options are private to the owning codec.
    parseSdkLiveEvidenceConfig("{}", {});
  }).returns.toEqualTypeOf<void>();
  return Effect.runPromise(
    Effect.gen(function* () {
      const config = {
        socketPath: "/fixture/socket",
        root: "/fixture",
        directory: "/fixture/gates",
        trace: false,
      };
      expect(yield* parseSdkLiveEvidenceConfig(JSON.stringify(config))).toEqual(config);
      for (const input of ["not-json", JSON.stringify({ ...config, trace: "false" })]) {
        const result = yield* Effect.result(parseSdkLiveEvidenceConfig(input));
        expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaError" } });
      }
    }),
    { signal: context.signal },
  );
});

test(
  "incompatible live protocol remains blocked with bounded actionable metadata",
  (context) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* startHerdrTestServer((request) =>
            Effect.succeed({
              id: request.id,
              result: { type: "pong", version: "0.8.2", protocol: 20 },
            }),
          );
          const result = yield* runSdkLiveEvidence({
            root: join(server.socketPath, ".."),
            socketPath: server.socketPath,
            onStep: () => Effect.die("Compatibility failure must prevent UI actions"),
          });
          expect(result.product).toEqual({
            status: "failed",
            errorTag: "HerdrUnsupportedProtocol",
          });
          expect(result.checks).toEqual([]);
          expect(result.limitations).toContain(
            "Compatibility blocked before workflow actions: server protocol 20; SDK requires 21. Install compatible Herdr and SDK versions; do not bypass the handshake.",
          );
          expect(server.requests.map((request) => request.method)).toEqual(["ping"]);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
      { signal: context.signal },
    ),
  15000,
);

// Protocol fixture lives in the bridge-owned temporary directory, never an ambient server.
test(
  "live bridge runs one installed TS boundary and preserves the typed product failure",
  (context) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "live-bridge-" });
          const server = yield* startHerdrTestServer((request) =>
            Effect.succeed(
              request.method === "ping"
                ? { id: request.id, result: { type: "pong", version: "0.8.2", protocol: 21 } }
                : {
                    id: request.id,
                    error: {
                      code: "fixture_rejected",
                      message: "Fixture intentionally rejects workspace listing",
                    },
                  },
            ),
          );
          // A symlink to another fixture root is unsafe even though both sockets are isolated.
          const socket = join(root, "fixture.sock");
          yield* fs.symlink(server.socketPath, socket);
          const denied = yield* Effect.exit(
            runSdkLiveEvidence({ root, socketPath: socket, onStep: () => Effect.void }),
          );
          expect(Exit.isFailure(denied)).toBe(true);
          expect(server.requests).toHaveLength(0);
          const result = yield* runSdkLiveEvidence({
            root: join(server.socketPath, ".."),
            socketPath: server.socketPath,
            onStep: () => Effect.die("No action gate should be reached"),
          });
          expect(result.product).toEqual({ status: "failed", errorTag: "HerdrServerError" });
          expect(result.checks).toEqual([]);
          expect(server.requests.map((request) => request.method)).toEqual([
            "ping",
            "workspace.list",
          ]);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
      { signal: context.signal },
    ),
  15000,
);

test(
  "interrupting a UI gate stops the owned TS child and removes its private gate files",
  (context) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const entered = yield* Deferred.make<void>();
          const server = yield* startHerdrTestServer((request) =>
            Effect.sync(() => {
              if (request.method === "workspace.list")
                return {
                  id: request.id,
                  result: {
                    type: "workspace_list",
                    workspaces: [
                      {
                        workspace_id: "w1",
                        active_tab_id: "w1:t1",
                        agent_status: "idle",
                        focused: true,
                        label: "Landing",
                        number: 1,
                        pane_count: 1,
                        tab_count: 1,
                      },
                    ],
                  },
                };
              if (request.method === "tab.list")
                return {
                  id: request.id,
                  result: {
                    type: "tab_list",
                    tabs: [
                      {
                        tab_id: "w1:t1",
                        workspace_id: "w1",
                        focused: true,
                        label: "Landing",
                        pane_count: 1,
                        position: 0,
                        agent_status: "idle",
                        number: 1,
                      },
                    ],
                  },
                };
              return makeHerdrSuccessResponse(request);
            }),
          );
          const root = join(server.socketPath, "..");
          const fiber = yield* runSdkLiveEvidence({
            root,
            socketPath: server.socketPath,
            onStep: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined);
                yield* Effect.never;
              }),
          }).pipe(Effect.forkScoped);
          yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
          yield* Fiber.interrupt(fiber);
          expect(server.requests.map((request) => request.method)).toEqual([
            "ping",
            "workspace.list",
            "tab.list",
          ]);
          expect(
            (yield* fs.readDirectory(root)).filter((name) => name.startsWith("workflow-")),
          ).toEqual([]);
        }),
      ).pipe(Effect.provide(verificationNodeLayer)),
      { signal: context.signal },
    ),
  15000,
);
