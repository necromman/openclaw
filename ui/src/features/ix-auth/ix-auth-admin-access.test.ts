import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canManageIxAuthDepartments,
  canManageIxAuthUsers,
  isIxAuthAdminRole,
  setIxAuthAdminAccess,
  setIxAuthSuperAdminAccess,
} from "./ix-auth-admin-access.ts";
import { probeIxAuthSession } from "./ix-auth-session-api.ts";

function stubProbeResponse(body: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setIxAuthAdminAccess(false);
  setIxAuthSuperAdminAccess(false);
});

describe("isIxAuthAdminRole", () => {
  it.each(["superadmin", "admin"])("admits %s, the roles the admin routes serve", (role) => {
    expect(isIxAuthAdminRole(role)).toBe(true);
  });

  it.each(["executive", "moderator", "member", "", "ADMIN", undefined])(
    "refuses %s",
    (role) => {
      expect(isIxAuthAdminRole(role)).toBe(false);
    },
  );
});

describe("what the session probe records", () => {
  // The regression this file exists for. The Gateway sends the console URL to a superadmin
  // and to nobody else, and the flag used to be read from its presence, so an ordinary
  // administrator was shut out of the user and audit screens the Gateway serves them.
  it("gives an administrator the company screens without a console URL", async () => {
    stubProbeResponse({
      authMode: "ix-auth",
      authenticated: true,
      user: {
        profileId: "p-2",
        email: "admin.test@deploy.local",
        gatewayRole: "admin",
        isSuperAdmin: false,
      },
    });
    await probeIxAuthSession("");
    expect(canManageIxAuthUsers()).toBe(true);
    // The department screen answers the same question since P: running the company's
    // departments is the same job as running its accounts (AUTH-IXAUTH 5-1).
    expect(canManageIxAuthDepartments()).toBe(true);
  });

  it("gives a system administrator both", async () => {
    stubProbeResponse({
      authMode: "ix-auth",
      authenticated: true,
      adminConsoleUrl: "/admin/identity",
      user: {
        profileId: "p-1",
        email: "admin@deploy.local",
        gatewayRole: "superadmin",
        isSuperAdmin: true,
      },
    });
    await probeIxAuthSession("");
    expect(canManageIxAuthUsers()).toBe(true);
    expect(canManageIxAuthDepartments()).toBe(true);
  });

  it.each(["executive", "moderator", "member"])("gives %s neither", async (role) => {
    stubProbeResponse({
      authMode: "ix-auth",
      authenticated: true,
      user: { profileId: "p-3", email: "someone@deploy.local", gatewayRole: role },
    });
    await probeIxAuthSession("");
    expect(canManageIxAuthUsers()).toBe(false);
    expect(canManageIxAuthDepartments()).toBe(false);
  });

  it("records nothing for a Gateway in another auth mode", async () => {
    stubProbeResponse({ authMode: "token", authenticated: true });
    await probeIxAuthSession("");
    expect(canManageIxAuthUsers()).toBe(false);
  });
});
