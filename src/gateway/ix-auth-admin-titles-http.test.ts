import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetIxAuthJwksCache } from "../auth/ix-auth/ix-auth-jwks.js";
import { IX_AUTH_DEFAULT_ROLE_MAP } from "../auth/ix-auth/ix-auth-role-map.js";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import { insertIxAuthLoginSession } from "../state/ix-auth-sessions-store.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { listTitles, syncTitleMembership, upsertTitle } from "../state/titles-store.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { handleIxAuthHttpRequest } from "./ix-auth-http.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret
const CSRF_TOKEN = "csrf-token-value";
const SIGNING_KEY_ID = "ix-auth-titles-test-key";

const SETTINGS = {
  baseUrl: "http://ix-auth:9100",
  jwksUrl: "http://ix-auth:9100/.well-known/jwks.json",
  serviceKey: SERVICE_KEY,
  cookieName: "__Host-openclaw-session",
  roleMap: { ...IX_AUTH_DEFAULT_ROLE_MAP },
  superAdminRoles: ["superadmin"],
  departmentClaim: "ixauth_groups",
  departmentGroupPrefix: "dept-",
  titleGroupPrefix: "title-",
  selfSignupEnabled: false,
  idleTimeoutMs: 1_800_000,
  absoluteTimeoutMs: 43_200_000,
} satisfies IxAuthRuntimeSettings;

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

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

/** Write a real login session row and return the cookie that resolves it. */
function seedSession(roles: string[]): string {
  const nowMs = Date.now();
  const sessionToken = `session-${roles.join("-")}`;
  insertIxAuthLoginSession({
    id: `row-${sessionToken}`,
    token_digest: digestSecretToken(sessionToken),
    csrf_digest: digestSecretToken(CSRF_TOKEN),
    profile_id: "profile-1",
    identity_subject: "1042",
    identity_session_id: "identity-session-1",
    identity_email: "admin@example.test",
    access_token: signAccessToken({
      sub: "1042",
      email: "admin@example.test",
      name: "Admin Person",
      ixauth_roles: roles,
      ixauth_groups: ["dept-rnd", "title-team-lead"],
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
  return `${SETTINGS.cookieName}=${sessionToken}`;
}

type CapturedResponse = { res: ServerResponse; status: () => number; body: () => string };

function buildResponse(): CapturedResponse {
  let body = "";
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        body = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    },
    // SAFETY: the handlers under test touch only statusCode, setHeader, and end.
  } as unknown as ServerResponse;
  return { res, status: () => res.statusCode, body: () => body };
}

function buildRequest(params: {
  method: string;
  pathname: string;
  cookie: string;
  body?: unknown;
}): IncomingMessage {
  const payload = params.body === undefined ? undefined : JSON.stringify(params.body);
  const stream = Readable.from(payload === undefined ? [] : [Buffer.from(payload)]);
  return Object.assign(stream, {
    method: params.method,
    url: params.pathname,
    socket: { destroyed: false, writableEnded: false, remoteAddress: "203.0.113.7" },
    headers: {
      host: "127.0.0.1:18800",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      cookie: params.cookie,
      "x-openclaw-csrf": CSRF_TOKEN,
    },
    // SAFETY: only the fields the auth handlers read are set on this stub request.
  }) as unknown as IncomingMessage;
}

type UpstreamCall = { path: string; method: string; body: string };

function stubIdentityServer(
  routes: Record<string, (call: UpstreamCall) => Response>,
): UpstreamCall[] {
  const calls: UpstreamCall[] = [];
  vi.stubGlobal("fetch", (url: URL | string, init: RequestInit | undefined) => {
    const href = typeof url === "string" ? url : url.toString();
    const upstreamCall: UpstreamCall = {
      path: new URL(href).pathname,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(upstreamCall);
    if (upstreamCall.path === "/.well-known/jwks.json") {
      return Promise.resolve(jwksDocument());
    }
    const route = routes[`${upstreamCall.method} ${upstreamCall.path}`];
    if (!route) {
      throw new Error(
        `unexpected identity-server call to ${upstreamCall.method} ${upstreamCall.path}`,
      );
    }
    return Promise.resolve(route(upstreamCall));
  });
  return calls;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Groups the identity server lists: one title, one department, one plain group. */
function groupListing(): Response {
  return jsonResponse({
    data: [
      { id: 11, code: "title-team-lead", name: "Team Lead" },
      { id: 7, code: "dept-rnd", name: "R and D" },
      { id: 8, code: "staff-all", name: "Everyone" },
    ],
  });
}

function directoryUser(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "31",
    email: "person@example.test",
    name: "Person",
    status: "ACTIVE",
    failedCount: 0,
    roles: ["MEMBER"],
    groups: [],
    ...overrides,
  };
}

function directory(items: Record<string, unknown>[]): Response {
  return jsonResponse({ data: { items, page: 0, size: 100, total: items.length } });
}

async function call(params: {
  method: string;
  cookie: string;
  body?: unknown;
}): Promise<CapturedResponse> {
  const captured = buildResponse();
  await handleIxAuthHttpRequest({
    req: buildRequest({ ...params, pathname: "/auth/admin/titles" }),
    res: captured.res,
    pathname: "/auth/admin/titles",
    deps: {
      settings: SETTINGS,
      isLocalClient: true,
      isSecureContext: false,
      clientIp: "203.0.113.7",
    } satisfies IxAuthHttpDependencies,
  });
  return captured;
}

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("openclaw-ix-auth-titles-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

describe("GET /auth/admin/titles", () => {
  it("returns only title-prefixed groups, with the local projection attached", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertTitle({ slug: "team-lead", displayName: "Team lead", nowMs: Date.now() });
    stubIdentityServer({
      "GET /admin/groups": groupListing,
      "GET /admin/users": () =>
        directory([
          directoryUser({ id: "31", groups: ["title-team-lead"] }),
          directoryUser({ id: "32", groups: ["title-team-lead", "dept-rnd"] }),
          directoryUser({ id: "33", groups: ["dept-rnd"] }),
        ]),
    });
    const answer = await call({ method: "GET", cookie });
    expect(answer.status()).toBe(200);
    const parsed = JSON.parse(answer.body());
    expect(parsed.prefix).toBe("title-");
    expect(parsed.memberCountSource).toBe("identity");
    expect(parsed.titles).toEqual([
      {
        code: "title-team-lead",
        slug: "team-lead",
        // The operator-authored name wins over the identity server's group name.
        name: "Team lead",
        identityName: "Team Lead",
        memberCount: 2,
      },
    ]);
    expect(parsed.orphans).toEqual([]);
  });

  it("reports a title the identity server no longer lists as an orphan", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertTitle({ slug: "retired", displayName: "Retired role", nowMs: Date.now() });
    stubIdentityServer({
      "GET /admin/groups": groupListing,
      "GET /admin/users": () => directory([]),
    });
    const answer = await call({ method: "GET", cookie });
    const parsed = JSON.parse(answer.body());
    // The live group keeps the identity server's own name; nobody has renamed it here.
    expect(parsed.titles).toEqual([
      {
        code: "title-team-lead",
        slug: "team-lead",
        name: "Team Lead",
        identityName: "Team Lead",
        memberCount: 0,
      },
    ]);
    expect(parsed.orphans).toEqual([{ slug: "retired", name: "Retired role", memberCount: 0 }]);
  });
});

describe("POST /auth/admin/titles", () => {
  it("mints the group code from the slug and records the projection", async () => {
    const cookie = seedSession(["ADMIN"]);
    const calls = stubIdentityServer({
      "GET /admin/groups": groupListing,
      "POST /admin/groups": () => jsonResponse({ data: { id: 21, code: "title-safety" } }),
    });
    const answer = await call({
      method: "POST",
      cookie,
      body: { slug: "safety", name: "Safety officer" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({
      code: "title-safety",
      slug: "safety",
      name: "Safety officer",
    });
    const created = calls.find((entry) => entry.method === "POST");
    // The caller never names the group code; the prefix is the Gateway's to apply.
    expect(JSON.parse(created?.body ?? "{}").code).toBe("title-safety");
    expect(listTitles().map((row) => row.slug)).toContain("safety");
  });

  it("refuses a code the identity server already has", async () => {
    const cookie = seedSession(["ADMIN"]);
    stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({
      method: "POST",
      cookie,
      body: { slug: "team-lead", name: "Team lead" },
    });
    expect(answer.status()).toBe(409);
    expect(JSON.parse(answer.body()).error).toBe("conflict");
  });

  it("refuses a slug the group code shape would not accept", async () => {
    const cookie = seedSession(["ADMIN"]);
    stubIdentityServer({});
    const answer = await call({
      method: "POST",
      cookie,
      body: { slug: "Not A Slug", name: "Whatever" },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body()).error).toBe("invalid_body");
  });

  it("refuses a member session outright", async () => {
    const cookie = seedSession(["MEMBER"]);
    stubIdentityServer({});
    const answer = await call({ method: "POST", cookie, body: { slug: "x", name: "X" } });
    expect(answer.status()).toBe(403);
  });
});

describe("DELETE /auth/admin/titles", () => {
  it("refuses while somebody still holds the title", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    stubIdentityServer({
      "GET /admin/groups": groupListing,
      // The contract's membership read is unavailable on the deployed server, so the
      // directory walk is what answers, exactly as it does for departments.
      "GET /admin/groups/11/members": () =>
        jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405),
      "GET /admin/users": () => directory([directoryUser({ groups: ["title-team-lead"] })]),
    });
    const answer = await call({ method: "DELETE", cookie, body: { slug: "team-lead" } });
    expect(answer.status()).toBe(409);
    expect(JSON.parse(answer.body())).toEqual({ error: "title_has_members", memberCount: 1 });
  });

  it("removes the group first, then the projection", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertTitle({ slug: "team-lead", displayName: "Team lead", nowMs: Date.now() });
    const calls = stubIdentityServer({
      "GET /admin/groups": groupListing,
      "GET /admin/groups/11/members": () =>
        jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405),
      "GET /admin/users": () => directory([directoryUser({ groups: ["dept-rnd"] })]),
      "DELETE /admin/groups/11": () => jsonResponse({ data: true }),
    });
    const answer = await call({ method: "DELETE", cookie, body: { slug: "team-lead" } });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({ slug: "team-lead" });
    expect(calls.some((entry) => entry.method === "DELETE")).toBe(true);
    expect(listTitles()).toEqual([]);
  });

  it("clears an orphan row without calling the identity server", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertTitle({ slug: "retired", displayName: "Retired role", nowMs: Date.now() });
    const calls = stubIdentityServer({
      "GET /admin/groups": groupListing,
      "GET /admin/users": () => directory([]),
    });
    const answer = await call({ method: "DELETE", cookie, body: { slug: "retired" } });
    expect(answer.status()).toBe(200);
    expect(calls.some((entry) => entry.method === "DELETE")).toBe(false);
    expect(listTitles()).toEqual([]);
  });

  it("refuses an orphan row the projection still places people in", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertTitle({ slug: "retired", displayName: "Retired role", nowMs: Date.now() });
    syncTitleMembership({ profileId: "profile-9", titles: ["retired"], nowMs: Date.now() });
    stubIdentityServer({
      "GET /admin/groups": groupListing,
      "GET /admin/users": () => directory([]),
    });
    const answer = await call({ method: "DELETE", cookie, body: { slug: "retired" } });
    expect(answer.status()).toBe(409);
    expect(listTitles().map((row) => row.slug)).toEqual(["retired"]);
  });
});

describe("PATCH /auth/admin/titles", () => {
  it("writes only the fork's display name", async () => {
    const cookie = seedSession(["ADMIN"]);
    const calls = stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({
      method: "PATCH",
      cookie,
      body: { slug: "team-lead", name: "Squad lead" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({ slug: "team-lead", name: "Squad lead" });
    // The identity server has no rename, so nothing is relayed to it.
    expect(calls.every((entry) => entry.method === "GET")).toBe(true);
    expect(listTitles()).toEqual([
      expect.objectContaining({ slug: "team-lead", display_name: "Squad lead" }),
    ]);
  });

  it("refuses a slug no group answers to", async () => {
    const cookie = seedSession(["ADMIN"]);
    stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({ method: "PATCH", cookie, body: { slug: "ghost", name: "Ghost" } });
    expect(answer.status()).toBe(404);
  });
});
