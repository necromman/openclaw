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
  | "signup"
  | "password-forgot"
  | "password-reset"
  | "email-verify"
  | "invite-accept"
  | "mail-hook"
  | "admin-invites"
  | "admin-approvals"
  | "admin-departments"
  | "outside"
  | "unknown";

/** Account-lifecycle routes reachable with no session at all. */
const IX_AUTH_PUBLIC_ACCOUNT_ROUTES: ReadonlySet<IxAuthHttpRoute> = new Set<IxAuthHttpRoute>([
  "signup",
  "password-forgot",
  "password-reset",
  "email-verify",
  "invite-accept",
]);

/** Routes that require a signed-in administrator rather than an anonymous visitor. */
const IX_AUTH_ADMIN_ACCOUNT_ROUTES: ReadonlySet<IxAuthHttpRoute> = new Set<IxAuthHttpRoute>([
  "admin-invites",
  "admin-approvals",
  "admin-departments",
]);

/** True for the anonymous account-lifecycle routes, which the IP limiter governs. */
export function isIxAuthPublicAccountRoute(route: IxAuthHttpRoute): boolean {
  return IX_AUTH_PUBLIC_ACCOUNT_ROUTES.has(route);
}

/** True for the routes gated on a superadmin or admin session. */
export function isIxAuthAdminAccountRoute(route: IxAuthHttpRoute): boolean {
  return IX_AUTH_ADMIN_ACCOUNT_ROUTES.has(route);
}

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
    case "/auth/signup":
      return "signup";
    case "/auth/password/forgot":
      return "password-forgot";
    case "/auth/password/reset":
      return "password-reset";
    case "/auth/email/verify":
      return "email-verify";
    case "/auth/invite/accept":
      return "invite-accept";
    // The identity server posts mail it could not send here. Service-key authenticated,
    // never reached by a browser, which is why it carries no Origin or CSRF requirement.
    case "/auth/mail-hook":
      return "mail-hook";
    case "/auth/admin/invites":
      return "admin-invites";
    case "/auth/admin/signup-approvals":
      return "admin-approvals";
    case "/auth/admin/departments":
      return "admin-departments";
    default:
      return "unknown";
  }
}

/**
 * Route namespace the Gateway owns for the identity server's admin console.
 *
 * The console is never published on its own host port (design invariant 4). It is
 * reached only through this Gateway path, which admits superadmin and admin sessions
 * and answers everyone else with 403.
 */
export const IX_AUTH_ADMIN_PROXY_BASE_PATH = "/admin/identity";

/** True when a request path belongs to the console proxy namespace. */
export function isIxAuthAdminProxyPath(pathname: string): boolean {
  return (
    pathname === IX_AUTH_ADMIN_PROXY_BASE_PATH ||
    pathname.startsWith(`${IX_AUTH_ADMIN_PROXY_BASE_PATH}/`)
  );
}

/**
 * Map one proxied path onto the identity server's own path.
 *
 * The console page derives its call paths from `location.pathname`: it posts sign-in to
 * `<here>/api/...` and calls the management API at `<here>/admin/...`. Serving the page
 * at this prefix therefore fixes the two shapes below, and nothing else in the namespace
 * is proxied at all.
 *
 * Returns `undefined` for a path inside the namespace that names no upstream route, so
 * the caller answers 404 instead of forwarding an attacker-chosen path.
 */
export function resolveIxAuthAdminProxyUpstreamPath(pathname: string): string | undefined {
  if (!isIxAuthAdminProxyPath(pathname)) {
    return undefined;
  }
  const suffix = pathname.slice(IX_AUTH_ADMIN_PROXY_BASE_PATH.length);
  if (suffix === "" || suffix === "/") {
    return "/admin-ui";
  }
  // Path traversal cannot reach outside the two prefixes below, but a normalized path
  // that still carries dot segments is rejected outright rather than reasoned about.
  if (suffix.includes("..")) {
    return undefined;
  }
  if (suffix === "/api" || suffix.startsWith("/api/")) {
    return `/admin-ui${suffix}`;
  }
  if (suffix.startsWith("/admin/")) {
    return suffix;
  }
  return undefined;
}
