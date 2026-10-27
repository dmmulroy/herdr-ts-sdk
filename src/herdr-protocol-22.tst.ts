import { Effect, type Scope } from "effect";
import { expectTypeOf } from "vite-plus/test";
import {
  type IHerdrSdk,
  type ClientShellAgentView,
  type ClientShellConnection,
  type ClientShellConnectInputEncoded,
  type ClientShellProjection,
  type HerdrEndpointFailure,
  type HerdrEndpointConnectError,
  type HerdrInvalidInput,
  type WorkspaceCreateOptionsEncoded,
} from "./index.ts";

declare const sdk: IHerdrSdk;
declare const connectionInput: ClientShellConnectInputEncoded;
const workspace = sdk.ids.workspace("workspace");
const pane = sdk.ids.pane("pane");
const command = sdk.ids.command("command");

sdk.workspaces.create();
sdk.workspaces.createInDirectory("/repository", { focus: false });
sdk.workspaces.createFromWorkspace(workspace, { label: "review" });
// @ts-expect-error Directory intent is selected by the method, not an option bag.
sdk.workspaces.create({ cwd: "/repository" });
// @ts-expect-error No public directory discriminator is required or accepted.
sdk.workspaces.create({ directory: { _tag: "ServerDefault" } });
// @ts-expect-error Source workspace is positional on createFromWorkspace.
sdk.workspaces.create({ sourceWorkspaceId: workspace });
// @ts-expect-error Parsed workspace IDs and pane IDs are distinct.
sdk.workspaces.createFromWorkspace(pane);
sdk.commands.invokeInPane(command, pane, {
  selection: { anchor: { row: 0, col: 0 }, cursor: { row: 1, col: 1 } },
});
// @ts-expect-error Selection is pane-only, not tab input.
sdk.commands.invokeInTab(command, sdk.ids.tab("tab"), { selection: {} });
sdk.commands.invokeInPane(command, pane, {
  // @ts-expect-error Selection has no second, conflicting pane identifier.
  selection: { paneId: "other", anchor: { row: 0, col: 0 }, cursor: { row: 0, col: 0 } },
});
// @ts-expect-error Copy search requires a content revision.
sdk.panes.copySearch(pane, { query: "error", direction: "forward", cursor: { row: 0, col: 0 } });

const callback = sdk.clientShell.withConnection(connectionInput, () => Effect.succeed(42));
expectTypeOf(callback).toEqualTypeOf<Effect.Effect<number, HerdrEndpointConnectError>>();
const callbackFailure = sdk.clientShell.withConnection(connectionInput, () =>
  Effect.fail("domain-failure" as const),
);
expectTypeOf(callbackFailure).toEqualTypeOf<
  Effect.Effect<never, HerdrEndpointConnectError | "domain-failure">
>();
declare const dependency: Effect.Effect<number, HerdrInvalidInput, "application-dependency">;
const dependent = sdk.clientShell.withConnection(connectionInput, () => dependency);
expectTypeOf(dependent).toEqualTypeOf<
  Effect.Effect<number, HerdrEndpointConnectError | HerdrInvalidInput, "application-dependency">
>();
const registration = sdk.server.sshAgent.withRegistration({ socketPath: "/tmp/agent.sock" }, () =>
  Effect.succeed(42),
);
expectTypeOf<Effect.Services<typeof registration>>().toEqualTypeOf<never>();
expectTypeOf<Effect.Success<typeof registration>>().toEqualTypeOf<number>();
const scopedRegistration = sdk.server.sshAgent.registerScoped({ socketPath: "/tmp/agent.sock" });
expectTypeOf<Effect.Services<typeof scopedRegistration>>().toEqualTypeOf<Scope.Scope>();
expectTypeOf<keyof WorkspaceCreateOptionsEncoded>().toEqualTypeOf<"focus" | "label" | "env">();

declare const shell: ClientShellConnection;
expectTypeOf(shell.setHostTheme({ kind: "appearance", appearance: "dark" })).toEqualTypeOf<
  Effect.Effect<void, HerdrInvalidInput | HerdrEndpointFailure>
>();
// @ts-expect-error Host theme inputs use a domain discriminator, not a caller-authored _tag.
shell.setHostTheme({ _tag: "Appearance", appearance: "dark" });
// @ts-expect-error Foreground/background is the target of a default-color update, not its kind.
shell.setHostTheme({ kind: "foreground", color: { r: 0, g: 0, b: 0 } });
expectTypeOf<ClientShellProjection["agentView"]>().toEqualTypeOf<ClientShellAgentView>();
expectTypeOf<ClientShellAgentView["status"]>().toEqualTypeOf<"none" | "active" | "unrecognized">();
