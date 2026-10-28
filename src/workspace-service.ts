/**
 * Controls Herdr workspace lifecycle, focus, ordering, and metadata.
 *
 * Workspace creation returns the initial tab and pane atomically, and block movement preserves contiguous workspace groups.
 *
 * @since 0.8.2
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HerdrAbsolutePath, type WorkspaceId } from "./herdr-domain.ts";
import {
  Workspace,
  WorkspaceCreateOptions,
  type WorkspaceCreateOptionsEncoded,
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
const parseWorkspaceCreateOptions = Schema.decodeEffect(WorkspaceCreateOptions, {
  onExcessProperty: "error",
});
const parseWorkspaceDirectory = Schema.decodeEffect(HerdrAbsolutePath);
const parseWorkspaceCreateResult = Schema.decodeUnknownEffect(WorkspaceCreateResult);
const parseWorkspaceLabel = Schema.decodeEffect(Schema.String);
const parseWorkspaceMetadataReportInput = Schema.decodeEffect(WorkspaceMetadataReportInput);
const parseWorkspaceMoveBlockInput = Schema.decodeEffect(WorkspaceMoveBlockInput);
const parseWorkspaceMoveInput = Schema.decodeEffect(WorkspaceMoveInput);

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
    input?: WorkspaceCreateOptionsEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<WorkspaceCreateResult, WorkspaceOperationError>;
  /** Creates a workspace in an explicit absolute directory. */
  readonly createInDirectory: (
    cwd: string,
    input?: WorkspaceCreateOptionsEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<WorkspaceCreateResult, WorkspaceOperationError>;
  /** Uses another workspace's directory policy; does not clone its layout or session. */
  readonly createFromWorkspace: (
    sourceWorkspaceId: WorkspaceId,
    input?: WorkspaceCreateOptionsEncoded,
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
  "herdr-sdk/WorkspaceService",
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
      operation: "workspace.get" | "workspace.focus",
      id: WorkspaceId,
      options: HerdrTransportRequestOptionsEncoded,
    ) =>
      Effect.gen(function* () {
        const response = yield* transport.request(operation, { workspaceId: id }, options);
        return yield* decodeHerdrWire(
          parseWorkspace,
          response.result.workspace,
          response.requestId,
        );
      }),
  );

  const createWorkspace = (
    operation: string,
    source:
      | { readonly kind: "default" }
      | { readonly kind: "directory"; readonly cwd: HerdrAbsolutePath }
      | { readonly kind: "workspace"; readonly sourceWorkspaceId: WorkspaceId },
    input: WorkspaceCreateOptionsEncoded,
    options: HerdrTransportRequestOptionsEncoded,
  ) =>
    Effect.gen(function* () {
      const parsed = yield* decodeHerdrInput(operation, parseWorkspaceCreateOptions, input);
      const directory =
        source.kind === "directory"
          ? { cwd: source.cwd }
          : source.kind === "workspace"
            ? { sourceWorkspaceId: source.sourceWorkspaceId }
            : {};
      const response = yield* transport.request(
        "workspace.create",
        {
          ...directory,
          label: Option.getOrNull(parsed.label),
          ...(Option.isSome(parsed.env) ? { env: parsed.env.value } : {}),
          ...(Option.isSome(parsed.focus) ? { focus: parsed.focus.value } : {}),
        },
        options,
      );
      return yield* decodeHerdrWire(
        parseWorkspaceCreateResult,
        response.result,
        response.requestId,
      );
    });

  return WorkspaceService.of({
    create: defineHerdrOperation("WorkspaceService.create", (input = {}, options = {}) =>
      createWorkspace("WorkspaceService.create", { kind: "default" }, input, options),
    ),
    createInDirectory: defineHerdrOperation(
      "WorkspaceService.createInDirectory",
      (cwd, input = {}, options = {}) =>
        Effect.gen(function* () {
          const directory = yield* decodeHerdrInput(
            "WorkspaceService.createInDirectory",
            parseWorkspaceDirectory,
            cwd,
          );
          return yield* createWorkspace(
            "WorkspaceService.createInDirectory",
            { kind: "directory", cwd: directory },
            input,
            options,
          );
        }),
    ),
    createFromWorkspace: defineHerdrOperation(
      "WorkspaceService.createFromWorkspace",
      (sourceWorkspaceId, input = {}, options = {}) =>
        createWorkspace(
          "WorkspaceService.createFromWorkspace",
          { kind: "workspace", sourceWorkspaceId },
          input,
          options,
        ),
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
      readWorkspace("workspace.get", id, options),
    ),
    focus: defineHerdrOperation("WorkspaceService.focus", (id, options = {}) =>
      readWorkspace("workspace.focus", id, options),
    ),
    rename: defineHerdrOperation("WorkspaceService.rename", (id, label, options = {}) =>
      Effect.gen(function* () {
        const parsedLabel = yield* decodeHerdrInput(
          "WorkspaceService.rename",
          parseWorkspaceLabel,
          label,
        );
        const response = yield* transport.request(
          "workspace.rename",
          { workspaceId: id, label: parsedLabel },
          options,
        );
        return yield* decodeHerdrWire(
          parseWorkspace,
          response.result.workspace,
          response.requestId,
        );
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
