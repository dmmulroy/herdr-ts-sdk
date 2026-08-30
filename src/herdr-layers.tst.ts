import type { Layer } from "effect";
import type { HerdrTransport } from "./index.ts";
import type { HerdrSdk } from "./herdr-sdk.ts";
import { herdrSdkLayer, herdrSdkLayerWithoutDependencies } from "./herdr-sdk.ts";
import {
  workspaceServiceLayer,
  workspaceServiceLayerWithoutDependencies,
} from "./workspace-service.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;
type LayerSuccess<Value> =
  Value extends Layer.Layer<infer Success, infer _Error, infer _Requirements> ? Success : never;
type LayerRequirements<Value> =
  Value extends Layer.Layer<infer _Success, infer _Error, infer Requirements>
    ? Requirements
    : never;

/** Compile-time proof that a namespace dependency remains visible until provided. */
export type WorkspaceLayerRequirement = Assert<
  Equal<LayerRequirements<typeof workspaceServiceLayerWithoutDependencies>, HerdrTransport>
>;

/** Compile-time proof that a ready namespace Layer has no remaining requirement. */
export type ReadyWorkspaceLayerRequirement = Assert<
  Equal<LayerRequirements<typeof workspaceServiceLayer>, never>
>;

/** Compile-time proof that the production root exposes only the aggregate service. */
export type RootLayerOutput = Assert<Equal<LayerSuccess<typeof herdrSdkLayer>, HerdrSdk>>;

/** Compile-time proof that the unprovided root still names construction requirements. */
export type RootLayerRequirementsRemainVisible = Assert<
  Equal<
    LayerRequirements<typeof herdrSdkLayerWithoutDependencies> extends never ? true : false,
    false
  >
>;
