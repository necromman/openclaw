import type { IncomingMessage, ServerResponse } from "node:http";
import { asOptionalRecord } from "@openclaw/normalization-core/record-coerce";
import type { IxAuthRuntimeSettings } from "../auth/ix-auth/ix-auth-types.js";
import {
  appendGatewayClearCookie,
  appendGatewaySetCookie,
  readRequestCookieValue,
  serializeGatewaySetCookie,
  type GatewayCookieAttributes,
} from "./cookie-header.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

function buildSessionCookieAttributes(params: {
  isSecureContext: boolean;
  maxAgeSeconds?: number;
}): GatewayCookieAttributes {
  return {
    path: "/",
    httpOnly: true,
    // A __Host- cookie requires Secure. Plain-HTTP loopback development therefore falls
    // back to an unprefixed name; serializeGatewaySetCookie enforces the rest.
    secure: params.isSecureContext,
    // Lax keeps top-level navigations working while blocking cross-site form posts. It is
    // a backstop: the CSRF token below is the actual defense.
    sameSite: "Lax",
    maxAgeSeconds: params.maxAgeSeconds,
  };
}

/**
 * Resolve the cookie name actually used.
 *
 * `__Host-` prefixed cookies are silently dropped by browsers over plain HTTP, which
 * would make loopback development look like a broken login rather than a policy choice.
 */
export function resolveEffectiveCookieName(
  settings: IxAuthRuntimeSettings,
  isSecureContext: boolean,
) {
  if (isSecureContext || !settings.cookieName.startsWith("__Host-")) {
    return settings.cookieName;
  }
  return settings.cookieName.slice("__Host-".length);
}

/**
 * Name of the companion cookie holding the CSRF token.
 *
 * The session cookie is HttpOnly so script cannot read it. The CSRF token must be
 * readable by the Control UI to echo it in a header, so it rides in a separate,
 * script-visible cookie. That is the standard double-submit shape, hardened here by
 * also checking the presented token against a per-session digest on the server, so a
 * forged cookie pair alone is not enough.
 */
function resolveCsrfCookieName(sessionCookieName: string): string {
  return `${sessionCookieName}-csrf`;
}

/** Write the session cookie and its companion CSRF cookie in one place. */
export function writeIxAuthSessionCookies(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  session: { sessionToken: string; csrfToken: string };
}): void {
  const cookieName = resolveEffectiveCookieName(params.deps.settings, params.deps.isSecureContext);
  const maxAgeSeconds = Math.floor(params.deps.settings.absoluteTimeoutMs / 1000);
  appendGatewaySetCookie(
    params.res,
    serializeGatewaySetCookie({
      name: cookieName,
      value: params.session.sessionToken,
      attributes: buildSessionCookieAttributes({
        isSecureContext: params.deps.isSecureContext,
        maxAgeSeconds,
      }),
    }),
  );
  appendGatewaySetCookie(
    params.res,
    serializeGatewaySetCookie({
      name: resolveCsrfCookieName(cookieName),
      value: params.session.csrfToken,
      attributes: {
        ...buildSessionCookieAttributes({
          isSecureContext: params.deps.isSecureContext,
          maxAgeSeconds,
        }),
        httpOnly: false,
      },
    }),
  );
}

/** Expire both cookies so a rejected or ended session leaves nothing behind. */
export function clearIxAuthSessionCookies(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): void {
  const cookieName = resolveEffectiveCookieName(params.deps.settings, params.deps.isSecureContext);
  const attributes = buildSessionCookieAttributes({
    isSecureContext: params.deps.isSecureContext,
  });
  appendGatewayClearCookie(params.res, { name: cookieName, attributes });
  appendGatewayClearCookie(params.res, {
    name: resolveCsrfCookieName(cookieName),
    attributes: { ...attributes, httpOnly: false },
  });
}

type IxAuthReturnSession = { sessionToken: string; csrfToken: string; impersonationToken: string };

function returnCookieName(deps: IxAuthHttpDependencies): string {
  return `${resolveEffectiveCookieName(deps.settings, deps.isSecureContext)}-return`;
}

export function readIxAuthReturnSession(
  req: IncomingMessage,
  deps: IxAuthHttpDependencies,
): IxAuthReturnSession | undefined {
  const value = readRequestCookieValue(req, returnCookieName(deps));
  if (!value || value.length > 1024) {
    return undefined;
  }
  try {
    const data = asOptionalRecord(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (
      !data ||
      typeof data.sessionToken !== "string" ||
      typeof data.csrfToken !== "string" ||
      typeof data.impersonationToken !== "string"
    ) {
      return undefined;
    }
    return {
      sessionToken: data.sessionToken,
      csrfToken: data.csrfToken,
      impersonationToken: data.impersonationToken,
    };
  } catch {
    return undefined;
  }
}

export function writeIxAuthReturnSession(
  res: ServerResponse,
  deps: IxAuthHttpDependencies,
  session: IxAuthReturnSession,
  expiresAt: number,
): void {
  appendGatewaySetCookie(
    res,
    serializeGatewaySetCookie({
      name: returnCookieName(deps),
      value: Buffer.from(JSON.stringify(session)).toString("base64url"),
      attributes: {
        ...buildSessionCookieAttributes({
          isSecureContext: deps.isSecureContext,
          maxAgeSeconds: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
        }),
        sameSite: "Strict",
      },
    }),
  );
}

export function clearIxAuthReturnSession(res: ServerResponse, deps: IxAuthHttpDependencies): void {
  appendGatewayClearCookie(res, {
    name: returnCookieName(deps),
    attributes: {
      ...buildSessionCookieAttributes({ isSecureContext: deps.isSecureContext }),
      sameSite: "Strict",
    },
  });
}
