// Path classification for the Gateway's own /auth/* backend-for-frontend routes.
//
// These routes are reached before any session exists, so they register as a plain
// (non-admitted) request stage, matching the device-pairing join route's shape.

/** Route namespace the Gateway owns for IX-Auth relaying. */
const IX_AUTH_HTTP_BASE_PATH = "/auth";

export type IxAuthHttpRoute =
  | "login"
  | "mfa"
  | "logout"
  | "refresh"
  | "me"
  | "outside"
  | "unknown";

/**
 * Classify one request path.
 *
 * `outside` means the path is not ours and the caller must fall through. `unknown`
 * means the path is inside `/auth` but names no route, which must answer 404 rather
 * than fall through, so a plugin cannot claim a sub-path of the auth namespace.
 */
export function classifyIxAuthHttpPath(pathname: string): IxAuthHttpRoute {
  if (pathname !== IX_AUTH_HTTP_BASE_PATH && !pathname.startsWith(`${IX_AUTH_HTTP_BASE_PATH}/`)) {
    return "outside";
  }
  switch (pathname) {
    case "/auth/login":
      return "login";
    case "/auth/mfa":
      return "mfa";
    case "/auth/logout":
      return "logout";
    case "/auth/refresh":
      return "refresh";
    case "/auth/me":
      return "me";
    default:
      return "unknown";
  }
}
