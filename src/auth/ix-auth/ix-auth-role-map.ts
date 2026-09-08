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
 * Role names allowed to reach the identity server's own admin console.
 *
 * Super admin only, and deliberately narrower than the list below.
 *
 * The console used to be reasoned about as "safe to show widely, because it keeps its own
 * sign-in and re-checks every action against the identity server's permission model". Two
 * facts retired that argument. The baseline seed grants the `ADMIN` role `ixauth:*:*`, so
 * the console's own re-check stops nothing an administrator asks it for: account
 * creation, deletion, and role assignment included. And the Gateway now signs the console
 * in from the visitor's existing session (`src/gateway/ix-auth-admin-proxy.ts`), so the
 * console's second sign-in is no longer a second factor at all. What is left is one
 * screen that can mint a super admin, which is a super admin's decision to make.
 */
const IX_AUTH_ADMIN_CONSOLE_ROLES: readonly string[] = Object.freeze(["superadmin"]);

/**
 * Role names allowed to use the Gateway's own account-administration surfaces.
 *
 * Wider than the console list, and a different question: these are the fork's screens
 * (invitations, signup approvals, the user list, the activity ledger), each of which the
 * Gateway authorizes itself and scopes to the reader's departments. An administrator
 * belongs here; the identity server's unscoped console is what they do not get.
 */
const IX_AUTH_ADMIN_API_ROLES: readonly string[] = Object.freeze(["superadmin", "admin"]);

/** True when this Gateway role may open the identity server's admin console. */
export function canOpenIxAuthAdminConsole(gatewayRole: string | undefined): boolean {
  return gatewayRole !== undefined && IX_AUTH_ADMIN_CONSOLE_ROLES.includes(gatewayRole);
}

/** True when this Gateway role may use the fork's own account-administration routes. */
export function canUseIxAuthAdminApi(gatewayRole: string | undefined): boolean {
  return gatewayRole !== undefined && IX_AUTH_ADMIN_API_ROLES.includes(gatewayRole);
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
