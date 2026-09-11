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
import { captureIxAuthInviteLink, resetIxAuthInviteLinks } from "./ix-auth-invite-links.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret
const CSRF_TOKEN = "csrf-token-value";
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

type SeededSession = { cookie: string; accessToken: string };

/**
 * Write a real login session row and return the cookie that resolves it.
 *
 * The row, the CSRF digest, the role mapping, and the JWT signature are all genuine, so
 * only the identity server's HTTP surface is simulated.
 */
function seedSession(params: { roles: string[]; sessionToken: string }): SeededSession {
  const nowMs = Date.now();
  const accessToken = signAccessToken({
    sub: "1042",
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
    identity_subject: "1042",
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
  return { cookie: `${SETTINGS.cookieName}=${params.sessionToken}`, accessToken };
}

type CapturedResponse = {
  res: ServerResponse;
  status: () => number;
  body: () => string;
  headers: Record<string, string>;
};

function buildResponse(): CapturedResponse {
  const headers: Record<string, string> = {};
  let body = "";
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        body = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    },
    // SAFETY: the handlers under test touch only statusCode, setHeader, and end.
  } as unknown as ServerResponse;
  return { res, status: () => res.statusCode, body: () => body, headers };
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

type UpstreamCall = { path: string; method: string; body: string; headers: Headers };

/** Answer one identity-server call, keyed by the path the relay asked for. */
type UpstreamRoutes = Record<string, (call: UpstreamCall) => Response>;

function stubIdentityServer(routes: UpstreamRoutes): UpstreamCall[] {
  const calls: UpstreamCall[] = [];
  vi.stubGlobal("fetch", (url: URL | string, init: RequestInit | undefined) => {
    const href = typeof url === "string" ? url : url.toString();
    const call: UpstreamCall = {
      path: new URL(href).pathname,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    if (call.path === "/.well-known/jwks.json") {
      return Promise.resolve(jwksDocument());
    }
    const route = routes[call.path];
    if (!route) {
      throw new Error(`unexpected identity-server call to ${call.path}`);
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
    pathname: params.pathname,
    deps: params.deps ?? buildDeps(),
  });
  return captured;
}

/** Cookie plus CSRF header, the pair a signed-in administrator's browser sends. */
function adminHeaders(session: SeededSession, extra?: Record<string, string>) {
  return { cookie: session.cookie, "x-openclaw-csrf": CSRF_TOKEN, ...extra };
}

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("openclaw-ix-auth-admin-http-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIxAuthInviteLinks();
  resetIxAuthJwksCache();
  closeOpenClawStateDatabaseForTest();
});

/** Every administration route, with the method its dispatcher accepts. */
const ADMIN_ROUTES: ReadonlyArray<{ method: string; pathname: string }> = [
  { method: "GET", pathname: "/auth/admin/invites" },
  { method: "POST", pathname: "/auth/admin/invites" },
  { method: "GET", pathname: "/auth/admin/signup-approvals" },
  { method: "POST", pathname: "/auth/admin/signup-approvals" },
  { method: "GET", pathname: "/auth/admin/departments" },
];

describe("administration route admission", () => {
  it.each(ADMIN_ROUTES)("refuses $method $pathname with no session", async (route) => {
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: route.method,
      pathname: route.pathname,
      headers: { "x-openclaw-csrf": CSRF_TOKEN },
      body: route.method === "POST" ? { email: "invitee@example.test" } : undefined,
    });
    expect(answer.status()).toBe(401);
    expect(JSON.parse(answer.body())).toEqual({ error: "unauthenticated" });
    expect(calls).toHaveLength(0);
  });

  it.each(ADMIN_ROUTES)("refuses $method $pathname for a member session", async (route) => {
    const session = seedSession({ roles: ["MEMBER"], sessionToken: "member-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: route.method,
      pathname: route.pathname,
      headers: adminHeaders(session),
      body: route.method === "POST" ? { email: "invitee@example.test" } : undefined,
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "forbidden" });
    // Only the JWKS document is fetched; nothing reaches the management API.
    expect(calls.every((call) => call.path === "/.well-known/jwks.json")).toBe(true);
  });

  it("refuses a session cookie that names no row", async () => {
    seedSession({ roles: ["ADMIN"], sessionToken: "real-session" });
    stubIdentityServer({});
    const answer = await callAdmin({
      pathname: "/auth/admin/invites",
      headers: { cookie: `${SETTINGS.cookieName}=not-the-real-token` },
    });
    expect(answer.status()).toBe(401);
  });
});

describe("administration CSRF", () => {
  it.each([
    { name: "a missing", header: undefined },
    { name: "a forged", header: "some-other-token" },
  ])("refuses a POST carrying $name CSRF token", async ({ header }) => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers:
        header === undefined
          ? { cookie: session.cookie }
          : { cookie: session.cookie, "x-openclaw-csrf": header },
      body: { email: "invitee@example.test" },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "csrf_mismatch" });
    expect(calls.every((call) => call.path === "/.well-known/jwks.json")).toBe(true);
  });

  it("refuses a DELETE carrying no CSRF token", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({});
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const answer = await callAdmin({
      method: "DELETE",
      pathname: "/auth/admin/invites",
      headers: { cookie: session.cookie },
      body: { email: "invitee@example.test" },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "csrf_mismatch" });
  });

  it("serves a GET with no CSRF token at all", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({});
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const answer = await callAdmin({
      pathname: "/auth/admin/invites",
      headers: { cookie: session.cookie },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body()).invites).toMatchObject([
      { email: "invitee@example.test", link: "https://gw/invite?token=abc" },
    ]);
  });

  it("forgets one captured link on a DELETE that carries the token", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({});
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const answer = await callAdmin({
      method: "DELETE",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({ forgotten: true });
  });
});

describe("issuing an invitation", () => {
  it("creates a pending account as the administrator, with no password", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 42 } }, 201),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test", role: "moderator" },
    });

    expect(answer.status()).toBe(200);
    const created = calls.find((call) => call.path === "/admin/users");
    expect(created?.method).toBe("POST");
    const sent = JSON.parse(created?.body ?? "{}");
    expect(sent).toMatchObject({
      email: "invitee@example.test",
      roles: ["MODERATOR"],
      invite: true,
    });
    // An invitation without a password is what makes it an invitation: no administrator
    // ever knows or hands over one.
    expect(Object.hasOwn(sent, "password")).toBe(false);
    // The administrator's own token, not the service key: the identity server re-checks
    // the permission and names the real actor in its ledger.
    expect(created?.headers.get("authorization")).toBe(`Bearer ${session.accessToken}`);
    expect(JSON.parse(answer.body())).toMatchObject({
      email: "invitee@example.test",
      userId: "42",
      inviteLink: "https://gw/invite?token=abc",
    });
  });

  it("defaults to the member role and derives a placeholder name", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 42 } }, 201),
    });
    await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test" },
    });
    const sent = JSON.parse(calls.find((call) => call.path === "/admin/users")?.body ?? "{}");
    expect(sent.roles).toEqual(["MEMBER"]);
    expect(sent.name).toBe("invitee");
  });

  it("omits the link when the identity server mailed the invitation itself", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({ "/admin/users": () => jsonResponse({ data: { id: 42 } }, 201) });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "mailed@example.test" },
    });
    expect(answer.status()).toBe(200);
    const payload = JSON.parse(answer.body());
    // Its absence is the signal that the invitation actually went out by mail.
    expect(Object.hasOwn(payload, "inviteLink")).toBe(false);
  });

  it("refuses a super-admin invitation from an ordinary administrator", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test", role: "SUPERADMIN" },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "forbidden" });
    expect(calls.some((call) => call.path === "/admin/users")).toBe(false);
  });

  it("lets a super-admin session invite a super-admin", async () => {
    const session = seedSession({ roles: ["SUPERADMIN"], sessionToken: "super-session" });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 43 } }, 201),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test", role: "SUPERADMIN" },
    });
    expect(answer.status()).toBe(200);
    expect(
      JSON.parse(calls.find((call) => call.path === "/admin/users")?.body ?? "{}").roles,
    ).toEqual(["SUPERADMIN"]);
  });

  it("refuses a role code the identity server does not define", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test", role: "OWNER" },
    });
    expect(answer.status()).toBe(403);
    expect(calls.some((call) => call.path === "/admin/users")).toBe(false);
  });

  it("answers 400 for an invitation with no address", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { role: "MEMBER" },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body())).toEqual({ error: "invalid_body" });
  });
});

describe("granting a department with an invitation", () => {
  it("puts the invited account into the matching group", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 42 } }, 201),
      "/admin/groups": () =>
        jsonResponse({ data: [{ id: 7, code: "dept-rnd", name: "Research" }] }),
      "/admin/groups/7/members": () => jsonResponse({ data: { added: true } }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test", department: "dept-rnd" },
    });

    expect(answer.status()).toBe(200);
    const membership = calls.find((call) => call.path === "/admin/groups/7/members");
    expect(membership?.method).toBe("POST");
    // The identity server keys group membership by numeric id.
    expect(JSON.parse(membership?.body ?? "{}")).toEqual({ userId: 42 });
    expect(JSON.parse(answer.body())).toMatchObject({
      department: "dept-rnd",
      departmentFailed: false,
    });
  });

  it("still invites when the department code does not exist", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 42 } }, 201),
      "/admin/groups": () =>
        jsonResponse({ data: [{ id: 7, code: "dept-rnd", name: "Research" }] }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "invitee@example.test", department: "dept-nowhere" },
    });

    expect(answer.status()).toBe(200);
    // The account exists either way; losing the invitation over a bad code would be worse.
    expect(JSON.parse(answer.body())).toMatchObject({
      userId: "42",
      departmentFailed: true,
    });
    expect(Object.hasOwn(JSON.parse(answer.body()), "department")).toBe(false);
    expect(calls.some((call) => call.path.endsWith("/members"))).toBe(false);
  });
});

describe("inviting an executive", () => {
  it("grants the role and fills in every department when none was named", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    captureIxAuthInviteLink({
      email: "chief@example.test",
      link: "https://gw/invite?token=abc",
      nowMs: Date.now(),
    });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 51 } }, 201),
      "/admin/groups": () =>
        jsonResponse({
          data: [
            { id: 7, code: "dept-rnd", name: "Research" },
            { id: 8, code: "dept-qa", name: "Quality" },
            // Not a department: an executive must not be swept into ordinary groups.
            { id: 9, code: "on-call", name: "On call" },
          ],
        }),
      "/admin/groups/7/members": () => jsonResponse({ data: { added: true } }),
      "/admin/groups/8/members": () => jsonResponse({ data: { added: true } }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "chief@example.test", role: "EXECUTIVE", departments: [] },
    });

    expect(answer.status()).toBe(200);
    expect(
      JSON.parse(calls.find((call) => call.path === "/admin/users")?.body ?? "{}").roles,
    ).toEqual(["EXECUTIVE"]);
    // The list comes from the identity server, never from the request body, so an empty
    // post cannot be talked into placing somebody nowhere or somewhere invented.
    expect(JSON.parse(answer.body())).toMatchObject({
      departments: ["dept-rnd", "dept-qa"],
      departmentFailed: false,
    });
    expect(calls.some((call) => call.path === "/admin/groups/9/members")).toBe(false);
  });

  it("obeys a narrowed list instead of widening it back to everything", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 52 } }, 201),
      "/admin/groups": () =>
        jsonResponse({
          data: [
            { id: 7, code: "dept-rnd", name: "Research" },
            { id: 8, code: "dept-qa", name: "Quality" },
          ],
        }),
      "/admin/groups/8/members": () => jsonResponse({ data: { added: true } }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "chief@example.test", role: "EXECUTIVE", departments: ["dept-qa"] },
    });

    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({ departments: ["dept-qa"] });
    expect(calls.some((call) => call.path === "/admin/groups/7/members")).toBe(false);
  });

  it("leaves an ordinary invitation with no department when none was named", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 53 } }, 201),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "staff@example.test", role: "MEMBER", departments: [] },
    });

    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({ departments: [], departmentFailed: false });
    // Filling in every department is the executive rule alone, so nothing is even listed.
    expect(calls.some((call) => call.path === "/admin/groups")).toBe(false);
  });
});

describe("granting several departments at once", () => {
  it("places one account into each department it was invited into", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 61 } }, 201),
      "/admin/groups": () =>
        jsonResponse({
          data: [
            { id: 7, code: "dept-rnd", name: "Research" },
            { id: 8, code: "dept-qa", name: "Quality" },
          ],
        }),
      "/admin/groups/7/members": () => jsonResponse({ data: { added: true } }),
      "/admin/groups/8/members": () => jsonResponse({ data: { added: true } }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "liaison@example.test", departments: ["dept-rnd", "dept-qa"] },
    });

    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({
      departments: ["dept-rnd", "dept-qa"],
      // The single field stays beside the list for a screen that only reads one.
      department: "dept-rnd",
      departmentFailed: false,
    });
    // One listing call covers every placement rather than one per department.
    expect(calls.filter((call) => call.path === "/admin/groups")).toHaveLength(1);
  });

  it("keeps the departments that exist and reports the one that does not", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 62 } }, 201),
      "/admin/groups": () =>
        jsonResponse({ data: [{ id: 7, code: "dept-rnd", name: "Research" }] }),
      "/admin/groups/7/members": () => jsonResponse({ data: { added: true } }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "liaison@example.test", departments: ["dept-rnd", "dept-nowhere"] },
    });

    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({
      departments: ["dept-rnd"],
      departmentFailed: true,
    });
  });

  it("refuses to place an invitation into a group that is not a department", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 63 } }, 201),
      "/admin/groups": () => jsonResponse({ data: [{ id: 9, code: "on-call", name: "On call" }] }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "liaison@example.test", departments: ["on-call"] },
    });

    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({ departments: [], departmentFailed: true });
    expect(calls.some((call) => call.path.endsWith("/members"))).toBe(false);
  });

  it("still reads the older single-value field on its own", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      "/admin/users": () => jsonResponse({ data: { id: 64 } }, 201),
      "/admin/groups": () =>
        jsonResponse({ data: [{ id: 7, code: "dept-rnd", name: "Research" }] }),
      "/admin/groups/7/members": () => jsonResponse({ data: { added: true } }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/invites",
      headers: adminHeaders(session),
      body: { email: "liaison@example.test", department: "dept-rnd" },
    });

    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({
      departments: ["dept-rnd"],
      department: "dept-rnd",
    });
  });
});

describe("signup approvals", () => {
  it("maps the waiting accounts onto the shape the screen reads", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      "/admin/signup-approvals": () =>
        jsonResponse({
          data: [
            { id: 7, email: "waiting@example.test", name: "Waiting", emailVerified: true },
            { userId: "8", email: "second@example.test", emailVerified: false },
            { email: "no-id@example.test" },
          ],
        }),
    });
    const answer = await callAdmin({
      pathname: "/auth/admin/signup-approvals",
      headers: { cookie: session.cookie },
    });

    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toEqual({
      pending: [
        { userId: "7", email: "waiting@example.test", name: "Waiting", emailVerified: true },
        // The name falls back to the address, and an entry with no id is dropped.
        {
          userId: "8",
          email: "second@example.test",
          name: "second@example.test",
          emailVerified: false,
        },
      ],
    });
  });

  it("approves one account", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/signup-approvals/7/approve": () => jsonResponse({ data: {} }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/signup-approvals",
      headers: adminHeaders(session),
      body: { userId: "7", decision: "approve" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({ userId: "7", decision: "approve" });
    const approved = calls.find((call) => call.path === "/admin/signup-approvals/7/approve");
    expect(approved?.method).toBe("POST");
    expect(approved?.headers.get("authorization")).toBe(`Bearer ${session.accessToken}`);
  });

  it("carries the reason onto a rejection", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({
      "/admin/signup-approvals/7/reject": () => jsonResponse({ data: {} }),
    });
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/signup-approvals",
      headers: adminHeaders(session),
      body: { userId: "7", decision: "reject", reason: "not a colleague" },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.parse(answer.body())).toMatchObject({ decision: "reject" });
    const rejected = calls.find((call) => call.path === "/admin/signup-approvals/7/reject");
    expect(JSON.parse(rejected?.body ?? "{}")).toEqual({ reason: "not a colleague" });
  });

  it("refuses a decision it does not know", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    const calls = stubIdentityServer({});
    const answer = await callAdmin({
      method: "POST",
      pathname: "/auth/admin/signup-approvals",
      headers: adminHeaders(session),
      body: { userId: "7", decision: "maybe" },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body())).toEqual({ error: "invalid_body" });
    expect(calls.some((call) => call.path.startsWith("/admin/signup-approvals"))).toBe(false);
  });
});

describe("department listing", () => {
  it("returns only the groups carrying the configured prefix", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      "/admin/groups": () =>
        jsonResponse({
          data: [
            { id: 7, code: "dept-rnd", name: "Research" },
            { id: 8, code: "dept-sales", name: "Sales" },
            { id: 9, code: "ops-oncall", name: "On call" },
            { id: 10, name: "unnamed group" },
          ],
        }),
    });
    const answer = await callAdmin({
      pathname: "/auth/admin/departments",
      headers: { cookie: session.cookie },
    });
    expect(answer.status()).toBe(200);
    // The listing carries the fork's own projection alongside each group. The two
    // decorated fields are zero here because nothing has signed in or been bound, and
    // with no directory stubbed the counts fall back to the sign-in projection and say so.
    expect(JSON.parse(answer.body())).toEqual({
      prefix: "dept-",
      memberCountSource: "projection",
      departments: [
        {
          code: "dept-rnd",
          slug: "rnd",
          name: "Research",
          identityName: "Research",
          memberCount: 0,
          agents: [],
        },
        {
          code: "dept-sales",
          slug: "sales",
          name: "Sales",
          identityName: "Sales",
          memberCount: 0,
          agents: [],
        },
      ],
      orphans: [],
    });
  });

  it("reports the identity server's refusal as forbidden, not as its own wording", async () => {
    const session = seedSession({ roles: ["ADMIN"], sessionToken: "admin-session" });
    stubIdentityServer({
      "/admin/groups": () =>
        jsonResponse(
          { error: { code: "AUTHZ_FORBIDDEN", message: "missing ixauth:groups:read" } },
          403,
        ),
    });
    const answer = await callAdmin({
      pathname: "/auth/admin/departments",
      headers: { cookie: session.cookie },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "forbidden" });
  });
});
