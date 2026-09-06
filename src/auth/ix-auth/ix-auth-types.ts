// Closed contracts for the IX-Auth identity provider integration.
// See ix-auth/docs/contract/token.md for the canonical claim definitions.

/** Cookie name used when `gateway.auth.ixAuth.cookieName` is unset. */
export const IX_AUTH_SESSION_COOKIE_NAME = "__Host-openclaw-session";

/** Header the browser must echo the session CSRF token in on mutating requests. */
export const IX_AUTH_CSRF_HEADER_NAME = "x-openclaw-csrf";

/** Group codes must carry this prefix to be read as a department code. */
export const IX_AUTH_DEFAULT_DEPARTMENT_PREFIX = "dept-";

/** Claim carrying group codes when `departmentClaim` is unset. */
export const IX_AUTH_DEFAULT_DEPARTMENT_CLAIM = "ixauth_groups";

/** Idle session expiry when `session.idleTimeoutMinutes` is unset. */
export const IX_AUTH_DEFAULT_IDLE_MINUTES = 30;

/** Absolute session expiry when `session.absoluteTimeoutHours` is unset. */
export const IX_AUTH_DEFAULT_ABSOLUTE_HOURS = 12;

/**
 * Access tokens live 15 minutes by contract. Refresh this far ahead of expiry so a
 * long-lived WebSocket never observes an expired token mid-request.
 */
export const IX_AUTH_REFRESH_LEAD_MS = 60_000;

/** Verified claims from an IX-Auth access token. Never built from request input. */
export type IxAuthVerifiedClaims = {
  /** `sub`: the IX-Auth `users.id` as a string. Stable across email changes. */
  subject: string;
  /** `email`: display and profile linkage. */
  email: string;
  /** `name`: display only. */
  displayName: string;
  /** `ixauth_roles`: role codes, not permissions. */
  roles: string[];
  /** `ixauth_groups` (or the configured claim): group codes. */
  groups: string[];
  /** `ixauth_sid`: the IX-Auth session id, carried into audit rows. */
  identitySessionId: string;
  /** `exp` in epoch milliseconds. */
  expiresAtMs: number;
  /** `ixauth_pv`: permissions version, for permission-map cache invalidation. */
  permissionsVersion?: number;
  /** `act.sub`: present only while an administrator impersonates this subject. */
  impersonatorSubject?: string;
  /** `act.email`: the impersonating administrator. */
  impersonatorEmail?: string;
  /** `ixauth_idp`: present only for federated logins. Never used for authorization. */
  federatedIdp?: string;
};

/**
 * Server-side identity for one authenticated browser session.
 *
 * Constructed only from a validated login-session row plus a locally verified JWT.
 * Never from a request body, a WebSocket `connect` parameter, or a forwarded header.
 */
export type IxAuthPrincipal = {
  kind: "ix-auth";
  /** Primary key of the Gateway-owned login session row. */
  loginSessionId: string;
  /** Gateway `user_profiles.id` bound to this IX-Auth subject. */
  profileId: string;
  claims: IxAuthVerifiedClaims;
  /** Role name resolved through `roleMap`, or undefined when no role maps. */
  gatewayRole?: string;
  /** Department codes derived from the group claim. */
  departments: string[];
  /** True when `gatewayRole` is listed in `superAdminRoles`. */
  isSuperAdmin: boolean;
};

/** Resolved, defaulted view of `gateway.auth.ixAuth` used by the runtime. */
export type IxAuthRuntimeSettings = {
  baseUrl: string;
  jwksUrl: string;
  serviceKey: string;
  issuer?: string;
  audience?: string;
  cookieName: string;
  roleMap: Record<string, string>;
  superAdminRoles: string[];
  departmentClaim: string;
  departmentGroupPrefix: string;
  adminConsoleUrl?: string;
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
};

/** Outcome of one login relay, before any cookie is written. */
export type IxAuthLoginOutcome =
  | { kind: "authenticated"; principal: IxAuthPrincipal; csrfToken: string; sessionToken: string }
  | { kind: "mfa-required"; challenge: string }
  | { kind: "rejected"; status: number; code: string; message: string; lockedUntilMs?: number };

/** Reason a session-cookie lookup failed. Kept coarse so callers cannot enumerate. */
export type IxAuthSessionRejection =
  | "no-cookie"
  | "unknown-session"
  | "revoked"
  | "idle-expired"
  | "absolute-expired"
  | "identity-expired"
  | "profile-missing";
