/**
 * Config-declared session permission ceilings.
 *
 * `agents.entries.<id>.tools.permissionMode`, falling back to
 * `agents.defaults.tools.permissionMode`, states the mode a new session inherits when
 * the caller names none. It is also a ceiling: narrowing stays free, widening past it
 * needs the operator admin scope, which is the rule that already guards "full".
 */
import type { SessionPermissionMode } from "../../packages/gateway-protocol/src/schema/sessions-row.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveAgentConfig } from "./agent-scope-config.js";

/** Ordered from most restrictive to least; a higher rank grants strictly more. */
const PERMISSION_MODE_RANK = {
  "read-only": 0,
  guarded: 1,
  workspace: 2,
  full: 3,
} as const satisfies Record<SessionPermissionMode, number>;

/** Resolves the configured permission mode for one agent id, if any. */
export function resolveAgentDefaultPermissionMode(
  cfg: OpenClawConfig | undefined,
  agentId: string | undefined,
): SessionPermissionMode | undefined {
  if (!cfg) {
    return undefined;
  }
  const entryMode = agentId ? resolveAgentConfig(cfg, agentId)?.tools?.permissionMode : undefined;
  return entryMode ?? cfg.agents?.defaults?.tools?.permissionMode;
}

/** True when `requested` grants more than `ceiling`. Equal or narrower is false. */
export function isPermissionModeWider(
  requested: SessionPermissionMode,
  ceiling: SessionPermissionMode,
): boolean {
  return PERMISSION_MODE_RANK[requested] > PERMISSION_MODE_RANK[ceiling];
}

/**
 * Resolves the mode a session should carry plus whether naming it needs the admin
 * scope. "full" always needs it, which is the pre-existing rule and holds even where no
 * agent ceiling is configured; anything wider than a configured ceiling needs it too.
 */
export function resolveRequestedSessionPermissionMode(
  cfg: OpenClawConfig | undefined,
  agentId: string | undefined,
  requested: SessionPermissionMode | undefined,
): { mode: SessionPermissionMode | undefined; needsAdminScope: boolean } {
  const ceiling = resolveAgentDefaultPermissionMode(cfg, agentId);
  const needsAdminScope =
    requested !== undefined &&
    (requested === "full" || (ceiling !== undefined && isPermissionModeWider(requested, ceiling)));
  return { mode: requested ?? ceiling, needsAdminScope };
}
