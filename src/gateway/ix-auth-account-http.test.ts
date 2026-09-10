import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { classifyIxAuthHttpPath } from "./ix-auth-http-paths.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { handleIxAuthHttpRequest } from "./ix-auth-http.js";
import { readIxAuthInviteLink, resetIxAuthInviteLinks } from "./ix-auth-invite-links.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret

const SETTINGS = {
  baseUrl: "http://ix-auth:9100",
  jwksUrl: "http://ix-auth:9100/.well-known/jwks.json",
  serviceKey: SERVICE_KEY,
  cookieName: "__Host-openclaw-session",
  roleMap: {},
  superAdminRoles: ["superadmin"],
  departmentClaim: "ixauth_groups",
  departmentGroupPrefix: "dept-",
  selfSignupEnabled: true,
  idleTimeoutMs: 60_000,
  absoluteTimeoutMs: 600_000,
} satisfies IxAuthRuntimeSettings;

type CapturedResponse = {
  res: ServerResponse;
  status: () => number;
  /** Raw bytes written, so two answers can be compared without parsing them. */
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
  pathname?: string;
  headers?: Record<string, string>;
  /** Drop the same-origin hint, as a server-to-server caller would. */
  omitBrowserHints?: boolean;
  body?: unknown;
}): IncomingMessage {
  const payload = params.body === undefined ? undefined : JSON.stringify(params.body);
  const stream = Readable.from(payload === undefined ? [] : [Buffer.from(payload)]);
  return Object.assign(stream, {
    method: params.method ?? "POST",
    url: params.pathname ?? "/auth/signup",
    socket: { destroyed: false, writableEnded: false, remoteAddress: "203.0.113.7" },
    headers: {
      host: "127.0.0.1:18800",
      "content-type": "application/json",
      ...(params.omitBrowserHints ? {} : { "sec-fetch-site": "same-origin" }),
      ...params.headers,
    },
    // SAFETY: only the fields the auth handlers read are needed on this stub request.
  }) as unknown as IncomingMessage;
}

type LimiterCalls = { failures: string[]; resets: string[] };

function buildLimiter(params: {
  allowed?: boolean;
  retryAfterMs?: number;
  calls: LimiterCalls;
}): AuthRateLimiter {
  const limiter = {
    check: () => ({
      allowed: params.allowed ?? true,
      retryAfterMs: params.retryAfterMs ?? 0,
    }),
    recordFailure: (_ip: string | undefined, scope?: string) => {
      params.calls.failures.push(scope ?? "default");
    },
    recordFailureAndDelay: async () => {},
    reset: (_ip: string | undefined, scope?: string) => {
      params.calls.resets.push(scope ?? "default");
    },
    size: () => 0,
    prune: () => {},
    dispose: () => {},
    // SAFETY: the limiter surface the auth routes use is check, recordFailure, and reset.
  } as unknown as AuthRateLimiter;
  return limiter;
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

type UpstreamCall = { url: string; method: string; body: string; headers: Headers };

/** Answer one identity-server call, keyed by the path the relay asked for. */
type UpstreamRoutes = Record<string, () => Response>;

function stubIdentityServer(routes: UpstreamRoutes): UpstreamCall[] {
  const calls: UpstreamCall[] = [];
  vi.stubGlobal("fetch", (url: URL | string, init: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push({
      url: href,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : "",
      headers: new Headers(init.headers),
    });
    const path = new URL(href).pathname;
    const route = routes[path];
    if (!route) {
      throw new Error(`unexpected identity-server call to ${path}`);
    }
    return Promise.resolve(route());
  });
  return calls;
}

function accepted(): Response {
  // The real contract: the identity server accepts every address, known or not.
  return new Response(JSON.stringify({ data: { accepted: true } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function refused(params: { status: number; code: string; message: string }): Response {
  return new Response(JSON.stringify({ error: { code: params.code, message: params.message } }), {
    status: params.status,
    headers: { "content-type": "application/json" },
  });
}

async function callAuth(params: {
  method?: string;
  pathname: string;
  headers?: Record<string, string>;
  omitBrowserHints?: boolean;
  body?: unknown;
  deps?: IxAuthHttpDependencies;
}): Promise<CapturedResponse & { handled: boolean }> {
  const captured = buildResponse();
  const handled = await handleIxAuthHttpRequest({
    req: buildRequest(params),
    res: captured.res,
    pathname: params.pathname,
    deps: params.deps ?? buildDeps(),
  });
  return { ...captured, handled };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetIxAuthInviteLinks();
});

describe("account routes and address enumeration", () => {
  it("answers signup identically for a known and an unknown address", async () => {
    const calls = stubIdentityServer({ "/auth/signup": accepted });
    const known = await callAuth({
      pathname: "/auth/signup",
      body: { email: "registered@example.test", password: "correct horse battery" },
    });
    const unknown = await callAuth({
      pathname: "/auth/signup",
      body: { email: "never-seen@example.test", password: "correct horse battery" },
    });

    // Compared as raw bytes: a difference in key order or an extra field would be an
    // oracle even when the parsed objects still look equal.
    expect(known.status()).toBe(unknown.status());
    expect(known.body()).toBe(unknown.body());
    expect(known.status()).toBe(200);
    expect(known.body()).toBe('{"accepted":true}');
    expect(calls).toHaveLength(2);
  });

  it("answers password recovery identically for a known and an unknown address", async () => {
    stubIdentityServer({ "/auth/password/forgot": accepted });
    const known = await callAuth({
      pathname: "/auth/password/forgot",
      body: { email: "registered@example.test" },
    });
    const unknown = await callAuth({
      pathname: "/auth/password/forgot",
      body: { email: "never-seen@example.test" },
    });
    expect(known.status()).toBe(unknown.status());
    expect(known.body()).toBe(unknown.body());
    expect(known.body()).toBe('{"accepted":true}');
  });
});

describe("signup", () => {
  it("refuses before any relay when self signup is closed", async () => {
    const calls = stubIdentityServer({});
    const answer = await callAuth({
      pathname: "/auth/signup",
      body: { email: "someone@example.test", password: "correct horse battery" },
      deps: buildDeps({ settings: { ...SETTINGS, selfSignupEnabled: false } }),
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toMatchObject({ error: "signup_disabled" });
    expect(calls).toHaveLength(0);
  });

  it("forwards boolean agreements and drops everything else", async () => {
    const calls = stubIdentityServer({ "/auth/signup": accepted });
    await callAuth({
      pathname: "/auth/signup",
      body: {
        email: "someone@example.test",
        password: "correct horse battery",
        name: "Someone",
        agreements: { tos: true, privacy: false, marketing: "yes", version: 3 },
      },
    });
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.agreements).toEqual({ tos: true, privacy: false });
    // The identity server records the version it currently publishes; accepting one
    // from the browser would let a client claim consent to a superseded text.
    expect(calls[0]?.body).not.toContain("version");
    expect(sent.name).toBe("Someone");
  });

  it("omits agreements entirely when none are boolean", async () => {
    const calls = stubIdentityServer({ "/auth/signup": accepted });
    await callAuth({
      pathname: "/auth/signup",
      body: {
        email: "someone@example.test",
        password: "correct horse battery",
        agreements: { tos: "true" },
      },
    });
    expect(JSON.parse(calls[0]?.body ?? "{}").agreements).toBeUndefined();
  });

  it("reports a domain restriction as a rejected signup, not a bad account", async () => {
    stubIdentityServer({
      "/auth/signup": () =>
        refused({
          status: 400,
          code: "VALIDATION_FAILED",
          message: "email domain is not allowed",
        }),
    });
    const answer = await callAuth({
      pathname: "/auth/signup",
      body: { email: "someone@other.test", password: "correct horse battery" },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body())).toEqual({
      error: "signup_rejected",
      message: "email domain is not allowed",
    });
  });

  it("answers 400 for a body with no password", async () => {
    const calls = stubIdentityServer({});
    const answer = await callAuth({
      pathname: "/auth/signup",
      body: { email: "someone@example.test" },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body())).toEqual({ error: "invalid_body" });
    expect(calls).toHaveLength(0);
  });
});

describe("invitation acceptance", () => {
  it("accepts a token the identity server recognizes", async () => {
    const calls = stubIdentityServer({ "/auth/invite/accept": accepted });
    const answer = await callAuth({
      pathname: "/auth/invite/accept",
      body: { token: "invite-token", password: "correct horse battery", name: "New Person" },
    });
    expect(answer.status()).toBe(200);
    expect(answer.body()).toBe('{"accepted":true}');
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      token: "invite-token",
      password: "correct horse battery",
      name: "New Person",
    });
  });

  it("refuses a rejected token and charges the shared per-IP limiter", async () => {
    stubIdentityServer({
      "/auth/invite/accept": () =>
        refused({
          status: 400,
          code: "AUTH_TOKEN_EXPIRED",
          message: "the invitation token has expired",
        }),
    });
    const calls: LimiterCalls = { failures: [], resets: [] };
    const answer = await callAuth({
      pathname: "/auth/invite/accept",
      body: { token: "expired-token", password: "correct horse battery" },
      deps: buildDeps({ rateLimiter: buildLimiter({ calls }) }),
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body())).toMatchObject({ error: "invalid_token" });
    expect(calls.failures).toEqual(["shared-secret"]);
  });

  it("gives one answer to an expired, a reused, and an invented token", async () => {
    const upstream = [
      { code: "AUTH_TOKEN_EXPIRED", message: "the invitation token has expired" },
      { code: "AUTH_TOKEN_USED", message: "the invitation token was already used" },
      { code: "AUTH_TOKEN_INVALID", message: "no such invitation token" },
    ];
    const answers: Array<{ status: number; body: string }> = [];
    for (const failure of upstream) {
      stubIdentityServer({
        "/auth/invite/accept": () => refused({ status: 400, ...failure }),
      });
      const answer = await callAuth({
        pathname: "/auth/invite/accept",
        body: { token: "some-token", password: "correct horse battery" },
      });
      answers.push({ status: answer.status(), body: answer.body() });
      vi.unstubAllGlobals();
    }
    // Telling the three apart would tell a link finder which guess came closest.
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(answers[0]?.status).toBe(400);
  });
});

describe("password reset", () => {
  it("passes the password rule through and leaves the token usable", async () => {
    let attempt = 0;
    const calls = stubIdentityServer({
      "/auth/password/reset": () => {
        attempt += 1;
        return attempt === 1
          ? refused({
              status: 400,
              code: "AUTH_PASSWORD_POLICY",
              message: "password must be at least 12 characters",
            })
          : accepted();
      },
    });
    const weak = await callAuth({
      pathname: "/auth/password/reset",
      body: { token: "reset-token", newPassword: "short" },
    });
    expect(weak.status()).toBe(400);
    expect(JSON.parse(weak.body())).toEqual({
      error: "password_rejected",
      message: "password must be at least 12 characters",
    });

    // The identity server keeps the link alive after a policy refusal, so the Gateway
    // must not remember the token as spent and block the second try.
    const retry = await callAuth({
      pathname: "/auth/password/reset",
      body: { token: "reset-token", newPassword: "correct horse battery" },
    });
    expect(retry.status()).toBe(200);
    expect(retry.body()).toBe('{"accepted":true}');
    expect(JSON.parse(calls[1]?.body ?? "{}").token).toBe("reset-token");
  });
});

describe("email verification", () => {
  it("confirms a valid token", async () => {
    const calls = stubIdentityServer({ "/auth/email/verify": accepted });
    const answer = await callAuth({
      pathname: "/auth/email/verify",
      body: { token: "verify-token" },
    });
    expect(answer.status()).toBe(200);
    expect(answer.body()).toBe('{"accepted":true}');
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ token: "verify-token" });
  });

  it("refuses a token the identity server rejected", async () => {
    stubIdentityServer({
      "/auth/email/verify": () =>
        refused({ status: 400, code: "AUTH_TOKEN_EXPIRED", message: "expired" }),
    });
    const answer = await callAuth({
      pathname: "/auth/email/verify",
      body: { token: "verify-token" },
    });
    expect(answer.status()).toBe(400);
    expect(JSON.parse(answer.body())).toMatchObject({ error: "invalid_token" });
  });
});

describe("method and path gating", () => {
  it("refuses a GET on a route that only accepts POST", async () => {
    const calls = stubIdentityServer({});
    const answer = await callAuth({ method: "GET", pathname: "/auth/signup" });
    expect(answer.status()).toBe(405);
    expect(JSON.parse(answer.body())).toEqual({ error: "method_not_allowed" });
    expect(calls).toHaveLength(0);
  });

  it("answers 404 for a path inside the namespace that names no route", async () => {
    const answer = await callAuth({ method: "GET", pathname: "/auth/signup/confirm" });
    expect(answer.status()).toBe(404);
    expect(JSON.parse(answer.body())).toEqual({ error: "not_found" });
  });
});

describe("origin rule", () => {
  it("refuses a cross-site caller before any relay", async () => {
    const calls = stubIdentityServer({});
    const answer = await callAuth({
      pathname: "/auth/signup",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      body: { email: "someone@example.test", password: "correct horse battery" },
    });
    expect(answer.status()).toBe(403);
    expect(JSON.parse(answer.body())).toEqual({ error: "origin_not_allowed" });
    expect(calls).toHaveLength(0);
  });
});

describe("mail hook", () => {
  it("captures an invitation link with no browser headers at all", async () => {
    const answer = await callAuth({
      pathname: "/auth/mail-hook",
      omitBrowserHints: true,
      headers: { "x-ixauth-key": SERVICE_KEY },
      body: { kind: "INVITE", to: "invitee@example.test", link: "https://gw/invite?token=abc" },
    });
    expect(answer.status()).toBe(204);
    expect(answer.body()).toBe("");
    expect(readIxAuthInviteLink({ email: "invitee@example.test", nowMs: Date.now() })).toBe(
      "https://gw/invite?token=abc",
    );
  });

  it("refuses a wrong service key and captures nothing", async () => {
    const answer = await callAuth({
      pathname: "/auth/mail-hook",
      omitBrowserHints: true,
      headers: { "x-ixauth-key": "not-the-service-key" },
      body: { kind: "INVITE", to: "invitee@example.test", link: "https://gw/invite?token=abc" },
    });
    expect(answer.status()).toBe(401);
    expect(JSON.parse(answer.body())).toEqual({ error: "unauthorized" });
    expect(
      readIxAuthInviteLink({ email: "invitee@example.test", nowMs: Date.now() }),
    ).toBeUndefined();
  });

  it("refuses a missing service key", async () => {
    const answer = await callAuth({
      pathname: "/auth/mail-hook",
      omitBrowserHints: true,
      body: { kind: "INVITE", to: "invitee@example.test", link: "https://gw/invite?token=abc" },
    });
    expect(answer.status()).toBe(401);
    expect(
      readIxAuthInviteLink({ email: "invitee@example.test", nowMs: Date.now() }),
    ).toBeUndefined();
  });

  it.each(["PASSWORD_RESET", "MAGIC_LINK"])("accepts but never retains a %s mail", async (kind) => {
    // Those two links log their holder in; nothing in this product reads one off a screen.
    const answer = await callAuth({
      pathname: "/auth/mail-hook",
      omitBrowserHints: true,
      headers: { "x-ixauth-key": SERVICE_KEY },
      body: { kind, to: "person@example.test", link: "https://gw/reset?token=abc" },
    });
    expect(answer.status()).toBe(204);
    expect(
      readIxAuthInviteLink({ email: "person@example.test", nowMs: Date.now() }),
    ).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After when the limiter denies the address", async () => {
    const calls = stubIdentityServer({});
    const limiterCalls: LimiterCalls = { failures: [], resets: [] };
    const answer = await callAuth({
      pathname: "/auth/signup",
      body: { email: "someone@example.test", password: "correct horse battery" },
      deps: buildDeps({
        rateLimiter: buildLimiter({ allowed: false, retryAfterMs: 4_200, calls: limiterCalls }),
      }),
    });
    expect(answer.status()).toBe(429);
    expect(answer.headers["retry-after"]).toBe("5");
    expect(JSON.parse(answer.body())).toEqual({ error: "rate_limited", retryAfterMs: 4_200 });
    expect(calls).toHaveLength(0);
  });
});

describe("paths outside the auth namespace", () => {
  it.each(["/", "/health", "/authorize", "/admin/identity/", "/api/auth/login"])(
    "classifies %s as outside",
    (pathname) => {
      expect(classifyIxAuthHttpPath(pathname)).toBe("outside");
    },
  );

  it("falls through so a later stage answers", async () => {
    const captured = buildResponse();
    const handled = await handleIxAuthHttpRequest({
      req: buildRequest({ method: "GET", pathname: "/health" }),
      res: captured.res,
      pathname: "/health",
      deps: buildDeps(),
    });
    expect(handled).toBe(false);
    expect(captured.status()).toBe(0);
    expect(captured.body()).toBe("");
    expect(captured.headers["cache-control"]).toBeUndefined();
  });
});
