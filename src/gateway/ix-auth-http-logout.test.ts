import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetIxAuthJwksCache } from "../auth/ix-auth/ix-auth-jwks.js";
import { IX_AUTH_DEFAULT_ROLE_MAP } from "../auth/ix-auth/ix-auth-role-map.js";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import {
  insertIxAuthLoginSession,
  readIxAuthLoginSessionByDigest,
} from "../state/ix-auth-sessions-store.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { handleIxAuthHttpRequest } from "./ix-auth-http.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret
const CSRF_TOKEN = "csrf-token-value";
const SESSION_TOKEN = "session-token-value"; // pragma: allowlist secret
const SESSION_ID = "session-row-1";
const PROFILE_ID = "profile-1";
const SIGNING_KEY_ID = "ix-auth-test-key";

const SETTINGS = {
  baseUrl: "http://ix-auth:9100",
  jwksUrl: "http://ix-auth:9100/.well-known/jwks.json",
  serviceKey: SERVICE_KEY,
  cookieName: "__Host-openclaw-session",
  roleMap: { ...IX_AUTH_DEFAULT_ROLE_MAP },
  superAdminRoles: ["superadmin"],
  departmentClaim: "ixauth_groups",
  departmentGroupPrefix: "dept-",
  selfSignupEnabled: false,
  idleTimeoutMs: 1_800_000,
  absoluteTimeoutMs: 43_200_000,
} satisfies IxAuthRuntimeSettings;

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

/** The JWKS the identity server publishes, so signature checking runs for real. */
function jwksDocument(): Response {
  const jwk = publicKey.export({ format: "jwk" });
  return new Response(
    JSON.stringify({ keys: [{ ...jwk, kid: SIGNING_KEY_ID, alg: "ES256", use: "sig" }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function signAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: SIGNING_KEY_ID, typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("sha256");
  signer.update(`${header}.${body}`);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${signature.toString("base64url")}`;
}

function digestSecretToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Write the login-session row logout has to find.
 *
 * The row, the CSRF digest, and the JWT signature are genuine, so the only thing
 * simulated here is the identity server's own HTTP surface.
 */
function seedSession(): void {
  const nowMs = Date.now();
  insertIxAuthLoginSession({
    id: SESSION_ID,
    token_digest: digestSecretToken(SESSION_TOKEN),
    csrf_digest: digestSecretToken(CSRF_TOKEN),
    profile_id: PROFILE_ID,
    identity_subject: "1042",
    identity_session_id: "identity-session-1",
    identity_email: "person@example.test",
    access_token: signAccessToken({
      sub: "1042",
      email: "person@example.test",
      name: "Signed In Person",
      ixauth_roles: ["MEMBER"],
      ixauth_groups: ["dept-rnd"],
      ixauth_sid: "identity-session-1",
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + 900,
    }),
    access_expires_at: nowMs + 900_000,
    refresh_token: "refresh-1",
    user_agent_digest: null,
    created_at: nowMs,
    last_seen_at: nowMs,
    idle_expires_at: nowMs + SETTINGS.idleTimeoutMs,
    absolute_expires_at: nowMs + SETTINGS.absoluteTimeoutMs,
  });
}

type CapturedResponse = {
  res: ServerResponse;
  status: () => number;
  body: () => string;
  headers: ReadonlyMap<string, string | string[]>;
};

function buildResponse(): CapturedResponse {
  let body = "";
  // Cookie clearing reads back what it already wrote, so this stub has to remember
  // headers rather than swallow them.
  const headers = new Map<string, string | string[]>();
  const res = {
    statusCode: 0,
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name.toLowerCase(), value);
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        body = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    },
    // SAFETY: the logout handler touches only statusCode, the header pair, and end.
  } as unknown as ServerResponse;
  return { res, status: () => res.statusCode, body: () => body, headers };
}

function buildRequest(headers: Record<string, string>): IncomingMessage {
  return Object.assign(Readable.from([]), {
    method: "POST",
    url: "/auth/logout",
    socket: { destroyed: false, writableEnded: false, remoteAddress: "203.0.113.7" },
    headers: {
      host: "127.0.0.1:18800",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    // SAFETY: only the fields the auth handlers read are needed on this stub request.
  }) as unknown as IncomingMessage;
}

/** Serve the JWKS for real and accept the identity server's own revocation call. */
function stubIdentityServer(): string[] {
  const paths: string[] = [];
  vi.stubGlobal("fetch", (url: URL | string) => {
    const href = typeof url === "string" ? url : url.toString();
    const pathname = new URL(href).pathname;
    paths.push(pathname);
    if (pathname === "/.well-known/jwks.json") {
      return Promise.resolve(jwksDocument());
    }
    return Promise.resolve(new Response("", { status: 204 }));
  });
  return paths;
}

function buildDeps(overrides?: Partial<IxAuthHttpDependencies>): IxAuthHttpDependencies {
  return {
    settings: SETTINGS,
    isLocalClient: true,
    // A `__Host-` cookie only exists in a secure context; over plain HTTP the routes
    // fall back to the unprefixed name and would never see the cookie below.
    isSecureContext: true,
    clientIp: "203.0.113.7",
    ...overrides,
  };
}

async function callLogout(params: {
  headers: Record<string, string>;
  onDisconnect: (profileId: string) => void;
}): Promise<CapturedResponse> {
  const captured = buildResponse();
  await handleIxAuthHttpRequest({
    req: buildRequest(params.headers),
    res: captured.res,
    pathname: "/auth/logout",
    deps: buildDeps({ disconnectClientsForUserProfile: params.onDisconnect }),
  });
  return captured;
}

function signedInHeaders(csrfToken: string): Record<string, string> {
  return {
    cookie: `${SETTINGS.cookieName}=${SESSION_TOKEN}`,
    "x-openclaw-csrf": csrfToken,
  };
}

function readRevokedAt(): number | null | undefined {
  return readIxAuthLoginSessionByDigest(digestSecretToken(SESSION_TOKEN))?.revoked_at;
}

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("openclaw-ix-auth-logout-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

describe("logout", () => {
  it("disconnects the connections of the profile that signed out", async () => {
    stubIdentityServer();
    seedSession();
    const disconnected: string[] = [];
    const answer = await callLogout({
      headers: signedInHeaders(CSRF_TOKEN),
      onDisconnect: (profileId) => disconnected.push(profileId),
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({ authenticated: false });
    expect(disconnected).toEqual([PROFILE_ID]);
    expect(readRevokedAt()).toBeTruthy();
    // The browser has to lose the cookie too, or the next probe would look signed in.
    expect(String(answer.headers.get("set-cookie"))).toContain(SETTINGS.cookieName);
  });

  it("leaves the connections alone when the CSRF header does not match", async () => {
    stubIdentityServer();
    seedSession();
    const disconnected: string[] = [];
    const answer = await callLogout({
      headers: signedInHeaders("wrong-token"),
      onDisconnect: (profileId) => disconnected.push(profileId),
    });
    expect(answer.status()).toBe(403);
    expect(disconnected).toEqual([]);
    expect(readRevokedAt()).toBeFalsy();
  });

  it("answers without a session cookie and disconnects nothing", async () => {
    stubIdentityServer();
    const disconnected: string[] = [];
    const answer = await callLogout({
      headers: {},
      onDisconnect: (profileId) => disconnected.push(profileId),
    });
    expect(answer.status()).toBe(200);
    expect(disconnected).toEqual([]);
  });
});
