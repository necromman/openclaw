import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIxAuthJwksCache, verifyIxAuthAccessToken } from "./ix-auth-jwks.js";

const JWKS_URL = "https://identity.example/.well-known/jwks.json";
const NOW = 1_800_000_000_000;

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signCompactJws(params: {
  privateKey: KeyObject;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}): string {
  const signingInput = `${encodeSegment(params.header)}.${encodeSegment(params.payload)}`;
  const signer = createSign("sha256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(params.privateKey).toString("base64url")}`;
}

function buildJwksResponse(publicKey: KeyObject, keyId: string) {
  return {
    keys: [{ ...publicKey.export({ format: "jwk" }), kid: keyId, alg: "RS256", use: "sig" }],
  };
}

describe("verifyIxAuthAccessToken", () => {
  let keyPair: { publicKey: KeyObject; privateKey: KeyObject };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetIxAuthJwksCache();
    keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(buildJwksResponse(keyPair.publicKey, "key-a")), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    resetIxAuthJwksCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts a token signed by the published key", async () => {
    const token = signCompactJws({
      privateKey: keyPair.privateKey,
      header: { alg: "RS256", kid: "key-a", typ: "JWT" },
      payload: { sub: "1042" },
    });
    const result = await verifyIxAuthAccessToken({ token, jwksUrl: JWKS_URL, nowMs: NOW });
    expect(result).toEqual({ ok: true, payload: { sub: "1042" } });
  });

  it("rejects a token whose payload was altered after signing", async () => {
    const token = signCompactJws({
      privateKey: keyPair.privateKey,
      header: { alg: "RS256", kid: "key-a", typ: "JWT" },
      payload: { sub: "1042" },
    });
    const [header, , signature] = token.split(".") as [string, string, string];
    const tampered = `${header}.${encodeSegment({ sub: "9999" })}.${signature}`;
    const result = await verifyIxAuthAccessToken({
      token: tampered,
      jwksUrl: JWKS_URL,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a token signed by a key the identity server never published", async () => {
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = signCompactJws({
      privateKey: attacker.privateKey,
      header: { alg: "RS256", kid: "key-a", typ: "JWT" },
      payload: { sub: "1042" },
    });
    const result = await verifyIxAuthAccessToken({ token, jwksUrl: JWKS_URL, nowMs: NOW });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("refuses the alg=none downgrade", async () => {
    const signingInput = `${encodeSegment({ alg: "none", kid: "key-a" })}.${encodeSegment({ sub: "1042" })}`;
    const result = await verifyIxAuthAccessToken({
      token: `${signingInput}.`,
      jwksUrl: JWKS_URL,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "unsupported_algorithm" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a symmetric algorithm even when a key id is supplied", async () => {
    const signingInput = `${encodeSegment({ alg: "HS256", kid: "key-a" })}.${encodeSegment({ sub: "1042" })}`;
    const result = await verifyIxAuthAccessToken({
      token: `${signingInput}.abcd`,
      jwksUrl: JWKS_URL,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "unsupported_algorithm" });
  });

  it("rejects a token with no key id", async () => {
    const token = signCompactJws({
      privateKey: keyPair.privateKey,
      header: { alg: "RS256", typ: "JWT" },
      payload: { sub: "1042" },
    });
    const result = await verifyIxAuthAccessToken({ token, jwksUrl: JWKS_URL, nowMs: NOW });
    expect(result).toEqual({ ok: false, reason: "missing_kid" });
  });

  it("rejects a malformed compact serialization", async () => {
    const result = await verifyIxAuthAccessToken({
      token: "not-a-jwt",
      jwksUrl: JWKS_URL,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "malformed_token" });
  });

  it("caches the document so repeated verification makes one network call", async () => {
    const token = signCompactJws({
      privateKey: keyPair.privateKey,
      header: { alg: "RS256", kid: "key-a", typ: "JWT" },
      payload: { sub: "1042" },
    });
    await verifyIxAuthAccessToken({ token, jwksUrl: JWKS_URL, nowMs: NOW });
    await verifyIxAuthAccessToken({ token, jwksUrl: JWKS_URL, nowMs: NOW + 1_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rate limits refetching when an unknown key id keeps arriving", async () => {
    const token = signCompactJws({
      privateKey: keyPair.privateKey,
      header: { alg: "RS256", kid: "key-a", typ: "JWT" },
      payload: { sub: "1042" },
    });
    await verifyIxAuthAccessToken({ token, jwksUrl: JWKS_URL, nowMs: NOW });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const forged = signCompactJws({
      privateKey: keyPair.privateKey,
      header: { alg: "RS256", kid: "unknown-key", typ: "JWT" },
      payload: { sub: "1042" },
    });
    // The first unknown kid is allowed one refetch to cover key rotation.
    const first = await verifyIxAuthAccessToken({
      token: forged,
      jwksUrl: JWKS_URL,
      nowMs: NOW + 1_000,
    });
    expect(first).toEqual({ ok: false, reason: "unknown_kid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A flood of forged key ids inside the cooldown must not become outbound traffic.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await verifyIxAuthAccessToken({ token: forged, jwksUrl: JWKS_URL, nowMs: NOW + 2_000 });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the document as unavailable rather than accepting the token", async () => {
    fetchMock.mockImplementation(async () => new Response("nope", { status: 503 }));
    const token = signCompactJws({
      privateKey: keyPair.privateKey,
      header: { alg: "RS256", kid: "key-a", typ: "JWT" },
      payload: { sub: "1042" },
    });
    const result = await verifyIxAuthAccessToken({ token, jwksUrl: JWKS_URL, nowMs: NOW });
    expect(result).toEqual({ ok: false, reason: "jwks_unavailable" });
  });
});
