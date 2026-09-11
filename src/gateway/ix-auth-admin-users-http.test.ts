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
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { handleIxAuthHttpRequest } from "./ix-auth-http.js";
import { resetIxAuthInviteLinks } from "./ix-auth-invite-links.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret
const CSRF_TOKEN = "csrf-token-value";
const SIGNING_KEY_ID = "ix-auth-test-key";
/** The signed-in administrator's own identity id, which is what the self checks compare. */
const ACTOR_USER_ID = "1042";
const TARGET_USER_ID = "2087";

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
  return `${header}.${body}.${signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

function digestSecretToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

type SeededSession = { cookie: string };

/** Write a real login session row and return the cookie that resolves it. */
function seedSession(params: { roles: string[]; sessionToken: string }): SeededSession {
  const nowMs = Date.now();
  const accessToken = signAccessToken({
    sub: ACTOR_USER_ID,
    email: "admin@example.test",
    name: "Admin Person",
    ixauth_roles: params.roles,
    ixauth_groups: ["dept-rnd"],
    ixauth_sid: "identity-session-1",
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + 900,
  });
  insertIxAuthLoginSession({
    id: `session-${params.sessionToken}`,
    token_digest: digestSecretToken(params.sessionToken),
    csrf_digest: digestSecretToken(CSRF_TOKEN),
    profile_id: "profile-1",
    identity_subject: ACTOR_USER_ID,
    identity_session_id: "identity-session-1",
    identity_email: "admin@example.test",
    access_token: accessToken,
    access_expires_at: nowMs + 900_000,
    refresh_token: "refresh-1",
    user_agent_digest: null,
    created_at: nowMs,
    last_seen_at: nowMs,
    idle_expires_at: nowMs + SETTINGS.idleTimeoutMs,
    absolute_expires_at: nowMs + SETTINGS.absoluteTimeoutMs,
  });
  return { cookie: `${SETTINGS.cookieName}=${params.sessionToken}` };
}

/** A second browser session for the account the tests act on, to prove it gets closed. */
function seedTargetSession(): void {
  const nowMs = Date.now();
  insertIxAuthLoginSession({
    id: "session-target",
    token_digest: digestSecretToken("target-session"),
    csrf_digest: digestSecretToken(CSRF_TOKEN),
    profile_id: "profile-target",
    identity_subject: TARGET_USER_ID,
    identity_session_id: "identity-session-target",
    identity_email: "member@example.test",
    access_token: "target-access",
    access_expires_at: nowMs + 900_000,
    refresh_token: "target-refresh",
    user_agent_digest: null,
    created_at: nowMs,
    last_seen_at: nowMs,
    idle_expires_at: nowMs + SETTINGS.idleTimeoutMs,
    absolute_expires_at: nowMs + SETTINGS.absoluteTimeoutMs,
  });
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
  method?: string;
  pathname: string;
  headers?: Record<string, string>;
  body?: unknown;
}): IncomingMessage {
  const payload = params.body === undefined ? undefined : JSON.stringify(params.body);
  const stream = Readable.from(payload === undefined ? [] : [Buffer.from(payload)]);
  return Object.assign(stream, {
    method: params.method ?? "GET",
    url: params.pathname,
    socket: { destroyed: false, writableEnded: false, remoteAddress: "203.0.113.7" },
    headers: {
      host: "127.0.0.1:18800",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...params.headers,
    },
    // SAFETY: only the fields the auth handlers read are needed on this stub request.
  }) as unknown as IncomingMessage;
}

type UpstreamCall = { path: string; search: string; method: string; body: string };
type UpstreamRoutes = Record<string, (call: UpstreamCall) => Response>;

function stubIdentityServer(routes: UpstreamRoutes): UpstreamCall[] {
  const calls: UpstreamCall[] = [];
  vi.stubGlobal("fetch", (url: URL | string, init: RequestInit | undefined) => {
    const parsed = new URL(typeof url === "string" ? url : url.toString());
    const call: UpstreamCall = {
      path: parsed.pathname,
      search: parsed.search,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    };
    if (call.path === "/.well-known/jwks.json") {
      // Key fetching is session verification, not an administration call, so it stays out
      // of the recorded list the assertions read.
      return Promise.resolve(jwksDocument());
    }
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`] ?? routes[call.path];
    if (!route) {
      throw new Error(`unexpected identity-server call to ${call.method} ${call.path}`);
    }
    return Promise.resolve(route(call));
  });
  return calls;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** One account as the identity server's own user API answers with. */
function userView(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: TARGET_USER_ID,
    email: "member@example.test",
    name: "Member Person",
    status: "ACTIVE",
    failedCount: 0,
    roles: ["MEMBER"],
    groups: ["dept-rnd"],
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function buildDeps(overrides?: Partial<IxAuthHttpDependencies>): IxAuthHttpDependencies {
  return {
    settings: SETTINGS,
    isLocalClient: true,
    isSecureContext: false,
    clientIp: "203.0.113.7",
    ...overrides,
  };
}

async function callAdmin(params: {
  method?: string;
  pathname: string;
  headers?: Record<string, string>;
  body?: unknown;
  deps?: IxAuthHttpDependencies;
}): Promise<CapturedResponse> {
  const captured = buildResponse();
  await handleIxAuthHttpRequest({
    req: buildRequest(params),
    res: captured.res,
    // The Gateway strips the query string before classifying, as its own router does.
    pathname: params.pathname.split("?")[0] ?? params.pathname,
    deps: params.deps ?? buildDeps(),
  });
  return captured;
}

function adminHeaders(session: SeededSession, extra?: Record<string, string>) {
  return { cookie: session.cookie, "x-openclaw-csrf": CSRF_TOKEN, ...extra };
}

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("openclaw-ix-auth-admin-users-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthInviteLinks();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

/** Every user-management route, with the method its dispatcher accepts. */
const USER_ROUTES: ReadonlyArray<{ method: string; pathname: string }> = [
  { method: "GET", pathname: "/auth/admin/users" },
  { method: "GET", pathname: `/auth/admin/users/${TARGET_USER_ID}` },
  { method: "PATCH", pathname: `/auth/admin/users/${TARGET_USER_ID}` },
  { method: "DELETE", pathname: `/auth/admin/users/${TARGET_USER_ID}` },
  { method: "PUT", pathname: `/auth/admin/users/${TARGET_USER_ID}/roles` },
  { method: "PUT", pathname: `/auth/admin/users/${TARGET_USER_ID}/departments` },
  { method: "POST", pathname: `/auth/admin/users/${TARGET_USER_ID}/password-reset` },
  { method: "POST", pathname: `/auth/admin/users/${TARGET_USER_ID}/invite` },
  { method: "POST", pathname: `/auth/admin/users/${TARGET_USER_ID}/unlock` },
  { method: "POST", pathname: `/auth/admin/users/${TARGET_USER_ID}/mfa-reset` },
  { method: "DELETE", pathname: `/auth/admin/users/${TARGET_USER_ID}/sessions` },
  { method: "POST", pathname: "/auth/admin/users/bulk" },
];

describe("user management admission", () => {
  it.each(USER_ROUTES)("refuses $method $pathname with no session", async (route) => {
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: route.method,
      pathname: route.pathname,
      headers: { "x-openclaw-csrf": CSRF_TOKEN },
      body: route.method === "GET" ? undefined : {},
    });
    expect(answer.status()).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each(["MEMBER", "EXECUTIVE", "MODERATOR"])(
    "refuses every user route for a %s session",
    async (role) => {
      const session = seedSession({ roles: [role], sessionToken: `session-${role}` });
      const calls = stubIdentityServer({});
      for (const route of USER_ROUTES) {
        const answer = await callAdmin({
          method: route.method,
          pathname: route.pathname,
          headers: adminHeaders(session),
          body: route.method === "GET" ? undefined : {},
        });
        expect(answer.status()).toBe(403);
        expect(JSON.parse(answer.body())).toEqual({ error: "forbidden" });
      }
      expect(calls).toHaveLength(0);
    },
  );

  it("refuses a mutating route with no CSRF token", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: "PATCH",
      pathname: `/auth/admin/users/${TARGET_USER_ID}`,
      headers: { cookie: session.cookie },
      body: { name: "New Name" },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "csrf_mismatch" });
    expect(calls).toHaveLength(0);
  });

  it("answers 404 for a path inside the namespace that names nothing", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/impersonate`,
      headers: adminHeaders(session),
      body: {},
    });
    expect(answer.status()).toBe(404);
  });
});

describe("listing", () => {
  it("passes the filters through and projects the Gateway role", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/users": () =>
        jsonResponse({
          data: {
            items: [
              userView(),
              userView({
                id: "3001",
                email: "boss@example.test",
                roles: ["EXECUTIVE"],
                groups: ["dept-qa"],
              }),
            ],
            page: 0,
            size: 25,
            total: 2,
          },
        }),
    });
    const answer = await callAdmin({
      pathname: "/auth/admin/users?query=member&status=active&role=member&page=0&size=25",
      headers: adminHeaders(session),
    });
    expect(answer.status()).toBe(200);
    const body = JSON.parse(answer.body());
    expect(body.users[0].gatewayRole).toBe("member");
    expect(body.users[0].departments).toEqual(["dept-rnd"]);
    expect(body.users[1].gatewayRole).toBe("executive");
    expect(body.total).toBe(2);
    const listCall = calls.find((call) => call.path === "/admin/users");
    expect(listCall?.search).toContain("q=member");
    expect(listCall?.search).toContain("status=ACTIVE");
    expect(listCall?.search).toContain("role=MEMBER");
  });

  it("narrows by department over the whole directory, with the department's own total", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    // Three pages of 100 on the identity server; every third account is in QA, so the
    // department has 100 people and a page of 25 must show 25 of 100, not 8 of 300.
    const everyone = Array.from({ length: 300 }, (_, index) =>
      userView({
        id: String(5000 + index),
        email: `person${index}@example.test`,
        groups: index % 3 === 0 ? ["dept-qa"] : ["dept-rnd"],
      }),
    );
    const calls = stubIdentityServer({
      "/admin/users": (call) => {
        const search = new URLSearchParams(call.search);
        const page = Number(search.get("page"));
        const size = Number(search.get("size"));
        return jsonResponse({
          data: { items: everyone.slice(page * size, page * size + size), page, size, total: 300 },
        });
      },
    });
    const answer = await callAdmin({
      pathname: "/auth/admin/users?department=dept-qa&page=1&size=25",
      headers: adminHeaders(session),
    });
    const body = JSON.parse(answer.body());
    expect(body.total).toBe(100);
    expect(body.page).toBe(1);
    expect(body.users).toHaveLength(25);
    // Page 1 of the department starts at its 26th member, who is index 75 overall.
    expect(body.users[0].id).toBe("5075");
    expect(body.departmentFilterApplied).toBe(true);
    expect(calls.filter((call) => call.path === "/admin/users")).toHaveLength(3);
  });

  it("answers an empty department with no rows and a total of zero", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      "/admin/users": () =>
        jsonResponse({
          data: { items: [userView(), userView({ id: "3001" })], page: 0, size: 100, total: 2 },
        }),
    });
    const answer = await callAdmin({
      pathname: "/auth/admin/users?department=dept-qa",
      headers: adminHeaders(session),
    });
    const body = JSON.parse(answer.body());
    expect(body.users).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("self protection", () => {
  const SELF_ROUTES: ReadonlyArray<{ method: string; suffix: string; body: unknown }> = [
    { method: "PATCH", suffix: "", body: { status: "DISABLED" } },
    { method: "DELETE", suffix: "", body: {} },
    { method: "PUT", suffix: "/roles", body: { roles: ["MEMBER"] } },
    { method: "PUT", suffix: "/departments", body: { departments: [] } },
  ];

  it.each(SELF_ROUTES)("refuses $method on the caller's own account", async (route) => {
    const session = seedSession({ roles: ["SUPERADMIN"], sessionToken: "super-session" });
    stubIdentityServer({});
    const answer = await callAdmin({
      method: route.method,
      pathname: `/auth/admin/users/${ACTOR_USER_ID}${route.suffix}`,
      headers: adminHeaders(session),
      body: route.body,
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "self_forbidden" });
  });

  it("still allows renaming the caller's own account", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      [`GET /admin/users/${ACTOR_USER_ID}`]: () =>
        jsonResponse({ data: userView({ id: ACTOR_USER_ID, email: "admin@example.test" }) }),
      [`PATCH /admin/users/${ACTOR_USER_ID}`]: () =>
        jsonResponse({
          data: userView({ id: ACTOR_USER_ID, email: "admin@example.test", name: "Renamed" }),
        }),
    });
    const answer = await callAdmin({
      method: "PATCH",
      pathname: `/auth/admin/users/${ACTOR_USER_ID}`,
      headers: adminHeaders(session),
      body: { name: "Renamed" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body()).user.displayName).toBe("Renamed");
  });
});

describe("rank protection", () => {
  it("refuses an ordinary administrator granting super-admin rank", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({});
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/roles`,
      headers: adminHeaders(session),
      body: { roles: ["SUPERADMIN"] },
    });
    expect(answer.status()).toBe(403);
  });

  it("refuses an ordinary administrator acting on a super administrator", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      [`GET /admin/users/${TARGET_USER_ID}`]: () =>
        jsonResponse({ data: userView({ roles: ["SUPERADMIN"] }) }),
    });
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/roles`,
      headers: adminHeaders(session),
      body: { roles: ["MEMBER"] },
    });
    expect(answer.status()).toBe(403);
  });

  it("refuses to demote the last super administrator", async () => {
    const session = seedSession({ roles: ["SUPERADMIN"], sessionToken: "super-session" });
    stubIdentityServer({
      [`GET /admin/users/${TARGET_USER_ID}`]: () =>
        jsonResponse({ data: userView({ roles: ["SUPERADMIN"] }) }),
      "/admin/users": () =>
        jsonResponse({
          data: { items: [userView({ roles: ["SUPERADMIN"] })], page: 0, size: 1, total: 1 },
        }),
    });
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/roles`,
      headers: adminHeaders(session),
      body: { roles: ["MEMBER"] },
    });
    expect(answer.status()).toBe(409);
    expect(JSON.parse(answer.body())).toEqual({ error: "last_super_admin" });
  });

  it("demotes a super administrator while another one remains", async () => {
    const session = seedSession({ roles: ["SUPERADMIN"], sessionToken: "super-session" });
    const calls = stubIdentityServer({
      [`GET /admin/users/${TARGET_USER_ID}`]: () =>
        jsonResponse({ data: userView({ roles: ["SUPERADMIN"] }) }),
      "/admin/users": () =>
        jsonResponse({ data: { items: [userView()], page: 0, size: 1, total: 2 } }),
      [`PUT /admin/users/${TARGET_USER_ID}/roles`]: () => jsonResponse({ data: userView() }),
      [`DELETE /admin/users/${TARGET_USER_ID}/sessions`]: () =>
        jsonResponse({ data: { revoked: 3 } }),
    });
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/roles`,
      headers: adminHeaders(session),
      body: { roles: ["MEMBER"] },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body()).sessions.identitySessions).toBe(3);
    expect(calls.some((call) => call.method === "PUT" && call.path.endsWith("/roles"))).toBe(true);
  });

  it("refuses a delete from an ordinary administrator", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({});
    const answer = await callAdmin({
      method: "DELETE",
      pathname: `/auth/admin/users/${TARGET_USER_ID}`,
      headers: adminHeaders(session),
      body: {},
    });
    expect(answer.status()).toBe(403);
  });
});

describe("session takedown", () => {
  it("ends Gateway sessions and closes sockets when an account is disabled", async () => {
    const session = seedSession({ roles: ["SUPERADMIN"], sessionToken: "super-session" });
    seedTargetSession();
    const disconnected: string[] = [];
    stubIdentityServer({
      [`GET /admin/users/${TARGET_USER_ID}`]: () => jsonResponse({ data: userView() }),
      [`PATCH /admin/users/${TARGET_USER_ID}`]: () =>
        jsonResponse({ data: userView({ status: "DISABLED" }) }),
      [`DELETE /admin/users/${TARGET_USER_ID}/sessions`]: () =>
        jsonResponse({ data: { revoked: 1 } }),
    });
    const answer = await callAdmin({
      method: "PATCH",
      pathname: `/auth/admin/users/${TARGET_USER_ID}`,
      headers: adminHeaders(session),
      body: { status: "DISABLED" },
      deps: buildDeps({
        disconnectClientsForUserProfile: (profileId) => disconnected.push(profileId),
      }),
    });
    expect(answer.status()).toBe(200);
    expect(disconnected).toEqual(["profile-target"]);
    expect(JSON.parse(answer.body()).sessions.gatewaySessions).toBe(1);
  });

  it("never returns a password-reset link", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      [`GET /admin/users/${TARGET_USER_ID}`]: () => jsonResponse({ data: userView() }),
      "/auth/password/forgot": () => jsonResponse({ data: { accepted: true } }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/password-reset`,
      headers: adminHeaders(session),
      body: {},
    });
    expect(answer.status()).toBe(200);
    expect(answer.body()).not.toContain("link");
  });
});

describe("departments", () => {
  it("applies the difference between the current and the requested set", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/groups": () =>
        jsonResponse({
          data: [
            { id: 11, code: "dept-rnd", name: "R&D" },
            { id: 12, code: "dept-qa", name: "QA" },
            { id: 13, code: "team-all", name: "Everyone" },
          ],
        }),
      [`GET /admin/users/${TARGET_USER_ID}`]: () =>
        jsonResponse({ data: userView({ groups: ["dept-rnd", "team-all"] }) }),
      "POST /admin/groups/12/members": () => new Response(null, { status: 204 }),
      [`DELETE /admin/groups/11/members/${TARGET_USER_ID}`]: () =>
        new Response(null, { status: 204 }),
      [`DELETE /admin/users/${TARGET_USER_ID}/sessions`]: () =>
        jsonResponse({ data: { revoked: 0 } }),
    });
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/departments`,
      headers: adminHeaders(session),
      body: { departments: ["dept-qa"] },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body()).departmentFailed).toBe(false);
    // The non-department group is left alone; only the prefix-carrying one is removed.
    expect(calls.some((call) => call.path === "/admin/groups/13/members/2087")).toBe(false);
    expect(
      calls.some(
        (call) => call.method === "DELETE" && call.path === "/admin/groups/11/members/2087",
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.method === "POST" && call.path === "/admin/groups/12/members"),
    ).toBe(true);
  });

  it("refuses an ordinary administrator moving a system administrator", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/groups": () => jsonResponse({ data: [{ id: 11, code: "dept-rnd", name: "R&D" }] }),
      [`GET /admin/users/${TARGET_USER_ID}`]: () =>
        jsonResponse({ data: userView({ roles: ["SUPERADMIN"], groups: ["dept-rnd"] }) }),
    });
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/departments`,
      headers: adminHeaders(session),
      body: { departments: [] },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "forbidden" });
    expect(calls.some((call) => call.method === "DELETE" && call.path.includes("/members/"))).toBe(
      false,
    );
  });

  it("lets a system administrator move another system administrator", async () => {
    const session = seedSession({ roles: ["SUPERADMIN"], sessionToken: "super-session" });
    const calls = stubIdentityServer({
      "/admin/groups": () => jsonResponse({ data: [{ id: 11, code: "dept-rnd", name: "R&D" }] }),
      [`GET /admin/users/${TARGET_USER_ID}`]: () =>
        jsonResponse({ data: userView({ roles: ["SUPERADMIN"], groups: [] }) }),
      "POST /admin/groups/11/members": () => new Response(null, { status: 204 }),
      [`DELETE /admin/users/${TARGET_USER_ID}/sessions`]: () =>
        jsonResponse({ data: { revoked: 0 } }),
    });
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/departments`,
      headers: adminHeaders(session),
      body: { departments: ["dept-rnd"] },
    });
    expect(answer.status()).toBe(200);
    expect(
      calls.some((call) => call.method === "POST" && call.path === "/admin/groups/11/members"),
    ).toBe(true);
  });

  it("refuses a department the identity server does not have", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      "/admin/groups": () => jsonResponse({ data: [{ id: 11, code: "dept-rnd", name: "R&D" }] }),
    });
    const answer = await callAdmin({
      method: "PUT",
      pathname: `/auth/admin/users/${TARGET_USER_ID}/departments`,
      headers: adminHeaders(session),
      body: { departments: ["dept-nope"] },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body()).error).toBe("unknown_department");
  });
});

describe("bulk import", () => {
  function csvOf(rows: number): string {
    const lines = ["email,name,roles,departments"];
    for (let index = 0; index < rows; index += 1) {
      lines.push(`person${index}@example.test,Person ${index},MEMBER,dept-rnd`);
    }
    return lines.join("\n");
  }

  it("refuses a file over the row limit before calling the identity server", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/users/bulk",
      headers: adminHeaders(session),
      body: { csv: csvOf(501) },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body())).toMatchObject({ error: "too_many_rows", limit: 500 });
    expect(calls).toHaveLength(0);
  });

  it("imports rows and applies their departments", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/groups": () => jsonResponse({ data: [{ id: 11, code: "dept-rnd", name: "R&D" }] }),
      // The identity server numbers a JSON row by its array position from one, not by
      // the spreadsheet line the file used.
      "/admin/users/bulk": () =>
        jsonResponse({
          data: {
            total: 2,
            created: 1,
            failed: 1,
            invited: 1,
            results: [
              { line: 1, email: "person0@example.test", status: "CREATED", userId: 9001 },
              {
                line: 2,
                email: "bad",
                status: "FAILED",
                error: "이메일 형식이 올바르지 않습니다.",
              },
            ],
          },
        }),
      "POST /admin/groups/11/members": () => new Response(null, { status: 204 }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/users/bulk",
      headers: adminHeaders(session),
      body: {
        csv: "email,name,roles,departments\nperson0@example.test,Person,MEMBER,dept-rnd\nbad,,MEMBER,\n",
      },
    });
    expect(answer.status()).toBe(200);
    const body = JSON.parse(answer.body());
    expect(body.created).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.departmentFailures).toBe(0);
    // Reported back with the spreadsheet's own line numbers, header included.
    expect(body.results.map((row: { line: number }) => row.line)).toEqual([2, 3]);
    expect(body.results[0].departments).toEqual({ granted: ["dept-rnd"], failed: [] });
    const bulkCall = calls.find((call) => call.path === "/admin/users/bulk");
    expect(JSON.parse(bulkCall?.body ?? "{}").users).toHaveLength(2);
    expect(calls.some((call) => call.path === "/admin/groups/11/members")).toBe(true);
  });

  it("connects each person to their own department, in the identity server's numbering", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/groups": () =>
        jsonResponse({
          data: [
            { id: 11, code: "dept-rnd", name: "R&D" },
            { id: 12, code: "dept-qa", name: "QA" },
          ],
        }),
      "/admin/users/bulk": () =>
        jsonResponse({
          data: {
            total: 2,
            created: 2,
            failed: 0,
            invited: 2,
            results: [
              { line: 1, email: "rnd@example.test", status: "CREATED", userId: 9001 },
              { line: 2, email: "qa@example.test", status: "CREATED", userId: 9002 },
            ],
          },
        }),
      "POST /admin/groups/11/members": () => new Response(null, { status: 204 }),
      "POST /admin/groups/12/members": () => new Response(null, { status: 204 }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/users/bulk",
      headers: adminHeaders(session),
      body: {
        csv: "email,departments\nrnd@example.test,dept-rnd\nqa@example.test,dept-qa\n",
      },
    });
    expect(answer.status()).toBe(200);
    const placements = calls
      .filter((call) => call.method === "POST" && call.path.endsWith("/members"))
      .map((call) => ({ path: call.path, userId: JSON.parse(call.body).userId }));
    // The first person goes into R&D and the second into QA: nobody is skipped and nobody
    // inherits the row above.
    expect(placements).toEqual([
      { path: "/admin/groups/11/members", userId: 9001 },
      { path: "/admin/groups/12/members", userId: 9002 },
    ]);
    const body = JSON.parse(answer.body());
    expect(body.departmentFailures).toBe(0);
    expect(body.results[1]).toMatchObject({
      line: 3,
      email: "qa@example.test",
      departments: { granted: ["dept-qa"], failed: [] },
    });
  });

  it("leaves a result alone when its address does not match the row at that position", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/groups": () => jsonResponse({ data: [{ id: 11, code: "dept-rnd", name: "R&D" }] }),
      "/admin/users/bulk": () =>
        jsonResponse({
          data: {
            total: 1,
            created: 1,
            failed: 0,
            invited: 1,
            results: [{ line: 1, email: "someone-else@example.test", status: "CREATED", userId: 9009 }],
          },
        }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/users/bulk",
      headers: adminHeaders(session),
      body: { csv: "email,departments\nrnd@example.test,dept-rnd\n" },
    });
    expect(answer.status()).toBe(200);
    expect(calls.some((call) => call.path.endsWith("/members"))).toBe(false);
  });

  it("refuses a role an ordinary administrator may not grant", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/users/bulk",
      headers: adminHeaders(session),
      body: { csv: "email,roles\nboss@example.test,SUPERADMIN\n" },
    });
    expect(answer.status()).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
