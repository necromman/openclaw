// Maps IX-Auth role codes onto gateway.roles definition names.
//
// IX-Auth owns "who has which role"; the Gateway owns "what a role may do". The
// mapping is the only seam between them, and it is deliberately data, not code.
import type { IxAuthRuntimeSettings } from "./ix-auth-types.js";

/**
 * Role map used when `gateway.auth.ixAuth.roleMap` is unset.
 *
 * IX-Auth role codes are upper case by convention (`docs/guides/permission-model.md`
 * section 4); gateway.roles definition names are lower case.
 */
export const IX_AUTH_DEFAULT_ROLE_MAP: Readonly<Record<string, string>> = Object.freeze({
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  EXECUTIVE: "executive",
  MODERATOR: "moderator",
  MEMBER: "member",
});

/** Role names that may reach unrestricted operator scopes when unset in config. */
export const IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES: readonly string[] = Object.freeze(["superadmin"]);

/**
 * Role names allowed to see the identity server's admin console link.
 *
 * Wider than the super-admin list on purpose. The console runs its own permission model
 * (`ixauth:users:read` and friends) and re-checks every action, so surfacing the link to
 * a department administrator cannot grant them anything the console would not already
 * allow. Hiding it from them would only mean they ask someone for the URL.
 */
const IX_AUTH_ADMIN_CONSOLE_ROLES: readonly string[] = Object.freeze(["superadmin", "admin"]);

/** True when this Gateway role should be offered the identity server's admin console. */
export function canOpenIxAuthAdminConsole(gatewayRole: string | undefined): boolean {
  return gatewayRole !== undefined && IX_AUTH_ADMIN_CONSOLE_ROLES.includes(gatewayRole);
}

/**
 * Precedence from most to least privileged.
 *
 * A user carrying several IX-Auth roles resolves to the most privileged mapped name.
 * Names outside this list sort last in configuration order, so a custom role never
 * silently outranks a known one.
 *
 * `executive` sits below `admin` because it is a reach role, not a rank: it reads across
 * every department but never writes another person's session. Ranking it above `admin`
 * would demote an administrator who also holds it.
 */
const IX_AUTH_ROLE_PRECEDENCE: readonly string[] = Object.freeze([
  "superadmin",
  "admin",
  "executive",
  "moderator",
  "member",
]);

function rankGatewayRoleName(name: string): number {
  const index = IX_AUTH_ROLE_PRECEDENCE.indexOf(name);
  return index === -1 ? IX_AUTH_ROLE_PRECEDENCE.length : index;
}

/**
 * Resolve the effective Gateway role for one set of IX-Auth role codes.
 *
 * Returns `undefined` when nothing maps: the caller then falls back to
 * `gateway.roles.default`, which is a deliberate deny-by-default posture rather than
 * an implicit promotion.
 *
 * `isSuperAdmin` is computed from `superAdminRoles`, never from the mapped name alone.
 * That way a typo that maps some code onto "superadmin" still cannot mint an
 * administrator unless the operator also listed it as a super-admin role.
 */
export function resolveIxAuthGatewayRole(params: {
  roles: string[];
  settings: Pick<IxAuthRuntimeSettings, "roleMap" | "superAdminRoles">;
}): { gatewayRole?: string; isSuperAdmin: boolean } {
  let best: string | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const code of params.roles) {
    const mapped = params.settings.roleMap[code];
    if (mapped === undefined) {
      continue;
    }
    const rank = rankGatewayRoleName(mapped);
    if (rank < bestRank) {
      best = mapped;
      bestRank = rank;
    }
  }
  return {
    gatewayRole: best,
    isSuperAdmin: best !== undefined && params.settings.superAdminRoles.includes(best),
  };
}
