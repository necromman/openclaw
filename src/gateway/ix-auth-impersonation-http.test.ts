import { createSign, generateKeyPairSync } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetIxAuthJwksCache } from "../auth/ix-auth/ix-auth-jwks.js";
import { IX_AUTH_DEFAULT_ROLE_MAP } from "../auth/ix-auth/ix-auth-role-map.js";
import {
  persistIxAuthLoginSession,
  readIxAuthSessionTokenRow,
} from "../auth/ix-auth/ix-auth-sessions.js";
import type { IxAuthVerifiedClaims } from "../auth/ix-auth/ix-auth-types.js";
import { revokeIxAuthLoginSession } from "../state/ix-auth-sessions-store.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { ensureProfileForEmail } from "../state/user-profiles.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { handleIxAuthHttpRequest } from "./ix-auth-http.js";

const settings = {
  baseUrl: "http://ix-auth:9100",
  jwksUrl: "http://ix-auth:9100/.well-known/jwks.json",
  serviceKey: "test-service-key-impersonation",
  cookieName: "__Host-openclaw-session",
  roleMap: { ...IX_AUTH_DEFAULT_ROLE_MAP },
  superAdminRoles: ["superadmin"],
  departmentClaim: "ixauth_groups",
  departmentGroupPrefix: "dept-",
  titleGroupPrefix: "title-",
  selfSignupEnabled: false,
  idleTimeoutMs: 3_600_000,
  absoluteTimeoutMs: 43_200_000,
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function identity(subject: string, roles: string[], actor?: string) {
  const claims: IxAuthVerifiedClaims = {
    subject,
    email: `${subject}@example.test`,
    displayName: subject,
    roles,
    groups: ["dept-rnd"],
    identitySessionId: `identity-${subject}-${actor ?? "self"}`,
    expiresAtMs: Math.floor(Date.now() / 1000) * 1000 + (actor ? 900_000 : 7_200_000),
    ...(actor ? { impersonatorSubject: actor, impersonatorEmail: `${actor}@example.test` } : {}),
  };
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "test-key" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      email: claims.email,
      name: subject,
      ixauth_roles: roles,
      ixauth_groups: claims.groups,
      ixauth_sid: claims.identitySessionId,
      iat: Math.floor(Date.now() / 1000),
      exp: claims.expiresAtMs / 1000,
      ...(actor ? { act: { sub: actor, email: `${actor}@example.test` } } : {}),
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const signer = createSign("sha256");
  signer.update(input);
  signer.end();
  const accessToken = `${input}.${signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  return {
    claims,
    tokens: {
      accessToken,
      refreshToken: `refresh-${subject}-${actor ?? "self"}`,
      expiresInSeconds: 900,
    },
  };
}

function setup(
  role = "ADMIN",
  options: { targetStatus?: string; actor?: string; beforeIssue?: () => void } = {},
) {
  const originalIdentity = identity("1", [role]);
  const original = persistIxAuthLoginSession({
    ...originalIdentity,
    settings,
    profileId: ensureProfileForEmail("1@example.test").id,
    nowMs: Date.now(),
  });
  const targetIdentity = identity("2", ["SUPERADMIN"], options.actor ?? "1");
  const logoutTokens: string[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/.well-known/jwks.json") {
      return Response.json({
        keys: [
          { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "ES256", use: "sig" },
        ],
      });
    }
    if (path === "/admin/users/2") {
      return Response.json({
        data: {
          id: "2",
          email: "2@example.test",
          name: "Target",
          status: options.targetStatus ?? "ACTIVE",
          roles: ["SUPERADMIN"],
          groups: [],
        },
      });
    }
    if (path === "/admin/users/2/impersonate") {
      options.beforeIssue?.();
      return Response.json({ data: { ...targetIdentity.tokens, expiresIn: 900 } });
    }
    if (path === "/auth/logout") {
      const body = JSON.parse(String(init?.body)) as { refreshToken: string };
      logoutTokens.push(body.refreshToken);
      return new Response(null, { status: 204 });
    }
    return Response.json(
      { error: { code: "AUTH_TOKEN_INVALID", message: "expired" } },
      { status: 401 },
    );
  });
  const cookies = new Map([
    [settings.cookieName, original.sessionToken],
    [`${settings.cookieName}-csrf`, original.csrfToken],
  ]);
  const disconnect = vi.fn();
  const profileDisconnect = vi.fn();
  const deps: IxAuthHttpDependencies = {
    settings,
    isLocalClient: true,
    isSecureContext: true,
    disconnectClientsForUserProfile: profileDisconnect,
    disconnectClientsForIxAuthLoginSession: disconnect,
  };
  const request = async (pathname: string, options: { csrf?: string; method?: string } = {}) => {
    const headers = new Map<string, string | string[]>();
    let responseBody = "";
    const res = {
      statusCode: 0,
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      setHeader: (name: string, value: string | string[]) => headers.set(name.toLowerCase(), value),
      end: (value?: string) => {
        responseBody = value ?? "";
      },
    } as unknown as ServerResponse;
    const req = Object.assign(Readable.from([]), {
      method: options.method ?? (pathname === "/auth/me" ? "GET" : "POST"),
      url: pathname,
      headers: {
        host: "localhost",
        "sec-fetch-site": "same-origin",
        cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        "x-openclaw-csrf": options.csrf ?? cookies.get(`${settings.cookieName}-csrf`),
      },
      socket: { remoteAddress: "127.0.0.1" },
    }) as unknown as IncomingMessage;
    await handleIxAuthHttpRequest({ req, res, deps, pathname });
    const setCookies = headers.get("set-cookie");
    const lines = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    for (const line of lines) {
      const pair = line.split(";")[0] ?? "";
      const split = pair.indexOf("=");
      const key = pair.slice(0, split);
      if (line.includes("Max-Age=0")) cookies.delete(key);
      else cookies.set(key, pair.slice(split + 1));
    }
    return {
      status: res.statusCode,
      body: JSON.parse(responseBody) as Record<string, unknown>,
      lines,
    };
  };
  return { original, cookies, request, disconnect, profileDisconnect, logoutTokens };
}

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("ix-auth-impersonation-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

describe("browser impersonation lifecycle", () => {
  it.each(["ADMIN", "SUPERADMIN"])(
    "lets %s reproduce a superadmin view and return without ending their own session",
    async (role) => {
      const app = setup(role);
      const started = await app.request("/auth/admin/users/2/impersonate");
      expect(started.status).toBe(200);
      expect(started.body.user).toEqual(
        expect.objectContaining({ email: "2@example.test", impersonatedBy: "1@example.test" }),
      );
      expect(
        started.lines.find((line) => line.startsWith(`${settings.cookieName}-return=`)),
      ).toMatch(/HttpOnly.*SameSite=Strict/);
      const targetToken = app.cookies.get(settings.cookieName)!;
      expect(targetToken).not.toBe(app.original.sessionToken);
      const me = await app.request("/auth/me");
      expect(me.body).not.toHaveProperty("adminConsoleUrl");
      expect((await app.request("/auth/admin/users", { method: "GET" })).status).toBe(403);
      expect((await app.request("/auth/admin/users/1/impersonate")).body).toEqual({
        error: "impersonation_forbidden",
      });
      const stopped = await app.request("/auth/impersonation/stop");
      expect(stopped.status).toBe(200);
      expect(app.cookies.get(settings.cookieName)).toBe(app.original.sessionToken);
      expect(readIxAuthSessionTokenRow(app.original.sessionToken)?.revoked_at).toBeNull();
      expect(readIxAuthSessionTokenRow(targetToken)?.revoked_at).not.toBeNull();
      expect(app.logoutTokens).toEqual(["refresh-2-1"]);
      expect(app.cookies.has(`${settings.cookieName}-return`)).toBe(false);
      expect(app.disconnect).toHaveBeenCalledTimes(2);
      expect(app.disconnect).toHaveBeenNthCalledWith(1, app.original.sessionId);
      expect(app.disconnect).toHaveBeenNthCalledWith(2, readIxAuthSessionTokenRow(targetToken)?.id);
      expect(app.profileDisconnect).not.toHaveBeenCalled();
    },
  );

  it("restores a valid administrator after the target token expires", async () => {
    const app = setup();
    await app.request("/auth/admin/users/2/impersonate");
    const later = Date.now() + 960_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const expired = await app.request("/auth/me");
    expect(expired.body).toEqual(
      expect.objectContaining({ authenticated: false, impersonationRestoreAvailable: true }),
    );
    expect((await app.request("/auth/impersonation/stop")).status).toBe(200);
    expect(app.cookies.get(settings.cookieName)).toBe(app.original.sessionToken);
  });

  it("logs out both browser sessions while leaving other devices alone", async () => {
    const app = setup();
    await app.request("/auth/admin/users/2/impersonate");
    const targetToken = app.cookies.get(settings.cookieName)!;
    const loggedOut = await app.request("/auth/logout");
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.body).toEqual({ authenticated: false });
    expect(readIxAuthSessionTokenRow(app.original.sessionToken)?.revoked_at).not.toBeNull();
    expect(readIxAuthSessionTokenRow(targetToken)?.revoked_at).not.toBeNull();
    expect(app.logoutTokens).toEqual(["refresh-2-1", "refresh-1-self"]);
    expect(app.cookies.size).toBe(0);
    expect(app.profileDisconnect).not.toHaveBeenCalled();
  });

  it("rejects a return cookie substituted with another valid administrator", async () => {
    const app = setup();
    await app.request("/auth/admin/users/2/impersonate");
    const other = persistIxAuthLoginSession({
      ...identity("3", ["ADMIN"]),
      settings,
      profileId: ensureProfileForEmail("3@example.test").id,
      nowMs: Date.now(),
    });
    const key = `${settings.cookieName}-return`;
    const saved = JSON.parse(
      Buffer.from(app.cookies.get(key)!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    app.cookies.set(
      key,
      Buffer.from(
        JSON.stringify({ ...saved, sessionToken: other.sessionToken, csrfToken: other.csrfToken }),
      ).toString("base64url"),
    );
    expect((await app.request("/auth/impersonation/stop")).body).toEqual({
      error: "impersonation_binding_mismatch",
    });
    expect(app.logoutTokens).toEqual([]);
  });

  it("drops a stale return cookie instead of trapping the login screen in recovery", async () => {
    const app = setup();
    app.cookies.set(settings.cookieName, "missing-target");
    app.cookies.set(
      `${settings.cookieName}-return`,
      Buffer.from(
        JSON.stringify({
          sessionToken: app.original.sessionToken,
          csrfToken: app.original.csrfToken,
          impersonationToken: "missing-target",
        }),
      ).toString("base64url"),
    );
    const me = await app.request("/auth/me");
    expect(me.body.authenticated).toBe(false);
    expect(me.body).not.toHaveProperty("impersonationRestoreAvailable");
    expect(app.cookies.size).toBe(0);
  });

  it("rejects forged CSRF without ending the target and rejects a revoked return session", async () => {
    const app = setup();
    await app.request("/auth/admin/users/2/impersonate");
    const targetToken = app.cookies.get(settings.cookieName)!;
    expect((await app.request("/auth/impersonation/stop", { csrf: "forged" })).status).toBe(403);
    expect(readIxAuthSessionTokenRow(targetToken)?.revoked_at).toBeNull();
    revokeIxAuthLoginSession({
      sessionId: app.original.sessionId,
      revokedAt: Date.now(),
      reason: "administrator-disabled",
    });
    const stopped = await app.request("/auth/impersonation/stop");
    expect(stopped.status).toBe(401);
    expect(stopped.body).toEqual({ error: "impersonation_restore_expired" });
    expect(app.cookies.size).toBe(0);
  });

  it("rejects actor mismatch and a caller revoked while the identity server responds", async () => {
    const mismatched = setup("ADMIN", { actor: "3" });
    expect((await mismatched.request("/auth/admin/users/2/impersonate")).status).toBe(401);
    expect(mismatched.cookies.has(`${settings.cookieName}-return`)).toBe(false);
    const pending = setup("ADMIN", {
      beforeIssue: () =>
        revokeIxAuthLoginSession({
          sessionId: pending.original.sessionId,
          revokedAt: Date.now(),
          reason: "concurrent-revocation",
        }),
    });
    expect((await pending.request("/auth/admin/users/2/impersonate")).status).toBe(401);
    expect(pending.logoutTokens).toEqual(["refresh-2-1"]);
  });

  it.each(["PENDING", "LOCKED", "DISABLED"])(
    "refuses %s accounts and self impersonation",
    async (status) => {
      const app = setup("ADMIN", { targetStatus: status });
      expect((await app.request("/auth/admin/users/2/impersonate")).status).toBe(409);
      expect((await app.request("/auth/admin/users/1/impersonate")).body).toEqual({
        error: "impersonation_self",
      });
    },
  );
});
