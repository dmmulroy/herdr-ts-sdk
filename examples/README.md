# Herdr TypeScript SDK examples

These examples are executable entrypoints for common local automation workflows. They use the
public `@herdr/sdk` package API and ambient Herdr configuration—`HERDR_SOCKET_PATH`, `HERDR_SESSION`,
or the platform's default session.

## Prerequisites

1. Start a Herdr release compatible with this SDK's protocol and attach a foreground client.
2. Install this repository with `pnpm install`.
3. Use Node.js 22.6 or newer to run TypeScript directly, or adapt an example in an application that
   depends on `@herdr/sdk`.

```sh
pnpm run example -- examples/session-inventory.ts
HERDR_SESSION=work pnpm run example -- examples/live-agent-monitor.ts
```

The `example` script builds the package before running the selected TypeScript file. All examples
are also compiled by `pnpm run check:examples` and the repository-wide `pnpm run check` gate.

## Use cases

| Example                                                                    | Real-world workflow                                                                           | Important behavior                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`development-workspace.ts`](development-workspace.ts)                     | Open a two-pane development workspace for a build watcher and test suite.                     | Creates and targets branded workspace/pane resources, then starts independent commands concurrently. |
| [`feature-worktree.ts`](feature-worktree.ts)                               | Create an isolated feature worktree and open it in a focused workspace.                       | Accepts an optional branch argument and explicitly opts into trusting the current repository.        |
| [`agent-code-review.ts`](agent-code-review.ts)                             | Launch a Codex reviewer in a new pane, prompt it, wait for completion, and notify the user.   | Separates the server-owned agent wait from the SDK request deadline.                                 |
| [`command-completion-notification.ts`](command-completion-notification.ts) | Run a build in a dedicated pane and show a foreground notification when its sentinel appears. | Uses recent unwrapped output and a bounded wait without polling.                                     |
| [`live-agent-monitor.ts`](live-agent-monitor.ts)                           | Monitor the current pane's agent state and notify on blocked or finished work.                | Consumes a cold, live-only event stream until interrupted; stream interruption releases the socket.  |
| [`graphics-status-overlay.ts`](graphics-status-overlay.ts)                 | Display a temporary RGBA status layer over the current pane.                                  | Checks pane visibility, selects a named z-indexed layer, and clears it with scoped finalization.     |
| [`session-inventory.ts`](session-inventory.ts)                             | Print a read-only inventory of workspaces and aggregate agent status.                         | Reads one consistent session snapshot and preserves optional focused-resource state.                 |

## Safety notes

- `feature-worktree.ts` sets `trustRepository: true`; run it only inside a repository you trust. Pass
  the desired branch as the first argument, for example
  `pnpm run example -- examples/feature-worktree.ts feature/payment-api`.
- `development-workspace.ts`, `agent-code-review.ts`, `command-completion-notification.ts`, and
  `feature-worktree.ts` create persistent Herdr resources. They intentionally leave those resources
  open for inspection and continued work.
- `live-agent-monitor.ts` runs until interrupted. `graphics-status-overlay.ts` runs for five seconds
  and clears its layer on success, failure, or interruption.
