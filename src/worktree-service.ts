import { Context, Effect, Layer, Option, Schema } from "effect";
import { type WorkspaceId } from "./herdr-domain.ts";
import {
  WorktreeCreateInput,
  type WorktreeCreateInputEncoded,
  WorktreeCreateResult,
  WorktreeListInput,
  type WorktreeListInputEncoded,
  WorktreeListResult,
  WorktreeOpenInput,
  type WorktreeOpenInputEncoded,
  WorktreeOpenResult,
  WorktreeRemoveInput,
  type WorktreeRemoveInputEncoded,
  WorktreeRemoveResult,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseWorktreeCreateInput = Schema.decodeUnknownEffect(WorktreeCreateInput);
const parseWorktreeCreateResult = Schema.decodeUnknownEffect(WorktreeCreateResult);
const parseWorktreeListInput = Schema.decodeUnknownEffect(WorktreeListInput);
const parseWorktreeListResult = Schema.decodeUnknownEffect(WorktreeListResult);
const parseWorktreeOpenInput = Schema.decodeUnknownEffect(WorktreeOpenInput);
const parseWorktreeOpenResult = Schema.decodeUnknownEffect(WorktreeOpenResult);
const parseWorktreeRemoveInput = Schema.decodeUnknownEffect(WorktreeRemoveInput);
const parseWorktreeRemoveResult = Schema.decodeUnknownEffect(WorktreeRemoveResult);

/** Git worktree discovery, creation, opening, and removal capability. */
export interface IWorktreeService {
  /** Lists worktrees in a resolved repository. */
  readonly list: (
    input?: WorktreeListInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<WorktreeListResult, HerdrTransportRequestError>;
  /** Creates a worktree and opens it in a new workspace. */
  readonly create: (
    input?: WorktreeCreateInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<WorktreeCreateResult, HerdrTransportRequestError>;
  /** Opens an existing worktree by path or branch. */
  readonly open: (
    input: WorktreeOpenInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<WorktreeOpenResult, HerdrTransportRequestError>;
  /** Closes a workspace and removes its linked worktree. */
  readonly remove: (
    workspaceId: WorkspaceId,
    input?: WorktreeRemoveInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<WorktreeRemoveResult, HerdrTransportRequestError>;
}

/** Yieldable Effect service for Git worktree operations. */
export class WorktreeService extends Context.Service<WorktreeService, IWorktreeService>()(
  "@herdr/sdk/WorktreeService",
) {}

/** Constructs worktree operations while preserving the shared transport requirement. */
export const makeWorktreeService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  return WorktreeService.of({
    list: defineHerdrOperation("WorktreeService.list", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "WorktreeService.list",
          parseWorktreeListInput,
          input,
        );
        const base = {
          workspaceId: Option.getOrNull(parsed.workspaceId),
          cwd: Option.getOrNull(parsed.cwd),
        };
        const parameters = Option.match(parsed.trustRepository, {
          onNone: () => base,
          onSome: (trustRepository) => ({ ...base, trustRepository }),
        });
        const response = yield* transport.request("worktree.list", parameters, options);
        return yield* decodeHerdrWire(parseWorktreeListResult, response.result, response.requestId);
      }),
    ),
    create: defineHerdrOperation("WorktreeService.create", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "WorktreeService.create",
          parseWorktreeCreateInput,
          input,
        );
        const parametersWithoutFocus = {
          workspaceId: Option.getOrNull(parsed.workspaceId),
          cwd: Option.getOrNull(parsed.cwd),
          branch: Option.getOrNull(parsed.branch),
          base: Option.getOrNull(parsed.base),
          path: Option.getOrNull(parsed.path),
          label: Option.getOrNull(parsed.label),
        };
        const withFocus = Option.match(parsed.focus, {
          onNone: () => parametersWithoutFocus,
          onSome: (focus) => ({ ...parametersWithoutFocus, focus }),
        });
        const parameters = Option.match(parsed.trustRepository, {
          onNone: () => withFocus,
          onSome: (trustRepository) => ({ ...withFocus, trustRepository }),
        });
        const response = yield* transport.request("worktree.create", parameters, options);
        return yield* decodeHerdrWire(
          parseWorktreeCreateResult,
          response.result,
          response.requestId,
        );
      }),
    ),
    open: defineHerdrOperation("WorktreeService.open", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "WorktreeService.open",
          parseWorktreeOpenInput,
          input,
        );
        const parametersWithoutFocus = {
          workspaceId: Option.getOrNull(parsed.workspaceId),
          cwd: Option.getOrNull(parsed.cwd),
          path: Option.getOrNull(parsed.path),
          branch: Option.getOrNull(parsed.branch),
          label: Option.getOrNull(parsed.label),
        };
        const withFocus = Option.match(parsed.focus, {
          onNone: () => parametersWithoutFocus,
          onSome: (focus) => ({ ...parametersWithoutFocus, focus }),
        });
        const parameters = Option.match(parsed.trustRepository, {
          onNone: () => withFocus,
          onSome: (trustRepository) => ({ ...withFocus, trustRepository }),
        });
        const response = yield* transport.request("worktree.open", parameters, options);
        return yield* decodeHerdrWire(parseWorktreeOpenResult, response.result, response.requestId);
      }),
    ),
    remove: defineHerdrOperation(
      "WorktreeService.remove",
      (workspaceId, input = {}, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "WorktreeService.remove",
            parseWorktreeRemoveInput,
            input,
          );
          const withForce = Option.match(parsed.force, {
            onNone: () => ({ workspaceId }),
            onSome: (force) => ({ workspaceId, force }),
          });
          const parameters = Option.match(parsed.trustRepository, {
            onNone: () => withForce,
            onSome: (trustRepository) => ({ ...withForce, trustRepository }),
          });
          const response = yield* transport.request("worktree.remove", parameters, options);
          return yield* decodeHerdrWire(
            parseWorktreeRemoveResult,
            response.result,
            response.requestId,
          );
        }),
    ),
  });
});

/** Provides worktree operations while retaining the shared transport requirement. */
export const worktreeServiceLayerWithoutDependencies: Layer.Layer<
  WorktreeService,
  never,
  HerdrTransport
> = Layer.effect(WorktreeService, makeWorktreeService);

/** Production worktree-service Layer using the ambient Herdr transport graph. */
export const worktreeServiceLayer = worktreeServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
