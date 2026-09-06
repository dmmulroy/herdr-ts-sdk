/**
 * Controls detected and launched terminal agents.
 *
 * The agent service discovers agents, reads their output, sends input, manages stable names, launches supported agent kinds, waits for lifecycle states, and owns the persistent foreground agent view.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  type AgentName,
  HerdrKeySequence,
  type HerdrKeySequence as HerdrKeySequenceValue,
} from "./herdr-domain.ts";
import {
  Agent,
  AgentPromptInput,
  type AgentPromptInputEncoded,
  AgentStartInput,
  type AgentStartInputEncoded,
  AgentStartResult,
  AgentTarget,
  type AgentTarget as AgentTargetValue,
  type AgentTargetEncoded,
  AgentViewClearInput,
  type AgentViewClearInputEncoded,
  AgentViewSetInput,
  type AgentViewSetInputEncoded,
  AgentViewState,
  AgentWaitInput,
  type AgentWaitInputEncoded,
  HerdrJsonValue,
  PaneReadInput,
  type PaneReadInputEncoded,
  PaneReadResult,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const encodeAgentViewSetInput = Schema.encodeEffect(AgentViewSetInput);
const parseAgent = Schema.decodeUnknownEffect(Agent);
const parseAgents = Schema.decodeUnknownEffect(Schema.Array(Agent));
const parseAgentPromptInput = Schema.decodeEffect(AgentPromptInput);
const parseAgentStartInput = Schema.decodeEffect(AgentStartInput);
const parseAgentStartResult = Schema.decodeUnknownEffect(AgentStartResult);
const parseAgentTarget = Schema.decodeEffect(AgentTarget);
const parseAgentViewClearInput = Schema.decodeEffect(AgentViewClearInput);
const parseAgentViewSetInput = Schema.decodeEffect(AgentViewSetInput);
const parseAgentViewState = Schema.decodeUnknownEffect(AgentViewState);
const parseAgentWaitInput = Schema.decodeEffect(AgentWaitInput);
const parseHerdrJsonValue = Schema.decodeUnknownEffect(HerdrJsonValue);
const parseHerdrKeySequence = Schema.decodeEffect(HerdrKeySequence);
const parsePaneReadInput = Schema.decodeEffect(PaneReadInput);
const parsePaneReadResult = Schema.decodeUnknownEffect(PaneReadResult);

/**
 * Nested persistent agent-view capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IAgentView {
  /** Activates or updates the foreground agent view. */
  readonly set: (
    input: AgentViewSetInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<AgentViewState, HerdrTransportRequestError>;
  /** Clears an agent view, optionally only for one source. */
  readonly clear: (
    input?: AgentViewClearInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<AgentViewState, HerdrTransportRequestError>;
}

/**
 * Agent discovery, control, prompting, waiting, and view capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IAgentService {
  /** Nested persistent agent-view operations. */
  readonly view: IAgentView;
  /** Lists every detected or launched agent. */
  readonly list: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly Agent[], HerdrTransportRequestError>;
  /** Reads one agent by pane or assigned name. */
  readonly get: (
    target: AgentTargetEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Agent, HerdrTransportRequestError>;
  /** Reads pane output through an agent target. */
  readonly read: (
    target: AgentTargetEncoded,
    input: PaneReadInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<PaneReadResult, HerdrTransportRequestError>;
  /** Reads schema-less detection diagnostics for one agent. */
  readonly explain: (
    target: AgentTargetEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<HerdrJsonValue, HerdrTransportRequestError>;
  /** Sends named keys to one agent. */
  readonly sendKeys: (
    target: AgentTargetEncoded,
    keys: HerdrKeySequenceValue,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, HerdrTransportRequestError>;
  /** Assigns or clears one agent name. */
  readonly rename: (
    target: AgentTargetEncoded,
    name: AgentName | null,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Agent, HerdrTransportRequestError>;
  /** Focuses one agent. */
  readonly focus: (
    target: AgentTargetEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Agent, HerdrTransportRequestError>;
  /** Launches one agent. */
  readonly start: (
    input: AgentStartInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<AgentStartResult, HerdrTransportRequestError>;
  /** Sends a prompt and optional server-owned wait policy. */
  readonly prompt: (
    target: AgentTargetEncoded,
    input: AgentPromptInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Agent, HerdrTransportRequestError>;
  /** Waits for one agent to reach a requested status. */
  readonly wait: (
    target: AgentTargetEncoded,
    input?: AgentWaitInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Agent, HerdrTransportRequestError>;
}

/**
 * Yieldable Effect service for Herdr agent operations.
 *
 * @category services
 * @since 0.8.2
 */
export class AgentService extends Context.Service<AgentService, IAgentService>()(
  "@herdr/sdk/AgentService",
) {}

/**
 * Constructs agent operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeAgentService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  const readAgent = defineHerdrOperation(
    "AgentService.readAgent",
    (
      method: "agent.get" | "agent.focus",
      target: AgentTargetEncoded,
      options: HerdrTransportRequestOptionsEncoded,
    ) =>
      Effect.gen(function* () {
        const parsedTarget = yield* decodeAgentTarget(target);
        const response = yield* transport.request(method, encodeAgentTarget(parsedTarget), options);
        return yield* decodeHerdrWire(parseAgent, response.result.agent, response.requestId);
      }),
  );

  const view: IAgentView = {
    set: defineHerdrOperation("AgentService.view.set", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "AgentService.view.set",
          parseAgentViewSetInput,
          input,
        );
        const parameters = yield* encodeAgentViewSetInput(parsed).pipe(Effect.orDie);
        const response = yield* transport.request("agent.view.set", parameters, options);
        return yield* decodeHerdrWire(parseAgentViewState, response.result, response.requestId);
      }),
    ),
    clear: defineHerdrOperation("AgentService.view.clear", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "AgentService.view.clear",
          parseAgentViewClearInput,
          input,
        );
        const response = yield* transport.request(
          "agent.view.clear",
          { source: Option.getOrNull(parsed.source) },
          options,
        );
        return yield* decodeHerdrWire(parseAgentViewState, response.result, response.requestId);
      }),
    ),
  };

  return AgentService.of({
    view,
    list: defineHerdrOperation("AgentService.list", (options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("agent.list", {}, options);
        return yield* decodeHerdrWire(parseAgents, response.result.agents, response.requestId);
      }),
    ),
    get: defineHerdrOperation("AgentService.get", (target, options = {}) =>
      readAgent("agent.get", target, options),
    ),
    read: defineHerdrOperation("AgentService.read", (target, input, options = {}) =>
      Effect.gen(function* () {
        const parsedTarget = yield* decodeAgentTarget(target);
        const parsed = yield* decodeHerdrInput("AgentService.read", parsePaneReadInput, input);
        const base = {
          ...encodeAgentTarget(parsedTarget),
          source: parsed.source,
          lines: Option.getOrNull(parsed.lines),
        };
        const withFormat = Option.match(parsed.format, {
          onNone: () => base,
          onSome: (format) => ({ ...base, format }),
        });
        const parameters = Option.match(parsed.stripAnsi, {
          onNone: () => withFormat,
          onSome: (stripAnsi) => ({ ...withFormat, stripAnsi }),
        });
        const response = yield* transport.request("agent.read", parameters, options);
        return yield* decodeHerdrWire(
          parsePaneReadResult,
          response.result.read,
          response.requestId,
        );
      }),
    ),
    explain: defineHerdrOperation("AgentService.explain", (target, options = {}) =>
      Effect.gen(function* () {
        const parsedTarget = yield* decodeAgentTarget(target);
        const response = yield* transport.request(
          "agent.explain",
          encodeAgentTarget(parsedTarget),
          options,
        );
        return yield* decodeHerdrWire(
          parseHerdrJsonValue,
          response.result.explain,
          response.requestId,
        );
      }),
    ),
    sendKeys: defineHerdrOperation("AgentService.sendKeys", (target, keys, options = {}) =>
      Effect.gen(function* () {
        const parsedTarget = yield* decodeAgentTarget(target);
        const parsedKeys = yield* decodeHerdrInput(
          "AgentService.sendKeys",
          parseHerdrKeySequence,
          keys,
        );
        yield* transport.request(
          "agent.send_keys",
          { ...encodeAgentTarget(parsedTarget), keys: parsedKeys },
          options,
        );
      }),
    ),
    rename: defineHerdrOperation("AgentService.rename", (target, name, options = {}) =>
      Effect.gen(function* () {
        const parsedTarget = yield* decodeAgentTarget(target);
        const response = yield* transport.request(
          "agent.rename",
          { ...encodeAgentTarget(parsedTarget), name },
          options,
        );
        return yield* decodeHerdrWire(parseAgent, response.result.agent, response.requestId);
      }),
    ),
    focus: defineHerdrOperation("AgentService.focus", (target, options = {}) =>
      readAgent("agent.focus", target, options),
    ),
    start: defineHerdrOperation("AgentService.start", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput("AgentService.start", parseAgentStartInput, input);
        const base = {
          name: parsed.name,
          kind: parsed.kind,
          paneId: parsed.paneId,
          timeoutMs: Option.getOrNull(parsed.timeoutMs),
        };
        const parameters = Option.match(parsed.args, {
          onNone: () => base,
          onSome: (args) => ({ ...base, args }),
        });
        const response = yield* transport.request("agent.start", parameters, options);
        return yield* decodeHerdrWire(parseAgentStartResult, response.result, response.requestId);
      }),
    ),
    prompt: defineHerdrOperation("AgentService.prompt", (target, input, options = {}) =>
      Effect.gen(function* () {
        const parsedTarget = yield* decodeAgentTarget(target);
        const parsed = yield* decodeHerdrInput("AgentService.prompt", parseAgentPromptInput, input);
        const parameters = Option.match(parsed.wait, {
          onNone: () => ({ ...encodeAgentTarget(parsedTarget), text: parsed.text }),
          onSome: (wait) => ({
            ...encodeAgentTarget(parsedTarget),
            text: parsed.text,
            wait: Option.match(wait.until, {
              onNone: () => ({ timeoutMs: Option.getOrNull(wait.timeoutMs) }),
              onSome: (until) => ({
                timeoutMs: Option.getOrNull(wait.timeoutMs),
                until,
              }),
            }),
          }),
        });
        const response = yield* transport.request("agent.prompt", parameters, options);
        return yield* decodeHerdrWire(parseAgent, response.result.agent, response.requestId);
      }),
    ),
    wait: defineHerdrOperation("AgentService.wait", (target, input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsedTarget = yield* decodeAgentTarget(target);
        const parsed = yield* decodeHerdrInput("AgentService.wait", parseAgentWaitInput, input);
        const base = {
          ...encodeAgentTarget(parsedTarget),
          timeoutMs: Option.getOrNull(parsed.timeoutMs),
        };
        const parameters = Option.match(parsed.until, {
          onNone: () => base,
          onSome: (until) => ({ ...base, until }),
        });
        const response = yield* transport.request("agent.wait", parameters, options);
        return yield* decodeHerdrWire(parseAgent, response.result.agent, response.requestId);
      }),
    ),
  });
});

/**
 * Provides agent operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const agentServiceLayerWithoutDependencies: Layer.Layer<
  AgentService,
  never,
  HerdrTransport
> = Layer.effect(AgentService, makeAgentService);

/**
 * Production agent-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const agentServiceLayer = agentServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);

function decodeAgentTarget(target: AgentTargetEncoded) {
  return decodeHerdrInput("AgentService.target", parseAgentTarget, target);
}

function encodeAgentTarget(target: AgentTargetValue) {
  return { target: "paneId" in target ? target.paneId : target.name };
}
