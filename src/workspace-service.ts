/**
 * Controls Herdr workspace lifecycle, focus, ordering, and metadata.
 *
 * Workspace creation returns the initial tab and pane atomically, and block movement preserves contiguous workspace groups.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import { type WorkspaceId } from "./herdr-domain.ts";
import {
  Workspace,
  WorkspaceCreateInput,
  type WorkspaceCreateInputEncoded,
  WorkspaceCreateResult,
  WorkspaceMetadataReportInput,
  type WorkspaceMetadataReportInputEncoded,
  WorkspaceMoveBlockInput,
  type WorkspaceMoveBlockInputEncoded,
  WorkspaceMoveInput,
  type WorkspaceMoveInputEncoded,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseWorkspace = Schema.decodeUnknownEffect(Workspace);
const parseWorkspaces = Schema.decodeUnknownEffect(Schema.Array(Workspace));
const parseWorkspaceCreateInput = Schema.decodeUnknownEffect(WorkspaceCreateInput);
const parseWorkspaceCreateResult = Schema.decodeUnknownEffect(WorkspaceCreateResult);
const parseWorkspaceLabel = Schema.decodeUnknownEffect(Schema.String);
const parseWorkspaceMetadataReportInput = Schema.decodeUnknownEffect(WorkspaceMetadataReportInput);
const parseWorkspaceMoveBlockInput = Schema.decodeUnknownEffect(WorkspaceMoveBlockInput);
const parseWorkspaceMoveInput = Schema.decodeUnknownEffect(WorkspaceMoveInput);

/**
 * Expected failure union for workspace protocol operations.
 *
 * @category errors
 * @since 0.8.2
 */
export type WorkspaceOperationError = HerdrTransportRequestError;

/**
 * Workspace lifecycle, ordering, focus, and metadata capability.
 *
 * @category services
 * @since 0.8.2
 */
export interface IWorkspaceService {
  /** Creates a workspace and its initial tab and root pane. */
  readonly create: (
    input?: WorkspaceCreateInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<WorkspaceCreateResult, WorkspaceOperationError>;
  /** Lists workspaces in Herdr display order. */
  readonly list: (
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly Workspace[], WorkspaceOperationError>;
  /** Reads one workspace by its parsed identifier. */
  readonly get: (
    id: WorkspaceId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Workspace, WorkspaceOperationError>;
  /** Focuses one workspace and returns its updated state. */
  readonly focus: (
    id: WorkspaceId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Workspace, WorkspaceOperationError>;
  /** Renames one workspace. */
  readonly rename: (
    id: WorkspaceId,
    label: string,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<Workspace, WorkspaceOperationError>;
  /** Moves one workspace to an insertion index. */
  readonly move: (
    id: WorkspaceId,
    input: WorkspaceMoveInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly Workspace[], WorkspaceOperationError>;
  /** Moves a contiguous workspace block before an optional anchor. */
  readonly moveBlock: (
    ids: readonly WorkspaceId[],
    input?: WorkspaceMoveBlockInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<readonly Workspace[], WorkspaceOperationError>;
  /** Reports replace-or-remove metadata tokens for one workspace. */
  readonly reportMetadata: (
    id: WorkspaceId,
    input: WorkspaceMetadataReportInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, WorkspaceOperationError>;
  /** Closes one workspace. */
  readonly close: (
    id: WorkspaceId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, WorkspaceOperationError>;
  /** Closes the selected workspace and every workspace in its group. */
  readonly closeGroup: (
    id: WorkspaceId,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<void, WorkspaceOperationError>;
}

/**
 * Yieldable Effect service for Herdr workspace operations.
 *
 * @category services
 * @since 0.8.2
 */
export class WorkspaceService extends Context.Service<WorkspaceService, IWorkspaceService>()(
  "@herdr/sdk/WorkspaceService",
) {}

/**
 * Constructs workspace operations while preserving the shared transport requirement.
 *
 * @category constructors
 * @since 0.8.2
 */
export const makeWorkspaceService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;

  const readWorkspace = defineHerdrOperation(
    "WorkspaceService.readWorkspace",
    (
      operation: "workspace.get" | "workspace.focus" | "workspace.rename",
      id: WorkspaceId,
      label: string | undefined,
      options: HerdrTransportRequestOptionsEncoded,
    ) =>
      Effect.gen(function* () {
        const response =
          operation === "workspace.rename"
            ? yield* transport.request(operation, { workspaceId: id, label: label ?? "" }, options)
            : yield* transport.request(operation, { workspaceId: id }, options);
        return yield* decodeHerdrWire(
          parseWorkspace,
          response.result.workspace,
          response.requestId,
        );
      }),
  );

  return WorkspaceService.of({
    create: defineHerdrOperation("WorkspaceService.create", (input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "WorkspaceService.create",
          parseWorkspaceCreateInput,
          input,
        );
        const parametersWithoutFocus = Option.match(parsed.env, {
          onNone: () => ({
            cwd: Option.getOrNull(parsed.cwd),
            label: Option.getOrNull(parsed.label),
          }),
          onSome: (env) => ({
            cwd: Option.getOrNull(parsed.cwd),
            env,
            label: Option.getOrNull(parsed.label),
          }),
        });
        const parameters = Option.match(parsed.focus, {
          onNone: () => parametersWithoutFocus,
          onSome: (focus) => ({ ...parametersWithoutFocus, focus }),
        });
        const response = yield* transport.request("workspace.create", parameters, options);
        return yield* decodeHerdrWire(
          parseWorkspaceCreateResult,
          response.result,
          response.requestId,
        );
      }),
    ),
    list: defineHerdrOperation("WorkspaceService.list", (options = {}) =>
      Effect.gen(function* () {
        const response = yield* transport.request("workspace.list", {}, options);
        return yield* decodeHerdrWire(
          parseWorkspaces,
          response.result.workspaces,
          response.requestId,
        );
      }),
    ),
    get: defineHerdrOperation("WorkspaceService.get", (id, options = {}) =>
      readWorkspace("workspace.get", id, undefined, options),
    ),
    focus: defineHerdrOperation("WorkspaceService.focus", (id, options = {}) =>
      readWorkspace("workspace.focus", id, undefined, options),
    ),
    rename: defineHerdrOperation("WorkspaceService.rename", (id, label, options = {}) =>
      Effect.gen(function* () {
        const parsedLabel = yield* decodeHerdrInput(
          "WorkspaceService.rename",
          parseWorkspaceLabel,
          label,
        );
        return yield* readWorkspace("workspace.rename", id, parsedLabel, options);
      }),
    ),
    move: defineHerdrOperation("WorkspaceService.move", (id, input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "WorkspaceService.move",
          parseWorkspaceMoveInput,
          input,
        );
        const response = yield* transport.request(
          "workspace.move",
          { workspaceId: id, insertIndex: parsed.insertIndex },
          options,
        );
        return yield* decodeHerdrWire(
          parseWorkspaces,
          response.result.workspaces,
          response.requestId,
        );
      }),
    ),
    moveBlock: defineHerdrOperation("WorkspaceService.moveBlock", (ids, input = {}, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "WorkspaceService.moveBlock",
          parseWorkspaceMoveBlockInput,
          input,
        );
        const response = yield* transport.request(
          "workspace.move_block",
          {
            workspaceIds: ids,
            beforeWorkspaceId: Option.getOrNull(parsed.beforeWorkspaceId),
          },
          options,
        );
        return yield* decodeHerdrWire(
          parseWorkspaces,
          response.result.workspaces,
          response.requestId,
        );
      }),
    ),
    reportMetadata: defineHerdrOperation(
      "WorkspaceService.reportMetadata",
      (id, input, options = {}) =>
        Effect.gen(function* () {
          const parsed = yield* decodeHerdrInput(
            "WorkspaceService.reportMetadata",
            parseWorkspaceMetadataReportInput,
            input,
          );
          yield* transport.request(
            "workspace.report_metadata",
            {
              workspaceId: id,
              source: parsed.source,
              tokens: parsed.tokens,
              seq: Option.getOrNull(parsed.sequence),
              ttlMs: Option.getOrNull(parsed.ttlMs),
            },
            options,
          );
        }),
    ),
    close: defineHerdrOperation("WorkspaceService.close", (id, options = {}) =>
      transport.request("workspace.close", { workspaceId: id }, options).pipe(Effect.asVoid),
    ),
    closeGroup: defineHerdrOperation("WorkspaceService.closeGroup", (id, options = {}) =>
      transport
        .request("workspace.close", { workspaceId: id, closeGroup: true }, options)
        .pipe(Effect.asVoid),
    ),
  });
});

/**
 * Provides workspace operations while retaining the shared transport requirement.
 *
 * @category layers
 * @since 0.8.2
 */
export const workspaceServiceLayerWithoutDependencies: Layer.Layer<
  WorkspaceService,
  never,
  HerdrTransport
> = Layer.effect(WorkspaceService, makeWorkspaceService);

/**
 * Production workspace-service Layer using the ambient Herdr transport graph.
 *
 * @category layers
 * @since 0.8.2
 */
export const workspaceServiceLayer = workspaceServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
