import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  planIxAuthHttpStages,
  runIxAuthServiceKeyRoute,
  type IxAuthStageParams,
} from "./ix-auth-http-stage.js";

// Only what each entry point claims is exercised here. Running a stage would pull in the
// identity client, its session store and the JWKS verifier; what matters at this seam is
// which paths reach a stage at all.
function params(pathname: string, authMode = "ix-auth"): IxAuthStageParams {
  return {
    authMode,
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    pathname,
    config: {} as OpenClawConfig,
  };
}

describe("planIxAuthHttpStages", () => {
  it("claims the whole authentication namespace", () => {
    expect(planIxAuthHttpStages(params("/auth/login"))).toHaveLength(1);
    expect(planIxAuthHttpStages(params("/auth/mail-hook"))).toHaveLength(1);
    expect(planIxAuthHttpStages(params("/admin/identity/api/login"))).toHaveLength(1);
  });

  it("leaves everything outside it alone", () => {
    expect(planIxAuthHttpStages(params("/health"))).toHaveLength(0);
    expect(planIxAuthHttpStages(params("/auth/login", "token"))).toHaveLength(0);
  });
});

describe("runIxAuthServiceKeyRoute", () => {
  // This runs where the ingress could not name a browser client. The identity server posts
  // undeliverable mail from the container network with the shared service key and no
  // forwarded headers, which is the exact shape that refusal is for. Without this route,
  // invitation links vanish and the service key is never even read.
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
    "/health",
  ])("refuses %s, because a browser belongs on the other end of it", async (pathname) => {
    await expect(runIxAuthServiceKeyRoute(params(pathname), "172.16.240.4")).resolves.toBe(false);
  });

  it("refuses the mail hook itself in another auth mode", async () => {
    await expect(
      runIxAuthServiceKeyRoute(params("/auth/mail-hook", "token"), "172.16.240.4"),
    ).resolves.toBe(false);
  });

  it("takes the mail hook", async () => {
    // Unconfigured here, so the stage answers 404 rather than reading a service key. What
    // this proves is that the route was claimed at all: before the fix it never was, and
    // the caller refused it with 403 before any of this ran.
    const recorded: { statusCode?: number; ended?: unknown } = {};
    const res = {
      set statusCode(value: number) {
        recorded.statusCode = value;
      },
      setHeader: () => {},
      end: (body?: unknown) => {
        recorded.ended = body;
      },
    } as unknown as ServerResponse;
    const claimed = await runIxAuthServiceKeyRoute(
      { ...params("/auth/mail-hook"), res },
      "172.16.240.4",
    );
    expect(claimed).toBe(true);
    expect(recorded.statusCode).toBe(404);
  });
});
