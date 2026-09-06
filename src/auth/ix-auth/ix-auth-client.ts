// HTTP relay from the Gateway to the IX-Auth identity server.
//
// This is the only module that talks to the identity server, and it is only reached
// from login, refresh, logout, and MFA verification. Every other code path verifies
// tokens locally (design invariant 2).
//
// The service key never leaves this process, and end-user IP and user agent are
// forwarded explicitly because the identity server sits behind the Gateway and cannot
// observe the real visitor (ix-auth/docs/guides/client-ip.md).
import type { IxAuthRuntimeSettings } from "./ix-auth-types.js";

/** Identity-server calls are user-blocking; fail fast rather than hang a login form. */
const IX_AUTH_REQUEST_TIMEOUT_MS = 15_000;

/** A response larger than this is treated as hostile and rejected. */
const IX_AUTH_RESPONSE_MAX_BYTES = 128 * 1024;

/** End-user attribution forwarded on every relayed call. */
export type IxAuthRequestMeta = {
  /** Real visitor IP resolved by the Gateway's ingress attribution, never `req.ip`. */
  clientIp?: string;
  userAgent?: string;
  /** Correlates the identity server's `traceId` with the Gateway's request id. */
  requestId?: string;
};

export type IxAuthTokenBundle = {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds as reported by the identity server. */
  expiresInSeconds: number;
};

export type IxAuthRelayFailure = {
  ok: false;
  /** HTTP status from the identity server, or 502 when it could not be reached. */
  status: number;
  /** Identity-server error code, or `IXAUTH_UNAVAILABLE`. */
  code: string;
  message: string;
  /** Present on `AUTH_ACCOUNT_LOCKED` when the lock expires on its own. */
  lockedUntilMs?: number;
  /** Present on `AUTH_MFA_REQUIRED`. */
  mfaChallenge?: string;
};

export type IxAuthRelayResult<T> = ({ ok: true } & T) | IxAuthRelayFailure;

function buildIxAuthHeaders(params: {
  settings: IxAuthRuntimeSettings;
  meta: IxAuthRequestMeta;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "x-ixauth-key": params.settings.serviceKey,
  };
  // Header injection guard: a control character here would split the request.
  const clientIp = params.meta.clientIp?.trim();
  if (clientIp && /^[\w.:%[\]-]+$/u.test(clientIp)) {
    headers["x-forwarded-for"] = clientIp;
  }
  const userAgent = params.meta.userAgent?.replaceAll(/[\r\n]/gu, " ").slice(0, 512).trim();
  if (userAgent) {
    headers["user-agent"] = userAgent;
  }
  const requestId = params.meta.requestId?.trim();
  if (requestId && /^[\w.-]{1,128}$/u.test(requestId)) {
    headers["x-request-id"] = requestId;
  }
  return headers;
}

function readRelayFailure(status: number, body: unknown): IxAuthRelayFailure {
  const envelope =
    // SAFETY: guarded by the typeof check on this line; JSON objects index by string.
    body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error =
    envelope.error !== null && typeof envelope.error === "object"
      // SAFETY: the preceding typeof guard proves error is a non-null object.
      ? (envelope.error as Record<string, unknown>)
      : {};
  const meta =
    error.meta !== null && typeof error.meta === "object"
      // SAFETY: the preceding typeof guard proves meta is a non-null object.
      ? (error.meta as Record<string, unknown>)
      : {};
  const lockedUntil = typeof meta.lockedUntil === "string" ? Date.parse(meta.lockedUntil) : NaN;
  return {
    ok: false,
    status,
    code: typeof error.code === "string" ? error.code : "IXAUTH_UNKNOWN_ERROR",
    message: typeof error.message === "string" ? error.message : "authentication failed",
    lockedUntilMs: Number.isFinite(lockedUntil) ? lockedUntil : undefined,
    mfaChallenge: typeof meta.challenge === "string" ? meta.challenge : undefined,
  };
}

async function callIxAuthEndpoint(params: {
  settings: IxAuthRuntimeSettings;
  path: string;
  body: Record<string, unknown>;
  meta: IxAuthRequestMeta;
}): Promise<{ ok: true; status: number; data: Record<string, unknown> } | IxAuthRelayFailure> {
  const url = new URL(params.path, `${params.settings.baseUrl.replace(/\/+$/u, "")}/`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildIxAuthHeaders({ settings: params.settings, meta: params.meta }),
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(IX_AUTH_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server could not be reached",
    };
  }
  if (response.status === 204) {
    return { ok: true, status: 204, data: {} };
  }
  const text = await response.text();
  if (text.length > IX_AUTH_RESPONSE_MAX_BYTES) {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned an oversized response",
    };
  }
  let parsed: unknown = {};
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned a malformed response",
    };
  }
  if (!response.ok) {
    return readRelayFailure(response.status, parsed);
  }
  // Every field below is read back through a typeof check, so a non-object body simply
  // yields undefined rather than a wrong value.
  // SAFETY: parsed came from JSON.parse of a response the server marked successful.
  const envelope = parsed as Record<string, unknown>;
  const data =
    envelope.data !== null && typeof envelope.data === "object"
      // SAFETY: the preceding typeof guard proves data is a non-null object.
      ? (envelope.data as Record<string, unknown>)
      : {};
  return { ok: true, status: response.status, data };
}

function readTokenBundle(data: Record<string, unknown>): IxAuthTokenBundle | undefined {
  const accessToken = typeof data.accessToken === "string" ? data.accessToken : undefined;
  const refreshToken = typeof data.refreshToken === "string" ? data.refreshToken : undefined;
  if (!accessToken || !refreshToken) {
    return undefined;
  }
  const expiresIn = typeof data.expiresIn === "number" ? data.expiresIn : 900;
  return { accessToken, refreshToken, expiresInSeconds: expiresIn };
}

/** Relay a password login. Returns tokens, or a failure that never distinguishes accounts. */
export async function relayIxAuthLogin(params: {
  settings: IxAuthRuntimeSettings;
  email: string;
  password: string;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthRelayResult<{ tokens: IxAuthTokenBundle }>> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/login",
    body: {
      email: params.email,
      password: params.password,
      ip: params.meta.clientIp,
      userAgent: params.meta.userAgent,
    },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const tokens = readTokenBundle(result.data);
  if (!tokens) {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned no tokens",
    };
  }
  return { ok: true, tokens };
}

/** Complete a two-step login by submitting the TOTP code against a challenge. */
export async function relayIxAuthMfaVerify(params: {
  settings: IxAuthRuntimeSettings;
  challenge: string;
  code: string;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthRelayResult<{ tokens: IxAuthTokenBundle }>> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/mfa/verify",
    body: {
      challenge: params.challenge,
      code: params.code,
      ip: params.meta.clientIp,
      userAgent: params.meta.userAgent,
    },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const tokens = readTokenBundle(result.data);
  if (!tokens) {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned no tokens",
    };
  }
  return { ok: true, tokens };
}

/**
 * Rotate a refresh token.
 *
 * The identity server also rotates the refresh token and detects reuse: replaying a
 * revoked token revokes every session for that user. Callers must persist the returned
 * refresh token before the next rotation.
 */
export async function relayIxAuthRefresh(params: {
  settings: IxAuthRuntimeSettings;
  refreshToken: string;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthRelayResult<{ tokens: IxAuthTokenBundle }>> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/refresh",
    body: { refreshToken: params.refreshToken },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const tokens = readTokenBundle(result.data);
  if (!tokens) {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned no tokens",
    };
  }
  return { ok: true, tokens };
}

/** Revoke a refresh token so the identity server ends the session on its side too. */
export async function relayIxAuthLogout(params: {
  settings: IxAuthRuntimeSettings;
  refreshToken: string;
  meta: IxAuthRequestMeta;
}): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/logout",
    body: { refreshToken: params.refreshToken },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}
