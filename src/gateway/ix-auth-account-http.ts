// Account-lifecycle routes: signup, email verification, invitation acceptance, and
// password recovery.
//
// Every one of these is reached with no session at all, and every one of them carries a
// token that came out of a mail message. The Gateway relays the token and shows the
// answer; the identity server decides whether the token is real, unexpired, and unused
// (AUTH-IXAUTH.md 6.2, "token relay without logic").
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  relayIxAuthEmailVerify,
  relayIxAuthInviteAccept,
  relayIxAuthPasswordForgot,
  relayIxAuthPasswordReset,
  relayIxAuthSignup,
  type IxAuthAccountRelayResult,
} from "../auth/ix-auth/ix-auth-account-client.js";
import type { IxAuthRelayFailure } from "../auth/ix-auth/ix-auth-client.js";
import { AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET } from "./auth-rate-limit.js";
import { sendJson } from "./http-common.js";
import type { IxAuthHttpRoute } from "./ix-auth-http-paths.js";
import {
  IX_AUTH_REQUEST_ACCEPTED,
  mapTokenFailureToResponse,
  readFirstHeaderValue,
  readIxAuthJsonBody,
  readRequestMeta,
  type IxAuthHttpDependencies,
} from "./ix-auth-http-shared.js";
import { captureIxAuthInviteLink } from "./ix-auth-invite-links.js";

/** A password field longer than this is not a password, it is an attempt to fill memory. */
const IX_AUTH_MAX_PASSWORD_LENGTH = 512;

/** Mail links carry a base64url token; anything much longer is not one of ours. */
const IX_AUTH_MAX_TOKEN_LENGTH = 512;

function readPassword(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= IX_AUTH_MAX_PASSWORD_LENGTH
    ? value
    : undefined;
}

function readToken(value: unknown): string | undefined {
  const token = normalizeOptionalString(value);
  return token && token.length <= IX_AUTH_MAX_TOKEN_LENGTH ? token : undefined;
}

/**
 * Read the terms acceptance map.
 *
 * Only booleans survive. Versions are deliberately not accepted from the browser: the
 * identity server records whichever version is currently published, so a client cannot
 * claim agreement to a superseded one and skip re-consent.
 */
function readAgreements(value: unknown): Record<string, boolean> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const agreements: Record<string, boolean> = {};
  // SAFETY: the guard above proves this is a plain object.
  for (const [code, accepted] of Object.entries(value as Record<string, unknown>)) {
    if (typeof accepted === "boolean") {
      agreements[code] = accepted;
    }
  }
  return Object.keys(agreements).length > 0 ? agreements : undefined;
}

/**
 * Translate a signup failure.
 *
 * A duplicate address never reaches here: the identity server accepts it and mails the
 * existing owner instead, so this function only ever sees policy refusals.
 */
function mapSignupFailureToResponse(res: ServerResponse, failure: IxAuthRelayFailure): void {
  if (failure.code === "AUTHZ_FORBIDDEN") {
    sendJson(res, 403, {
      error: "signup_disabled",
      message: "Signing up is not open. Ask an administrator for an invitation.",
    });
    return;
  }
  if (failure.code === "VALIDATION_FAILED") {
    // Domain restrictions land here. The message names the rule, not an account.
    sendJson(res, 400, { error: "signup_rejected", message: failure.message });
    return;
  }
  mapTokenFailureToResponse(res, failure);
}

async function handleSignup(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const email = normalizeOptionalString(body.email);
  const password = readPassword(body.password);
  if (!email || !password) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  if (!params.deps.settings.selfSignupEnabled) {
    // Refused before the relay so a deployment that never opened signup does not even
    // create traffic toward the identity server from an unauthenticated caller.
    sendJson(params.res, 403, {
      error: "signup_disabled",
      message: "Signing up is not open. Ask an administrator for an invitation.",
    });
    return;
  }
  const relay = await relayIxAuthSignup({
    settings: params.deps.settings,
    email,
    password,
    name: normalizeOptionalString(body.name),
    agreements: readAgreements(body.agreements),
    meta: readRequestMeta(params.req, params.deps.clientIp),
  });
  params.deps.onSecurityEvent?.({
    action: "ix-auth.signup.requested",
    outcome: relay.ok ? "succeeded" : "failed",
    clientIp: params.deps.clientIp,
    reason: relay.ok ? undefined : relay.code,
  });
  if (!relay.ok) {
    mapSignupFailureToResponse(params.res, relay);
    return;
  }
  sendJson(params.res, 200, IX_AUTH_REQUEST_ACCEPTED);
}

/**
 * Answer a password-recovery request.
 *
 * The reply is the same for a registered address, an unregistered one, and one still on
 * the identity server's send cooldown. Only transport failures differ, and those say
 * nothing about the address.
 */
async function handlePasswordForgot(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const email = normalizeOptionalString(body.email);
  if (!email) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const relay = await relayIxAuthPasswordForgot({
    settings: params.deps.settings,
    email,
    meta: readRequestMeta(params.req, params.deps.clientIp),
  });
  if (!relay.ok) {
    mapTokenFailureToResponse(params.res, relay);
    return;
  }
  sendJson(params.res, 200, IX_AUTH_REQUEST_ACCEPTED);
}

/** Finish one token-bearing route with the shared answer or the shared refusal. */
function finishTokenRoute(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  relay: IxAuthAccountRelayResult;
}): void {
  if (!params.relay.ok) {
    params.deps.rateLimiter?.recordFailure(
      params.deps.clientIp,
      AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
    );
    mapTokenFailureToResponse(params.res, params.relay);
    return;
  }
  sendJson(params.res, 200, IX_AUTH_REQUEST_ACCEPTED);
}

async function handlePasswordReset(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const token = readToken(body.token);
  const newPassword = readPassword(body.newPassword);
  if (!token || !newPassword) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const relay = await relayIxAuthPasswordReset({
    settings: params.deps.settings,
    token,
    newPassword,
    meta: readRequestMeta(params.req, params.deps.clientIp),
  });
  finishTokenRoute({ res: params.res, deps: params.deps, relay });
}

async function handleEmailVerify(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const token = readToken(body.token);
  if (!token) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const relay = await relayIxAuthEmailVerify({
    settings: params.deps.settings,
    token,
    meta: readRequestMeta(params.req, params.deps.clientIp),
  });
  finishTokenRoute({ res: params.res, deps: params.deps, relay });
}

async function handleInviteAccept(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const token = readToken(body.token);
  const password = readPassword(body.password);
  if (!token || !password) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const relay = await relayIxAuthInviteAccept({
    settings: params.deps.settings,
    token,
    password,
    name: normalizeOptionalString(body.name),
    meta: readRequestMeta(params.req, params.deps.clientIp),
  });
  params.deps.onSecurityEvent?.({
    action: "ix-auth.invite.accepted",
    outcome: relay.ok ? "succeeded" : "failed",
    clientIp: params.deps.clientIp,
    reason: relay.ok ? undefined : relay.code,
  });
  finishTokenRoute({ res: params.res, deps: params.deps, relay });
}

/** Constant-time comparison of two secrets of unequal length. */
function matchesServiceKey(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(presented, "utf8").digest(),
    createHash("sha256").update(expected, "utf8").digest(),
  );
}

/**
 * Receive one mail message the identity server could not send itself.
 *
 * This is the identity server's `mail.transport: WEBHOOK`, pointed back at the Gateway so
 * a deployment without SMTP still produces a usable invitation link. It is a
 * server-to-server call authenticated by the service key, so it carries no browser origin
 * and no CSRF token, and it answers 204 whatever happens: a webhook that reported what it
 * did with a message would let anyone probe for one.
 */
export async function handleIxAuthMailHook(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const presented = readFirstHeaderValue(params.req.headers["x-ixauth-key"]);
  if (!presented || !matchesServiceKey(presented, params.deps.settings.serviceKey)) {
    sendJson(params.res, 401, { error: "unauthorized" });
    return;
  }
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const kind = normalizeOptionalString(body.kind);
  const to = normalizeOptionalString(body.to);
  const link = normalizeOptionalString(body.link);
  // Only invitations are retained. A password-reset or magic link is a credential in its
  // own right, and nothing in this product needs to read one off a screen.
  if (kind === "INVITE" && to && link) {
    captureIxAuthInviteLink({ email: to, link, nowMs: Date.now() });
  }
  params.res.statusCode = 204;
  params.res.end();
}

/** Dispatch one anonymous account-lifecycle route. */
export async function handleIxAuthAccountHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  route: IxAuthHttpRoute;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  switch (params.route) {
    case "signup":
      await handleSignup(params);
      return;
    case "password-forgot":
      await handlePasswordForgot(params);
      return;
    case "password-reset":
      await handlePasswordReset(params);
      return;
    case "email-verify":
      await handleEmailVerify(params);
      return;
    case "invite-accept":
      await handleInviteAccept(params);
      return;
    default:
      sendJson(params.res, 404, { error: "not_found" });
  }
}
