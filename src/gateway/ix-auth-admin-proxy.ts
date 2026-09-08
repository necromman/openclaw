// Backend-for-frontend proxy for the identity server's admin console.
//
// The fork does not rebuild a user-management screen; it reuses the one shipped inside
// IX-Auth. Design invariant 4 (ix-auth/MODULE.md section 7) forbids publishing that
// server to a browser, so the console is reached only here, behind the Gateway session
// that already proved who the visitor is.
//
// Three rules make that safe:
//   1. Only a superadmin session gets past. Everyone else is refused, and the link is
//      withheld from their session payload in the first place.
//   2. Nothing the browser sends is trusted onto the upstream request. Headers are
//      rebuilt from an allowlist, so the Gateway session cookie, hop-by-hop headers, and
//      any forged attribution header are dropped rather than filtered.
//   3. The console does not sign anyone in. This proxy attaches the visitor's own
//      identity-server access token, the one their Gateway session already holds, and
//      refuses the console's sign-in routes outright. The console's second password
//      prompt used to be counted as a second factor, but the identity server grants an
//      administrator every console permission anyway, so it stopped nothing an
//      administrator asked for and only cost a super admin a second password. Rule 1
//      narrowing to super admin is what replaced it (ix-auth/MODULE.md section 7.3).
//
// The access token never reaches the browser. The console page will not open until it
// finds a token in sessionStorage, so the proxy plants an opaque sentinel there instead;
// it is worthless upstream because rule 2 overwrites whatever the page sends.
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
 *
 * `Authorization` is absent for the same reason and is set from the session instead. A
 * browser that names its own bearer token must not be able to reach the identity server
 * as somebody else, and a page under this proxy has no legitimate token of its own.
 */
const IX_AUTH_ADMIN_PROXY_FORWARDED_REQUEST_HEADERS: readonly string[] = Object.freeze([
  "accept",
  "accept-language",
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
 * The page is one self-contained HTML file with inline script and inline styles and no
 * external reference of any kind, and this proxy prepends one more inline script, so
 * inline execution is allowed while every remote origin, frame, and form target is
 * denied.
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
  /**
   * Identity-server access token belonging to that same session row.
   *
   * The session layer rotates it before it expires, so reading it per request is what
   * keeps a long console visit working. It is attached to the upstream call and is never
   * written into a response.
   */
  accessToken?: string;
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
  // Injected last so no forwarded header can shadow it. The bearer token is the visitor's
  // own: the console authorizes on `users.id`, so an ordinary sign-in token carries
  // exactly the permissions that person already has, and no new grant is minted here.
  const accessToken = params.deps.accessToken;
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  headers.set("x-ixauth-key", params.deps.settings.serviceKey);
  return headers;
}

/**
 * Upstream paths the console uses to sign itself in.
 *
 * Refused outright. The visitor is already signed in to the Gateway and the proxy speaks
 * for them upstream, so a second credential prompt behind this route could only be a way
 * to reach the identity server as a different account than the session proved.
 */
const IX_AUTH_ADMIN_PROXY_BLOCKED_UPSTREAM_PATHS: ReadonlySet<string> = new Set([
  "/admin-ui/api/login",
  "/admin-ui/api/mfa/verify",
]);

function isBlockedConsoleSignInPath(upstreamPath: string): boolean {
  const normalized = upstreamPath.toLowerCase().replace(/\/+$/u, "");
  return IX_AUTH_ADMIN_PROXY_BLOCKED_UPSTREAM_PATHS.has(normalized);
}

/**
 * Value planted in the console's `sessionStorage` so the page opens instead of asking for
 * a password.
 *
 * The page only tests that a token is present; every call it makes is re-authorized
 * upstream with the session's real token, which this proxy sets. So the value here is a
 * label, not a credential: it names why the page is unlocked and is worth nothing to
 * anyone who reads it out of the browser.
 */
const IX_AUTH_ADMIN_CONSOLE_TOKEN_SENTINEL = "gateway-session";

/** The console document carries exactly one script tag; the bootstrap goes before it. */
const IX_AUTH_ADMIN_CONSOLE_SCRIPT_MARKER = "<script>";

/** Where the console's exit control returns to, relative to the Gateway's own root. */
const IX_AUTH_ADMIN_CONSOLE_RETURN_PATH = "/settings/users";

/** What the console's sign-out control says once it can no longer sign anyone out. */
const IX_AUTH_ADMIN_CONSOLE_EXIT_LABEL = "게이트웨이로 돌아가기";

/**
 * JSON-encode one value for a place inside an inline script.
 *
 * JSON alone is not enough there: a `</script>` inside a string would end the element,
 * and the two line separators are ordinary characters in JSON but line breaks in
 * JavaScript. Escaping every character that can start either problem keeps a display name
 * from becoming markup.
 */
function encodeForInlineScript(value: string): string {
  return JSON.stringify(value).replaceAll(/[<>&\u2028\u2029]/gu, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

/**
 * Plant the console's sign-in state in the document it is about to run.
 *
 * Returns `undefined` when the page does not look like the console that was expected. The
 * caller then serves the original bytes: a console that shows its own sign-in form is a
 * worse screen, but it is the screen the identity server sent, and refusing to serve
 * anything would turn a cosmetic mismatch into an outage.
 */
export function injectIxAuthAdminConsoleBootstrap(params: {
  html: string;
  principal: IxAuthPrincipal;
}): string | undefined {
  const markerIndex = params.html.indexOf(IX_AUTH_ADMIN_CONSOLE_SCRIPT_MARKER);
  if (markerIndex === -1) {
    return undefined;
  }
  const email = params.principal.claims.email;
  const roles = params.principal.claims.roles.join(", ");
  const who = roles.length > 0 ? `${email} · ${roles}` : email;
  const bootstrap =
    "<script>try{" +
    `sessionStorage.setItem('ixauth_token',${encodeForInlineScript(IX_AUTH_ADMIN_CONSOLE_TOKEN_SENTINEL)});` +
    `sessionStorage.setItem('ixauth_who',${encodeForInlineScript(who)});` +
    "}catch{}</script>";
  const seeded = params.html.slice(0, markerIndex) + bootstrap + params.html.slice(markerIndex);
  return appendIxAuthAdminConsoleExit(seeded);
}

/**
 * Turn the console's sign-out button into a way back out of the console.
 *
 * The console's own `logout()` clears its `sessionStorage` and shows its sign-in form.
 * Under this proxy that form is a dead end: the sign-in routes are refused as not-found
 * (rule 3 above), so pressing sign out produced a password box that answers 404 to
 * anything typed into it. The visitor's session was never the console's to end anyway; it
 * belongs to the Gateway.
 *
 * So the control leaves instead of signing out, and says so. Returning to the Gateway
 * screen that offered the console keeps the session intact, which is what makes the
 * console re-openable without signing in again. Signing out for real stays where it has
 * always been, in the Gateway's own account menu.
 *
 * The override is appended after the console's script rather than before it: a function
 * declaration in a classic script wins over an earlier assignment, so an override placed
 * with the bootstrap above would be overwritten by the very function it replaces.
 */
function appendIxAuthAdminConsoleExit(html: string): string {
  const script =
    "<script>(function(){try{" +
    // The Gateway may be mounted under a base path, so the way back is derived from the
    // path this document was actually served at rather than assumed to be the root.
    `var here=location.pathname;var cut=here.indexOf(${encodeForInlineScript(IX_AUTH_ADMIN_PROXY_BASE_PATH)});` +
    `var exit=(cut>0?here.slice(0,cut):'')+${encodeForInlineScript(IX_AUTH_ADMIN_CONSOLE_RETURN_PATH)};` +
    "window.logout=function(){location.assign(exit);};" +
    "document.querySelectorAll('button[onclick]').forEach(function(button){" +
    "if((button.getAttribute('onclick')||'').indexOf('logout')===0){" +
    `button.textContent=${encodeForInlineScript(IX_AUTH_ADMIN_CONSOLE_EXIT_LABEL)};}});` +
    "}catch{}})();</script>";
  const closing = html.lastIndexOf("</body>");
  return closing === -1 ? html + script : html.slice(0, closing) + script + html.slice(closing);
}

/**
 * Decide whether this response is the console document and rewrite it if so.
 *
 * Narrow on purpose: only the document itself, only a success, and only when the identity
 * server called it HTML. A management API answer, a CSV export, or an error page passes
 * through byte for byte.
 */
function applyIxAuthAdminConsoleBootstrap(params: {
  payload: ArrayBuffer;
  upstream: Response;
  upstreamPath: string;
  principal?: IxAuthPrincipal;
}): Buffer {
  const original = Buffer.from(params.payload);
  const contentType = params.upstream.headers.get("content-type") ?? "";
  if (
    params.principal === undefined ||
    params.upstreamPath !== "/admin-ui" ||
    params.upstream.status !== 200 ||
    !contentType.toLowerCase().includes("text/html")
  ) {
    return original;
  }
  const injected = injectIxAuthAdminConsoleBootstrap({
    html: original.toString("utf8"),
    principal: params.principal,
  });
  return injected === undefined ? original : Buffer.from(injected, "utf8");
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
      message: "이 화면은 시스템 관리자만 열 수 있다.",
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
  if (upstreamPath === undefined || isBlockedConsoleSignInPath(upstreamPath)) {
    // The sign-in routes answer the same way a path that names nothing does, so the
    // console's own login is not merely refused here: from this side it does not exist.
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
  params.res.end(
    applyIxAuthAdminConsoleBootstrap({
      payload,
      upstream,
      upstreamPath,
      ...(params.deps.principal ? { principal: params.deps.principal } : {}),
    }),
  );
}
