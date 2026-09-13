import type { IncomingMessage, ServerResponse } from "node:http";
import { getIxAuthUser } from "../auth/ix-auth/ix-auth-admin-users-client.js";
import { relayIxAuthImpersonation, relayIxAuthLogout } from "../auth/ix-auth/ix-auth-client.js";
import { canUseIxAuthAdminApi } from "../auth/ix-auth/ix-auth-role-map.js";
import {
  matchesIxAuthCsrfDigest,
  readIxAuthSessionTokenRow,
  resolveIxAuthSessionToken,
  verifyIxAuthTokenBundle,
} from "../auth/ix-auth/ix-auth-sessions.js";
import {
  IX_AUTH_CSRF_HEADER_NAME,
  type IxAuthVerifiedClaims,
} from "../auth/ix-auth/ix-auth-types.js";
import { revokeIxAuthLoginSession } from "../state/ix-auth-sessions-store.js";
import { sendJson } from "./http-common.js";
import { sendRelayFailure, type IxAuthAdminContext } from "./ix-auth-admin-context.js";
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import { readRequestMeta, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { isIxAuthImpersonating } from "./ix-auth-impersonation-policy.js";
import { readIxAuthSessionCookie } from "./ix-auth-principal.js";
import {
  clearIxAuthReturnSession,
  clearIxAuthSessionCookies,
  readIxAuthReturnSession,
  writeIxAuthReturnSession,
  writeIxAuthSessionCookies,
} from "./ix-auth-session-cookies.js";
import { createIxAuthBrowserSession } from "./ix-auth-session-login.js";

type Request = { req: IncomingMessage; res: ServerResponse; deps: IxAuthHttpDependencies };

/** A recovery hint requires this browser's stored target row, not just cookie JSON. */
export function readIxAuthImpersonationReturnBinding(
  req: IncomingMessage,
  deps: IxAuthHttpDependencies,
) {
  const saved = readIxAuthReturnSession(req, deps);
  const currentToken = readIxAuthSessionCookie({ req, settings: deps.settings });
  const target =
    saved && currentToken === saved.impersonationToken
      ? readIxAuthSessionTokenRow(saved.impersonationToken)
      : undefined;
  return saved && target ? { saved, target } : undefined;
}

function liveSession(token: string) {
  const row = readIxAuthSessionTokenRow(token);
  const now = Date.now();
  return row &&
    row.revoked_at === null &&
    row.idle_expires_at > now &&
    row.absolute_expires_at > now
    ? row
    : undefined;
}

function sendAuthenticated(
  params: Request,
  profileId: string,
  csrfToken: string,
  claims: IxAuthVerifiedClaims,
): void {
  sendJson(params.res, 200, {
    authenticated: true,
    csrfToken,
    user: {
      profileId,
      email: claims.email,
      displayName: claims.displayName,
      roles: claims.roles,
      groups: claims.groups,
      impersonatedBy: claims.impersonatorEmail ?? claims.impersonatorSubject,
    },
  });
}

/** Keep the original administrator session alive; only the new browser identity changes. */
export async function startIxAuthImpersonation(
  params: Request & { admin: IxAuthAdminContext; userId: string },
): Promise<void> {
  const { admin, deps, req, res } = params;
  if (isIxAuthImpersonating(admin.principal)) {
    sendJson(res, 403, { error: "impersonation_forbidden" });
    return;
  }
  if (admin.principal.claims.subject === params.userId) {
    sendJson(res, 400, { error: "impersonation_self" });
    return;
  }
  const originalToken = readIxAuthSessionCookie({ req, settings: deps.settings });
  const csrf = req.headers[IX_AUTH_CSRF_HEADER_NAME];
  if (!originalToken || typeof csrf !== "string") {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }
  const target = await getIxAuthUser({ ...admin.call, userId: params.userId });
  if (!target.ok) {
    sendRelayFailure(res, target);
    return;
  }
  if (target.user.status !== "ACTIVE" || Date.parse(target.user.lockedUntil ?? "") > Date.now()) {
    sendJson(res, 409, { error: "impersonation_target_not_active" });
    return;
  }
  // Both administrator ranks may reproduce an active colleague's view, including
  // a higher rank. This does not grant the separate password/role editing capability.
  const relayed = await relayIxAuthImpersonation({ ...admin.call, userId: params.userId });
  if (!relayed.ok) {
    sendRelayFailure(res, relayed);
    return;
  }
  const verified = await verifyIxAuthTokenBundle({
    tokens: relayed.tokens,
    settings: deps.settings,
    nowMs: Date.now(),
  });
  const original = liveSession(originalToken);
  if (
    !verified.ok ||
    verified.claims.subject !== params.userId ||
    verified.claims.impersonatorSubject !== admin.principal.claims.subject ||
    !original ||
    original.id !== admin.principal.loginSessionId ||
    !matchesIxAuthCsrfDigest({ presented: csrf, storedDigest: original.csrf_digest })
  ) {
    await relayIxAuthLogout({
      settings: deps.settings,
      refreshToken: relayed.tokens.refreshToken,
      meta: admin.call.meta,
    });
    sendJson(res, verified.ok ? 401 : 502, {
      error: verified.ok ? "unauthenticated" : "identity_token_invalid",
    });
    return;
  }
  let created;
  try {
    created = createIxAuthBrowserSession({
      tokens: relayed.tokens,
      claims: verified.claims,
      settings: deps.settings,
      nowMs: Date.now(),
      userAgent: admin.call.meta.userAgent,
    });
  } catch {
    await relayIxAuthLogout({
      settings: deps.settings,
      refreshToken: relayed.tokens.refreshToken,
      meta: admin.call.meta,
    });
    sendJson(res, 500, { error: "session_persist_failed" });
    return;
  }
  writeIxAuthReturnSession(
    res,
    deps,
    {
      sessionToken: originalToken,
      csrfToken: csrf,
      impersonationToken: created.session.sessionToken,
    },
    original.absolute_expires_at,
  );
  writeIxAuthSessionCookies({ res, deps, session: created.session });
  deps.disconnectClientsForIxAuthLoginSession?.(original.id);
  recordIxAuthAdminAction({
    deps,
    admin,
    action: "impersonation-start",
    targetUserId: params.userId,
    detail: { email: verified.claims.email },
  });
  sendAuthenticated(params, created.profileId, created.session.csrfToken, verified.claims);
}

/** An expired target session may prove its binding, never authority to continue impersonating. */
export async function stopIxAuthImpersonation(params: Request, restore = true): Promise<void> {
  const { req, res, deps } = params;
  const bindingRow = readIxAuthImpersonationReturnBinding(req, deps);
  const csrf = req.headers[IX_AUTH_CSRF_HEADER_NAME];
  if (!bindingRow) {
    sendJson(res, 400, { error: "impersonation_not_active" });
    return;
  }
  const { saved, target } = bindingRow;
  if (
    typeof csrf !== "string" ||
    !matchesIxAuthCsrfDigest({ presented: csrf, storedDigest: target.csrf_digest })
  ) {
    sendJson(res, 403, { error: "csrf_mismatch" });
    return;
  }
  const meta = readRequestMeta(req, deps.clientIp);
  const original = await resolveIxAuthSessionToken({
    sessionToken: saved.sessionToken,
    settings: deps.settings,
    meta,
    nowMs: Date.now(),
    touch: false,
  });
  if (
    !original.ok ||
    isIxAuthImpersonating(original.principal) ||
    !canUseIxAuthAdminApi(original.principal.gatewayRole) ||
    !matchesIxAuthCsrfDigest({ presented: saved.csrfToken, storedDigest: original.row.csrf_digest })
  ) {
    revokeIxAuthLoginSession({
      sessionId: target.id,
      revokedAt: Date.now(),
      reason: "impersonation-restore-expired",
    });
    deps.disconnectClientsForIxAuthLoginSession?.(target.id);
    await relayIxAuthLogout({ settings: deps.settings, refreshToken: target.refresh_token, meta });
    clearIxAuthSessionCookies({ res, deps });
    clearIxAuthReturnSession(res, deps);
    sendJson(res, 401, { error: "impersonation_restore_expired" });
    return;
  }
  // This past timestamp checks a stored, signed actor binding even after expiry.
  // The original administrator above is independently resolved at the current time.
  const binding = await verifyIxAuthTokenBundle({
    settings: deps.settings,
    tokens: {
      accessToken: target.access_token,
      refreshToken: target.refresh_token,
      expiresInSeconds: 0,
    },
    nowMs: Math.min(Date.now(), target.access_expires_at - 1),
  });
  if (
    !binding.ok ||
    binding.claims.subject !== target.identity_subject ||
    binding.claims.impersonatorSubject !== original.principal.claims.subject
  ) {
    sendJson(res, 403, { error: "impersonation_binding_mismatch" });
    return;
  }
  const latestTarget = readIxAuthSessionTokenRow(saved.impersonationToken);
  revokeIxAuthLoginSession({
    sessionId: target.id,
    revokedAt: Date.now(),
    reason: "impersonation-stopped",
  });
  deps.disconnectClientsForIxAuthLoginSession?.(target.id);
  await relayIxAuthLogout({
    settings: deps.settings,
    refreshToken: latestTarget?.refresh_token ?? target.refresh_token,
    meta,
  });
  clearIxAuthReturnSession(res, deps);
  if (!restore) {
    revokeIxAuthLoginSession({
      sessionId: original.row.id,
      revokedAt: Date.now(),
      reason: "user-logout",
    });
    deps.disconnectClientsForIxAuthLoginSession?.(original.row.id);
    await relayIxAuthLogout({
      settings: deps.settings,
      refreshToken: original.row.refresh_token,
      meta,
    });
    clearIxAuthSessionCookies({ res, deps });
    recordIxAuthAdminAction({
      deps,
      admin: {
        principal: original.principal,
        call: { settings: deps.settings, accessToken: original.row.access_token, meta },
      },
      action: "impersonation-stop",
      targetUserId: target.identity_subject,
      detail: { logout: true },
    });
    sendJson(res, 200, { authenticated: false });
    return;
  }
  if (!liveSession(saved.sessionToken)) {
    clearIxAuthSessionCookies({ res, deps });
    sendJson(res, 401, { error: "impersonation_restore_expired" });
    return;
  }
  writeIxAuthSessionCookies({ res, deps, session: saved });
  recordIxAuthAdminAction({
    deps,
    admin: {
      principal: original.principal,
      call: { settings: deps.settings, accessToken: original.row.access_token, meta },
    },
    action: "impersonation-stop",
    targetUserId: target.identity_subject,
  });
  sendAuthenticated(
    params,
    original.principal.profileId,
    saved.csrfToken,
    original.principal.claims,
  );
}
