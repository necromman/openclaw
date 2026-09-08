import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetIxAuthJwksCache } from "../auth/ix-auth/ix-auth-jwks.js";
import { IX_AUTH_DEFAULT_ROLE_MAP } from "../auth/ix-auth/ix-auth-role-map.js";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import {
  listDepartments,
  readDepartmentAgentBindings,
  setDepartmentAgent,
  upsertDepartment,
} from "../state/departments-store.js";
import { insertIxAuthLoginSession } from "../state/ix-auth-sessions-store.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { handleIxAuthHttpRequest, type IxAuthHttpDependencies } from "./ix-auth-http.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret
const CSRF_TOKEN = "csrf-token-value";
const SIGNING_KEY_ID = "ix-auth-departments-test-key";

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

function groupListing(): Response {
  return jsonResponse({
    data: [
      { id: 7, code: "dept-rnd", name: "R and D" },
      { id: 8, code: "staff-all", name: "Everyone" },
    ],
  });
}

async function call(params: {
  method: string;
  cookie: string;
  body?: unknown;
}): Promise<CapturedResponse> {
  const captured = buildResponse();
  await handleIxAuthHttpRequest({
    req: buildRequest({ ...params, pathname: "/auth/admin/departments" }),
    res: captured.res,
    pathname: "/auth/admin/departments",
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
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("openclaw-ix-auth-departments-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

describe("GET /auth/admin/departments", () => {
  it("returns only prefixed groups, with the local projection attached", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertDepartment({ slug: "rnd", displayName: "Research", nowMs: Date.now() });
    setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "rnd", nowMs: Date.now() });
    stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({ method: "GET", cookie });
    expect(answer.status()).toBe(200);
    const parsed = JSON.parse(answer.body());
    expect(parsed.prefix).toBe("dept-");
    expect(parsed.departments).toEqual([
      {
        code: "dept-rnd",
        slug: "rnd",
        // The operator-authored name wins over the identity server's group name.
        name: "Research",
        identityName: "R and D",
        memberCount: 0,
        agents: ["rnd-bot"],
      },
    ]);
    expect(parsed.orphans).toEqual([]);
  });

  it("reports a department the identity server no longer lists", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertDepartment({ slug: "legacy", displayName: "Old Team", nowMs: Date.now() });
    stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({ method: "GET", cookie });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body()).orphans).toEqual([
      { slug: "legacy", name: "Old Team", memberCount: 0, agents: [] },
    ]);
  });

  it("refuses a member session", async () => {
    const cookie = seedSession(["MEMBER"]);
    const calls = stubIdentityServer({});
    const answer = await call({ method: "GET", cookie });
    expect(answer.status()).toBe(403);
    expect(calls.filter((entry) => entry.path === "/admin/groups")).toHaveLength(0);
  });
});

describe("POST /auth/admin/departments", () => {
  it("creates the prefixed group and records it locally", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    const calls = stubIdentityServer({
      "GET /admin/groups": groupListing,
      "POST /admin/groups": () => jsonResponse({ data: { id: 11, code: "dept-qa" } }),
    });
    const answer = await call({
      method: "POST",
      cookie,
      body: { slug: "QA", name: "Quality" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({ code: "dept-qa", slug: "qa", name: "Quality" });
    const created = calls.find((entry) => entry.method === "POST");
    expect(JSON.parse(created?.body ?? "{}")).toEqual({ code: "dept-qa", name: "Quality" });
    expect(listDepartments().map((row) => [row.slug, row.display_name])).toEqual([
      ["qa", "Quality"],
    ]);
  });

  it("refuses a slug that is not a department code", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    const calls = stubIdentityServer({});
    const answer = await call({
      method: "POST",
      cookie,
      body: { slug: "../etc", name: "Nope" },
    });
    expect(answer.status()).toBe(400);
    expect(calls.filter((entry) => entry.method === "POST")).toHaveLength(0);
  });

  it("refuses an ordinary administrator", async () => {
    const cookie = seedSession(["ADMIN"]);
    const calls = stubIdentityServer({});
    const answer = await call({
      method: "POST",
      cookie,
      body: { slug: "qa", name: "Quality" },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "forbidden" });
    expect(calls.filter((entry) => entry.path === "/admin/groups")).toHaveLength(0);
  });

  it("refuses a department that already exists", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({
      method: "POST",
      cookie,
      body: { slug: "rnd", name: "Again" },
    });
    expect(answer.status()).toBe(409);
  });
});

describe("PATCH /auth/admin/departments", () => {
  it("renames the local display name and leaves the group code alone", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({
      method: "PATCH",
      cookie,
      body: { slug: "rnd", name: "Research and Development" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({
      slug: "rnd",
      name: "Research and Development",
    });
    expect(listDepartments().map((row) => [row.slug, row.display_name])).toEqual([
      ["rnd", "Research and Development"],
    ]);
  });

  it("refuses an ordinary administrator", async () => {
    const cookie = seedSession(["ADMIN"]);
    stubIdentityServer({});
    const answer = await call({
      method: "PATCH",
      cookie,
      body: { slug: "rnd", name: "Renamed" },
    });
    expect(answer.status()).toBe(403);
    expect(listDepartments()).toEqual([]);
  });

  it("refuses a department the identity server does not list", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({
      method: "PATCH",
      cookie,
      body: { slug: "ghost", name: "Nowhere" },
    });
    expect(answer.status()).toBe(404);
  });
});

describe("DELETE /auth/admin/departments", () => {
  it("removes the group and everything the projection held for it", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertDepartment({ slug: "rnd", displayName: "Research", nowMs: Date.now() });
    setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "rnd", nowMs: Date.now() });
    const calls = stubIdentityServer({
      "GET /admin/groups": groupListing,
      "GET /admin/groups/7/members": () => jsonResponse({ data: [] }),
      "DELETE /admin/groups/7": () => jsonResponse({ data: {} }),
    });
    const answer = await call({ method: "DELETE", cookie, body: { slug: "rnd" } });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({ slug: "rnd", unboundAgents: ["rnd-bot"] });
    expect(listDepartments()).toEqual([]);
    expect(readDepartmentAgentBindings().has("rnd-bot")).toBe(false);
    expect(calls.some((entry) => entry.method === "DELETE" && entry.path === "/admin/groups/7")).toBe(
      true,
    );
  });

  it("refuses while the identity server still holds members, and deletes nothing", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertDepartment({ slug: "rnd", displayName: "Research", nowMs: Date.now() });
    const calls = stubIdentityServer({
      "GET /admin/groups": groupListing,
      "GET /admin/groups/7/members": () => jsonResponse({ data: [{ id: 3 }] }),
    });
    const answer = await call({ method: "DELETE", cookie, body: { slug: "rnd" } });
    expect(answer.status()).toBe(409);
    expect(JSON.parse(answer.body())).toEqual({
      error: "department_has_members",
      memberCount: 1,
    });
    expect(listDepartments().map((row) => row.slug)).toEqual(["rnd"]);
    expect(calls.some((entry) => entry.method === "DELETE")).toBe(false);
  });

  it("clears an orphan row without calling the identity server for a delete", async () => {
    const cookie = seedSession(["SUPERADMIN"]);
    upsertDepartment({ slug: "legacy", displayName: "Old Team", nowMs: Date.now() });
    const calls = stubIdentityServer({ "GET /admin/groups": groupListing });
    const answer = await call({ method: "DELETE", cookie, body: { slug: "legacy" } });
    expect(answer.status()).toBe(200);
    expect(listDepartments()).toEqual([]);
    expect(calls.some((entry) => entry.method === "DELETE")).toBe(false);
  });

  it("refuses an ordinary administrator", async () => {
    const cookie = seedSession(["ADMIN"]);
    upsertDepartment({ slug: "rnd", displayName: "Research", nowMs: Date.now() });
    stubIdentityServer({});
    const answer = await call({ method: "DELETE", cookie, body: { slug: "rnd" } });
    expect(answer.status()).toBe(403);
    expect(listDepartments().map((row) => row.slug)).toEqual(["rnd"]);
  });
});
