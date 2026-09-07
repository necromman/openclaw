// Gateway auth mode policy rejects ambiguous token+password config before
// credential resolution can choose the wrong side.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { hasConfiguredSecretInput } from "../config/types.secrets.js";

// Gateway auth mode validation keeps ambiguous token/password configs out of
// runtime credential resolution. The resolver can preserve precedence only
// after config names the intended mode.
const EXPLICIT_GATEWAY_AUTH_MODE_REQUIRED_ERROR =
  "Invalid config: gateway.auth.token and gateway.auth.password are both configured, but gateway.auth.mode is unset. Set gateway.auth.mode to token or password.";

/** Returns true when local gateway auth config needs an explicit token/password mode. */
export function hasAmbiguousGatewayAuthModeConfig(cfg: OpenClawConfig): boolean {
  const auth = cfg.gateway?.auth;
  if (!auth) {
    return false;
  }
  if (typeof auth.mode === "string" && auth.mode.trim().length > 0) {
    return false;
  }
  const defaults = cfg.secrets?.defaults;
  const tokenConfigured = hasConfiguredSecretInput(auth.token, defaults);
  const passwordConfigured = hasConfiguredSecretInput(auth.password, defaults);
  return tokenConfigured && passwordConfigured;
}

/** Throws the public config error used by setup, doctor, and gateway startup validation. */
export function assertExplicitGatewayAuthModeWhenBothConfigured(cfg: OpenClawConfig): void {
  if (!hasAmbiguousGatewayAuthModeConfig(cfg)) {
    return;
  }
  throw new Error(EXPLICIT_GATEWAY_AUTH_MODE_REQUIRED_ERROR);
}

/**
 * Auth modes that identify every connection without a shared secret.
 *
 * The startup guard refuses a non-loopback bind when nothing authenticates callers. A
 * shared token is the usual proof, but these two modes need none: `trusted-proxy` reads
 * identity from a proxy the operator vouched for, and `ix-auth` requires a per-person
 * sign-in before any request is admitted, which is stronger than a shared secret rather
 * than weaker. Treating them as authless kept the identity-server deployment from
 * starting at all inside a container, where the bind is never loopback.
 */
const GATEWAY_AUTH_MODES_WITHOUT_SHARED_SECRET: ReadonlySet<string> = new Set([
  "trusted-proxy",
  "ix-auth",
]);

/** True when this auth mode proves who the caller is without a configured shared secret. */
export function authenticatesGatewayWithoutSharedSecret(mode: string | undefined): boolean {
  return mode !== undefined && GATEWAY_AUTH_MODES_WITHOUT_SHARED_SECRET.has(mode);
}
