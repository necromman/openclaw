// Backend-for-frontend proxy for the identity server's admin console.
//
// The fork does not rebuild a user-management screen; it reuses the one shipped inside
// IX-Auth. Design invariant 4 (ix-auth/MODULE.md section 7) forbids publishing that
// server to a browser, so the console is reached only here, behind the Gateway session
// that already proved who the visitor is.
//
// Three rules make that safe:
//   1. Only a superadmin or admin session gets past. Everyone else is refused, and the
//      link is withheld from their session payload in the first place.
//   2. Nothing the browser sends is trusted onto the upstream request. Headers are
//      rebuilt from an allowlist, so the Gateway session cookie, hop-by-hop headers, and
//      any forged attribution header are dropped rather than filtered.
//   3. The console keeps its own sign-in. This proxy does not mint an identity-server
//      token from the Gateway session, so a stolen Gateway session alone cannot manage
//      users; ix-auth/MODULE.md section 7.2 names that second factor as the point.
import type { IncomingMessage, ServerResponse } from "node:http";
import { canOpenIxAuthAdminConsole } from "../auth/ix-auth/ix-auth-role-map.js";
import { matchesIxAuthCsrfDigest } from "../auth/ix-auth/ix-auth-sessions.js";
import {
  IX_AUTH_CSRF_HEADER_NAME,
  type IxAuthPrincipal,
  type IxAuthRuntimeSettings,
} from "../auth/ix-auth/ix-auth-types.js";
import { sendJson } from "./http-common.js";
import {
  IX_AUTH_ADMIN_PROXY_BASE_PATH,
  resolveIxAuthAdminProxyUpstreamPath,
} from "./ix-auth-http-paths.js";
import { isAllowedIxAuthBrowserOrigin } from "./ix-auth-http.js";

/** The console posts small JSON. A bulk import is the largest realistic body. */
const IX_AUTH_ADMIN_PROXY_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** An audit-log export is the largest realistic response. */
const IX_AUTH_ADMIN_PROXY_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** The console is a person clicking; a stuck upstream must not pin a socket forever. */
const IX_AUTH_ADMIN_PROXY_TIMEOUT_MS = 30_000;

/** Methods that change state upstream and therefore need the CSRF proof. */
const IX_AUTH_ADMIN_PROXY_MUTATING_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Request headers copied through verbatim.
 *
 * An allowlist rather than a denylist: a header the fork has never heard of must not
 * reach the identity server just because nobody thought to strip it. Cookies are absent
 * on purpose, so the Gateway session never crosses the boundary, and hop-by-hop headers
 * cannot appear because they were never eligible.
 */
const IX_AUTH_ADMIN_PROXY_FORWARDED_REQUEST_HEADERS: readonly string[] = Object.freeze([
  "accept",
  "accept-language",
  "authorization",
  "content-type",
]);

/** Response headers copied back. Caching and cookies are withheld deliberately. */
const IX_AUTH_ADMIN_PROXY_FORWARDED_RESPONSE_HEADERS: readonly string[] = Object.freeze([
  "content-type",
  "content-disposition",
  "content-language",
  "retry-after",
]);

/**
 * Content-Security-Policy for the console document.
 *
 * The page is one self-contained HTML file with an inline script and inline styles and
 * no external reference of any kind, so inline execution is allowed while every remote
 * origin, frame, and form target is denied.
 */
const IX_AUTH_ADMIN_PROXY_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; " +
  "base-uri 'none'";

export type IxAuthAdminProxyDependencies = {
  settings: IxAuthRuntimeSettings;
  /** Absent when the browser presented no usable Gateway session. */
  principal?: IxAuthPrincipal;
  /** CSRF digest of that session row, used for the double-submit check. */
  csrfDigest?: Uint8Array;
  allowedOrigins?: string[];
  allowHostHeaderOriginFallback?: boolean;
  clientIp?: string;
  isLocalClient: boolean;
};

function readFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function wantsHtmlResponse(req: IncomingMessage): boolean {
  const accept = readFirstHeaderValue(req.headers.accept) ?? "";
  return req.method === "GET" && accept.includes("text/html");
}

/**
 * Refuse in the visitor's own medium.
 *
 * A person who followed a link deserves a sentence; a script call deserves the JSON
 * shape every other Gateway route uses.
 */
function sendIxAuthAdminProxyDenial(params: {
  req: IncomingMessage;
  res: ServerResponse;
  status: number;
  error: string;
  message: string;
}): void {
  if (!wantsHtmlResponse(params.req)) {
    sendJson(params.res, params.status, { error: params.error });
    return;
  }
  const body =
    '<!doctype html><html lang="ko"><meta charset="utf-8">' +
    "<title>접근 거부</title>" +
    "<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;" +
    "place-items:center;min-height:100vh;color:#1c1c1c;background:#fafafa}" +
    "main{max-width:28rem;padding:1.5rem;text-align:center}" +
    "h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;color:#5a5a5a}</style>" +
    `<main><h1>접근 거부</h1><p>${params.message}</p></main></html>`;
  params.res.statusCode = params.status;
  params.res.setHeader("Content-Type", "text/html; charset=utf-8");
  params.res.setHeader("Cache-Control", "no-store");
  params.res.setHeader("Content-Security-Policy", IX_AUTH_ADMIN_PROXY_CSP);
  params.res.end(body);
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    // SAFETY: a request stream without an encoding set yields Buffer chunks.
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > IX_AUTH_ADMIN_PROXY_MAX_REQUEST_BYTES) {
      return undefined;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function buildUpstreamHeaders(params: {
  req: IncomingMessage;
  deps: IxAuthAdminProxyDependencies;
}): Headers {
  const headers = new Headers();
  for (const name of IX_AUTH_ADMIN_PROXY_FORWARDED_REQUEST_HEADERS) {
    const value = readFirstHeaderValue(params.req.headers[name]);
    if (value !== undefined && value.length > 0) {
      headers.set(name, value);
    }
  }
  // The identity server writes the visitor into its own audit ledger, so it must be told
  // who that is: it sits behind the Gateway and cannot observe the browser directly.
  const clientIp = params.deps.clientIp?.trim();
  if (clientIp && /^[\w.:%[\]-]+$/u.test(clientIp)) {
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }
  const userAgent = readFirstHeaderValue(params.req.headers["user-agent"]);
  const sanitizedUserAgent = userAgent
    ?.replaceAll(/[\r\n]/gu, " ")
    .slice(0, 512)
    .trim();
  if (sanitizedUserAgent) {
    headers.set("user-agent", sanitizedUserAgent);
  }
  // Injected last so no forwarded header can shadow it.
  headers.set("x-ixauth-key", params.deps.settings.serviceKey);
  return headers;
}

/**
 * Rewrite an upstream redirect back into this namespace.
 *
 * The identity server knows its own paths, not the Gateway's, so a bare `Location` would
 * send the browser to a Gateway path that does not exist. Anything naming another host
 * is refused outright: the identity server has no public address by design.
 */
export function rewriteIxAuthAdminProxyLocation(location: string): string | undefined {
  const trimmed = location.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return undefined;
  }
  if (trimmed === "/admin-ui" || trimmed.startsWith("/admin-ui/")) {
    return `${IX_AUTH_ADMIN_PROXY_BASE_PATH}${trimmed.slice("/admin-ui".length) || "/"}`;
  }
  if (trimmed.startsWith("/admin/")) {
    return `${IX_AUTH_ADMIN_PROXY_BASE_PATH}${trimmed}`;
  }
  return undefined;
}

function rejectDisallowedRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthAdminProxyDependencies;
}): boolean {
  const originAllowed = isAllowedIxAuthBrowserOrigin({
    origin: readFirstHeaderValue(params.req.headers.origin),
    fetchSite: readFirstHeaderValue(params.req.headers["sec-fetch-site"]),
    requestHost: readFirstHeaderValue(params.req.headers.host),
    allowedOrigins: params.deps.allowedOrigins,
    allowHostHeaderOriginFallback: params.deps.allowHostHeaderOriginFallback,
    isLocalClient: params.deps.isLocalClient,
  });
  if (!originAllowed) {
    sendIxAuthAdminProxyDenial({
      req: params.req,
      res: params.res,
      status: 403,
      error: "origin_not_allowed",
      message: "허용되지 않은 출처에서 온 요청이다.",
    });
    return true;
  }
  const principal = params.deps.principal;
  if (!principal) {
    sendIxAuthAdminProxyDenial({
      req: params.req,
      res: params.res,
      status: 401,
      error: "unauthenticated",
      message: "먼저 로그인하라.",
    });
    return true;
  }
  if (!canOpenIxAuthAdminConsole(principal.gatewayRole)) {
    sendIxAuthAdminProxyDenial({
      req: params.req,
      res: params.res,
      status: 403,
      error: "forbidden",
      message: "이 화면은 관리자만 열 수 있다.",
    });
    return true;
  }
  if (!IX_AUTH_ADMIN_PROXY_MUTATING_METHODS.has(params.req.method ?? "")) {
    return false;
  }
  // Double submit on top of the Origin check, so this route follows the same rule as
  // every other cookie-bearing Gateway route instead of carving out an exception.
  const presented = params.req.headers[IX_AUTH_CSRF_HEADER_NAME];
  const csrfToken = typeof presented === "string" ? presented : undefined;
  const storedDigest = params.deps.csrfDigest;
  if (
    !csrfToken ||
    !storedDigest ||
    !matchesIxAuthCsrfDigest({ presented: csrfToken, storedDigest })
  ) {
    sendIxAuthAdminProxyDenial({
      req: params.req,
      res: params.res,
      status: 403,
      error: "csrf_mismatch",
      message: "요청 검증에 실패했다. 화면을 새로 고친 뒤 다시 시도하라.",
    });
    return true;
  }
  return false;
}

function buildUpstreamUrl(params: {
  settings: IxAuthRuntimeSettings;
  upstreamPath: string;
  requestUrl: string | undefined;
}): string {
  const requestUrl = params.requestUrl ?? "";
  const queryIndex = requestUrl.indexOf("?");
  const query = queryIndex >= 0 ? requestUrl.slice(queryIndex) : "";
  return `${params.settings.baseUrl.replace(/\/+$/u, "")}${params.upstreamPath}${query}`;
}

/**
 * Handle one console request.
 *
 * Every path inside the namespace is answered here, including the not-found case, so no
 * plugin or hook can claim a sub-path of the console.
 */
export async function handleIxAuthAdminProxyRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  deps: IxAuthAdminProxyDependencies;
}): Promise<void> {
  params.res.setHeader("Cache-Control", "no-store");
  const upstreamPath = resolveIxAuthAdminProxyUpstreamPath(params.pathname);
  if (upstreamPath === undefined) {
    sendJson(params.res, 404, { error: "not_found" });
    return;
  }
  if (rejectDisallowedRequest(params)) {
    return;
  }

  const body = await readRequestBody(params.req);
  if (body === undefined) {
    sendJson(params.res, 413, { error: "payload_too_large" });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      buildUpstreamUrl({
        settings: params.deps.settings,
        upstreamPath,
        requestUrl: params.req.url,
      }),
      {
        method: params.req.method ?? "GET",
        headers: buildUpstreamHeaders({ req: params.req, deps: params.deps }),
        ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(IX_AUTH_ADMIN_PROXY_TIMEOUT_MS),
      },
    );
  } catch {
    sendJson(params.res, 503, { error: "identity_unavailable" });
    return;
  }

  const payload = await upstream.arrayBuffer().catch(() => undefined);
  if (payload === undefined || payload.byteLength > IX_AUTH_ADMIN_PROXY_MAX_RESPONSE_BYTES) {
    sendJson(params.res, 502, { error: "identity_response_invalid" });
    return;
  }

  const location = upstream.headers.get("location");
  const rewrittenLocation =
    location === null ? undefined : rewriteIxAuthAdminProxyLocation(location);
  if (location !== null && rewrittenLocation === undefined) {
    sendJson(params.res, 502, { error: "identity_response_invalid" });
    return;
  }

  params.res.statusCode = upstream.status;
  for (const name of IX_AUTH_ADMIN_PROXY_FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      params.res.setHeader(name, value);
    }
  }
  if (rewrittenLocation !== undefined) {
    params.res.setHeader("Location", rewrittenLocation);
  }
  params.res.setHeader("Cache-Control", "no-store");
  params.res.setHeader("Content-Security-Policy", IX_AUTH_ADMIN_PROXY_CSP);
  params.res.setHeader("X-Frame-Options", "DENY");
  params.res.end(Buffer.from(payload));
}
