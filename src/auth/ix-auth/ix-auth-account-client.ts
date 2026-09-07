// Account lifecycle relays: signup, email verification, invitation acceptance, and
// password recovery.
//
// Every route below is a service-key route on the identity server, and every one of them
// is reached before any session exists. The Gateway carries the token from the URL to the
// identity server and carries the answer back; it never inspects, stores, or judges a
// token itself (ix-auth/docs/contract/http-api.md section 2-1).
import { callIxAuthEndpoint, type IxAuthRelayFailure, type IxAuthRequestMeta } from "./ix-auth-client.js";
import type { IxAuthRuntimeSettings } from "./ix-auth-types.js";

/** Outcome of one account-lifecycle relay. Carries no identity-revealing detail. */
export type IxAuthAccountRelayResult = { ok: true } | IxAuthRelayFailure;

/**
 * Request a signup.
 *
 * The identity server answers `{accepted:true}` whether or not the address is already
 * registered, so this relay cannot distinguish the two either. That uniformity is the
 * whole defense: a differing answer would turn the signup form into a membership oracle.
 */
export async function relayIxAuthSignup(params: {
  settings: IxAuthRuntimeSettings;
  email: string;
  password: string;
  name?: string;
  /** Terms code to acceptance. Versions are decided by the identity server, never here. */
  agreements?: Record<string, boolean>;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthAccountRelayResult> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/signup",
    body: {
      email: params.email,
      password: params.password,
      name: params.name,
      agreements: params.agreements,
    },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** Ask for a password-reset mail. Answers identically for known and unknown addresses. */
export async function relayIxAuthPasswordForgot(params: {
  settings: IxAuthRuntimeSettings;
  email: string;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthAccountRelayResult> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/password/forgot",
    body: { email: params.email },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** Set a new password from a reset token. The identity server judges the token. */
export async function relayIxAuthPasswordReset(params: {
  settings: IxAuthRuntimeSettings;
  token: string;
  newPassword: string;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthAccountRelayResult> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/password/reset",
    body: { token: params.token, newPassword: params.newPassword },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** Confirm an email address from a verification token. */
export async function relayIxAuthEmailVerify(params: {
  settings: IxAuthRuntimeSettings;
  token: string;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthAccountRelayResult> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/email/verify",
    body: { token: params.token },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/**
 * Accept an invitation by setting the first password.
 *
 * Acceptance moves the account from PENDING to ACTIVE and marks the address verified, so
 * an invitation is itself the approval: no second administrator step follows.
 */
export async function relayIxAuthInviteAccept(params: {
  settings: IxAuthRuntimeSettings;
  token: string;
  password: string;
  name?: string;
  meta: IxAuthRequestMeta;
}): Promise<IxAuthAccountRelayResult> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "auth/invite/accept",
    body: { token: params.token, password: params.password, name: params.name },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}
