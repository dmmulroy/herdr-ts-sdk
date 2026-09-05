import { expectTypeOf } from "vite-plus/test";
import type { WireMethod } from "./generated/wire-method-map.ts";
import { encodeWireRequest, type HerdrWireParameters } from "./herdr-wire-encoder.ts";

const workspace = {
  env: { API_KEY: "fixture", camelCase: "fixture", ["__proto__"]: "fixture" },
} satisfies HerdrWireParameters<"workspace.create">;
expectTypeOf(encodeWireRequest("request-1", "workspace.create", workspace)).toEqualTypeOf<string>();
expectTypeOf<
  NonNullable<HerdrWireParameters<"workspace.create">["env"]>[string]
>().toEqualTypeOf<string>();
expectTypeOf<HerdrWireParameters<"workspace.report_metadata">["tokens"][string]>().toEqualTypeOf<
  string | null
>();
expectTypeOf<
  NonNullable<HerdrWireParameters<"pane.report_metadata">["stateLabels"]>[string]
>().toEqualTypeOf<string>();

encodeWireRequest("request-1", "pane.send_text", { paneId: "pane-1", text: "fixture" });
// @ts-expect-error Method selection must not widen to accept another method's parameters.
encodeWireRequest("request-1", "pane.send_text", { workspaceId: "workspace-1" });
// @ts-expect-error A required protocol field cannot disappear during camel-case remapping.
encodeWireRequest("request-1", "pane.send_text", { paneId: "pane-1" });
// @ts-expect-error Dictionary values retain their generated string contract.
encodeWireRequest("request-1", "workspace.create", { env: { API_KEY: 123 } });
// @ts-expect-error Protocol field names remain camel-cased at the SDK transport boundary.
encodeWireRequest("request-1", "pane.close", { pane_id: "pane-1" });

function forwardWireRequest<Method extends WireMethod>(
  method: Method,
  params: HerdrWireParameters<Method>,
): string {
  return encodeWireRequest("request-1", method, params);
}
expectTypeOf(forwardWireRequest("pane.close", { paneId: "pane-1" })).toEqualTypeOf<string>();
