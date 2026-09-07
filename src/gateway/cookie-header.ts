// Shared Cookie header parsing and Set-Cookie serialization for Gateway HTTP routes.
//
// Promoted from control-ui-plugin-auth-cookie.ts so the IX-Auth session cookie and the
// plugin-tab cookie share one parser. Its warning carries over: cookies are scoped to a
// hostname, never to a port, so two Gateways on the same hostname can overwrite each
// other's cookies. Give mutually untrusted Gateways separate hostnames.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type GatewayCookieAttributes = {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  maxAgeSeconds?: number;
};

/** Split a Cookie header into name/value pairs, keeping the first value per name. */
export function readRequestCookieMap(header: string | string[] | undefined): Map<string, string> {
  const raw = Array.isArray(header) ? header.join(";") : header;
  const cookies = new Map<string, string>();
  for (const part of raw?.split(";") ?? []) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name.length > 0 && !cookies.has(name)) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/** Read one cookie value from a request, or undefined when absent. */
export function readRequestCookieValue(
  req: Pick<IncomingMessage, "headers">,
  name: string,
): string | undefined {
  return readRequestCookieMap(req.headers.cookie)?.get(name);
}

/** Collect every cookie value whose name starts with the given prefix plus an underscore. */
export function readPrefixedCookieValues(
  header: string | string[] | undefined,
  namePrefix: string,
): string[] {
  const values: string[] = [];
  for (const [name, value] of readRequestCookieMap(header)) {
    if (name.startsWith(`${namePrefix}_`)) {
      values.push(value);
    }
  }
  return values;
}

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Both sides are hashed first so the comparison length is constant regardless of the
 * candidate's length, which timingSafeEqual would otherwise reveal by throwing.
 */
export function compareSecretStringsSafely(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

function hasInvalidCookieCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === ";" || character === "," || code <= 0x1f || code >= 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Build one Set-Cookie value.
 *
 * Names beginning with `__Host-` are only honored by browsers when the cookie is
 * Secure, has `Path=/`, and carries no Domain, so those are enforced here rather than
 * left to each caller.
 */
export function serializeGatewaySetCookie(params: {
  name: string;
  value: string;
  attributes: GatewayCookieAttributes;
}): string {
  if (hasInvalidCookieCharacter(params.name) || hasInvalidCookieCharacter(params.value)) {
    throw new Error("gateway cookie name or value contains an unsupported character");
  }
  const hostPrefixed = params.name.startsWith("__Host-");
  const path = hostPrefixed ? "/" : params.attributes.path;
  const secure = hostPrefixed ? true : params.attributes.secure;
  const segments = [`${params.name}=${params.value}`, `Path=${path}`];
  if (params.attributes.httpOnly) {
    segments.push("HttpOnly");
  }
  if (secure) {
    segments.push("Secure");
  }
  segments.push(`SameSite=${params.attributes.sameSite}`);
  if (params.attributes.maxAgeSeconds !== undefined) {
    segments.push(`Max-Age=${Math.max(0, Math.floor(params.attributes.maxAgeSeconds))}`);
  }
  return segments.join("; ");
}

/** Append one Set-Cookie header without discarding cookies an earlier stage set. */
export function appendGatewaySetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  if (existing === undefined) {
    res.setHeader("Set-Cookie", [cookie]);
    return;
  }
  const list = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

/**
 * Decide whether the browser reached the Gateway in a secure context.
 *
 * Browsers refuse a `Secure` cookie over plain HTTP, except on loopback, which they
 * treat as a secure context. Getting this wrong is silent: the cookie is simply never
 * stored and the login appears to fail for no reason.
 *
 * `x-forwarded-proto` is only trusted when the request actually arrived through a
 * configured trusted proxy, because otherwise any client could claim HTTPS and induce
 * a Secure cookie the browser will then drop.
 */
export function isSecureGatewayBrowserContext(params: {
  encrypted: boolean;
  remoteAddressIsLoopback: boolean;
  forwardedProto?: string | string[];
  fromTrustedProxy: boolean;
}): boolean {
  if (params.encrypted || params.remoteAddressIsLoopback) {
    return true;
  }
  if (!params.fromTrustedProxy) {
    return false;
  }
  const raw = Array.isArray(params.forwardedProto)
    ? params.forwardedProto[0]
    : params.forwardedProto;
  return raw?.split(",")[0]?.trim().toLowerCase() === "https";
}

/** Emit an expiring Set-Cookie so the browser drops the named cookie immediately. */
export function appendGatewayClearCookie(
  res: ServerResponse,
  params: { name: string; attributes: GatewayCookieAttributes },
): void {
  appendGatewaySetCookie(
    res,
    serializeGatewaySetCookie({
      name: params.name,
      value: "",
      attributes: { ...params.attributes, maxAgeSeconds: 0 },
    }),
  );
}
