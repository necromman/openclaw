import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserActivityRecordParams } from "../audit/user-activity-audit-recorder.js";
import type { IxAuthVerifiedClaims } from "../auth/ix-auth/ix-auth-types.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

const recorded: UserActivityRecordParams[] = [];

vi.mock("../audit/user-activity-audit-recorder.js", () => ({
  recordUserActivity: (params: UserActivityRecordParams) => {
    recorded.push(params);
    return true;
  },
}));

const { recordIxAuthLoginActivity, recordIxAuthLoginFailureActivity, recordIxAuthLogoutActivity } =
  await import("./ix-auth-activity-audit.js");

function request(): IncomingMessage {
  return {
    headers: { "user-agent": "Mozilla/5.0", "x-request-id": "req-1" },
  } as unknown as IncomingMessage;
}

function deps(): IxAuthHttpDependencies {
  return { clientIp: "10.0.0.7" } as unknown as IxAuthHttpDependencies;
}

function claims(): IxAuthVerifiedClaims {
  return {
    subject: "u-1",
    email: "kim@example.com",
    displayName: "Kim",
    roles: ["MEMBER"],
    groups: ["dept-rnd"],
    identitySessionId: "sid-1",
    expiresAtMs: 0,
  } as IxAuthVerifiedClaims;
}

beforeEach(() => {
  recorded.length = 0;
});

describe("identity route recording", () => {
  it("records a sign-in with the account, its resolved rank and its departments", () => {
    recordIxAuthLoginActivity({
      req: request(),
      deps: deps(),
      profileId: "p1",
      claims: claims(),
      departments: ["dept-rnd"],
      settings: { roleMap: { MEMBER: "member" }, superAdminRoles: ["superadmin"] },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      kind: "login",
      remoteIp: "10.0.0.7",
      userAgent: "Mozilla/5.0",
      requestId: "req-1",
      detail: { identitySessionId: "sid-1" },
      actor: {
        source: "profile",
        profileId: "p1",
        email: "kim@example.com",
        displayName: "Kim",
        gatewayRole: "member",
        departments: ["dept-rnd"],
      },
    });
  });

  it("records a sign-in with no rank when no role maps", () => {
    recordIxAuthLoginActivity({
      req: request(),
      deps: deps(),
      profileId: "p1",
      claims: claims(),
      departments: [],
      settings: { roleMap: {}, superAdminRoles: [] },
    });
    expect(recorded[0]?.actor.gatewayRole).toBeUndefined();
  });

  it("records a sign-out against the account whose session ended", () => {
    recordIxAuthLogoutActivity({
      req: request(),
      deps: deps(),
      profileId: "p1",
      email: "kim@example.com",
    });
    expect(recorded[0]).toMatchObject({
      kind: "logout",
      actor: { source: "profile", profileId: "p1", email: "kim@example.com" },
    });
  });

  it("records a refused sign-in without saying whether the account exists", () => {
    recordIxAuthLoginFailureActivity({
      req: request(),
      deps: deps(),
      email: "nobody@example.com",
      reason: "AUTH_INVALID_CREDENTIALS",
    });
    const row = recorded[0];
    expect(row).toMatchObject({
      kind: "login_failed",
      detail: { reason: "AUTH_INVALID_CREDENTIALS" },
    });
    // No profile id: resolving one would answer "does this address have an account".
    expect(row?.actor.profileId).toBeUndefined();
    expect(row?.actor.email).toBe("nobody@example.com");
  });

  it("records a refused second factor with no address at all", () => {
    recordIxAuthLoginFailureActivity({ req: request(), deps: deps(), reason: "AUTH_MFA_INVALID" });
    expect(recorded[0]?.actor.email).toBeUndefined();
  });
});
