import { createSign, generateKeyPairSync } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetIxAuthJwksCache } from "../auth/ix-auth/ix-auth-jwks.js";
import { IX_AUTH_DEFAULT_ROLE_MAP } from "../auth/ix-auth/ix-auth-role-map.js";
import { resetIxAuthSessionActivityTrackerForTest } from "../auth/ix-auth/ix-auth-session-activity.js";
import {
  persistIxAuthLoginSession,
  readIxAuthSessionTokenRow,
} from "../auth/ix-auth/ix-auth-sessions.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { ensureProfileForEmail } from "../state/user-profiles.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { handleIxAuthHttpRequest } from "./ix-auth-http.js";

const settings = {
  baseUrl: "http://ix-auth:9100",
  jwksUrl: "http://ix-auth:9100/.well-known/jwks.json",
  serviceKey: "test-service-key-activity",
  cookieName: "__Host-openclaw-session",
  roleMap: { ...IX_AUTH_DEFAULT_ROLE_MAP },
  superAdminRoles: ["superadmin"],
  departmentClaim: "ixauth_groups",
  departmentGroupPrefix: "dept-",
  titleGroupPrefix: "title-",
  selfSignupEnabled: false,
  idleTimeoutMs: 1_800_000,
  absoluteTimeoutMs: 43_200_000,
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function identity(subject: string) {
  const claims = {
    subject,
    email: `${subject}@example.test`,
    displayName: subject,
    roles: ["ADMIN"],
    groups: ["dept-rnd"],
    identitySessionId: `identity-${subject}`,
    expiresAtMs: Math.floor(Date.now() / 1000) * 1000 + 7_200_000,
  };
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "test-key" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      email: claims.email,
      name: subject,
      ixauth_roles: claims.roles,
      ixauth_groups: claims.groups,
      ixauth_sid: claims.identitySessionId,
      iat: Math.floor(Date.now() / 1000),
      exp: claims.expiresAtMs / 1000,
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const signer = createSign("sha256");
  signer.update(input);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return {
    claims,
    tokens: {
      accessToken: `${input}.${signature.toString("base64url")}`,
      refreshToken: `refresh-${subject}`,
      expiresInSeconds: 900,
    },
  };
}

/** One signed-in browser whose only request is the session probe on each page load. */
function setup(signedInAtMs: number) {
  vi.stubGlobal("fetch", async (url: string | URL) => {
    if (new URL(String(url)).pathname === "/.well-known/jwks.json") {
      return Response.json({
        keys: [
          { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "ES256", use: "sig" },
        ],
      });
    }
    return Response.json({ error: { code: "AUTH_TOKEN_INVALID" } }, { status: 401 });
  });
  const session = persistIxAuthLoginSession({
    ...identity("1"),
    settings,
    profileId: ensureProfileForEmail("1@example.test").id,
    nowMs: signedInAtMs,
  });
  const deps: IxAuthHttpDependencies = {
    settings,
    isLocalClient: true,
    isSecureContext: true,
  };
  const probe = async (options: { cookie?: boolean } = {}) => {
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
      method: "GET",
      url: "/auth/me",
      headers: {
        host: "localhost",
        "sec-fetch-site": "same-origin",
        ...(options.cookie === false
          ? {}
          : { cookie: `${settings.cookieName}=${session.sessionToken}` }),
      },
      socket: { remoteAddress: "127.0.0.1" },
    }) as unknown as IncomingMessage;
    await handleIxAuthHttpRequest({ req, res, deps, pathname: "/auth/me" });
    return { status: res.statusCode, body: JSON.parse(responseBody) as Record<string, unknown> };
  };
  return { session, probe };
}

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("ix-auth-http-activity-"));
  resetIxAuthSessionActivityTrackerForTest();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthSessionActivityTrackerForTest();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

describe("GET /auth/me records browser activity", () => {
  it("slides the idle window on the first page load after signing in", async () => {
    const signedInAt = Date.now() - 5_000;
    const app = setup(signedInAt);
    const before = readIxAuthSessionTokenRow(app.session.sessionToken)!;
    expect(before.last_seen_at).toBe(before.created_at);

    const probed = await app.probe();

    expect(probed.status).toBe(200);
    expect(probed.body.authenticated).toBe(true);
    const after = readIxAuthSessionTokenRow(app.session.sessionToken)!;
    // The symptom this guards: a browser that only loads pages left every row at
    // `last_seen_at == created_at`, so the session died one idle window after sign-in
    // however hard the person was working.
    expect(after.last_seen_at).toBeGreaterThan(after.created_at);
    expect(after.idle_expires_at).toBeGreaterThan(before.idle_expires_at);
    expect(after.absolute_expires_at).toBe(before.absolute_expires_at);
  });

  it("does not write again for a burst of page loads inside one throttle interval", async () => {
    const app = setup(Date.now() - 5_000);
    await app.probe();
    const first = readIxAuthSessionTokenRow(app.session.sessionToken)!;
    await app.probe();
    await app.probe();

    const after = readIxAuthSessionTokenRow(app.session.sessionToken)!;
    expect(after.last_seen_at).toBe(first.last_seen_at);
    expect(after.idle_expires_at).toBe(first.idle_expires_at);
  });

  it("leaves the row alone when the probe carries no session cookie", async () => {
    const app = setup(Date.now() - 5_000);

    const probed = await app.probe({ cookie: false });

    expect(probed.body.authenticated).toBe(false);
    const row = readIxAuthSessionTokenRow(app.session.sessionToken)!;
    expect(row.last_seen_at).toBe(row.created_at);
  });
});
