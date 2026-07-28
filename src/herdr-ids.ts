import { isAbsolute } from "node:path";
import { HerdrError } from "./herdr-error.ts";
import type {
  AbsolutePath,
  AgentName,
  HerdrIdHelpers,
  PaneId,
  PluginActionId,
  PluginId,
  PluginLogId,
  TabId,
  TerminalId,
  WorkspaceId,
} from "./herdr-public-api.ts";

function parseNonEmptyHerdrIdentifier(value: string, kind: string): string {
  if (value.length === 0) {
    throw new HerdrError("invalid_argument", `${kind} must not be empty`, "local");
  }
  return value;
}

/** Validates caller-provided IDs and absolute paths before socket I/O. */
export const herdrIdHelpers: HerdrIdHelpers = {
  workspace(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Workspace ID") as WorkspaceId;
  },
  tab(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Tab ID") as TabId;
  },
  pane(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Pane ID") as PaneId;
  },
  terminal(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Terminal ID") as TerminalId;
  },
  plugin(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Plugin ID") as PluginId;
  },
  pluginAction(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Plugin action ID") as PluginActionId;
  },
  pluginLog(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Plugin log ID") as PluginLogId;
  },
  agentName(value) {
    // SAFETY: TypeScript cannot express brands; the non-empty identifier invariant was checked above.
    return parseNonEmptyHerdrIdentifier(value, "Agent name") as AgentName;
  },
  absolutePath(value) {
    if (!isAbsolute(value)) {
      throw new HerdrError("invalid_argument", `Absolute path required: ${value}`, "local");
    }
    // SAFETY: TypeScript cannot express brands; node:path verified that this path is absolute.
    return value as AbsolutePath;
  },
};
