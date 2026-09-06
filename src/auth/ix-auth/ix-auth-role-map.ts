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
  MODERATOR: "moderator",
  MEMBER: "member",
});

/** Role names that may reach unrestricted operator scopes when unset in config. */
export const IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES: readonly string[] = Object.freeze(["superadmin"]);

/**
 * Precedence from most to least privileged.
 *
 * A user carrying several IX-Auth roles resolves to the most privileged mapped name.
 * Names outside this list sort last in configuration order, so a custom role never
 * silently outranks a known one.
 */
const IX_AUTH_ROLE_PRECEDENCE: readonly string[] = Object.freeze([
  "superadmin",
  "admin",
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
