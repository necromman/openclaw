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
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("ix-auth-session-race-"));
});
afterEach(() => {
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
