// Wiring for the Gateway's own /auth/* request stage.
//
// The dependency assembly lives here rather than inline in server-http.ts so that file
// keeps its hook to a single call, which is what makes rebasing on upstream cheap.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { isSecureGatewayBrowserContext } from "./cookie-header.js";
import { classifyIxAuthHttpPath } from "./ix-auth-http-paths.js";
import { isLocalDirectRequest, isLoopbackAddress, isTrustedProxyAddress } from "./net.js";

/**
 * True when this request belongs to the Gateway's authentication namespace.
 *
 * Checked before the stage runs so the modules below stay unloaded on every deployment
 * that does not use this mode.
 */
export function claimsIxAuthHttpRequest(params: {
  authMode: string;
  pathname: string;
}): boolean {
  return params.authMode === "ix-auth" && classifyIxAuthHttpPath(params.pathname) !== "outside";
}

type IxAuthStageModules = {
  handleIxAuthHttpRequest: typeof import("./ix-auth-http.js").handleIxAuthHttpRequest;
  loadIxAuthGatewaySettings: typeof import("./ix-auth-principal.js").loadIxAuthGatewaySettings;
};

/**
 * Answer one `/auth/*` request.
 *
 * Returns true whenever the request was handled, including the not-found case: a path
 * inside the authentication namespace must never fall through to a plugin or hook.
 */
export async function runIxAuthHttpStage(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  config: OpenClawConfig;
  trustedProxies: string[];
  clientIp?: string;
  rateLimiter?: AuthRateLimiter;
  modules: IxAuthStageModules;
  respondNotFound: (res: ServerResponse) => void;
}): Promise<boolean> {
  const settings = await params.modules.loadIxAuthGatewaySettings();
  if (!settings) {
    // Configured for this mode but unusable. Denying is the only safe answer; startup
    // validation reports the underlying misconfiguration separately.
    params.respondNotFound(params.res);
    return true;
  }
  const socket = params.req.socket;
  return await params.modules.handleIxAuthHttpRequest({
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
    },
  });
}
