// Parses and narrows IX-Auth access-token claims into a closed contract.
// Canonical claim list: ix-auth/docs/contract/token.md section 3.
import {
  IX_AUTH_DEFAULT_DEPARTMENT_CLAIM,
  IX_AUTH_DEFAULT_DEPARTMENT_PREFIX,
  type IxAuthRuntimeSettings,
  type IxAuthVerifiedClaims,
} from "./ix-auth-types.js";

/** Allowed clock skew when checking `exp` and `iat`, per the SDK contract. */
const IX_AUTH_CLOCK_SKEW_MS = 60_000;

function readStringClaim(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArrayClaim(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      seen.add(trimmed);
    }
  }
  return [...seen];
}

function readEpochSecondsClaim(
  payload: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value * 1000 : undefined;
}

/**
 * Extract department codes from the configured group claim.
 *
 * IX-Auth deliberately does not model org trees (permission-model.md section 4), so a
 * group only carries a department code by convention: the configured prefix marks it.
 * An empty prefix accepts every group as a department code.
 */
export function readIxAuthDepartmentCodes(params: {
  groups: string[];
  prefix: string;
}): string[] {
  if (params.prefix.length === 0) {
    return [...params.groups];
  }
  const codes: string[] = [];
  for (const group of params.groups) {
    if (group.startsWith(params.prefix)) {
      const code = group.slice(params.prefix.length);
      if (code.length > 0) {
        codes.push(code);
      }
    }
  }
  return codes;
}

/**
 * Narrow a verified JWT payload into the closed claim contract.
 *
 * The signature is checked before this runs; this function only rejects payloads whose
 * required claims are missing, whose issuer/audience disagree with configuration, or
 * whose lifetime has passed.
 */
export function parseIxAuthTokenClaims(params: {
  payload: Record<string, unknown>;
  settings: Pick<IxAuthRuntimeSettings, "issuer" | "audience" | "departmentClaim">;
  nowMs: number;
}): { ok: true; claims: IxAuthVerifiedClaims } | { ok: false; reason: string } {
  const { payload, settings } = params;

  const expiresAtMs = readEpochSecondsClaim(payload, "exp");
  if (expiresAtMs === undefined) {
    return { ok: false, reason: "missing_exp" };
  }
  if (expiresAtMs + IX_AUTH_CLOCK_SKEW_MS < params.nowMs) {
    return { ok: false, reason: "token_expired" };
  }
  const issuedAtMs = readEpochSecondsClaim(payload, "iat");
  if (issuedAtMs !== undefined && issuedAtMs - IX_AUTH_CLOCK_SKEW_MS > params.nowMs) {
    return { ok: false, reason: "token_not_yet_valid" };
  }

  if (settings.issuer !== undefined && readStringClaim(payload, "iss") !== settings.issuer) {
    return { ok: false, reason: "issuer_mismatch" };
  }
  if (settings.audience !== undefined) {
    const audience = payload.aud;
    const matches =
      audience === settings.audience ||
      (Array.isArray(audience) && audience.includes(settings.audience));
    if (!matches) {
      return { ok: false, reason: "audience_mismatch" };
    }
  }

  const subject = readStringClaim(payload, "sub");
  if (subject === undefined) {
    return { ok: false, reason: "missing_sub" };
  }
  const email = readStringClaim(payload, "email");
  if (email === undefined) {
    return { ok: false, reason: "missing_email" };
  }
  const identitySessionId = readStringClaim(payload, "ixauth_sid");
  if (identitySessionId === undefined) {
    return { ok: false, reason: "missing_ixauth_sid" };
  }

  const groupClaim = settings.departmentClaim || IX_AUTH_DEFAULT_DEPARTMENT_CLAIM;
  const actor = payload.act;
  const actorRecord =
    // SAFETY: the typeof guard on this line proves act is a non-null object.
    actor !== null && typeof actor === "object" ? (actor as Record<string, unknown>) : undefined;

  return {
    ok: true,
    claims: {
      subject,
      email,
      displayName: readStringClaim(payload, "name") ?? email,
      roles: readStringArrayClaim(payload, "ixauth_roles"),
      groups: readStringArrayClaim(payload, groupClaim),
      identitySessionId,
      expiresAtMs,
      permissionsVersion: (() => {
        const value = payload.ixauth_pv;
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
      })(),
      impersonatorSubject: actorRecord ? readStringClaim(actorRecord, "sub") : undefined,
      impersonatorEmail: actorRecord ? readStringClaim(actorRecord, "email") : undefined,
      federatedIdp: readStringClaim(payload, "ixauth_idp"),
    },
  };
}

/** Default department prefix used when configuration leaves it unset. */
export function resolveIxAuthDepartmentPrefix(configured: string | undefined): string {
  return configured ?? IX_AUTH_DEFAULT_DEPARTMENT_PREFIX;
}
