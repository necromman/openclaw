// One account as the management screen reads it.
//
// The projection lives apart from the routes so the list, the detail panel, and every
// mutating action answer with exactly the same shape: a screen that had to tell three
// spellings of "this user" apart would drift the moment one route grew a field.
import type { IxAuthUserSummary } from "../auth/ix-auth/ix-auth-admin-users-client.js";
import { resolveIxAuthGatewayRole } from "../auth/ix-auth/ix-auth-role-map.js";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";

/**
 * Project one identity account into the row a browser receives.
 *
 * The Gateway role is resolved here rather than in the browser: the mapping is
 * deployment configuration, and a screen that guessed at it would disagree with the
 * permission checks the Gateway actually runs.
 */
export function projectIxAuthUser(params: {
  user: IxAuthUserSummary;
  settings: IxAuthRuntimeSettings;
  self: boolean;
}) {
  const role = resolveIxAuthGatewayRole({
    roles: params.user.roles,
    settings: params.settings,
  });
  const prefix = params.settings.departmentGroupPrefix;
  return {
    id: params.user.id,
    email: params.user.email,
    displayName: params.user.name,
    status: params.user.status,
    roles: params.user.roles,
    gatewayRole: role.gatewayRole,
    isSuperAdmin: role.isSuperAdmin,
    departments: params.user.groups.filter((code) => prefix.length > 0 && code.startsWith(prefix)),
    lastLoginAt: params.user.lastLoginAt,
    createdAt: params.user.createdAt,
    // `LOCKED` is the automatic lockout; the expiry is what tells an administrator
    // whether unlocking is worth doing or the lock clears on its own.
    locked: params.user.status === "LOCKED" || params.user.lockedUntil !== undefined,
    lockedUntil: params.user.lockedUntil,
    failedCount: params.user.failedCount,
    // Marked by the Gateway, so a screen never has to compare email spellings to find
    // out which row it must not offer destructive buttons for.
    self: params.self,
  };
}
