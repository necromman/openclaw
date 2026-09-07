import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IxAuthPrincipal, IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import {
  handleIxAuthAdminProxyRequest,
  rewriteIxAuthAdminProxyLocation,
  type IxAuthAdminProxyDependencies,
} from "./ix-auth-admin-proxy.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret
const CSRF_TOKEN = "csrf-token-value";

/** Mirrors the private digest the session store keeps, so the check runs for real. */
function digestSecretToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

const SETTINGS = {
  baseUrl: "http://ix-auth:9100",
  jwksUrl: "http://ix-auth:9100/.well-known/jwks.json",
  serviceKey: SERVICE_KEY,
  cookieName: "__Host-openclaw-session",
  roleMap: {},
  superAdminRoles: ["superadmin"],
  departmentClaim: "ixauth_groups",
  departmentGroupPrefix: "dept-",
  idleTimeoutMs: 60_000,
  absoluteTimeoutMs: 600_000,
} satisfies IxAuthRuntimeSettings;

function buildPrincipal(gatewayRole: string | undefined): IxAuthPrincipal {
  return {
    kind: "ix-auth",
    loginSessionId: "session-1",
    profileId: "profile-1",
    claims: {
      subject: "42",
      email: "person@example.test",
      displayName: "Person",
      roles: [],
      groups: [],
      identitySessionId: "identity-session-1",
      expiresAtMs: Date.now() + 900_000,
    },
    ...(gatewayRole === undefined ? {} : { gatewayRole }),
    departments: [],
    isSuperAdmin: gatewayRole === "superadmin",
  };
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
  } as unknown as ServerResponse;
  return { res, status: () => res.statusCode, body: () => body, headers };
}

function buildRequest(params: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const stream = Readable.from(params.body === undefined ? [] : [Buffer.from(params.body)]);
  return Object.assign(stream, {
    method: params.method ?? "GET",
    url: params.url ?? "/admin/identity/",
    headers: {
      host: "127.0.0.1:18800",
      "sec-fetch-site": "same-origin",
      ...params.headers,
    },
  }) as unknown as IncomingMessage;
}

function buildDeps(overrides?: Partial<IxAuthAdminProxyDependencies>): IxAuthAdminProxyDependencies {
  return {
    settings: SETTINGS,
    principal: buildPrincipal("admin"),
    csrfDigest: digestSecretToken(CSRF_TOKEN),
    isLocalClient: true,
    clientIp: "203.0.113.7",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubUpstream(response: Response): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  });
  return { calls };
}

describe("handleIxAuthAdminProxyRequest", () => {
  it("refuses a member session and never reaches the identity server", async () => {
    const { calls } = stubUpstream(new Response("should not be requested"));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({}),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps({ principal: buildPrincipal("member") }),
    });
    expect(captured.status()).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a browser with no session", async () => {
    const { calls } = stubUpstream(new Response("should not be requested"));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({}),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps({ principal: undefined, csrfDigest: undefined }),
    });
    expect(captured.status()).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a cross-site request even from an administrator", async () => {
    const { calls } = stubUpstream(new Response("should not be requested"));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({ headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps(),
    });
    expect(captured.status()).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("answers a path inside the namespace that names no upstream route", async () => {
    const { calls } = stubUpstream(new Response("should not be requested"));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({ url: "/admin/identity/health" }),
      res: captured.res,
      pathname: "/admin/identity/health",
      deps: buildDeps(),
    });
    expect(captured.status()).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("serves the console page and rebuilds the upstream headers", async () => {
    const { calls } = stubUpstream(
      new Response("<!doctype html>console", {
        status: 200,
        headers: { "content-type": "text/html", "set-cookie": "JSESSIONID=abc", etag: "W/'1'" },
      }),
    );
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({
        headers: {
          accept: "text/html",
          cookie: "__Host-openclaw-session=secret",
          connection: "keep-alive",
          "x-forwarded-for": "198.51.100.9",
        },
      }),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps(),
    });

    expect(captured.status()).toBe(200);
    expect(captured.body()).toContain("console");
    expect(calls).toHaveLength(1);
    const sent = new Headers(calls[0]?.init.headers);
    expect(calls[0]?.url).toBe("http://ix-auth:9100/admin-ui");
    // The service key is injected, and nothing the browser controls survives.
    expect(sent.get("x-ixauth-key")).toBe(SERVICE_KEY);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("connection")).toBeNull();
    // Attribution is the Gateway's resolved visitor IP, not the header the browser sent.
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
    // A session cookie from upstream would collide with the Gateway's own.
    expect(captured.headers["set-cookie"]).toBeUndefined();
    expect(captured.headers.etag).toBeUndefined();
    expect(captured.headers["cache-control"]).toBe("no-store");
    expect(captured.headers["x-frame-options"]).toBe("DENY");
  });

  it("carries the query string onto the upstream management API", async () => {
    const { calls } = stubUpstream(new Response("csv", { status: 200 }));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({
        url: "/admin/identity/admin/audit-logs/export?from=2026-01-01",
        headers: { authorization: "Bearer console-token" },
      }),
      res: captured.res,
      pathname: "/admin/identity/admin/audit-logs/export",
      deps: buildDeps(),
    });
    expect(calls[0]?.url).toBe("http://ix-auth:9100/admin/audit-logs/export?from=2026-01-01");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer console-token");
  });

  it("requires the session CSRF token on a write", async () => {
    const { calls } = stubUpstream(new Response("{}", { status: 200 }));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({
        method: "POST",
        url: "/admin/identity/admin/users",
        headers: { origin: "http://127.0.0.1:18800", "content-type": "application/json" },
        body: '{"email":"new@example.test"}',
      }),
      res: captured.res,
      pathname: "/admin/identity/admin/users",
      deps: buildDeps(),
    });
    expect(captured.status()).toBe(403);
    expect(captured.body()).toContain("csrf_mismatch");
    expect(calls).toHaveLength(0);
  });

  it("forwards a write that carries the session CSRF token", async () => {
    const { calls } = stubUpstream(new Response('{"data":{}}', { status: 201 }));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({
        method: "POST",
        url: "/admin/identity/admin/users",
        headers: {
          origin: "http://127.0.0.1:18800",
          "content-type": "application/json",
          "x-openclaw-csrf": CSRF_TOKEN,
        },
        body: '{"email":"new@example.test"}',
      }),
      res: captured.res,
      pathname: "/admin/identity/admin/users",
      deps: buildDeps(),
    });
    expect(captured.status()).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("answers 503 when the identity server cannot be reached", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("connect ECONNREFUSED")));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({}),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps(),
    });
    expect(captured.status()).toBe(503);
  });
});

describe("rewriteIxAuthAdminProxyLocation", () => {
  it.each([
    ["/admin-ui", "/admin/identity/"],
    ["/admin-ui/", "/admin/identity/"],
    ["/admin-ui/api/login", "/admin/identity/api/login"],
    ["/admin/users", "/admin/identity/admin/users"],
  ])("rewrites %s onto %s", (location, expected) => {
    expect(rewriteIxAuthAdminProxyLocation(location)).toBe(expected);
  });

  it.each(["https://ix-auth.internal/admin-ui", "//evil.example/admin-ui", "/health"])(
    "refuses to send the browser to %s",
    (location) => {
      // The identity server has no public address, so any target it names outside the
      // proxied namespace is a place the browser must not follow.
      expect(rewriteIxAuthAdminProxyLocation(location)).toBeUndefined();
    },
  );
});
