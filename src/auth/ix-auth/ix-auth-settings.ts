// Resolves gateway.auth.ixAuth into defaulted runtime settings.
//
// The service key is a SecretInput, so resolution is async and cached: every request
// path needs the key, and re-resolving a provider-backed ref per request would put the
// secrets provider on the login critical path.
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import type { GatewayIxAuthConfig } from "../../config/types.gateway.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveConfiguredSecretInputString } from "../../gateway/resolve-configured-secret-input-string.js";
import { resolveIxAuthDepartmentPrefix } from "./ix-auth-claims.js";
import {
  IX_AUTH_DEFAULT_ROLE_MAP,
  IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES,
} from "./ix-auth-role-map.js";
import {
  IX_AUTH_DEFAULT_ABSOLUTE_HOURS,
  IX_AUTH_DEFAULT_DEPARTMENT_CLAIM,
  IX_AUTH_DEFAULT_IDLE_MINUTES,
  IX_AUTH_SESSION_COOKIE_NAME,
  type IxAuthRuntimeSettings,
} from "./ix-auth-types.js";

const settingsCacheByServiceKeyPath = new Map<string, IxAuthRuntimeSettings>();

/** Drop cached settings so a config reload re-resolves the service key. */
export function resetIxAuthSettingsCache(): void {
  settingsCacheByServiceKeyPath.clear();
}

function buildDefaultJwksUrl(baseUrl: string): string {
  return new URL(".well-known/jwks.json", `${baseUrl.replace(/\/+$/u, "")}/`).toString();
}

function buildSettingsCacheKey(config: GatewayIxAuthConfig): string {
  // Cache identity is the connection target plus the secret's location, never its value.
  return JSON.stringify([
    config.baseUrl,
    config.jwksUrl ?? null,
    config.issuer ?? null,
    config.audience ?? null,
    typeof config.serviceKey === "string" ? "inline" : JSON.stringify(config.serviceKey ?? null),
  ]);
}

/**
 * Resolve and cache the runtime view of `gateway.auth.ixAuth`.
 *
 * Throws when the mode is configured but unusable, because a Gateway that cannot reach
 * its identity provider must fail to start rather than fall back to a weaker mode.
 */
export async function resolveIxAuthRuntimeSettings(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
}): Promise<IxAuthRuntimeSettings> {
  const ixAuth = params.config.gateway?.auth?.ixAuth;
  if (!ixAuth) {
    throw new Error(
      "gateway auth mode is ix-auth, but no ixAuth config was provided (set gateway.auth.ixAuth)",
    );
  }
  const cacheKey = buildSettingsCacheKey(ixAuth);
  const cached = settingsCacheByServiceKeyPath.get(cacheKey);
  if (cached) {
    return cached;
  }

  const baseUrl = normalizeOptionalString(ixAuth.baseUrl);
  if (!baseUrl) {
    throw new Error(
      "gateway auth mode is ix-auth, but gateway.auth.ixAuth.baseUrl is empty; set the internal IX-Auth address",
    );
  }
  const resolvedKey = await resolveConfiguredSecretInputString({
    config: params.config,
    env: params.env,
    value: ixAuth.serviceKey,
    path: "gateway.auth.ixAuth.serviceKey",
    unresolvedReasonStyle: "detailed",
  });
  if (!resolvedKey.value) {
    throw new Error(
      resolvedKey.unresolvedRefReason ??
        "gateway auth mode is ix-auth, but gateway.auth.ixAuth.serviceKey resolved to an empty value",
    );
  }

  const settings: IxAuthRuntimeSettings = {
    baseUrl,
    jwksUrl: normalizeOptionalString(ixAuth.jwksUrl) ?? buildDefaultJwksUrl(baseUrl),
    serviceKey: resolvedKey.value,
    issuer: normalizeOptionalString(ixAuth.issuer),
    audience: normalizeOptionalString(ixAuth.audience),
    cookieName: normalizeOptionalString(ixAuth.cookieName) ?? IX_AUTH_SESSION_COOKIE_NAME,
    roleMap: { ...IX_AUTH_DEFAULT_ROLE_MAP, ...(ixAuth.roleMap ?? {}) },
    superAdminRoles: ixAuth.superAdminRoles ?? [...IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES],
    departmentClaim:
      normalizeOptionalString(ixAuth.departmentClaim) ?? IX_AUTH_DEFAULT_DEPARTMENT_CLAIM,
    departmentGroupPrefix: resolveIxAuthDepartmentPrefix(ixAuth.departmentGroupPrefix),
    adminConsoleUrl: normalizeOptionalString(ixAuth.adminConsoleUrl),
    // Defaults closed: an installation that has not said its identity server accepts
    // signups must not advertise a form that would be refused.
    selfSignupEnabled: ixAuth.selfSignup === true,
    idleTimeoutMs:
      (ixAuth.session?.idleTimeoutMinutes ?? IX_AUTH_DEFAULT_IDLE_MINUTES) * 60_000,
    absoluteTimeoutMs:
      (ixAuth.session?.absoluteTimeoutHours ?? IX_AUTH_DEFAULT_ABSOLUTE_HOURS) * 3_600_000,
  };
  settingsCacheByServiceKeyPath.set(cacheKey, settings);
  return settings;
}

/** True when the effective Gateway auth mode delegates identity to IX-Auth. */
export function isIxAuthGatewayMode(mode: string | undefined): boolean {
  return mode === "ix-auth";
}
