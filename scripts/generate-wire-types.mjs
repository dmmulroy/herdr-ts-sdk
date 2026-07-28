import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const schemaPath = new URL("../schema/herdr-api.schema.json", import.meta.url);
const generatedDirectory = new URL("../src/generated/", import.meta.url);
const document = JSON.parse(await readFile(schemaPath, "utf8"));

const resultMethods = {
  pong: ["ping"],
  ok: [
    "server.stop",
    "server.live_handoff",
    "workspace.report_metadata",
    "workspace.close",
    "tab.close",
    "agent.send_keys",
    "pane.send_text",
    "pane.send_keys",
    "pane.send_input",
    "pane.graphics.set",
    "pane.graphics.clear",
    "pane.graphics.stream",
    "pane.report_agent",
    "pane.report_agent_session",
    "pane.report_metadata",
    "pane.clear_agent_authority",
    "pane.release_agent",
    "pane.close",
    "popup.close",
  ],
  config_reload: ["server.reload_config"],
  agent_manifest_status: ["server.agent_manifests"],
  agent_manifest_reload: ["server.reload_agent_manifests"],
  notification_show: ["notification.show"],
  client_window_title: ["client.window_title.set", "client.window_title.clear"],
  session_snapshot: ["session.snapshot"],
  workspace_created: ["workspace.create"],
  workspace_list: ["workspace.list", "workspace.move", "workspace.move_block"],
  workspace_info: ["workspace.get", "workspace.focus", "workspace.rename"],
  worktree_list: ["worktree.list"],
  worktree_created: ["worktree.create"],
  worktree_opened: ["worktree.open"],
  worktree_removed: ["worktree.remove"],
  tab_created: ["tab.create"],
  tab_list: ["tab.list", "tab.move"],
  tab_info: ["tab.get", "tab.focus", "tab.rename"],
  agent_list: ["agent.list"],
  agent_info: ["agent.get", "agent.rename", "agent.focus", "agent.wait"],
  pane_read: ["agent.read", "pane.read"],
  agent_explain: ["agent.explain"],
  agent_view: ["agent.view.set", "agent.view.clear"],
  agent_started: ["agent.start"],
  agent_prompted: ["agent.prompt"],
  pane_info: ["pane.split", "pane.get", "pane.focus", "pane.rename"],
  pane_swap: ["pane.swap"],
  pane_move: ["pane.move"],
  pane_zoom: ["pane.zoom"],
  pane_layout: ["pane.layout"],
  pane_process_info: ["pane.process_info"],
  pane_neighbor: ["pane.neighbor"],
  pane_edges: ["pane.edges"],
  pane_focus_direction: ["pane.focus_direction"],
  pane_resize: ["pane.resize"],
  pane_list: ["pane.list"],
  pane_current: ["pane.current"],
  pane_graphics_info: ["pane.graphics.info"],
  output_matched: ["pane.wait_for_output"],
  layout_export: ["layout.export"],
  layout_apply: ["layout.apply"],
  layout_split_ratio_set: ["layout.set_split_ratio"],
  subscription_started: ["events.subscribe"],
  wait_matched: ["events.wait"],
  integration_install: ["integration.install"],
  integration_uninstall: ["integration.uninstall"],
  plugin_linked: ["plugin.link"],
  plugin_list: ["plugin.list"],
  plugin_unlinked: ["plugin.unlink"],
  plugin_enabled: ["plugin.enable"],
  plugin_disabled: ["plugin.disable"],
  plugin_action_list: ["plugin.action.list"],
  plugin_action_invoked: ["plugin.action.invoke"],
  plugin_log_list: ["plugin.log.list"],
  plugin_pane_opened: ["plugin.pane.open"],
  plugin_pane_focused: ["plugin.pane.focus"],
  plugin_pane_closed: ["plugin.pane.close"],
};
const resultTypeByMethod = Object.fromEntries(
  Object.entries(resultMethods).flatMap(([result, methods]) =>
    methods.map((method) => [method, result]),
  ),
);
const schemaMethods = document.schemas.request.oneOf.map((entry) => entry.properties.method.const);
const expectedMethods = [...schemaMethods, "pane.graphics.stream"].sort((left, right) =>
  left.localeCompare(right),
);
const mappedMethods = Object.keys(resultTypeByMethod).sort((left, right) =>
  left.localeCompare(right),
);
if (JSON.stringify(expectedMethods) !== JSON.stringify(mappedMethods))
  throw new Error(
    `Wire result map differs from schema methods: expected ${expectedMethods.join(",")}; mapped ${mappedMethods.join(",")}`,
  );
const responseTypes = new Set(
  document.schemas.success_response.$defs.ResponseResult.oneOf.map(
    (entry) => entry.properties.type.const,
  ),
);
for (const resultType of Object.values(resultTypeByMethod))
  if (!responseTypes.has(resultType)) throw new Error(`Unknown wire result type: ${resultType}`);

for (const [schemaName, typeName, fileName] of [
  ["request", "WireRequest", "wire-request.ts"],
  ["success_response", "WireSuccessResponse", "wire-success-response.ts"],
  ["error_response", "WireErrorResponse", "wire-error-response.ts"],
  ["event", "WireEventEnvelope", "wire-event.ts"],
  ["subscription_event", "WireSubscriptionEventEnvelope", "wire-subscription-event.ts"],
]) {
  const schema = structuredClone(document.schemas[schemaName]);
  rewriteLocalReferences(schema, `#/schemas/${schemaName}/`, "#/");
  const source = await compile(schema, typeName, {
    bannerComment: "/** Generated from schema/herdr-api.schema.json; do not edit. */",
    format: true,
    style: { singleQuote: false, semi: true, trailingComma: "all" },
  });
  await writeFile(new URL(fileName, generatedDirectory), source);
}

const methodEntries = Object.entries(resultTypeByMethod).sort(([left], [right]) =>
  left.localeCompare(right),
);
const mapSource = `/** Generated and exhaustively checked against the bundled Herdr schema; do not edit. */\nimport type { Request } from "./wire-request.ts";\nimport type { ResponseResult } from "./wire-success-response.ts";\n\nexport interface WireMethodMap {\n${methodEntries.map(([method, result]) => `  readonly ${JSON.stringify(method)}: { readonly params: ${method === "pane.graphics.stream" ? "{ readonly pane_id: string }" : `Extract<Request, { readonly method: ${JSON.stringify(method)} }>["params"]`}; readonly result: Extract<ResponseResult, { readonly type: ${method === "plugin.pane.open" ? '"plugin_pane_opened" | "ok"' : JSON.stringify(result)} }> };`).join("\n")}\n}\n\n/** Every schema-declared request method plus the schema-skipped binary graphics stream. */\nexport type WireMethod = keyof WireMethodMap;\n`;
await writeFile(new URL("wire-method-map.ts", generatedDirectory), mapSource);

function rewriteLocalReferences(value, prefix, replacement) {
  if (Array.isArray(value)) {
    for (const child of value) rewriteLocalReferences(child, prefix, replacement);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith(prefix)) {
    value.$ref = replacement + value.$ref.slice(prefix.length);
  }
  for (const child of Object.values(value)) rewriteLocalReferences(child, prefix, replacement);
}
