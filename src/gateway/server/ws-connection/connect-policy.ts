// WebSocket connect policy resolves Control UI pairing bypasses and missing-device identity decisions.
import type { ConnectParams } from "../../../../packages/gateway-protocol/src/index.js";
import type { GatewayRole } from "../../role-policy.js";
import { roleCanSkipDeviceIdentity } from "../../role-policy.js";

export type ControlUiPairingKind = "tailscale-device" | "auth-none" | "identity-session" | null;

export function shouldSkipControlUiPairing(params: {
  isControlUi: boolean;
  device: ConnectParams["device"] | null | undefined;
  role: GatewayRole;
  authMode?: string;
  authMethod?: string;
}): ControlUiPairingKind {
  if (
    params.isControlUi &&
    params.role === "operator" &&
    params.authMethod === "tailscale" &&
    params.device
  ) {
    return "tailscale-device";
  }
  // When auth is completely disabled (mode=none), there is no shared secret
  // or token to gate pairing. Requiring pairing in this configuration adds
  // friction without security value since any client can already connect
  // without credentials. Guard with isControlUi because this function is
  // called for ALL clients (not just Control UI) at the call site.
  // Scope to operator role so node-role sessions still need device identity
  // (#43478 was reverted for skipping ALL clients).
  if (params.isControlUi && params.role === "operator" && params.authMode === "none") {
    return "auth-none";
  }
  // An identity-server session already names the person, on every request, from a cookie
  // the Gateway minted itself. Pairing would ask them to approve a device as well, which
  // is the friction this mode exists to remove: "signed in from any PC, no pairing".
  // Without this the exemption only held for loopback clients, where local self-pairing
  // covered it, so the very deployment this mode is for (a container behind a port) asked
  // every signed-in person to approve a device that nobody can approve yet.
  if (
    params.isControlUi &&
    params.role === "operator" &&
    params.authMode === "ix-auth" &&
    params.authMethod === "ix-auth"
  ) {
    return "identity-session";
  }
  return null;
}

/**
 * True when the session is authorized by something other than the pairing record.
 *
 * The pairing row still exists for diagnostics and durable grants; it just does not decide
 * whether this connection may proceed.
 */
export function controlUiPairingKindAuthorizesSession(kind: ControlUiPairingKind): boolean {
  return kind === "auth-none" || kind === "identity-session";
}

/**
 * True when this Control UI operator authenticated with an IX-Auth session cookie.
 *
 * Mirrors the trusted-proxy predicate: in both cases an external identity provider,
 * not a per-device credential, vouched for the person, so requiring a paired device
 * would add friction without adding assurance.
 */
export function isIxAuthControlUiOperatorAuth(params: {
  isControlUi: boolean;
  role: GatewayRole;
  authMode: string;
  authOk: boolean;
  authMethod: string | undefined;
}): boolean {
  return (
    params.isControlUi &&
    params.role === "operator" &&
    params.authMode === "ix-auth" &&
    params.authOk &&
    params.authMethod === "ix-auth"
  );
}

export function isTrustedProxyControlUiOperatorAuth(params: {
  isControlUi: boolean;
  role: GatewayRole;
  authMode: string;
  authOk: boolean;
  authMethod: string | undefined;
}): boolean {
  return (
    params.isControlUi &&
    params.role === "operator" &&
    params.authMode === "trusted-proxy" &&
    params.authOk &&
    params.authMethod === "trusted-proxy"
  );
}

type MissingDeviceIdentityDecision =
  | { kind: "allow" }
  | { kind: "reject-control-ui-insecure-auth" }
  | { kind: "reject-unauthorized" }
  | { kind: "reject-device-required" };

export function shouldClearUnboundScopesForMissingDeviceIdentity(params: {
  decision: MissingDeviceIdentityDecision;
  authMethod: string | undefined;
}): boolean {
  return (
    params.decision.kind !== "allow" ||
    params.authMethod === "token" ||
    params.authMethod === "password" ||
    params.authMethod === "trusted-proxy" ||
    // The browser declares operator.admin in its default scope list. A person's scopes
    // come from their mapped role, never from what the page asked for.
    params.authMethod === "ix-auth"
  );
}

export function evaluateMissingDeviceIdentity(params: {
  hasDeviceIdentity: boolean;
  role: GatewayRole;
  isControlUi: boolean;
  trustedProxyAuthOk?: boolean;
  ixAuthOk?: boolean;
  localBackendSelfPairingOk?: boolean;
  sharedAuthOk: boolean;
  authOk: boolean;
  hasSharedAuth: boolean;
  isLocalClient: boolean;
}): MissingDeviceIdentityDecision {
  if (params.hasDeviceIdentity) {
    return { kind: "allow" };
  }
  if (params.isControlUi && (params.trustedProxyAuthOk || params.ixAuthOk)) {
    return { kind: "allow" };
  }
  if (params.localBackendSelfPairingOk && params.role === "operator") {
    return { kind: "allow" };
  }
  if (params.isControlUi) {
    return { kind: "reject-control-ui-insecure-auth" };
  }
  if (roleCanSkipDeviceIdentity(params.role, params.sharedAuthOk)) {
    return { kind: "allow" };
  }
  if (!params.authOk && params.hasSharedAuth) {
    return { kind: "reject-unauthorized" };
  }
  return { kind: "reject-device-required" };
}
