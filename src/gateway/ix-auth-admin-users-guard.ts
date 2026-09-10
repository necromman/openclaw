// The rules the Gateway applies on top of the identity server's own permission model.
//
// The identity server gives an ADMIN account `ixauth:*:*`, so on its own it would let one
// administrator promote themselves to super administrator, demote the last one, or lock
// themselves out. Those are Gateway policy, not identity policy, so they are decided
// here, before any relay leaves the process.
//
// Session invalidation lives here too. Changing someone's roles or departments rewrites
// the claims their access token carries, and that token stays valid for its remaining
// lifetime (AUTH-IXAUTH 7.3): without ending the sessions, a change lands up to a refresh
// interval late. Ending them on both sides, and closing the sockets, is what makes it
// immediate.
import type { ServerResponse } from "node:http";
import {
  listIxAuthUsers,
  revokeIxAuthUserSessions,
  type IxAuthUserSummary,
} from "../auth/ix-auth/ix-auth-admin-users-client.js";
import { resolveIxAuthGatewayRole } from "../auth/ix-auth/ix-auth-role-map.js";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import { revokeIxAuthSessionsForIdentityEmail } from "../state/ix-auth-sessions-store.js";
import { sendJson } from "./http-common.js";
import type { IxAuthAdminContext } from "./ix-auth-admin-context.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

/**
 * Role codes this fork manages.
 *
 * `MODERATOR` stays accepted so an account that already holds it keeps working, but no
 * screen offers it. Codes outside this list belong to a deployment that configured its
 * own, and are refused rather than guessed at.
 */
export const IX_AUTH_MANAGEABLE_ROLE_CODES: readonly string[] = Object.freeze([
  "SUPERADMIN",
  "ADMIN",
  "EXECUTIVE",
  "MODERATOR",
  "MEMBER",
]);

/** Identity role codes that map onto a Gateway super-admin name. */
function superAdminRoleCodes(settings: IxAuthRuntimeSettings): string[] {
  return Object.entries(settings.roleMap)
    .filter(([, name]) => settings.superAdminRoles.includes(name))
    .map(([code]) => code);
}

/** True when this set of identity role codes carries super-admin rank. */
export function grantsSuperAdmin(params: {
  roles: readonly string[];
  settings: IxAuthRuntimeSettings;
}): boolean {
  return resolveIxAuthGatewayRole({ roles: [...params.roles], settings: params.settings })
    .isSuperAdmin;
}

/**
 * The account id the signed-in administrator is.
 *
 * The identity server's subject claim is that account's own id, which is what makes the
 * self checks exact rather than a comparison of email spellings.
 */
export function isSelfIxAuthUser(params: { admin: IxAuthAdminContext; userId: string }): boolean {
  return params.admin.principal.claims.subject === params.userId;
}

/** Answer 403 and report true when the administrator aimed an action at themselves. */
export function rejectSelfTarget(params: {
  res: ServerResponse;
  admin: IxAuthAdminContext;
  userId: string;
}): boolean {
  if (!isSelfIxAuthUser(params)) {
    return false;
  }
  sendJson(params.res, 403, { error: "self_forbidden" });
  return true;
}

/**
 * Answer 403 and report true when an ordinary administrator aimed at a super administrator.
 *
 * Without this an admin could demote, disable, or delete the person who could undo it.
 */
export function rejectSuperAdminTarget(params: {
  res: ServerResponse;
  admin: IxAuthAdminContext;
  deps: IxAuthHttpDependencies;
  target: IxAuthUserSummary;
}): boolean {
  if (params.admin.principal.isSuperAdmin) {
    return false;
  }
  if (!grantsSuperAdmin({ roles: params.target.roles, settings: params.deps.settings })) {
    return false;
  }
  sendJson(params.res, 403, { error: "forbidden" });
  return true;
}

/**
 * Answer 409 and report true when this would remove the last super administrator.
 *
 * The identity server does not track "the last one", so the count is asked of it here.
 * A deployment that maps several codes onto super-admin rank is counted by the widest
 * single code rather than by summing them, because one account may hold two of those
 * codes and would then be counted twice; under-counting only ever refuses a change that
 * would have been allowed, which is the safe direction.
 */
export async function rejectLastSuperAdminRemoval(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  target: IxAuthUserSummary;
}): Promise<boolean> {
  if (!grantsSuperAdmin({ roles: params.target.roles, settings: params.deps.settings })) {
    return false;
  }
  let widest = 0;
  for (const code of superAdminRoleCodes(params.deps.settings)) {
    const page = await listIxAuthUsers({
      ...params.admin.call,
      role: code,
      page: 0,
      size: 1,
    });
    if (!page.ok) {
      // The count could not be taken, so the protection cannot be proved. Refusing is
      // the only answer that cannot end with an unreachable deployment.
      sendJson(params.res, 503, { error: "identity_unavailable", message: page.message });
      return true;
    }
    widest = Math.max(widest, page.total);
  }
  if (widest > 1) {
    return false;
  }
  sendJson(params.res, 409, { error: "last_super_admin" });
  return true;
}

/** How many sessions one enforcement pass ended, on each side. */
export type IxAuthSessionTakedown = { identitySessions: number; gatewaySessions: number };

/**
 * End every session one account holds, everywhere, and close its sockets.
 *
 * Called after any change to roles, departments, or status. The identity server's own
 * revocation is what stops a refresh from succeeding; the Gateway rows are what stop the
 * cookie that is already in the browser; the socket close is what stops a connection that
 * was admitted before either.
 */
export async function endIxAuthUserSessions(params: {
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  target: IxAuthUserSummary;
  reason: string;
}): Promise<IxAuthSessionTakedown> {
  const revoked = await revokeIxAuthUserSessions({
    ...params.admin.call,
    userId: params.target.id,
  });
  const profileIds = revokeIxAuthSessionsForIdentityEmail({
    email: params.target.email,
    revokedAt: Date.now(),
    reason: params.reason,
  });
  for (const profileId of profileIds) {
    params.deps.disconnectClientsForUserProfile?.(profileId);
  }
  return {
    identitySessions: revoked.ok ? revoked.revoked : 0,
    gatewaySessions: profileIds.length,
  };
}
