import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { createDeferredCore } from "../../shared/deferred.js";
import { revokeIxAuthLoginSession } from "../../state/ix-auth-sessions-store.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { ensureProfileForEmail } from "../../state/user-profiles.js";
import { resetIxAuthJwksCache } from "./ix-auth-jwks.js";
import {
  persistIxAuthLoginSession,
  readIxAuthSessionTokenRow,
  resolveIxAuthSessionToken,
} from "./ix-auth-sessions.js";
import type { IxAuthRuntimeSettings, IxAuthVerifiedClaims } from "./ix-auth-types.js";

const settings: IxAuthRuntimeSettings = {
  baseUrl: "http://identity.example.test",
  jwksUrl: "http://identity.example.test/.well-known/jwks.json",
  serviceKey: "session-concurrency-test-service-key",
  cookieName: "__Host-openclaw-session",
  roleMap: { MEMBER: "member" },
  superAdminRoles: ["superadmin"],
  departmentClaim: "ixauth_groups",
  departmentGroupPrefix: "dept-",
  titleGroupPrefix: "title-",
  selfSignupEnabled: false,
  idleTimeoutMs: 3_600_000,
  absoluteTimeoutMs: 43_200_000,
};
const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function tokenBundle(expiresAtMs: number, refreshToken: string) {
  const claims: IxAuthVerifiedClaims = {
    subject: "42",
    email: "target@example.test",
    displayName: "Target",
    roles: ["MEMBER"],
    groups: ["dept-rnd"],
    identitySessionId: "identity-target",
    expiresAtMs: Math.floor(expiresAtMs / 1000) * 1000,
    impersonatorSubject: "1",
    impersonatorEmail: "admin@example.test",
  };
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "session-test" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: claims.subject,
      email: claims.email,
      name: claims.displayName,
      ixauth_roles: claims.roles,
      ixauth_groups: claims.groups,
      ixauth_sid: claims.identitySessionId,
      exp: claims.expiresAtMs / 1000,
      act: { sub: claims.impersonatorSubject, email: claims.impersonatorEmail },
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const signer = createSign("sha256");
  signer.update(input);
  signer.end();
  const accessToken = `${input}.${signer.sign({ key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  return { claims, tokens: { accessToken, refreshToken, expiresInSeconds: 900 } };
}

function jwksResponse(): Response {
  return Response.json({
    keys: [
      {
        ...keys.publicKey.export({ format: "jwk" }),
        kid: "session-test",
        alg: "ES256",
        use: "sig",
      },
    ],
  });
}

beforeEach(() => {
  // The resolver carries its caller's clock forward by the real milliseconds each queued
  // turn waited, so a wall clock that ticks mid-test lands a revoke one millisecond past
  // the value the test computed. Freeze Date only: real timers still drive the fetch
  // stubs and the AbortSignal.timeout guards inside the client.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("ix-auth-session-race-"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

describe("IX-Auth session authority during asynchronous verification", () => {
  it("refuses a session revoked while its signing key is loading", async () => {
    const now = Date.now();
    const session = persistIxAuthLoginSession({
      ...tokenBundle(now + 900_000, "refresh-original"),
      settings,
      nowMs: now,
      profileId: ensureProfileForEmail("target@example.test").id,
    });
    const requested = createDeferredCore();
    const keyResponse = createDeferredCore<Response>();
    vi.stubGlobal("fetch", () => {
      requested.resolve();
      return keyResponse.promise;
    });
    const resolving = resolveIxAuthSessionToken({
      sessionToken: session.sessionToken,
      settings,
      meta: {},
      nowMs: now,
      touch: false,
    });
    await requested.promise;
    revokeIxAuthLoginSession({
      sessionId: session.sessionId,
      revokedAt: now,
      reason: "impersonation-stopped",
    });
    keyResponse.resolve(jwksResponse());
    await expect(resolving).resolves.toEqual({ ok: false, rejection: "revoked" });
    expect(readIxAuthSessionTokenRow(session.sessionToken)?.revoked_at).toBe(now);
  });

  it("rotates a refresh token once for concurrent requests and gives both the current identity", async () => {
    const now = Date.now();
    const session = persistIxAuthLoginSession({
      ...tokenBundle(now + 30_000, "refresh-original"),
      settings,
      nowMs: now,
      profileId: ensureProfileForEmail("target@example.test").id,
    });
    const renewed = tokenBundle(now + 900_000, "refresh-rotated");
    const refreshStarted = createDeferredCore();
    const refreshResponse = createDeferredCore<void>();
    const refreshTokens: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (new URL(String(url)).pathname === "/.well-known/jwks.json") {
        return jwksResponse();
      }
      refreshTokens.push(JSON.parse(String(init?.body)).refreshToken);
      refreshStarted.resolve();
      await refreshResponse.promise;
      return Response.json({ data: { ...renewed.tokens, expiresIn: 900 } });
    });
    const request = {
      sessionToken: session.sessionToken,
      settings,
      meta: {},
      nowMs: now,
      touch: false,
    };
    const first = resolveIxAuthSessionToken(request);
    await refreshStarted.promise;
    const second = resolveIxAuthSessionToken(request);
    refreshResponse.resolve();
    const results = await Promise.all([first, second]);
    expect(refreshTokens).toEqual(["refresh-original"]);
    for (const result of results) {
      expect(result).toMatchObject({
        ok: true,
        principal: {
          profileId: readIxAuthSessionTokenRow(session.sessionToken)?.profile_id,
          claims: { subject: "42", impersonatorSubject: "1" },
        },
        row: { refresh_token: "refresh-rotated", access_token: renewed.tokens.accessToken },
      });
    }
    expect(readIxAuthSessionTokenRow(session.sessionToken)?.refresh_token).toBe("refresh-rotated");
  });
});

// A redeploy restarts the Gateway and the identity server side by side. Every open tab
// reconnects at once, so the first resolutions a fresh process performs are the ones most
// likely to find the identity server still starting. Those must be answered with "ask
// again", because a revoke here is permanent and would sign out everyone who was working.
describe("IX-Auth sessions across an identity-server restart", () => {
  it("keeps the session when the key set cannot be fetched, and admits it once it can", async () => {
    const now = Date.now();
    const session = persistIxAuthLoginSession({
      ...tokenBundle(now + 900_000, "refresh-original"),
      settings,
      nowMs: now,
      profileId: ensureProfileForEmail("target@example.test").id,
    });
    let identityUp = false;
    vi.stubGlobal("fetch", async () => {
      if (!identityUp) {
        throw new Error("connect ECONNREFUSED");
      }
      return jwksResponse();
    });
    const request = {
      sessionToken: session.sessionToken,
      settings,
      meta: {},
      nowMs: now,
      touch: false,
    };
    await expect(resolveIxAuthSessionToken(request)).resolves.toEqual({
      ok: false,
      rejection: "identity-unavailable",
    });
    expect(readIxAuthSessionTokenRow(session.sessionToken)?.revoked_at).toBeNull();

    identityUp = true;
    await expect(resolveIxAuthSessionToken(request)).resolves.toMatchObject({ ok: true });
  });

  it("keeps the session when the refresh call cannot reach the identity server", async () => {
    const now = Date.now();
    const session = persistIxAuthLoginSession({
      ...tokenBundle(now + 30_000, "refresh-original"),
      settings,
      nowMs: now,
      profileId: ensureProfileForEmail("target@example.test").id,
    });
    vi.stubGlobal("fetch", async (url: string | URL) => {
      if (new URL(String(url)).pathname === "/.well-known/jwks.json") {
        return jwksResponse();
      }
      throw new Error("connect ECONNREFUSED");
    });
    await expect(
      resolveIxAuthSessionToken({
        sessionToken: session.sessionToken,
        settings,
        meta: {},
        nowMs: now,
        touch: false,
      }),
    ).resolves.toEqual({ ok: false, rejection: "identity-unavailable" });
    const row = readIxAuthSessionTokenRow(session.sessionToken);
    expect(row?.revoked_at).toBeNull();
    // The stored token is still the one the identity server knows about, so the next
    // attempt is an ordinary rotation rather than a replay it would read as theft.
    expect(row?.refresh_token).toBe("refresh-original");
  });

  it("still ends the session when the identity server refuses the refresh token", async () => {
    const now = Date.now();
    const session = persistIxAuthLoginSession({
      ...tokenBundle(now + 30_000, "refresh-original"),
      settings,
      nowMs: now,
      profileId: ensureProfileForEmail("target@example.test").id,
    });
    vi.stubGlobal("fetch", async (url: string | URL) => {
      if (new URL(String(url)).pathname === "/.well-known/jwks.json") {
        return jwksResponse();
      }
      return Response.json({ error: { code: "AUTH_REFRESH_INVALID" } }, { status: 401 });
    });
    await expect(
      resolveIxAuthSessionToken({
        sessionToken: session.sessionToken,
        settings,
        meta: {},
        nowMs: now,
        touch: false,
      }),
    ).resolves.toEqual({ ok: false, rejection: "identity-expired" });
    expect(readIxAuthSessionTokenRow(session.sessionToken)?.revoked_at).toBe(now);
  });
});
