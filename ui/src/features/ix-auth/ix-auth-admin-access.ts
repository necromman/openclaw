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

/** Record what the last session probe reported. Called only by the session client. */
export function setIxAuthAdminAccess(value: boolean): void {
  ixAuthAdminAccess = value;
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
