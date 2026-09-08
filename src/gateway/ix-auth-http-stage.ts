// Wiring for the Gateway's own /auth/* request stage.
//
// The dependency assembly lives here rather than inline in server-http.ts so that file
// keeps its hook to a single call, which is what makes rebasing on upstream cheap.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { isSecureGatewayBrowserContext } from "./cookie-header.js";
import { classifyIxAuthHttpPath, isIxAuthAdminProxyPath } from "./ix-auth-http-paths.js";
import { isLocalDirectRequest, isLoopbackAddress, isTrustedProxyAddress } from "./net.js";

/**
 * True when this request belongs to the Gateway's authentication namespace.
 *
 * Checked before the stage runs so the modules below stay unloaded on every deployment
 * that does not use this mode.
 */
function claimsIxAuthHttpRequest(params: { authMode: string; pathname: string }): boolean {
  return params.authMode === "ix-auth" && classifyIxAuthHttpPath(params.pathname) !== "outside";
}

/**
 * True when this request is a server-to-server call the identity server authenticates with
 * the shared service key rather than with a browser session.
 *
 * There is exactly one such route today: the identity server posts mail it could not send
 * to `/auth/mail-hook`, carrying `x-ixauth-key` and nothing else. It is the only namespace
 * member with no browser on the other end, so it is the only one that may run where the
 * ingress cannot name a browser client.
 *
 * Why this predicate exists: a deployment behind a tunnel lists the container network in
 * `gateway.trustedProxies` so the forwarded scheme is believed (DEPLOY.md 11.7). The
 * identity server is on that same network, so its call is judged "relayed by a proxy that
 * forgot to say whom for" and refused before any route runs -- the service key is never
 * even read. Invitation mail then vanishes with only a log line on the identity side.
 * Naming the route class here keeps that from depending on how narrowly the proxy list
 * happens to be drawn.
 */
function claimsIxAuthServiceKeyRequest(params: { authMode: string; pathname: string }): boolean {
  return params.authMode === "ix-auth" && classifyIxAuthHttpPath(params.pathname) === "mail-hook";
}

/**
 * Answer one `/auth/*` request.
 *
 * Returns true whenever the request was handled, including the not-found case: a path
 * inside the authentication namespace must never fall through to a plugin or hook.
 */
async function runIxAuthHttpStage(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  config: OpenClawConfig;
  trustedProxies: string[];
  clientIp?: string;
  rateLimiter?: AuthRateLimiter;
  disconnectClientsForUserProfile?: (profileId: string) => void;
  respondNotFound: (res: ServerResponse) => void;
}): Promise<boolean> {
  // Imported here rather than at module scope so a deployment that never enables this
  // mode never loads the identity client, its session store, or the JWKS verifier.
  const [httpModule, principalModule] = await Promise.all([
    import("./ix-auth-http.js"),
    import("./ix-auth-principal.js"),
  ]);
  const settings = await principalModule.loadIxAuthGatewaySettings();
  if (!settings) {
    // Configured for this mode but unusable. Denying is the only safe answer; startup
    // validation reports the underlying misconfiguration separately.
    params.respondNotFound(params.res);
    return true;
  }
  const socket = params.req.socket;
  return await httpModule.handleIxAuthHttpRequest({
    req: params.req,
    res: params.res,
    pathname: params.pathname,
    deps: {
      settings,
      allowedOrigins: params.config.gateway?.controlUi?.allowedOrigins,
      allowHostHeaderOriginFallback:
        params.config.gateway?.controlUi?.dangerouslyAllowHostHeaderOriginFallback === true,
      clientIp: params.clientIp,
      isLocalClient: isLocalDirectRequest(params.req, params.trustedProxies),
      isSecureContext: isSecureGatewayBrowserContext({
        // A TLS server hands this handler a TLSSocket, a plain server a net.Socket. The
        // encrypted flag is what distinguishes them at this point.
        // SAFETY: the property is read as optional, which holds for both socket types.
        encrypted: Boolean((socket as { encrypted?: boolean }).encrypted),
        remoteAddressIsLoopback: isLoopbackAddress(socket?.remoteAddress),
        forwardedProto: params.req.headers["x-forwarded-proto"],
        fromTrustedProxy: isTrustedProxyAddress(socket?.remoteAddress, params.trustedProxies),
      }),
      rateLimiter: params.rateLimiter,
      ...(params.disconnectClientsForUserProfile
        ? { disconnectClientsForUserProfile: params.disconnectClientsForUserProfile }
        : {}),
    },
  });
}

/** True when this request belongs to the identity server's admin console namespace. */
function claimsIxAuthAdminProxyRequest(params: { authMode: string; pathname: string }): boolean {
  return params.authMode === "ix-auth" && isIxAuthAdminProxyPath(params.pathname);
}

/**
 * Answer one `/admin/identity/*` request.
 *
 * The session is resolved here rather than inside the proxy so the proxy receives a
 * principal it cannot construct itself, and so the CSRF digest and the identity-server
 * access token travel with it: all three come from the same login-session row, and
 * reading them apart would let one drift.
 */
async function runIxAuthAdminProxyStage(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  config: OpenClawConfig;
  trustedProxies: string[];
  clientIp?: string;
  respondNotFound: (res: ServerResponse) => void;
}): Promise<void> {
  const [proxyModule, principalModule, sessionsModule] = await Promise.all([
    import("./ix-auth-admin-proxy.js"),
    import("./ix-auth-principal.js"),
    import("../auth/ix-auth/ix-auth-sessions.js"),
  ]);
  const settings = await principalModule.loadIxAuthGatewaySettings();
  if (!settings) {
    params.respondNotFound(params.res);
    return;
  }
  const sessionToken = principalModule.readIxAuthSessionCookie({ req: params.req, settings });
  const userAgent = params.req.headers["user-agent"];
  const resolution = sessionToken
    ? await sessionsModule.resolveIxAuthSessionToken({
        sessionToken,
        settings,
        meta: {
          clientIp: params.clientIp,
          userAgent: typeof userAgent === "string" ? userAgent : undefined,
        },
        nowMs: Date.now(),
        // The console is a separate document; sliding the Control UI's idle window from
        // it would keep an abandoned browser session alive for as long as a tab is open.
        touch: false,
      })
    : undefined;
  await proxyModule.handleIxAuthAdminProxyRequest({
    req: params.req,
    res: params.res,
    pathname: params.pathname,
    deps: {
      settings,
      ...(resolution?.ok
        ? {
            principal: resolution.principal,
            csrfDigest: resolution.row.csrf_digest,
            // The console signs in as this person upstream. The resolver above rotates a
            // token that is about to expire, so the row read here is the current one.
            accessToken: resolution.row.access_token,
          }
        : {}),
      allowedOrigins: params.config.gateway?.controlUi?.allowedOrigins,
      allowHostHeaderOriginFallback:
        params.config.gateway?.controlUi?.dangerouslyAllowHostHeaderOriginFallback === true,
      clientIp: params.clientIp,
      isLocalClient: isLocalDirectRequest(params.req, params.trustedProxies),
    },
  });
}

/**
 * Pick the request stages this path belongs to, in order.
 *
 * Returning stages instead of exporting the two predicates keeps `server-http.ts` free of
 * the namespace rules: it registers whatever comes back and never learns which paths this
 * mode owns. An empty array is the normal case for every other request.
 */
export function planIxAuthHttpStages(params: {
  authMode: string;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  config: OpenClawConfig;
  trustedProxies: string[];
  clientIp?: string;
  rateLimiter?: AuthRateLimiter;
  /** Reaches the live connection set so signing out can close that person's sockets. */
  disconnectClientsForUserProfile?: (profileId: string) => void;
  respondNotFound: (res: ServerResponse) => void;
  /**
   * Plan only the service-key routes, for the ingress path that could not attribute the
   * request to a browser client. Everything else in the namespace stays refused there.
   */
  serviceKeyRoutesOnly?: boolean;
}): Array<() => Promise<boolean>> {
  const { authMode: _authMode, serviceKeyRoutesOnly: _serviceOnly, ...stageParams } = params;
  if (params.serviceKeyRoutesOnly === true) {
    return claimsIxAuthServiceKeyRequest({ authMode: params.authMode, pathname: params.pathname })
      ? [() => runIxAuthHttpStage(stageParams)]
      : [];
  }
  if (claimsIxAuthHttpRequest({ authMode: params.authMode, pathname: params.pathname })) {
    return [() => runIxAuthHttpStage(stageParams)];
  }
  if (claimsIxAuthAdminProxyRequest({ authMode: params.authMode, pathname: params.pathname })) {
    return [
      async () => {
        await runIxAuthAdminProxyStage(stageParams);
        return true;
      },
    ];
  }
  return [];
}
