// Pieces every `/auth/*` handler needs: the dependency shape, the browser-origin rule,
// body reading, and the single failure vocabulary.
//
// Extracted so the sign-in routes, the account-lifecycle routes, and the administration
// routes can live in separate files without importing one another, which would make the
// authentication namespace a dependency cycle.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IxAuthRelayFailure, IxAuthRequestMeta } from "../auth/ix-auth/ix-auth-client.js";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { readJsonBody } from "./hooks.js";
import { sendJson } from "./http-common.js";
import { checkBrowserOrigin } from "./origin-check.js";

/** Login bodies are tiny; anything larger is not a login form. */
export const IX_AUTH_BODY_MAX_BYTES = 4 * 1024;

/** Uniform failure body. Never distinguishes "no such account" from "wrong password". */
export const IX_AUTH_INVALID_CREDENTIALS = {
  error: "invalid_credentials",
  message: "The email or password is incorrect.",
} as const;

/**
 * The one answer every request-shaped account route gives.
 *
 * Signup and password recovery reply with this whether the address is registered, is
 * disabled, or has never been seen. A body that varied would turn either form into a
 * membership directory, so the uniformity is the feature and not a missing detail.
 */
export const IX_AUTH_REQUEST_ACCEPTED = { accepted: true } as const;

export type IxAuthHttpDependencies = {
  settings: IxAuthRuntimeSettings;
  /** Origins permitted to drive these routes, from gateway.controlUi.allowedOrigins. */
  allowedOrigins?: string[];
  allowHostHeaderOriginFallback?: boolean;
  /** Real visitor IP resolved by ingress attribution, not the socket address. */
  clientIp?: string;
  isLocalClient: boolean;
  /** True when the browser reached the Gateway over TLS or a loopback secure context. */
  isSecureContext: boolean;
  rateLimiter?: AuthRateLimiter;
  /**
   * Close the WebSocket connections that authenticated as this user profile.
   *
   * Signing out has to reach the sockets too: the cookie is gone, but an already
   * admitted connection keeps its scopes until something closes it, so without this a
   * signed-out browser tab would still be able to drive the Gateway.
   */
  disconnectClientsForUserProfile?: (profileId: string) => void;
  onSecurityEvent?: (event: IxAuthSecurityEvent) => void;
};

/** Audit-shaped record of one authentication decision on the HTTP line. */
export type IxAuthSecurityEvent = {
  action:
    | "ix-auth.login.succeeded"
    | "ix-auth.login.failed"
    | "ix-auth.login.mfa-required"
    | "ix-auth.logout"
    | "ix-auth.session.rejected"
    | "ix-auth.signup.requested"
    | "ix-auth.invite.issued"
    | "ix-auth.invite.accepted"
    | "ix-auth.signup.decided"
    | "ix-auth.admin.denied"
    // One administrator action against one account. `reason` names which action it was.
    | "ix-auth.admin.action";
  outcome: "succeeded" | "failed" | "denied";
  clientIp?: string;
  profileId?: string;
  identitySubject?: string;
  identitySessionId?: string;
  loginSessionId?: string;
  reason?: string;
};

export function readFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function readRequestMeta(
  req: IncomingMessage,
  clientIp: string | undefined,
): IxAuthRequestMeta {
  const userAgent = req.headers["user-agent"];
  const requestId = req.headers["x-request-id"];
  return {
    clientIp,
    userAgent: typeof userAgent === "string" ? userAgent : undefined,
    requestId: typeof requestId === "string" ? requestId : undefined,
  };
}

/**
 * Reject a request whose browser origin is not allowed.
 *
 * Chrome omits `Origin` on same-origin GET requests, so demanding the header outright
 * would reject the very session probe the Control UI makes on every load. The gateway's
 * established rule applies instead: no Origin is acceptable only when the browser
 * declares `Sec-Fetch-Site: same-origin`, which a cross-site caller cannot forge.
 */
export function isAllowedIxAuthBrowserOrigin(params: {
  origin?: string;
  fetchSite?: string;
  requestHost?: string;
  allowedOrigins?: string[];
  allowHostHeaderOriginFallback?: boolean;
  isLocalClient: boolean;
}): boolean {
  const origin = params.origin?.trim();
  if (!origin) {
    const fetchSite = params.fetchSite?.trim().toLowerCase();
    // "same-origin" is set by the browser and cannot be forged by a cross-site page.
    // "none" is a user-initiated navigation such as typing the address, which is not
    // an attacker-controlled context either.
    return fetchSite === "same-origin" || fetchSite === "none";
  }
  return checkBrowserOrigin({
    requestHost: params.requestHost,
    origin,
    allowedOrigins: params.allowedOrigins,
    allowHostHeaderOriginFallback: params.allowHostHeaderOriginFallback,
    isLocalClient: params.isLocalClient,
  }).ok;
}

/** Answer 403 and report true when the caller's origin is not permitted. */
export function rejectDisallowedOrigin(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): boolean {
  const allowed = isAllowedIxAuthBrowserOrigin({
    origin: readFirstHeaderValue(params.req.headers.origin),
    fetchSite: readFirstHeaderValue(params.req.headers["sec-fetch-site"]),
    requestHost: readFirstHeaderValue(params.req.headers.host),
    allowedOrigins: params.deps.allowedOrigins,
    allowHostHeaderOriginFallback: params.deps.allowHostHeaderOriginFallback,
    isLocalClient: params.deps.isLocalClient,
  });
  if (allowed) {
    return false;
  }
  sendJson(params.res, 403, { error: "origin_not_allowed" });
  return true;
}

/** Read a small JSON object body, answering 400 and returning undefined on anything else. */
export async function readIxAuthJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | undefined> {
  const body = await readJsonBody(req, IX_AUTH_BODY_MAX_BYTES);
  if (!body.ok) {
    sendJson(res, 400, { error: "invalid_body" });
    return undefined;
  }
  if (body.value === null || typeof body.value !== "object" || Array.isArray(body.value)) {
    sendJson(res, 400, { error: "invalid_body" });
    return undefined;
  }
  // SAFETY: the guard above rejected null, non-objects, and arrays.
  return body.value as Record<string, unknown>;
}

/** Translate one identity-server failure into the Gateway's own answer. */
export function mapRelayFailureToResponse(res: ServerResponse, failure: IxAuthRelayFailure): void {
  if (failure.code === "IXAUTH_UNAVAILABLE") {
    sendJson(res, 503, {
      error: "identity_unavailable",
      message: "The identity server is unavailable. Try again shortly.",
    });
    return;
  }
  if (failure.code === "AUTH_ACCOUNT_LOCKED") {
    sendJson(res, 423, {
      error: "account_locked",
      message: "This account is locked. Contact an administrator.",
      // Present only for automatic lockouts; an administrator lock has no expiry.
      lockedUntilMs: failure.lockedUntilMs,
    });
    return;
  }
  if (failure.code === "AUTH_ACCOUNT_DISABLED") {
    sendJson(res, 403, { error: "account_disabled", message: "This account is disabled." });
    return;
  }
  if (failure.code === "AUTH_ACCOUNT_PENDING_APPROVAL") {
    sendJson(res, 403, {
      error: "account_pending_approval",
      message: "This account is waiting for administrator approval.",
    });
    return;
  }
  if (failure.code === "AUTH_ACCOUNT_PENDING") {
    sendJson(res, 403, {
      error: "account_pending",
      message: "Accept the invitation email before signing in.",
    });
    return;
  }
  // The identity server runs its own per-IP limiter and answers 429 before its account
  // lockout can trigger. Flattening that into "invalid credentials" would tell a person
  // their password is wrong when it is not, and hide why retrying keeps failing.
  if (failure.status === 429 || failure.code === "RATE_LIMITED") {
    sendJson(res, 429, {
      error: "rate_limited",
      message: "Too many attempts. Wait a moment and try again.",
    });
    return;
  }
  // Everything else, including a wrong password and an unknown account, is uniform.
  sendJson(res, 401, IX_AUTH_INVALID_CREDENTIALS);
}

/**
 * Translate a failure on a token-bearing account route.
 *
 * A reset, verification, or invitation token that the identity server refused is one
 * answer regardless of why: expired, already used, or never real. The person's next step
 * is the same in all three cases, and separating them tells a link finder which of their
 * guesses was closest.
 */
export function mapTokenFailureToResponse(res: ServerResponse, failure: IxAuthRelayFailure): void {
  if (failure.code === "IXAUTH_UNAVAILABLE") {
    sendJson(res, 503, {
      error: "identity_unavailable",
      message: "The identity server is unavailable. Try again shortly.",
    });
    return;
  }
  if (failure.status === 429 || failure.code === "RATE_LIMITED") {
    sendJson(res, 429, {
      error: "rate_limited",
      message: "Too many attempts. Wait a moment and try again.",
    });
    return;
  }
  // The password rules are the one detail worth passing through: a person who typed a
  // weak password must be told so, and the identity server keeps the link alive for
  // exactly that reason.
  if (
    failure.code === "AUTH_PASSWORD_POLICY" ||
    failure.code === "AUTH_PASSWORD_REUSED" ||
    failure.code === "AUTH_PASSWORD_BREACHED"
  ) {
    sendJson(res, 400, { error: "password_rejected", message: failure.message });
    return;
  }
  if (failure.code === "AUTH_TERMS_REQUIRED") {
    sendJson(res, 400, { error: "terms_required", message: failure.message });
    return;
  }
  sendJson(res, 400, {
    error: "invalid_token",
    message: "This link is no longer valid. Ask for a new one.",
  });
}
