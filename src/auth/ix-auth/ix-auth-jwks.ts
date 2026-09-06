// Local JWT signature verification against the IX-Auth JWKS document.
//
// Design invariant 2 (ix-auth/MODULE.md section 7): the app verifies every token
// locally with the published public key and never calls the identity server on the
// request path. Only the JWKS document itself is fetched, and it is cached.
//
// Implemented on node:crypto rather than a JWT library so the fork adds no npm
// dependency: createPublicKey accepts a JWK directly and verify() covers RS256/ES256.
import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

/** Algorithms IX-Auth may sign with (token.md section 2). Nothing else is accepted. */
const IX_AUTH_SUPPORTED_ALGORITHMS = new Set(["RS256", "ES256"]);

/** JWKS responses carry `Cache-Control: public, max-age=3600`; mirror that. */
const IX_AUTH_JWKS_CACHE_TTL_MS = 3_600_000;

/** An unknown `kid` triggers at most one refetch per this window (token.md section 4). */
const IX_AUTH_JWKS_REFETCH_COOLDOWN_MS = 60_000;

/** A JWKS document larger than this is treated as hostile and rejected. */
const IX_AUTH_JWKS_MAX_BYTES = 256 * 1024;

type JwksCacheEntry = {
  keys: Map<string, KeyObject>;
  fetchedAtMs: number;
  lastRefetchAtMs: number;
};

const jwksCacheByUrl = new Map<string, JwksCacheEntry>();

/** Drop every cached JWKS document. Used by tests and by config reloads. */
export function resetIxAuthJwksCache(): void {
  jwksCacheByUrl.clear();
}

function decodeBase64UrlSegment(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function importJwksKeys(document: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  const list =
    document !== null && typeof document === "object"
      ? (document as { keys?: unknown }).keys
      : undefined;
  if (!Array.isArray(list)) {
    return keys;
  }
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const jwk = entry as Record<string, unknown>;
    const keyId = typeof jwk.kid === "string" ? jwk.kid : undefined;
    const algorithm = typeof jwk.alg === "string" ? jwk.alg : undefined;
    if (!keyId || (algorithm !== undefined && !IX_AUTH_SUPPORTED_ALGORITHMS.has(algorithm))) {
      continue;
    }
    if (jwk.use !== undefined && jwk.use !== "sig") {
      continue;
    }
    try {
      keys.set(keyId, createPublicKey({ key: jwk as never, format: "jwk" }));
    } catch {
      // A malformed key must not discard the sound keys beside it.
    }
  }
  return keys;
}

async function fetchIxAuthJwksDocument(jwksUrl: string): Promise<Map<string, KeyObject>> {
  const response = await fetch(jwksUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`ix-auth jwks fetch failed with status ${response.status}`);
  }
  const body = await response.text();
  if (body.length > IX_AUTH_JWKS_MAX_BYTES) {
    throw new Error("ix-auth jwks document exceeds the accepted size");
  }
  return importJwksKeys(JSON.parse(body));
}

async function resolveIxAuthSigningKey(params: {
  jwksUrl: string;
  keyId: string;
  nowMs: number;
}): Promise<KeyObject | undefined> {
  const cached = jwksCacheByUrl.get(params.jwksUrl);
  const isFresh = cached && params.nowMs - cached.fetchedAtMs < IX_AUTH_JWKS_CACHE_TTL_MS;
  if (isFresh) {
    const hit = cached.keys.get(params.keyId);
    if (hit) {
      return hit;
    }
    // Key rotation publishes a new kid before the old one retires. Refetch once,
    // rate-limited, so a forged kid cannot turn every request into an outbound call.
    if (params.nowMs - cached.lastRefetchAtMs < IX_AUTH_JWKS_REFETCH_COOLDOWN_MS) {
      return undefined;
    }
  }
  const keys = await fetchIxAuthJwksDocument(params.jwksUrl);
  jwksCacheByUrl.set(params.jwksUrl, {
    keys,
    fetchedAtMs: isFresh && cached ? cached.fetchedAtMs : params.nowMs,
    lastRefetchAtMs: params.nowMs,
  });
  return keys.get(params.keyId);
}

function verifySignedSegments(params: {
  algorithm: string;
  key: KeyObject;
  signingInput: string;
  signature: Buffer;
}): boolean {
  const digest = params.algorithm === "ES256" ? "sha256" : "sha256";
  const verifier = createVerify(digest);
  verifier.update(params.signingInput);
  verifier.end();
  if (params.algorithm === "ES256") {
    return verifier.verify(
      { key: params.key, dsaEncoding: "ieee-p1363" },
      params.signature,
    );
  }
  return verifier.verify(params.key, params.signature);
}

/**
 * Verify one compact JWS and return its payload.
 *
 * Rejects unsigned tokens, algorithms outside the contract, unknown key ids, and any
 * signature mismatch. Claim-level checks (iss/aud/exp) live in ix-auth-claims.ts.
 */
export async function verifyIxAuthAccessToken(params: {
  token: string;
  jwksUrl: string;
  nowMs: number;
}): Promise<
  { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string }
> {
  const segments = params.token.split(".");
  if (segments.length !== 3) {
    return { ok: false, reason: "malformed_token" };
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments as [string, string, string];

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(decodeBase64UrlSegment(encodedHeader).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed_header" };
  }

  const algorithm = typeof header.alg === "string" ? header.alg : undefined;
  if (!algorithm || !IX_AUTH_SUPPORTED_ALGORITHMS.has(algorithm)) {
    // "none" and every symmetric algorithm land here.
    return { ok: false, reason: "unsupported_algorithm" };
  }
  const keyId = typeof header.kid === "string" ? header.kid : undefined;
  if (!keyId) {
    return { ok: false, reason: "missing_kid" };
  }

  let key: KeyObject | undefined;
  try {
    key = await resolveIxAuthSigningKey({ jwksUrl: params.jwksUrl, keyId, nowMs: params.nowMs });
  } catch {
    return { ok: false, reason: "jwks_unavailable" };
  }
  if (!key) {
    return { ok: false, reason: "unknown_kid" };
  }

  const signatureValid = verifySignedSegments({
    algorithm,
    key,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: decodeBase64UrlSegment(encodedSignature),
  });
  if (!signatureValid) {
    return { ok: false, reason: "signature_mismatch" };
  }

  try {
    const payload: unknown = JSON.parse(decodeBase64UrlSegment(encodedPayload).toString("utf8"));
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, reason: "malformed_payload" };
    }
    return { ok: true, payload: payload as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "malformed_payload" };
  }
}
