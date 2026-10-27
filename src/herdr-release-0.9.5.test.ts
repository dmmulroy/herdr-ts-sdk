import { Effect, Option } from "effect";
import { expect, test } from "vite-plus/test";
import {
  HerdrAbsolutePath,
  HerdrInvalidInput,
  HerdrSdk,
  HerdrServerError,
  herdrSdkLayerFromOptions,
} from "./index.ts";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";

const provideFixtureSdk = (socketPath: string) =>
  Effect.provide(herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(socketPath) }));

test("Herdr 0.9.5 pane, agent, and capability fields decode through SDK services", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            switch (response.result.type) {
              case "pong":
                return {
                  ...response,
                  result: {
                    ...response.result,
                    capabilities: { live_handoff: false, ssh_agent_registration: true },
                  },
                };
              case "pane_info":
                return {
                  ...response,
                  result: {
                    ...response.result,
                    pane: { ...response.result.pane, restore_error: "Saved directory is gone." },
                  },
                };
              case "agent_info":
                return {
                  ...response,
                  result: {
                    ...response.result,
                    agent: { ...response.result.agent, state_change_seq: 7, completion_seq: 7 },
                  },
                };
              case "pane_link_resolved":
                return {
                  ...response,
                  result: {
                    ...response.result,
                    regions: [
                      { row: 3, start_col: 10, end_col: 79 },
                      { row: 4, start_col: 0, end_col: 12 },
                    ],
                  },
                };
              default:
                return response;
            }
          }),
        );
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const pane = sdk.ids.pane("pane");
          const pong = yield* sdk.server.ping();
          expect(Option.getOrThrow(pong.capabilities).sshAgentRegistration).toBe(true);

          const restored = yield* sdk.panes.get(pane);
          expect(Option.getOrThrow(restored.restoreError)).toBe("Saved directory is gone.");

          const agent = yield* sdk.agents.get({ paneId: pane });
          expect(agent.stateChangeSequence).toBe(7);
          expect(Option.getOrThrow(agent.completionSequence)).toBe(7);

          const resolved = yield* sdk.panes.link.resolve(pane, {
            viewportRow: 3,
            col: 20,
            contentRevision: 4,
            offsetFromBottom: 0,
          });
          expect(resolved.regions).toEqual([
            { row: 3, startCol: 10, endCol: 79 },
            { row: 4, startCol: 0, endCol: 12 },
          ]);
          yield* sdk.panes.clear(pane);
        }).pipe(provideFixtureSdk(server.socketPath));

        expect(server.requests.find((request) => request.method === "pane.link.resolve")).toEqual({
          id: expect.any(String),
          method: "pane.link.resolve",
          params: {
            pane_id: "pane",
            viewport_row: 3,
            col: 20,
            content_revision: 4,
            offset_from_bottom: 0,
          },
        });
        expect(server.requests.find((request) => request.method === "pane.clear")).toMatchObject({
          params: { pane_id: "pane" },
        });
      }),
    ),
  ));

test("fields absent from older-shaped responses decode to their documented defaults", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.sync(() => {
            const response = makeHerdrSuccessResponse(request);
            return response.result.type === "pong"
              ? {
                  ...response,
                  result: { ...response.result, capabilities: { live_handoff: true } },
                }
              : response;
          }),
        );
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const pong = yield* sdk.server.ping();
          expect(Option.getOrThrow(pong.capabilities).sshAgentRegistration).toBe(false);
          const pane = yield* sdk.panes.get(sdk.ids.pane("pane"));
          expect(Option.isNone(pane.restoreError)).toBe(true);
          const agent = yield* sdk.agents.get({ paneId: sdk.ids.pane("pane") });
          expect(Option.isNone(agent.completionSequence)).toBe(true);
        }).pipe(provideFixtureSdk(server.socketPath));
      }),
    ),
  ));

test("agent reports encode resumeArgv only when supplied", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(makeHerdrSuccessResponse(request)),
        );
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const pane = sdk.ids.pane("pane");
          const owner = { source: "custom:agent", agent: "agent" };
          yield* sdk.panes.reportAgent(pane, { ...owner, state: "working" });
          yield* sdk.panes.reportAgentSession(pane, {
            ...owner,
            sessionId: "session-1",
            resumeArgv: ["agent.v2_x-y", "--resume", "session-1", "naïve ✓"],
          });
        }).pipe(provideFixtureSdk(server.socketPath));
        expect(
          server.requests.find((request) => request.method === "pane.report_agent"),
        ).toMatchObject({ params: { resume_argv: null } });
        expect(
          server.requests.find((request) => request.method === "pane.report_agent_session"),
        ).toMatchObject({
          params: {
            agent_session_id: "session-1",
            resume_argv: ["agent.v2_x-y", "--resume", "session-1", "naïve ✓"],
          },
        });
      }),
    ),
  ));

test.for([
  { name: "empty argv", argv: [] },
  { name: "path command", argv: ["/usr/local/bin/agent"] },
  { name: "relative path command", argv: ["./agent"] },
  { name: "option-like command", argv: ["-agent"] },
  { name: "command with a space", argv: ["my agent"] },
  { name: "apostrophe", argv: ["agent", "it's"] },
  { name: "newline", argv: ["agent", "a\nb"] },
  { name: "C1 control character", argv: ["agent", "a\u0085b"] },
  { name: "65 arguments", argv: ["agent", ...Array.from({ length: 64 }, () => "x")] },
  { name: "8193 UTF-8 bytes", argv: ["agent", "é".repeat(4094)] },
])("invalid resumeArgv is rejected before any request: $name", ({ argv }, context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(makeHerdrSuccessResponse(request)),
        );
        const failure = yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          return yield* sdk.panes
            .reportAgent(sdk.ids.pane("pane"), {
              source: "custom:agent",
              agent: "agent",
              state: "idle",
              resumeArgv: argv,
            })
            .pipe(Effect.flip);
        }).pipe(provideFixtureSdk(server.socketPath));
        expect(failure).toBeInstanceOf(HerdrInvalidInput);
        expect(server.requests).toHaveLength(0);
      }),
    ),
  ),
);

test("resumeArgv accepts its documented inclusive limits", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(makeHerdrSuccessResponse(request)),
        );
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          const report = (resumeArgv: readonly string[]) =>
            sdk.panes.reportAgent(sdk.ids.pane("pane"), {
              source: "custom:agent",
              agent: "agent",
              state: "idle",
              resumeArgv,
            });
          yield* report(["agent", ...Array.from({ length: 63 }, () => "x")]);
          // "agent" is 5 bytes; 4093 two-byte characters plus one ASCII byte reach exactly 8192.
          yield* report(["agent", "é".repeat(4093) + "x"]);
        }).pipe(provideFixtureSdk(server.socketPath));
        expect(
          server.requests.filter((request) => request.method === "pane.report_agent"),
        ).toHaveLength(2);
      }),
    ),
  ));

test.for(["resume_not_accepted", "invalid_resume_argv", "pane_clear_failed"])(
  "server %s failures retain their code",
  (code, context) =>
    runHerdrTest(
      context,
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* startHerdrTestServer((request) =>
            Effect.succeed(
              request.method === "ping"
                ? makeHerdrSuccessResponse(request)
                : { id: request.id, error: { code, message: "fixture rejection" } },
            ),
          );
          const error = yield* Effect.gen(function* () {
            const sdk = yield* HerdrSdk;
            const pane = sdk.ids.pane("pane");
            return yield* (
              code === "pane_clear_failed"
                ? sdk.panes.clear(pane)
                : sdk.panes.reportAgentSession(pane, {
                    source: "custom:agent",
                    agent: "agent",
                    resumeArgv: ["agent", "--resume"],
                  })
            ).pipe(Effect.flip);
          }).pipe(provideFixtureSdk(server.socketPath));
          expect(error).toBeInstanceOf(HerdrServerError);
          expect(error).toMatchObject({ serverCode: code });
          expect(server.requests.filter((request) => request.method !== "ping")).toHaveLength(1);
        }),
      ),
    ),
);
