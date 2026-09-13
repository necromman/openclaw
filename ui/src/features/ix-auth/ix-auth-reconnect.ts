// What an open tab does when its WebSocket is refused after a Gateway restart.
//
// A redeploy replaces the Gateway process under tabs that are already open. Those tabs
// reconnect, and until this file existed every refusal looked the same to them: the
// shared reconnect supervisor kept retrying a handshake the Gateway would never accept,
// so the window sat on "offline, reconnecting" until somebody reloaded it by hand.
//
// The rules here are deliberately small and pure so they can be tested without a socket:
// classify the refusal, ask the Gateway who we are, and return one of three moves.
import { ConnectErrorDetailCodes } from "@openclaw/gateway-protocol/connect-error-details";
import type { IxAuthSessionState } from "./ix-auth-session-api.ts";

/** Address to send a person back to once they sign in again. */
const IX_AUTH_RETURN_PATH_KEY = "openclaw.ixAuth.returnTo";

/** How a connect refusal reads to a tab that already held a session. */
export type IxAuthConnectFailureKind =
  /** The Gateway says this browser is not signed in. */
  | "unauthorized"
  /** The identity server could not answer. The session is untouched. */
  | "identity-unavailable"
  /** Anything else; the ordinary reconnect supervisor owns it. */
  | "other";

/**
 * Read a connect failure the way this mode has to read it.
 *
 * The reason carried beside the code is the authority when present: the Gateway names
 * `identity_unavailable` exactly where it declined to judge the session at all.
 */
export function classifyIxAuthConnectFailure(params: {
  code?: string | null;
  authReason?: string | null;
}): IxAuthConnectFailureKind {
  if (
    params.authReason === "identity_unavailable" ||
    params.code === ConnectErrorDetailCodes.AUTH_IDENTITY_UNAVAILABLE
  ) {
    return "identity-unavailable";
  }
  if (
    params.code === ConnectErrorDetailCodes.AUTH_REQUIRED ||
    params.code === ConnectErrorDetailCodes.AUTH_UNAUTHORIZED ||
    params.authReason === "gateway_auth_required"
  ) {
    return "unauthorized";
  }
  return "other";
}

/** The move a tab makes after one refused handshake. */
export type IxAuthRecoveryAction =
  /** Stop retrying and render the sign-in screen. */
  | "show-gate"
  /** The cookie still works; open a fresh socket rather than waiting out the backoff. */
  | "retry-connect"
  /** Nothing is decided yet; let the backoff keep trying. */
  | "keep-waiting";

/**
 * Decide what an unauthorized handshake means, given what `/auth/me` just said.
 *
 * The probe is the tie-breaker, not the close code. A Gateway mid-restart refuses the
 * handshake and then answers the probe with "still signed in", and that pair must end in
 * another connect attempt, not a sign-out. Only a Gateway that answers and says "not
 * signed in" sends anyone to the sign-in screen.
 */
export function decideIxAuthRecovery(params: {
  failure: IxAuthConnectFailureKind;
  probe: IxAuthSessionState | undefined;
}): IxAuthRecoveryAction {
  if (params.failure === "other") {
    return "keep-waiting";
  }
  // A deployment window: the maintenance page or a starting container answered. Nothing
  // was learned about the session, so keep the shell and let the backoff continue.
  if (params.failure === "identity-unavailable" || params.probe === undefined) {
    return "keep-waiting";
  }
  if (params.probe.unavailable === true) {
    return "keep-waiting";
  }
  if (params.probe.authMode !== "ix-auth") {
    // The Gateway is no longer in this mode. The shared connection screen owns that case.
    return "show-gate";
  }
  return params.probe.authenticated ? "retry-connect" : "show-gate";
}

/**
 * Remember where a person was before the sign-in screen took over.
 *
 * Kept in session storage rather than the address bar: the gate replaces the address
 * with its own screen route, and a query parameter carried through a sign-in form is one
 * more thing an operator can paste somewhere it does not belong.
 */
export function rememberIxAuthReturnPath(path: string): void {
  try {
    globalThis.sessionStorage?.setItem(IX_AUTH_RETURN_PATH_KEY, path);
  } catch {
    // Blocked storage only costs the return trip; the sign-in itself still works.
  }
}

/**
 * Take back the remembered address, if it is one this application can navigate to.
 *
 * Only a same-document absolute path is accepted. A stored value starting with `//` or
 * carrying a scheme would be an open redirect the moment it reached `location`.
 */
export function takeIxAuthReturnPath(): string | undefined {
  let stored: string | null | undefined;
  try {
    stored = globalThis.sessionStorage?.getItem(IX_AUTH_RETURN_PATH_KEY);
    globalThis.sessionStorage?.removeItem(IX_AUTH_RETURN_PATH_KEY);
  } catch {
    return undefined;
  }
  if (!stored || !stored.startsWith("/") || stored.startsWith("//")) {
    return undefined;
  }
  return stored;
}
