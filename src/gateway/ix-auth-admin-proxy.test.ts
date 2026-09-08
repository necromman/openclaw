import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IxAuthPrincipal, IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import {
  handleIxAuthAdminProxyRequest,
  injectIxAuthAdminConsoleBootstrap,
  rewriteIxAuthAdminProxyLocation,
  type IxAuthAdminProxyDependencies,
} from "./ix-auth-admin-proxy.js";

const SERVICE_KEY = "service-key-that-is-long-enough-000000"; // pragma: allowlist secret
const CSRF_TOKEN = "csrf-token-value";
const SESSION_ACCESS_TOKEN = "session-access-token-value"; // pragma: allowlist secret

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
  selfSignupEnabled: false,
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
      roles: gatewayRole === undefined ? [] : [gatewayRole.toUpperCase()],
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

function buildDeps(
  overrides?: Partial<IxAuthAdminProxyDependencies>,
): IxAuthAdminProxyDependencies {
  return {
    settings: SETTINGS,
    principal: buildPrincipal("superadmin"),
    csrfDigest: digestSecretToken(CSRF_TOKEN),
    accessToken: SESSION_ACCESS_TOKEN,
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
      req: buildRequest({
        headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      }),
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
    // The browser named its own bearer token; the session's token went upstream instead.
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${SESSION_ACCESS_TOKEN}`,
    );
  });

  it("refuses an administrator, who keeps the fork's own screens instead", async () => {
    const { calls } = stubUpstream(new Response("should not be requested"));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({}),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps({ principal: buildPrincipal("admin") }),
    });
    expect(captured.status()).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it.each(["executive", "moderator", "member", undefined])(
    "refuses the %s role outright",
    async (role) => {
      const { calls } = stubUpstream(new Response("should not be requested"));
      const captured = buildResponse();
      await handleIxAuthAdminProxyRequest({
        req: buildRequest({}),
        res: captured.res,
        pathname: "/admin/identity/",
        deps: buildDeps({ principal: buildPrincipal(role) }),
      });
      expect(captured.status()).toBe(403);
      expect(calls).toHaveLength(0);
    },
  );

  it("sends the session's own access token and never the browser's", async () => {
    const { calls } = stubUpstream(new Response("{}", { status: 200 }));
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({
        url: "/admin/identity/admin/users",
        headers: { authorization: "Bearer forged-token-from-the-browser" },
      }),
      res: captured.res,
      pathname: "/admin/identity/admin/users",
      deps: buildDeps(),
    });
    const sent = new Headers(calls[0]?.init.headers);
    expect(sent.get("authorization")).toBe(`Bearer ${SESSION_ACCESS_TOKEN}`);
    expect(sent.get("authorization")).not.toContain("forged-token-from-the-browser");
  });

  it.each(["/admin/identity/api/login", "/admin/identity/api/mfa/verify"])(
    "answers 404 for the console sign-in route %s",
    async (pathname) => {
      const { calls } = stubUpstream(new Response("{}", { status: 200 }));
      const captured = buildResponse();
      await handleIxAuthAdminProxyRequest({
        req: buildRequest({
          method: "POST",
          url: pathname,
          headers: {
            origin: "http://127.0.0.1:18800",
            "content-type": "application/json",
            "x-openclaw-csrf": CSRF_TOKEN,
          },
          body: '{"email":"person@example.test","password":"hunter2"}',
        }),
        res: captured.res,
        pathname,
        deps: buildDeps(),
      });
      expect(captured.status()).toBe(404);
      expect(captured.body()).toContain("not_found");
      expect(calls).toHaveLength(0);
    },
  );

  it("plants the console's sign-in state in the document it serves", async () => {
    const { calls } = stubUpstream(
      new Response("<!doctype html><body><script>let token = '';</script>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({ headers: { accept: "text/html" } }),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps(),
    });
    expect(calls).toHaveLength(1);
    const body = captured.body();
    expect(body).toContain("sessionStorage.setItem('ixauth_token'");
    expect(body).toContain("sessionStorage.setItem('ixauth_who'");
    expect(body).toContain("person@example.test");
    // The real token stays on this side of the boundary.
    expect(body).not.toContain(SESSION_ACCESS_TOKEN);
    // The bootstrap runs before the page reads sessionStorage.
    expect(body.indexOf("ixauth_token")).toBeLessThan(body.indexOf("let token"));
  });

  it("leaves a JSON answer alone", async () => {
    stubUpstream(
      new Response('{"data":{"items":[]}}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({ url: "/admin/identity/admin/users" }),
      res: captured.res,
      pathname: "/admin/identity/admin/users",
      deps: buildDeps(),
    });
    expect(captured.body()).toBe('{"data":{"items":[]}}');
  });

  it("leaves a stylesheet alone even at the console document path", async () => {
    stubUpstream(
      new Response("body{color:red}<script>", {
        status: 200,
        headers: { "content-type": "text/css" },
      }),
    );
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({}),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps(),
    });
    expect(captured.body()).toBe("body{color:red}<script>");
  });

  it("serves the original document when the marker is missing", async () => {
    stubUpstream(
      new Response("<!doctype html><body>no script here", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const captured = buildResponse();
    await handleIxAuthAdminProxyRequest({
      req: buildRequest({ headers: { accept: "text/html" } }),
      res: captured.res,
      pathname: "/admin/identity/",
      deps: buildDeps(),
    });
    expect(captured.status()).toBe(200);
    expect(captured.body()).toBe("<!doctype html><body>no script here");
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

describe("injectIxAuthAdminConsoleBootstrap", () => {
  it("escapes an identity that would otherwise close the script element", () => {
    const principal = buildPrincipal("superadmin");
    const hostile = {
      ...principal,
      claims: {
        ...principal.claims,
        email: "</script><img src=x onerror=alert(1)>@example.test",
        roles: ["SUPERADMIN"],
      },
    } satisfies IxAuthPrincipal;
    const injected = injectIxAuthAdminConsoleBootstrap({
      html: "<!doctype html><body><script>let token = '';</script>",
      principal: hostile,
    });
    expect(injected).toBeDefined();
    const bootstrap = (injected ?? "").slice(0, (injected ?? "").indexOf("let token"));
    // Nothing the identity carries can start a tag or end this element: the angle
    // brackets survive only as escapes inside a JavaScript string literal.
    expect(bootstrap).not.toContain("<img");
    expect(bootstrap).not.toContain("</script><img");
    expect(bootstrap).toContain("\\u003cimg");
    expect(bootstrap).toContain("\\u003c/script\\u003e");
  });

  it("injects exactly once", () => {
    const injected =
      injectIxAuthAdminConsoleBootstrap({
        html: "<head><script>a</script><script>b</script>",
        principal: buildPrincipal("superadmin"),
      }) ?? "";
    expect(injected.split("ixauth_token")).toHaveLength(2);
  });

  it("reports a document it does not recognize instead of guessing", () => {
    expect(
      injectIxAuthAdminConsoleBootstrap({
        html: "<!doctype html><body>nothing to bootstrap",
        principal: buildPrincipal("superadmin"),
      }),
    ).toBeUndefined();
  });

  it("replaces the console sign-out with a way back to the Gateway", () => {
    const injected =
      injectIxAuthAdminConsoleBootstrap({
        html:
          '<!doctype html><body><header><button class="sm" onclick="logout()">out</button>' +
          "</header><script>function logout(){}</script></body></html>",
        principal: buildPrincipal("superadmin"),
      }) ?? "";
    // The override has to sit after the console's own declaration, or the function
    // declaration would win and the dead sign-in form would come back.
    expect(injected.indexOf("window.logout=")).toBeGreaterThan(
      injected.indexOf("function logout(){}"),
    );
    expect(injected).toContain("/settings/users");
    // Inserted inside the document, not appended after it closes.
    expect(injected.indexOf("window.logout=")).toBeLessThan(injected.indexOf("</body>"));
  });
});
