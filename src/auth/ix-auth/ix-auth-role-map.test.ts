import { describe, expect, it } from "vitest";
import {
  canOpenIxAuthAdminConsole,
  canUseIxAuthAdminApi,
  IX_AUTH_DEFAULT_ROLE_MAP,
  IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES,
  resolveIxAuthGatewayRole,
} from "./ix-auth-role-map.js";

const DEFAULT_SETTINGS = {
  roleMap: { ...IX_AUTH_DEFAULT_ROLE_MAP },
  superAdminRoles: [...IX_AUTH_DEFAULT_SUPER_ADMIN_ROLES],
};

describe("resolveIxAuthGatewayRole", () => {
  it("maps each default identity role onto its gateway role", () => {
    // The five tiers the fork ships, listed so a dropped or renamed one fails here.
    expect({ ...IX_AUTH_DEFAULT_ROLE_MAP }).toEqual({
      SUPERADMIN: "superadmin",
      ADMIN: "admin",
      EXECUTIVE: "executive",
      MODERATOR: "moderator",
      MEMBER: "member",
    });
    for (const [code, expected] of Object.entries(IX_AUTH_DEFAULT_ROLE_MAP)) {
      expect(resolveIxAuthGatewayRole({ roles: [code], settings: DEFAULT_SETTINGS }).gatewayRole).toBe(
        expected,
      );
    }
  });

  it("takes the most privileged role when a user carries several", () => {
    expect(
      resolveIxAuthGatewayRole({ roles: ["MEMBER", "ADMIN"], settings: DEFAULT_SETTINGS })
        .gatewayRole,
    ).toBe("admin");
    expect(
      resolveIxAuthGatewayRole({
        roles: ["MEMBER", "MODERATOR", "SUPERADMIN"],
        settings: DEFAULT_SETTINGS,
      }).gatewayRole,
    ).toBe("superadmin");
  });

  it("orders the five tiers superadmin, admin, executive, moderator, member", () => {
    // Every adjacent pair, so inserting a tier in the wrong slot fails here rather than
    // silently demoting somebody in production.
    const ordered = ["SUPERADMIN", "ADMIN", "EXECUTIVE", "MODERATOR", "MEMBER"] as const;
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const higher = ordered[index] ?? "";
      const lower = ordered[index + 1] ?? "";
      expect(
        resolveIxAuthGatewayRole({ roles: [lower, higher], settings: DEFAULT_SETTINGS })
          .gatewayRole,
      ).toBe(IX_AUTH_DEFAULT_ROLE_MAP[higher]);
    }
  });

  it("keeps an executive below an administrator and above a moderator", () => {
    expect(
      resolveIxAuthGatewayRole({ roles: ["EXECUTIVE", "ADMIN"], settings: DEFAULT_SETTINGS })
        .gatewayRole,
    ).toBe("admin");
    expect(
      resolveIxAuthGatewayRole({ roles: ["MODERATOR", "EXECUTIVE"], settings: DEFAULT_SETTINGS })
        .gatewayRole,
    ).toBe("executive");
    // Being an executive is a reach, never a super-admin promotion.
    expect(
      resolveIxAuthGatewayRole({ roles: ["EXECUTIVE"], settings: DEFAULT_SETTINGS }).isSuperAdmin,
    ).toBe(false);
  });

  it("returns no role when nothing maps, so the caller falls back to the default role", () => {
    const result = resolveIxAuthGatewayRole({ roles: ["PM", "SALES"], settings: DEFAULT_SETTINGS });
    expect(result.gatewayRole).toBeUndefined();
    expect(result.isSuperAdmin).toBe(false);
  });

  it("returns no role for a user with no identity roles at all", () => {
    expect(resolveIxAuthGatewayRole({ roles: [], settings: DEFAULT_SETTINGS }).gatewayRole).toBeUndefined();
  });

  it("marks super admins only when the mapped name is listed as one", () => {
    expect(
      resolveIxAuthGatewayRole({ roles: ["SUPERADMIN"], settings: DEFAULT_SETTINGS }).isSuperAdmin,
    ).toBe(true);
    expect(
      resolveIxAuthGatewayRole({ roles: ["ADMIN"], settings: DEFAULT_SETTINGS }).isSuperAdmin,
    ).toBe(false);
  });

  it("refuses to grant super admin through a role map typo alone", () => {
    // Someone maps a stray identity code onto the superadmin role name but does not add
    // it to superAdminRoles. The mapping must not be enough by itself.
    const settings = {
      roleMap: { ...IX_AUTH_DEFAULT_ROLE_MAP, INTERN: "superadmin" },
      superAdminRoles: ["never-assigned-role"],
    };
    const result = resolveIxAuthGatewayRole({ roles: ["INTERN"], settings });
    expect(result.gatewayRole).toBe("superadmin");
    expect(result.isSuperAdmin).toBe(false);
  });

  it("honours a custom role map that overrides the defaults", () => {
    const settings = {
      roleMap: { OWNER: "superadmin", STAFF: "member" },
      superAdminRoles: ["superadmin"],
    };
    expect(resolveIxAuthGatewayRole({ roles: ["OWNER"], settings }).isSuperAdmin).toBe(true);
    expect(resolveIxAuthGatewayRole({ roles: ["STAFF"], settings }).gatewayRole).toBe("member");
    // Default codes are no longer present in the custom map.
    expect(resolveIxAuthGatewayRole({ roles: ["ADMIN"], settings }).gatewayRole).toBeUndefined();
  });

  it("ranks an unrecognized mapped name below every known one", () => {
    const settings = {
      roleMap: { CUSTOM: "auditor", MEMBER: "member" },
      superAdminRoles: ["superadmin"],
    };
    expect(resolveIxAuthGatewayRole({ roles: ["CUSTOM", "MEMBER"], settings }).gatewayRole).toBe(
      "member",
    );
    // Including below the tier added for this fork.
    const withExecutive = {
      roleMap: { CUSTOM: "auditor", EXECUTIVE: "executive" },
      superAdminRoles: ["superadmin"],
    };
    expect(
      resolveIxAuthGatewayRole({ roles: ["CUSTOM", "EXECUTIVE"], settings: withExecutive })
        .gatewayRole,
    ).toBe("executive");
  });
});

describe("canOpenIxAuthAdminConsole", () => {
  it("offers the identity server's console to super admins only", () => {
    expect(canOpenIxAuthAdminConsole("superadmin")).toBe(true);
  });

  it("withholds it from an administrator", () => {
    // The console is unscoped and the baseline seed gives the ADMIN role every console
    // permission, so opening it would hand an administrator account creation and role
    // assignment. Their own administration screens stay open; see the predicate below.
    expect(canOpenIxAuthAdminConsole("admin")).toBe(false);
  });

  it("withholds it from everyone else, including unmapped users", () => {
    // An executive reads across departments but never manages accounts.
    expect(canOpenIxAuthAdminConsole("executive")).toBe(false);
    expect(canOpenIxAuthAdminConsole("moderator")).toBe(false);
    expect(canOpenIxAuthAdminConsole("member")).toBe(false);
    expect(canOpenIxAuthAdminConsole(undefined)).toBe(false);
  });
});

describe("canUseIxAuthAdminApi", () => {
  it("admits super admins and administrators to the fork's own admin routes", () => {
    expect(canUseIxAuthAdminApi("superadmin")).toBe(true);
    expect(canUseIxAuthAdminApi("admin")).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(canUseIxAuthAdminApi("executive")).toBe(false);
    expect(canUseIxAuthAdminApi("moderator")).toBe(false);
    expect(canUseIxAuthAdminApi("member")).toBe(false);
    expect(canUseIxAuthAdminApi(undefined)).toBe(false);
  });

  it("is wider than the console predicate, which is the point of having two", () => {
    expect(canOpenIxAuthAdminConsole("admin")).toBe(false);
    expect(canUseIxAuthAdminApi("admin")).toBe(true);
  });
});
