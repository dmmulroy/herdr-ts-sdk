import { Effect } from "effect";
import { FastCheck } from "effect/testing";
import { expect, test } from "vite-plus/test";
import { runHerdrTest } from "./herdr-test-runtime.ts";
import {
  HerdrAbsolutePath,
  HerdrSdk,
  PaneId,
  WorkspaceId,
  herdrSdkLayerFromOptions,
} from "./index.ts";
import { startHerdrTestServer } from "./herdr-test-server.ts";
import { makeHerdrSuccessResponse } from "./herdr-wire-fixtures.ts";
import { encodeWireRequest } from "./herdr-wire-encoder.ts";

const dictionaryKeys = [
  "API_KEY",
  "camelCase",
  "snake_case",
  "",
  "__proto__",
  "constructor",
  "toString",
  "toJSON",
  "é漢字😀",
  'quote"slash\\newline\n',
  "paneId",
  "stateLabels",
];
const fixtureDictionary = Object.fromEntries(dictionaryKeys.map((key) => [key, "fixture"]));

test("SDK preserves environment and metadata dictionary keys on the socket", (context) =>
  runHerdrTest(
    context,
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startHerdrTestServer((request) =>
          Effect.succeed(makeHerdrSuccessResponse(request)),
        );
        // Metadata names are protocol-restricted; environment names have no such restriction.
        const tokens = {
          ...Object.fromEntries(
            dictionaryKeys
              .filter((key) => /^[A-Za-z0-9_-]{1,32}$/.test(key))
              .map((key) => [key, "fixture"]),
          ),
          deletedToken: null,
        };
        // The public schema restricts state labels to the five known agent statuses.
        const stateLabels = {
          idle: "Idle",
          working: "Working",
          blocked: "Blocked",
          done: "Done",
          unknown: "Unknown",
        };
        yield* Effect.gen(function* () {
          const sdk = yield* HerdrSdk;
          yield* sdk.workspaces.create({ env: fixtureDictionary });
          yield* sdk.workspaces.reportMetadata(WorkspaceId.make("workspace-1"), {
            source: "fixture",
            tokens,
          });
          yield* sdk.panes.reportMetadata(PaneId.make("pane-1"), {
            source: "fixture",
            tokens,
            stateLabels,
          });
          yield* sdk.layouts.apply({
            workspaceId: WorkspaceId.make("workspace-1"),
            tabLabel: "Fixture",
            root: {
              type: "split",
              direction: "right",
              ratio: 0.5,
              first: { type: "pane", paneId: PaneId.make("pane-1"), env: fixtureDictionary },
              second: { type: "pane", env: fixtureDictionary },
            },
          });
        }).pipe(
          Effect.provide(
            herdrSdkLayerFromOptions({ socketPath: HerdrAbsolutePath.make(server.socketPath) }),
          ),
        );
        const workspaceCreate = server.requests.find(
          (request) => request.method === "workspace.create",
        );
        expect(workspaceCreate?.params.env).toStrictEqual(fixtureDictionary);
        const workspaceMetadata = server.requests.find(
          (request) => request.method === "workspace.report_metadata",
        );
        expect(workspaceMetadata?.params.tokens).toStrictEqual(tokens);
        const paneMetadata = server.requests.find(
          (request) => request.method === "pane.report_metadata",
        );
        expect(paneMetadata?.params.tokens).toStrictEqual(tokens);
        expect(paneMetadata?.params.state_labels).toStrictEqual(stateLabels);
        expect(paneMetadata?.params.pane_id).toBe("pane-1");
        const layout = server.requests.find((request) => request.method === "layout.apply");
        expect(layout?.params).toMatchObject({
          workspace_id: "workspace-1",
          tab_label: "Fixture",
          root: {
            type: "split",
            first: { type: "pane", pane_id: "pane-1", env: fixtureDictionary },
            second: { type: "pane", env: fixtureDictionary },
          },
        });
        if (layout?.params.root.type !== "split")
          throw new Error("Wire encoder test expected a split layout");
        expect(layout.params.root.first).toHaveProperty("env", fixtureDictionary);
        expect(Object.getPrototypeOf(fixtureDictionary)).toBe(Object.prototype);
        expect(Object.hasOwn(fixtureDictionary, "__proto__")).toBe(true);
      }),
    ),
  ));

test("arbitrary dictionary keys round-trip without prototype mutation or protocol-key conversion", () => {
  FastCheck.assert(
    FastCheck.property(
      FastCheck.array(FastCheck.tuple(FastCheck.string({ unit: "grapheme" }), FastCheck.string())),
      (entries) => {
        const dictionary = { ...fixtureDictionary, ...Object.fromEntries(entries) };
        const tokens = { ...dictionary, deletedToken: null };
        const wire: unknown = JSON.parse(
          encodeWireRequest("request-1", "pane.report_metadata", {
            paneId: "pane-1",
            source: "fixture",
            tokens,
            stateLabels: dictionary,
            ttlMs: 1000,
          }),
        );
        expect(wire).toStrictEqual({
          id: "request-1",
          method: "pane.report_metadata",
          params: {
            pane_id: "pane-1",
            source: "fixture",
            tokens,
            state_labels: dictionary,
            ttl_ms: 1000,
          },
        });
        const envWire: unknown = JSON.parse(
          encodeWireRequest("request-2", "workspace.create", { env: dictionary }),
        );
        expect(envWire).toStrictEqual({
          id: "request-2",
          method: "workspace.create",
          params: { env: dictionary },
        });
        expect(Object.getPrototypeOf(dictionary)).toBe(Object.prototype);
        expect(Object.hasOwn(dictionary, "__proto__")).toBe(true);
      },
    ),
    { seed: 21, numRuns: 100 },
  );
});

test("wire strings and sparse arrays follow native JSON serialization semantics", () => {
  FastCheck.assert(
    FastCheck.property(FastCheck.string({ unit: "grapheme" }), (text) => {
      // Typed JavaScript arrays can still contain holes, which JSON must encode as null.
      const keys = Array<string>(3);
      keys[1] = text;
      const params = { paneId: text, keys, omitted: undefined };
      expect(encodeWireRequest(text, "pane.send_keys", params)).toBe(
        `${JSON.stringify({ id: text, method: "pane.send_keys", params: { pane_id: text, keys } })}\n`,
      );
      const explicitUndefinedKeys = [...keys];
      expect(
        encodeWireRequest(text, "agent.send_keys", { target: text, keys: explicitUndefinedKeys }),
      ).toBe(
        `${JSON.stringify({ id: text, method: "agent.send_keys", params: { target: text, keys: explicitUndefinedKeys } })}\n`,
      );
    }),
    { seed: 22, numRuns: 100 },
  );
});

test("nested structured parameters encode protocol names while string values remain opaque", () => {
  const wire: unknown = JSON.parse(
    encodeWireRequest('quoted"id\n', "plugin.action.invoke", {
      actionId: "camelCase",
      pluginId: "plugin-1",
      context: {
        focusedPaneId: "pane-1",
        selectedText: '{"paneId":"leaveMe"}',
        worktree: {
          checkoutPath: "/tmp/fixture",
          isLinkedWorktree: true,
          repoKey: "repoKey",
          repoName: "repoName",
          repoRoot: "/tmp",
        },
      },
    }),
  );
  expect(wire).toStrictEqual({
    id: 'quoted"id\n',
    method: "plugin.action.invoke",
    params: {
      action_id: "camelCase",
      plugin_id: "plugin-1",
      context: {
        focused_pane_id: "pane-1",
        selected_text: '{"paneId":"leaveMe"}',
        worktree: {
          checkout_path: "/tmp/fixture",
          is_linked_worktree: true,
          repo_key: "repoKey",
          repo_name: "repoName",
          repo_root: "/tmp",
        },
      },
    },
  });
});
