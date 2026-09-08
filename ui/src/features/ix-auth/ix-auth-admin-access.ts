// One boolean: may the signed-in account manage users.
//
// It lives in a module of its own, with no imports at all, because the settings
// navigation reads it at startup. Reaching into the session client for the same answer
// would pull that whole module (and its fetch plumbing) into the boot bundle, which is
// several kilobytes for one flag.
//
// The session probe is the only writer: it learns the answer from `/auth/me`, which
// reports the account's Gateway role.

/**
 * The Gateway roles that may call the `/auth/admin/*` routes.
 *
 * It mirrors `IX_AUTH_ADMIN_API_ROLES` in `src/auth/ix-auth/ix-auth-role-map.ts`, which is
 * the predicate `ix-auth-admin-context.ts` actually enforces. It is deliberately NOT the
 * console predicate: the console is superadmin only, and using the console URL as the
 * stand-in shut ordinary administrators out of screens the Gateway serves them (AUTH-IXAUTH
 * 4-3). The list is inlined rather than imported so this module keeps its zero imports.
 */
const IX_AUTH_ADMIN_API_ROLES = ["superadmin", "admin"];

/** True when this Gateway role may call the admin routes. Shared by every caller. */
export function isIxAuthAdminRole(role: string | undefined): boolean {
  return role !== undefined && IX_AUTH_ADMIN_API_ROLES.includes(role);
}

let ixAuthAdminAccess = false;
let ixAuthSuperAdminAccess = false;
let ixAuthManagedSession = false;

/** Record what the last session probe reported. Called only by the session client. */
export function setIxAuthAdminAccess(value: boolean): void {
  ixAuthAdminAccess = value;
}

/**
 * Record whether the last probe reported the top rank.
 *
 * Kept apart from the flag above because the two answer different questions. An ordinary
 * administrator manages people; only a system administrator moves the department fence,
 * and a fence its occupants can move is not a fence (AUTH-DEPARTMENTS 7).
 */
export function setIxAuthSuperAdminAccess(value: boolean): void {
  ixAuthSuperAdminAccess = value;
}

/**
 * Record whether this browser holds a signed-in account on a delegated-identity Gateway.
 *
 * The two flags above answer "how high does this account rank"; this one answers "is
 * there a ranked account at all". A shared-token Gateway has no ranks, so nothing below
 * may narrow its settings menu.
 */
export function setIxAuthManagedSession(value: boolean): void {
  ixAuthManagedSession = value;
}

/**
 * True when the signed-in account may open the user-management screen.
 *
 * False before the first probe answers, so a surface that renders early shows nothing
 * rather than an item that would answer 403.
 */
export function canManageIxAuthUsers(): boolean {
  return ixAuthAdminAccess;
}

/**
 * True when the signed-in account may open the department screen.
 *
 * False before the first probe answers, and false for an ordinary administrator: the
 * department writes are superadmin only (`rejectNonSuperAdmin` in
 * `src/gateway/ix-auth-admin-departments-http.ts`). The top rank alone decides it, because
 * every superadmin is also an admin; asking both would only restate that.
 */
export function canManageIxAuthDepartments(): boolean {
  return ixAuthSuperAdminAccess;
}

/**
 * True when the settings menu must shrink to the entries that belong to the account.
 *
 * A staff member, a moderator and an executive all configure nothing on this deployment:
 * every remaining settings screen writes Gateway configuration that everyone shares, and
 * a screen whose every control answers 403 is worse than no screen. Administrators keep
 * the full menu, and a shared-token Gateway keeps it too because it has no accounts to
 * rank. False before the first probe answers, so nothing disappears mid-flight.
 */
export function isIxAuthRestrictedAccount(): boolean {
  return ixAuthManagedSession && !ixAuthAdminAccess;
}
