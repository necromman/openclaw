// Binds a verified IX-Auth principal to one HTTP request or WebSocket handshake.
//
// The principal is only ever produced here, from a session cookie plus a locally
// verified access token. Nothing in a request body, a `connect` parameter, or a
// forwarded header can construct one.
import type { IncomingMessage } from "node:http";
import { resolveIxAuthSessionToken } from "../auth/ix-auth/ix-auth-sessions.js";
import { resolveIxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-settings.js";
import type {
  IxAuthPrincipal,
  IxAuthRuntimeSettings,
  IxAuthSessionRejection,
} from "../auth/ix-auth/ix-auth-types.js";
import { getRuntimeConfig } from "../config/io.js";
import { readRequestCookieValue } from "./cookie-header.js";
import { resolveRequestClientIpFromHeaders } from "./net.js";

/**
 * Read the session cookie under whichever name is actually in force.
 *
 * A `__Host-` prefixed cookie is never set over plain HTTP, so loopback development
 * carries the unprefixed name. Trying both keeps one configuration value working in
 * both deployments instead of forcing a second setting.
 */
export function readIxAuthSessionCookie(params: {
  req: Pick<IncomingMessage, "headers">;
  settings: Pick<IxAuthRuntimeSettings, "cookieName">;
}): string | undefined {
  const configured = params.settings.cookieName;
  const direct = readRequestCookieValue(params.req, configured);
  if (direct) {
    return direct;
  }
  if (!configured.startsWith("__Host-")) {
    return undefined;
  }
  return readRequestCookieValue(params.req, configured.slice("__Host-".length));
}

/** Resolved settings for the current config, or undefined when ix-auth is not configured. */
export async function loadIxAuthGatewaySettings(): Promise<IxAuthRuntimeSettings | undefined> {
  const config = getRuntimeConfig();
  if (config.gateway?.auth?.ixAuth === undefined) {
    return undefined;
  }
  try {
    return await resolveIxAuthRuntimeSettings({ config, env: process.env });
  } catch {
    // A misconfigured identity provider must not authenticate anyone. Startup
    // validation reports the same failure loudly; here it simply denies.
    return undefined;
  }
}

/**
 * Resolve the principal for one request or handshake, if any.
 *
 * `touch` is false on the WebSocket path: a handshake proves liveness, but sliding the
 * idle window from a long-lived socket would keep an abandoned browser session alive
 * indefinitely.
 */
export async function resolveIxAuthRequestPrincipal(params: {
  req: IncomingMessage;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  touch?: boolean;
}): Promise<{ principal: IxAuthPrincipal; settings: IxAuthRuntimeSettings } | undefined> {
  const resolved = await resolveIxAuthRequestSession(params);
  return resolved.ok ? { principal: resolved.principal, settings: resolved.settings } : undefined;
}

/** What a cookie resolution produced, including why it failed. */
export type IxAuthRequestSessionResolution =
  | { ok: true; principal: IxAuthPrincipal; settings: IxAuthRuntimeSettings }
  | { ok: false; rejection: IxAuthSessionRejection };

/**
 * Same resolution as above, with the rejection kept.
 *
 * Callers that answer a browser need it: "the identity server did not answer" has to
 * become a retry, while "this session is finished" becomes the sign-in screen. Folding
 * both into `undefined` is what turned a restart into a forced sign-out.
 */
export async function resolveIxAuthRequestSession(params: {
  req: IncomingMessage;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  touch?: boolean;
}): Promise<IxAuthRequestSessionResolution> {
  const settings = await loadIxAuthGatewaySettings();
  if (!settings) {
    return { ok: false, rejection: "no-cookie" };
  }
  const sessionToken = readIxAuthSessionCookie({ req: params.req, settings });
  if (!sessionToken) {
    return { ok: false, rejection: "no-cookie" };
  }
  const clientIp =
    resolveRequestClientIpFromHeaders(
      params.req,
      params.trustedProxies ?? [],
      params.allowRealIpFallback === true,
    ) ?? params.req.socket?.remoteAddress;
  const userAgent = params.req.headers["user-agent"];
  const resolution = await resolveIxAuthSessionToken({
    sessionToken,
    settings,
    meta: {
      clientIp,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    },
    nowMs: Date.now(),
    touch: params.touch ?? false,
  });
  return resolution.ok
    ? { ok: true, principal: resolution.principal, settings }
    : { ok: false, rejection: resolution.rejection };
}
