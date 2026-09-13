// Gateway backend-for-frontend routes that relay browser credentials to IX-Auth.
//
// Design invariant 4 (ix-auth/MODULE.md section 7): the identity server is never exposed
// to the browser. The browser only ever talks to these routes, and only ever receives an
// opaque session cookie. Access and refresh tokens stay in this process.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  relayIxAuthLogin,
  relayIxAuthLogout,
  relayIxAuthMfaVerify,
  type IxAuthTokenBundle,
} from "../auth/ix-auth/ix-auth-client.js";
import { canOpenIxAuthAdminConsole } from "../auth/ix-auth/ix-auth-role-map.js";
import { projectIxAuthGatewayRole } from "../auth/ix-auth/ix-auth-role-projection.js";
import {
  matchesIxAuthCsrfDigest,
  resolveIxAuthSessionToken,
  verifyIxAuthTokenBundle,
} from "../auth/ix-auth/ix-auth-sessions.js";
import { IX_AUTH_CSRF_HEADER_NAME } from "../auth/ix-auth/ix-auth-types.js";
import { revokeIxAuthLoginSession } from "../state/ix-auth-sessions-store.js";
import { AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET } from "./auth-rate-limit.js";
import { readRequestCookieValue } from "./cookie-header.js";
import { sendJson } from "./http-common.js";
import {
  recordIxAuthLoginActivity,
  recordIxAuthLoginFailureActivity,
  recordIxAuthLogoutActivity,
} from "./ix-auth-activity-audit.js";
import {
  classifyIxAuthHttpPath,
  isIxAuthAdminAccountRoute,
  isIxAuthPublicAccountRoute,
  IX_AUTH_ADMIN_PROXY_BASE_PATH,
  type IxAuthHttpRoute,
} from "./ix-auth-http-paths.js";
import {
  IX_AUTH_INVALID_CREDENTIALS,
  mapRelayFailureToResponse,
  readIxAuthJsonBody,
  readRequestMeta,
  rejectDisallowedOrigin,
  type IxAuthHttpDependencies,
} from "./ix-auth-http-shared.js";
import { readIxAuthImpersonationReturnBinding } from "./ix-auth-impersonation-http.js";
import { isIxAuthImpersonating } from "./ix-auth-impersonation-policy.js";
import {
  clearIxAuthReturnSession,
  readIxAuthReturnSession,
  clearIxAuthSessionCookies,
  resolveEffectiveCookieName,
  writeIxAuthSessionCookies,
} from "./ix-auth-session-cookies.js";
import { createIxAuthBrowserSession } from "./ix-auth-session-login.js";
import { withSerializedRateLimitAttempt } from "./rate-limit-attempt-serialization.js";

export { isAllowedIxAuthBrowserOrigin } from "./ix-auth-http-shared.js";

/** Built-in console route, trailing slash included so the page derives its own base. */
const IX_AUTH_ADMIN_PROXY_BASE_PATH_WITH_SLASH = `${IX_AUTH_ADMIN_PROXY_BASE_PATH}/`;

async function completeIxAuthLogin(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  tokens: IxAuthTokenBundle;
}): Promise<void> {
  const { deps, res } = params;
  const nowMs = Date.now();
  const userAgentHeader = params.req.headers["user-agent"];
  const userAgent = typeof userAgentHeader === "string" ? userAgentHeader : undefined;

  const verified = await verifyIxAuthTokenBundle({
    tokens: params.tokens,
    settings: deps.settings,
    nowMs,
  });
  if (!verified.ok) {
    deps.onSecurityEvent?.({
      action: "ix-auth.login.failed",
      outcome: "failed",
      clientIp: deps.clientIp,
      reason: verified.reason,
    });
    sendJson(res, 502, { error: "identity_token_invalid" });
    return;
  }

  let created;
  try {
    created = createIxAuthBrowserSession({
      tokens: params.tokens,
      claims: verified.claims,
      settings: deps.settings,
      userAgent,
      nowMs,
    });
  } catch {
    sendJson(res, 500, { error: "session_persist_failed" });
    return;
  }
  const { session, profileId, departments } = created;
  clearIxAuthReturnSession(res, deps);
  writeIxAuthSessionCookies({ res, deps, session });
  deps.onSecurityEvent?.({
    action: "ix-auth.login.succeeded",
    outcome: "succeeded",
    clientIp: deps.clientIp,
    profileId,
    identitySubject: session.claims.subject,
    identitySessionId: session.claims.identitySessionId,
    loginSessionId: session.sessionId,
  });
  recordIxAuthLoginActivity({
    req: params.req,
    deps,
    profileId,
    claims: session.claims,
    departments,
    settings: deps.settings,
  });
  sendJson(res, 200, {
    authenticated: true,
    csrfToken: session.csrfToken,
    user: {
      profileId,
      email: session.claims.email,
      displayName: session.claims.displayName,
      roles: session.claims.roles,
      groups: session.claims.groups,
    },
  });
}

async function handleIxAuthLoginRoute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const email = normalizeOptionalString(body.email);
  const password = typeof body.password === "string" ? body.password : undefined;
  if (!email || !password) {
    sendJson(params.res, 400, IX_AUTH_INVALID_CREDENTIALS);
    return;
  }
  const relay = await relayIxAuthLogin({
    settings: params.deps.settings,
    email,
    password,
    meta: readRequestMeta(params.req, params.deps.clientIp),
  });
  if (!relay.ok) {
    if (relay.code === "AUTH_MFA_REQUIRED" && relay.mfaChallenge) {
      params.deps.onSecurityEvent?.({
        action: "ix-auth.login.mfa-required",
        outcome: "denied",
        clientIp: params.deps.clientIp,
      });
      sendJson(params.res, 200, {
        authenticated: false,
        mfaRequired: true,
        challenge: relay.mfaChallenge,
      });
      return;
    }
    params.deps.rateLimiter?.recordFailure(
      params.deps.clientIp,
      AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
    );
    params.deps.onSecurityEvent?.({
      action: "ix-auth.login.failed",
      outcome: "failed",
      clientIp: params.deps.clientIp,
      reason: relay.code,
    });
    recordIxAuthLoginFailureActivity({
      req: params.req,
      deps: params.deps,
      email,
      reason: relay.code,
    });
    mapRelayFailureToResponse(params.res, relay);
    return;
  }
  params.deps.rateLimiter?.reset(params.deps.clientIp, AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET);
  await completeIxAuthLogin({ ...params, tokens: relay.tokens });
}

async function handleIxAuthMfaRoute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const challenge = normalizeOptionalString(body.challenge);
  const code = normalizeOptionalString(body.code);
  if (!challenge || !code) {
    sendJson(params.res, 400, { error: "invalid_code" });
    return;
  }
  const relay = await relayIxAuthMfaVerify({
    settings: params.deps.settings,
    challenge,
    code,
    meta: readRequestMeta(params.req, params.deps.clientIp),
  });
  if (!relay.ok) {
    params.deps.rateLimiter?.recordFailure(
      params.deps.clientIp,
      AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
    );
    params.deps.onSecurityEvent?.({
      action: "ix-auth.login.failed",
      outcome: "failed",
      clientIp: params.deps.clientIp,
      reason: relay.code,
    });
    // The address never reaches this route - the challenge stands in for it - so the row
    // records the refusal without naming an account.
    recordIxAuthLoginFailureActivity({ req: params.req, deps: params.deps, reason: relay.code });
    sendJson(params.res, 401, { error: "invalid_code", message: "That code is not valid." });
    return;
  }
  params.deps.rateLimiter?.reset(params.deps.clientIp, AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET);
  await completeIxAuthLogin({ ...params, tokens: relay.tokens });
}

async function handleIxAuthLogoutRoute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  if (readIxAuthImpersonationReturnBinding(params.req, params.deps)) {
    const impersonation = await import("./ix-auth-impersonation-http.js");
    await impersonation.stopIxAuthImpersonation(params, false);
    return;
  }
  const cookieName = resolveEffectiveCookieName(params.deps.settings, params.deps.isSecureContext);
  const sessionToken = readRequestCookieValue(params.req, cookieName);
  if (!sessionToken) {
    clearIxAuthReturnSession(params.res, params.deps);
    clearIxAuthSessionCookies({ res: params.res, deps: params.deps });
    sendJson(params.res, 200, { authenticated: false });
    return;
  }
  const resolution = await resolveIxAuthSessionToken({
    sessionToken,
    settings: params.deps.settings,
    meta: readRequestMeta(params.req, params.deps.clientIp),
    nowMs: Date.now(),
    touch: false,
  });
  if (resolution.ok) {
    // CSRF applies to logout too: a forced logout is a real denial-of-service.
    const presented = params.req.headers[IX_AUTH_CSRF_HEADER_NAME];
    const csrfToken = typeof presented === "string" ? presented : undefined;
    if (
      !csrfToken ||
      !matchesIxAuthCsrfDigest({ presented: csrfToken, storedDigest: resolution.row.csrf_digest })
    ) {
      sendJson(params.res, 403, { error: "csrf_mismatch" });
      return;
    }
    revokeIxAuthLoginSession({
      sessionId: resolution.row.id,
      revokedAt: Date.now(),
      reason: "user-logout",
    });
    // The session row is dead, but an already admitted WebSocket keeps the scopes it was
    // given at connect time. Close those before answering, so the tab that just signed
    // out cannot keep driving the Gateway until it happens to reload.
    params.deps.disconnectClientsForUserProfile?.(resolution.row.profile_id);
    // Best effort: the Gateway session is already dead, so a failure here only delays
    // the identity server's own cleanup.
    await relayIxAuthLogout({
      settings: params.deps.settings,
      refreshToken: resolution.row.refresh_token,
      meta: readRequestMeta(params.req, params.deps.clientIp),
    });
    params.deps.onSecurityEvent?.({
      action: "ix-auth.logout",
      outcome: "succeeded",
      clientIp: params.deps.clientIp,
      profileId: resolution.row.profile_id,
      identitySubject: resolution.row.identity_subject,
      identitySessionId: resolution.row.identity_session_id,
      loginSessionId: resolution.row.id,
    });
    recordIxAuthLogoutActivity({
      req: params.req,
      deps: params.deps,
      profileId: resolution.row.profile_id,
      email: resolution.principal.claims.email,
      ...(isIxAuthImpersonating(resolution.principal)
        ? {
            impersonator: {
              subject: resolution.principal.claims.impersonatorSubject,
              email: resolution.principal.claims.impersonatorEmail,
            },
          }
        : {}),
    });
  }
  clearIxAuthReturnSession(params.res, params.deps);
  clearIxAuthSessionCookies({ res: params.res, deps: params.deps });
  sendJson(params.res, 200, { authenticated: false });
}

async function handleIxAuthSessionProbeRoute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  refresh: boolean;
}): Promise<void> {
  const returnBinding = readIxAuthImpersonationReturnBinding(params.req, params.deps);
  if (!returnBinding && readIxAuthReturnSession(params.req, params.deps)) {
    clearIxAuthReturnSession(params.res, params.deps);
  }
  const cookieName = resolveEffectiveCookieName(params.deps.settings, params.deps.isSecureContext);
  const sessionToken = readRequestCookieValue(params.req, cookieName);
  // Declared once so the unauthenticated body is byte-identical whether the cookie was
  // absent, unknown, revoked, or expired. A caller must not be able to tell them apart.
  const unauthenticated: {
    authenticated: false;
    authMode: "ix-auth";
    selfSignupEnabled: boolean;
    impersonationRestoreAvailable?: boolean;
    adminConsoleUrl?: string;
  } = {
    authenticated: false,
    authMode: "ix-auth",
    // Told to every visitor, signed in or not: the sign-in screen needs it before anyone
    // has an identity, and it says nothing about who exists.
    selfSignupEnabled: params.deps.settings.selfSignupEnabled,
    ...(returnBinding ? { impersonationRestoreAvailable: true } : {}),
  };
  if (!sessionToken) {
    sendJson(params.res, 200, unauthenticated);
    return;
  }
  const resolution = await resolveIxAuthSessionToken({
    sessionToken,
    settings: params.deps.settings,
    meta: readRequestMeta(params.req, params.deps.clientIp),
    nowMs: Date.now(),
    touch: params.refresh,
  });
  if (!resolution.ok) {
    if (!returnBinding) {
      clearIxAuthSessionCookies({ res: params.res, deps: params.deps });
    }
    params.deps.onSecurityEvent?.({
      action: "ix-auth.session.rejected",
      outcome: "denied",
      clientIp: params.deps.clientIp,
      reason: resolution.rejection,
    });
    sendJson(params.res, 200, unauthenticated);
    return;
  }
  const { principal } = resolution;
  // A session that predates the role projection heals here rather than at the next
  // sign-in: the Control UI probes this route before it opens the WebSocket, and the
  // handshake reads the profile row this writes.
  projectIxAuthGatewayRole({
    profileId: principal.profileId,
    roles: principal.claims.roles,
    settings: params.deps.settings,
  });
  sendJson(params.res, 200, {
    authenticated: true,
    authMode: "ix-auth",
    selfSignupEnabled: params.deps.settings.selfSignupEnabled,
    // Withheld from the payload rather than hidden in the browser, so a non-administrator
    // never receives the URL in the first place.
    adminConsoleUrl:
      !isIxAuthImpersonating(principal) && canOpenIxAuthAdminConsole(principal.gatewayRole)
        ? // The Gateway proxies the console at a route of its own, so the default needs no
          // configuration and no second host name. `adminConsoleUrl` remains an override
          // for a deployment that publishes the console separately.
          (params.deps.settings.adminConsoleUrl ?? IX_AUTH_ADMIN_PROXY_BASE_PATH_WITH_SLASH)
        : undefined,
    user: {
      profileId: principal.profileId,
      email: principal.claims.email,
      displayName: principal.claims.displayName,
      roles: principal.claims.roles,
      groups: principal.claims.groups,
      gatewayRole: principal.gatewayRole,
      departments: principal.departments,
      isSuperAdmin: principal.isSuperAdmin,
      impersonatedBy: principal.claims.impersonatorEmail ?? principal.claims.impersonatorSubject,
    },
  });
}

/** Methods each route accepts. Anything else is 405 before any work happens. */
const IX_AUTH_ROUTE_METHODS: ReadonlyMap<IxAuthHttpRoute, ReadonlySet<string>> = new Map<
  IxAuthHttpRoute,
  ReadonlySet<string>
>([
  ["login", new Set(["POST"])],
  ["mfa", new Set(["POST"])],
  ["logout", new Set(["POST"])],
  ["impersonation-stop", new Set(["POST"])],
  ["refresh", new Set(["POST"])],
  ["me", new Set(["GET"])],
  ["signup", new Set(["POST"])],
  ["password-forgot", new Set(["POST"])],
  ["password-reset", new Set(["POST"])],
  ["email-verify", new Set(["POST"])],
  ["invite-accept", new Set(["POST"])],
  ["mail-hook", new Set(["POST"])],
  ["admin-invites", new Set(["GET", "POST", "DELETE"])],
  ["admin-approvals", new Set(["GET", "POST"])],
  // POST creates a department group; PATCH renames the fork's own display name for one;
  // DELETE removes an empty one from both the identity server and the projection. The
  // route refuses a department anybody is still in, which is what keeps a delete from
  // orphaning memberships the way deleting the group in the console does.
  ["admin-departments", new Set(["GET", "POST", "PATCH", "DELETE"])],
  // GET reads the model policy; PUT replaces it whole, so a stale screen cannot merge
  // half of an older list back in.
  ["admin-models", new Set(["GET", "PUT"])],
  ["admin-users", new Set(["GET", "POST", "PATCH", "PUT", "DELETE"])],
  ["admin-audit-export", new Set(["GET"])],
]);

/**
 * Run one handler behind the per-IP limiter.
 *
 * Signup, password recovery, and the token-bearing routes share the sign-in bucket on
 * purpose: they are the same guessing surface reached by a different door, and separate
 * buckets would let an attacker spend a fresh allowance on each one.
 */
async function withIxAuthRateLimit(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  run: () => Promise<void>;
}): Promise<void> {
  await withSerializedRateLimitAttempt({
    ip: params.deps.clientIp,
    scope: AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
    run: async () => {
      const rateCheck = params.deps.rateLimiter?.check(
        params.deps.clientIp,
        AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
      );
      if (rateCheck && !rateCheck.allowed) {
        if (rateCheck.retryAfterMs > 0) {
          params.res.setHeader("Retry-After", String(Math.ceil(rateCheck.retryAfterMs / 1000)));
        }
        sendJson(params.res, 429, {
          error: "rate_limited",
          retryAfterMs: rateCheck.retryAfterMs,
        });
        return;
      }
      await params.run();
    },
  });
}

/**
 * Handle one `/auth/*` request.
 *
 * Returns false only when the path lies outside the namespace, so the caller falls
 * through to later stages. Every path inside `/auth` is answered here.
 */
export async function handleIxAuthHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  deps: IxAuthHttpDependencies;
}): Promise<boolean> {
  const route = classifyIxAuthHttpPath(params.pathname);
  if (route === "outside") {
    return false;
  }
  params.res.setHeader("Cache-Control", "no-store");
  const allowedMethods = IX_AUTH_ROUTE_METHODS.get(route);
  if (route === "unknown" || !allowedMethods) {
    sendJson(params.res, 404, { error: "not_found" });
    return true;
  }
  if (!params.req.method || !allowedMethods.has(params.req.method)) {
    sendJson(params.res, 405, { error: "method_not_allowed" });
    return true;
  }
  // The mail hook is the one route here no browser reaches. It is authenticated by the
  // service key instead, so requiring a browser origin would only break it.
  if (route === "mail-hook") {
    const accountModule = await import("./ix-auth-account-http.js");
    await accountModule.handleIxAuthMailHook(params);
    return true;
  }
  // Every remaining route is cookie-bearing, so cross-site callers are rejected outright
  // rather than relying on SameSite alone.
  if (rejectDisallowedOrigin({ req: params.req, res: params.res, deps: params.deps })) {
    return true;
  }

  if (route === "me") {
    await handleIxAuthSessionProbeRoute({ ...params, refresh: false });
    return true;
  }
  if (route === "refresh") {
    await handleIxAuthSessionProbeRoute({ ...params, refresh: true });
    return true;
  }
  if (route === "logout") {
    await handleIxAuthLogoutRoute(params);
    return true;
  }
  if (route === "impersonation-stop") {
    const impersonation = await import("./ix-auth-impersonation-http.js");
    await impersonation.stopIxAuthImpersonation(params);
    return true;
  }
  if (isIxAuthAdminAccountRoute(route)) {
    const adminModule = await import("./ix-auth-admin-http.js");
    await adminModule.handleIxAuthAdminHttpRequest({ ...params, route });
    return true;
  }
  if (isIxAuthPublicAccountRoute(route)) {
    const accountModule = await import("./ix-auth-account-http.js");
    await withIxAuthRateLimit({
      res: params.res,
      deps: params.deps,
      run: async () => {
        await accountModule.handleIxAuthAccountHttpRequest({ ...params, route });
      },
    });
    return true;
  }

  // Login and MFA are the brute-force surface. Serialize per IP so parallel guesses
  // cannot outrun the limiter's own bookkeeping.
  await withIxAuthRateLimit({
    res: params.res,
    deps: params.deps,
    run: async () => {
      if (route === "login") {
        await handleIxAuthLoginRoute(params);
        return;
      }
      await handleIxAuthMfaRoute(params);
    },
  });
  return true;
}
