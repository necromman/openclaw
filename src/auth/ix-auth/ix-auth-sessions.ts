// Gateway-owned browser login sessions for ix-auth mode.
//
// The browser holds one opaque, high-entropy session token in an HttpOnly cookie. The
// IX-Auth access and refresh tokens never leave this process. That is what makes logout
// and suspension immediate: revoking the row kills the session now, rather than waiting
// out the 15-minute access-token lifetime.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { generateSecureUuid } from "../../infra/secure-random.js";
import {
  insertIxAuthLoginSession,
  readIxAuthLoginSessionByDigest,
  revokeIxAuthLoginSession,
  touchIxAuthLoginSession,
  updateIxAuthSessionTokens,
} from "../../state/ix-auth-sessions-store.js";
import type { IxAuthLoginSessionRow } from "../../state/ix-auth-sessions-schema.js";
import { relayIxAuthRefresh, type IxAuthRequestMeta, type IxAuthTokenBundle } from "./ix-auth-client.js";
import { parseIxAuthTokenClaims, readIxAuthDepartmentCodes } from "./ix-auth-claims.js";
import { verifyIxAuthAccessToken } from "./ix-auth-jwks.js";
import { resolveIxAuthGatewayRole } from "./ix-auth-role-map.js";
import {
  IX_AUTH_REFRESH_LEAD_MS,
  type IxAuthPrincipal,
  type IxAuthRuntimeSettings,
  type IxAuthSessionRejection,
  type IxAuthVerifiedClaims,
} from "./ix-auth-types.js";

/** 256 bits of entropy for both the session token and the CSRF token. */
const IX_AUTH_TOKEN_BYTES = 32;

function digestSecretToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

function digestUserAgent(userAgent: string | undefined): Uint8Array | null {
  return userAgent ? createHash("sha256").update(userAgent, "utf8").digest() : null;
}

/** Mint an unguessable, URL-safe token for a cookie or a CSRF header. */
export function mintIxAuthSecretToken(): string {
  return randomBytes(IX_AUTH_TOKEN_BYTES).toString("base64url");
}

/** Compare a presented CSRF token against the stored digest in constant time. */
export function matchesIxAuthCsrfDigest(params: {
  presented: string;
  storedDigest: Uint8Array;
}): boolean {
  return timingSafeEqual(digestSecretToken(params.presented), params.storedDigest);
}

/** Everything a caller needs after a session is created, before the cookie is written. */
export type IxAuthCreatedSession = {
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  claims: IxAuthVerifiedClaims;
};

/**
 * Verify a freshly relayed token bundle and return its claims.
 *
 * Kept separate from persistence so the caller can resolve the Gateway profile from the
 * verified email before any row is written. Minting a profile from an unverified token
 * would let a forged bundle create identities.
 */
export async function verifyIxAuthTokenBundle(params: {
  tokens: IxAuthTokenBundle;
  settings: IxAuthRuntimeSettings;
  nowMs: number;
}): Promise<{ ok: true; claims: IxAuthVerifiedClaims } | { ok: false; reason: string }> {
  const verified = await verifyIxAuthAccessToken({
    token: params.tokens.accessToken,
    jwksUrl: params.settings.jwksUrl,
    nowMs: params.nowMs,
  });
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const parsed = parseIxAuthTokenClaims({
    payload: verified.payload,
    settings: params.settings,
    nowMs: params.nowMs,
  });
  return parsed.ok ? { ok: true, claims: parsed.claims } : { ok: false, reason: parsed.reason };
}

/**
 * Persist a new login session for already verified claims.
 *
 * Session fixation defense: this always mints a brand-new session id and token. A caller
 * that had a pre-login session must revoke it separately rather than reuse its id.
 */
export function persistIxAuthLoginSession(params: {
  tokens: IxAuthTokenBundle;
  claims: IxAuthVerifiedClaims;
  settings: IxAuthRuntimeSettings;
  profileId: string;
  userAgent?: string;
  nowMs: number;
}): IxAuthCreatedSession {
  const sessionToken = mintIxAuthSecretToken();
  const csrfToken = mintIxAuthSecretToken();
  const sessionId = generateSecureUuid();
  insertIxAuthLoginSession({
    id: sessionId,
    token_digest: digestSecretToken(sessionToken),
    csrf_digest: digestSecretToken(csrfToken),
    profile_id: params.profileId,
    identity_subject: params.claims.subject,
    identity_session_id: params.claims.identitySessionId,
    identity_email: params.claims.email,
    access_token: params.tokens.accessToken,
    access_expires_at: params.claims.expiresAtMs,
    refresh_token: params.tokens.refreshToken,
    user_agent_digest: digestUserAgent(params.userAgent),
    created_at: params.nowMs,
    last_seen_at: params.nowMs,
    idle_expires_at: params.nowMs + params.settings.idleTimeoutMs,
    absolute_expires_at: params.nowMs + params.settings.absoluteTimeoutMs,
  });
  return { sessionId, sessionToken, csrfToken, claims: params.claims };
}

function buildPrincipalFromClaims(params: {
  row: IxAuthLoginSessionRow;
  claims: IxAuthVerifiedClaims;
  settings: IxAuthRuntimeSettings;
}): IxAuthPrincipal {
  const role = resolveIxAuthGatewayRole({
    roles: params.claims.roles,
    settings: params.settings,
  });
  return {
    kind: "ix-auth",
    loginSessionId: params.row.id,
    profileId: params.row.profile_id,
    claims: params.claims,
    gatewayRole: role.gatewayRole,
    departments: readIxAuthDepartmentCodes({
      groups: params.claims.groups,
      prefix: params.settings.departmentGroupPrefix,
    }),
    isSuperAdmin: role.isSuperAdmin,
  };
}

/** Outcome of resolving a presented session cookie. */
export type IxAuthSessionResolution =
  | { ok: true; principal: IxAuthPrincipal; row: IxAuthLoginSessionRow }
  | { ok: false; rejection: IxAuthSessionRejection };

/**
 * Resolve a session cookie into a verified principal.
 *
 * Refreshes the access token in place when it is about to expire, which is what keeps a
 * multi-hour WebSocket alive without the browser holding any identity-server token. A
 * refresh failure is terminal: the row is revoked so the caller tears the connection
 * down rather than continuing on a token the identity server has disowned.
 */
export async function resolveIxAuthSessionToken(params: {
  sessionToken: string;
  settings: IxAuthRuntimeSettings;
  meta: IxAuthRequestMeta;
  nowMs: number;
  /** Skip the idle-window write for read-only probes such as a WebSocket handshake. */
  touch?: boolean;
}): Promise<IxAuthSessionResolution> {
  const row = readIxAuthLoginSessionByDigest(digestSecretToken(params.sessionToken));
  if (!row) {
    return { ok: false, rejection: "unknown-session" };
  }
  if (row.revoked_at !== null) {
    return { ok: false, rejection: "revoked" };
  }
  if (row.absolute_expires_at <= params.nowMs) {
    revokeIxAuthLoginSession({
      sessionId: row.id,
      revokedAt: params.nowMs,
      reason: "absolute-expired",
    });
    return { ok: false, rejection: "absolute-expired" };
  }
  if (row.idle_expires_at <= params.nowMs) {
    revokeIxAuthLoginSession({
      sessionId: row.id,
      revokedAt: params.nowMs,
      reason: "idle-expired",
    });
    return { ok: false, rejection: "idle-expired" };
  }

  let accessToken = row.access_token;
  let refreshToken = row.refresh_token;
  let rotated = false;
  if (row.access_expires_at - IX_AUTH_REFRESH_LEAD_MS <= params.nowMs) {
    const refreshed = await relayIxAuthRefresh({
      settings: params.settings,
      refreshToken: row.refresh_token,
      meta: params.meta,
    });
    if (!refreshed.ok) {
      // Reuse detection, revocation, and account suspension all land here. The identity
      // server has ended this session, so the Gateway must not keep serving it.
      revokeIxAuthLoginSession({
        sessionId: row.id,
        revokedAt: params.nowMs,
        reason: `identity-refresh-failed:${refreshed.code}`,
      });
      return { ok: false, rejection: "identity-expired" };
    }
    accessToken = refreshed.tokens.accessToken;
    // The identity server rotates the refresh token on every call and treats a replay of
    // the previous one as theft, revoking every session for the user. Persisting the new
    // token below is therefore mandatory, not an optimization.
    refreshToken = refreshed.tokens.refreshToken;
    rotated = true;
  }

  const verified = await verifyIxAuthAccessToken({
    token: accessToken,
    jwksUrl: params.settings.jwksUrl,
    nowMs: params.nowMs,
  });
  if (!verified.ok) {
    revokeIxAuthLoginSession({
      sessionId: row.id,
      revokedAt: params.nowMs,
      reason: `identity-token-invalid:${verified.reason}`,
    });
    return { ok: false, rejection: "identity-expired" };
  }
  const parsed = parseIxAuthTokenClaims({
    payload: verified.payload,
    settings: params.settings,
    nowMs: params.nowMs,
  });
  if (!parsed.ok) {
    revokeIxAuthLoginSession({
      sessionId: row.id,
      revokedAt: params.nowMs,
      reason: `identity-claims-invalid:${parsed.reason}`,
    });
    return { ok: false, rejection: "identity-expired" };
  }

  if (rotated) {
    updateIxAuthSessionTokens({
      sessionId: row.id,
      accessToken,
      accessExpiresAt: parsed.claims.expiresAtMs,
      refreshToken,
    });
  }
  if (params.touch !== false) {
    touchIxAuthLoginSession({
      sessionId: row.id,
      lastSeenAt: params.nowMs,
      idleExpiresAt: params.nowMs + params.settings.idleTimeoutMs,
    });
  }

  const currentRow: IxAuthLoginSessionRow = {
    ...row,
    access_token: accessToken,
    access_expires_at: parsed.claims.expiresAtMs,
    refresh_token: refreshToken,
  };
  return {
    ok: true,
    principal: buildPrincipalFromClaims({
      row: currentRow,
      claims: parsed.claims,
      settings: params.settings,
    }),
    row: currentRow,
  };
}
