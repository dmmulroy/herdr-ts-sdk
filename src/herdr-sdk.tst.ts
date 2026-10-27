import { Effect, type Stream } from "effect";
import type { HerdrTransportRequestOptionsEncoded as PublicHerdrRequestOptions } from "./index.ts";
import type {
  HerdrEventsLost,
  HerdrSshAgentRegistrationClosed,
  HerdrUnsupportedEvent,
} from "./herdr-errors.ts";
import type { IHerdrSdk } from "./herdr-sdk.ts";
import type { WorkspaceCreateResult } from "./herdr-models.ts";
import type { PaneLinkResolvedResult } from "./herdr-pane-interaction-models.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;
type EffectSuccess<Value> =
  Value extends Effect.Effect<infer Success, infer _Error, infer _Requirements> ? Success : never;
type EffectError<Value> =
  Value extends Effect.Effect<infer _Success, infer Error, infer _Requirements> ? Error : never;
type StreamSuccess<Value> =
  Value extends Stream.Stream<infer Success, infer _Error, infer _Requirements> ? Success : never;
type StreamError<Value> =
  Value extends Stream.Stream<infer _Success, infer Error, infer _Requirements> ? Error : never;

declare const herdr: IHerdrSdk;
declare const paneId: ReturnType<IHerdrSdk["ids"]["pane"]>;

const workspaceCreate = herdr.workspaces.create();
const workspaceEventStream = herdr.events.subscribe([{ type: "workspace.created" }] as const);
const linkResolve = herdr.panes.link.resolve(paneId, { viewportRow: 0, col: 0 });
const sshAgentRegistration = herdr.server.sshAgent.withRegistration(
  { socketPath: "/tmp/agent.sock" },
  () => Effect.fail("domain-failure" as const),
);
const workspaceList = herdr.workspaces.list();
const eventWait = herdr.events.wait({ type: "workspace.created" });
herdr.agents.start({ name: herdr.ids.agentName("muse"), kind: "muse", paneId });

/** Compile-time proof that Stripe-style namespace calls preserve operation success. */
export type WorkspaceCreateInference = Assert<
  Equal<EffectSuccess<typeof workspaceCreate>, WorkspaceCreateResult>
>;

/** Compile-time proof that subscription literals narrow the stream event union. */
export type WorkspaceEventInference = Assert<
  Equal<StreamSuccess<typeof workspaceEventStream>["type"], "workspace.created">
>;

/** Compile-time proof that link resolution returns its viewport regions. */
export type LinkResolveInference = Assert<
  Equal<EffectSuccess<typeof linkResolve>, PaneLinkResolvedResult>
>;

/** Compile-time proof that SSH agent leases keep callback failures and lease closure visible. */
export type SshAgentRegistrationErrorInference = Assert<
  "domain-failure" | HerdrSshAgentRegistrationClosed extends EffectError<
    typeof sshAgentRegistration
  >
    ? true
    : false
>;

/** Compile-time proof that live subscriptions expose history overrun as a typed failure. */
export type SubscriptionIncludesEventsLost = Assert<
  HerdrEventsLost extends StreamError<typeof workspaceEventStream> ? true : false
>;

/** Compile-time proof that ordinary operations exclude event-only failures. */
export type WorkspaceErrorExcludesUnsupportedEvent = Assert<
  HerdrUnsupportedEvent extends EffectError<typeof workspaceList> ? false : true
>;

/** Compile-time proof that event waits retain unknown-discriminant failures. */
export type EventWaitIncludesUnsupportedEvent = Assert<
  HerdrUnsupportedEvent extends EffectError<typeof eventWait> ? true : false
>;

/** Compile-time proof that one-shot waits never report subscription overrun. */
export type EventWaitExcludesEventsLost = Assert<
  HerdrEventsLost extends EffectError<typeof eventWait> ? false : true
>;

/** Compile-time proof that public operation request options are importable from the package entrypoint. */
export type PublicRequestOptionsAreNamed = Assert<
  Equal<NonNullable<Parameters<IHerdrSdk["workspaces"]["list"]>[0]>, PublicHerdrRequestOptions>
>;
