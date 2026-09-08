import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserProfileRole = vi.fn<(profileId: string) => string | null>();
const setUserProfileRole = vi.fn<(profileId: string, role: string | null) => unknown>();
const invalidateOperatorRolePolicy = vi.fn<(profileId: string) => void>();

vi.mock("../../state/user-profiles.js", () => ({
  getUserProfileRole: (profileId: string) => getUserProfileRole(profileId),
  setUserProfileRole: (profileId: string, role: string | null) =>
    setUserProfileRole(profileId, role),
}));
vi.mock("../../gateway/operator-role-policy.js", () => ({
  invalidateOperatorRolePolicy: (profileId: string) => invalidateOperatorRolePolicy(profileId),
}));

const { projectIxAuthGatewayRole } = await import("./ix-auth-role-projection.js");

const SETTINGS = {
  roleMap: {
    SUPERADMIN: "superadmin",
    ADMIN: "admin",
    EXECUTIVE: "executive",
    MODERATOR: "moderator",
    MEMBER: "member",
  },
  superAdminRoles: ["superadmin"],
};

describe("projectIxAuthGatewayRole", () => {
  beforeEach(() => {
    getUserProfileRole.mockReset();
    setUserProfileRole.mockReset();
    invalidateOperatorRolePolicy.mockReset();
  });

  it("writes the mapped role onto a profile that has none", () => {
    // This is the state every identity-server login left behind before the projection
    // existed, so the role boundary fell back to gateway.roles.default.
    getUserProfileRole.mockReturnValue(null);
    expect(
      projectIxAuthGatewayRole({
        profileId: "profile-1",
        roles: ["SUPERADMIN"],
        settings: SETTINGS,
      }),
    ).toBe("superadmin");
    expect(setUserProfileRole).toHaveBeenCalledWith("profile-1", "superadmin");
    expect(invalidateOperatorRolePolicy).toHaveBeenCalledWith("profile-1");
  });

  it("takes the most privileged role when a person carries several", () => {
    getUserProfileRole.mockReturnValue(null);
    expect(
      projectIxAuthGatewayRole({
        profileId: "profile-2",
        roles: ["MEMBER", "ADMIN"],
        settings: SETTINGS,
      }),
    ).toBe("admin");
    expect(setUserProfileRole).toHaveBeenCalledWith("profile-2", "admin");
  });

  it("writes nothing when the stored role already matches", () => {
    getUserProfileRole.mockReturnValue("admin");
    expect(
      projectIxAuthGatewayRole({ profileId: "profile-3", roles: ["ADMIN"], settings: SETTINGS }),
    ).toBe("admin");
    expect(setUserProfileRole).not.toHaveBeenCalled();
    expect(invalidateOperatorRolePolicy).not.toHaveBeenCalled();
  });

  it("applies a demotion the identity server made", () => {
    getUserProfileRole.mockReturnValue("superadmin");
    expect(
      projectIxAuthGatewayRole({ profileId: "profile-4", roles: ["MEMBER"], settings: SETTINGS }),
    ).toBe("member");
    expect(setUserProfileRole).toHaveBeenCalledWith("profile-4", "member");
  });

  it("leaves the stored role alone when no code maps", () => {
    // An unmapped code is not evidence of a demotion, so it must not clear an assignment.
    getUserProfileRole.mockReturnValue("admin");
    expect(
      projectIxAuthGatewayRole({ profileId: "profile-5", roles: ["AUDITOR"], settings: SETTINGS }),
    ).toBeUndefined();
    expect(setUserProfileRole).not.toHaveBeenCalled();
  });

  it("does not fail a login when the profile refuses a role assignment", () => {
    // The owner profile throws by design; a login must survive it.
    getUserProfileRole.mockReturnValue(null);
    setUserProfileRole.mockImplementation(() => {
      throw new Error("owner profile");
    });
    expect(
      projectIxAuthGatewayRole({ profileId: "owner", roles: ["ADMIN"], settings: SETTINGS }),
    ).toBeUndefined();
    expect(invalidateOperatorRolePolicy).not.toHaveBeenCalled();
  });
});
