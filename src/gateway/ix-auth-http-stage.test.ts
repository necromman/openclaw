import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { planIxAuthHttpStages } from "./ix-auth-http-stage.js";

// The planner is exercised for what it claims, not for what the stages then do: running a
// stage would load the identity client, its session store and the JWKS verifier. What
// matters here is which paths reach a stage at all.
function plan(params: { pathname: string; serviceKeyRoutesOnly?: boolean; authMode?: string }) {
  return planIxAuthHttpStages({
    authMode: params.authMode ?? "ix-auth",
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    pathname: params.pathname,
    config: {} as OpenClawConfig,
    trustedProxies: [],
    respondNotFound: () => {},
    ...(params.serviceKeyRoutesOnly === undefined
      ? {}
      : { serviceKeyRoutesOnly: params.serviceKeyRoutesOnly }),
  });
}

describe("planIxAuthHttpStages", () => {
  it("claims the whole authentication namespace on the ordinary path", () => {
    expect(plan({ pathname: "/auth/login" })).toHaveLength(1);
    expect(plan({ pathname: "/auth/mail-hook" })).toHaveLength(1);
    expect(plan({ pathname: "/admin/identity/api/login" })).toHaveLength(1);
    expect(plan({ pathname: "/health" })).toHaveLength(0);
  });

  it("claims nothing at all in another auth mode", () => {
    expect(plan({ pathname: "/auth/login", authMode: "token" })).toHaveLength(0);
    expect(
      plan({ pathname: "/auth/mail-hook", authMode: "token", serviceKeyRoutesOnly: true }),
    ).toHaveLength(0);
  });

  describe("serviceKeyRoutesOnly", () => {
    // This is the plan used where the ingress could not name a browser client. The
    // identity server posts undeliverable mail from the container network with the shared
    // service key and no forwarded headers, which is the exact shape that refusal is for.
    // Without this route, invitation links vanish and the service key is never even read.
    it("claims the mail hook", () => {
      expect(plan({ pathname: "/auth/mail-hook", serviceKeyRoutesOnly: true })).toHaveLength(1);
    });

    it.each([
      "/auth/login",
      "/auth/me",
      "/auth/logout",
      "/auth/signup",
      "/auth/invite/accept",
      "/auth/admin/users",
      "/auth/admin/departments",
      "/admin/identity/api/login",
      "/auth/unknown",
    ])("leaves %s refused, because a browser belongs on the other end of it", (pathname) => {
      expect(plan({ pathname, serviceKeyRoutesOnly: true })).toHaveLength(0);
    });
  });
});
