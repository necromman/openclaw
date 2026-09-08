// One boolean: may the signed-in account manage users.
//
// It lives in a module of its own, with no imports at all, because the settings
// navigation reads it at startup. Reaching into the session client for the same answer
// would pull that whole module (and its fetch plumbing) into the boot bundle, which is
// several kilobytes for one flag.
//
// The session probe is the only writer: it learns the answer from `/auth/me`, where the
// Gateway withholds the console URL from anyone it does not judge an administrator.

let ixAuthAdminAccess = false;
let ixAuthSuperAdminAccess = false;

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
 * False before the first probe answers, and false for an ordinary administrator. The
 * Gateway refuses the routes behind that screen either way; this only decides whether an
 * item that would answer 403 is worth drawing.
 */
export function canManageIxAuthDepartments(): boolean {
  return ixAuthAdminAccess && ixAuthSuperAdminAccess;
}
