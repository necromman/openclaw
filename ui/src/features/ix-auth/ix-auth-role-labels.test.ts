// @vitest-environment node
import { describe, expect, it } from "vitest";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import {
  IX_AUTH_LABELLED_GATEWAY_ROLES,
  ixAuthRoleLabel,
  ixAuthRoleLabelKey,
  resolveIxAuthGatewayRoleName,
} from "./ix-auth-role-labels.ts";

// The labels live in the lazily loaded identity catalog, exactly as the screens load it.
registerIxAuthEnglish();

describe("resolveIxAuthGatewayRoleName", () => {
  it("reads an identity-server role code", () => {
    expect(resolveIxAuthGatewayRoleName("SUPERADMIN")).toBe("superadmin");
    expect(resolveIxAuthGatewayRoleName("ADMIN")).toBe("admin");
    expect(resolveIxAuthGatewayRoleName("EXECUTIVE")).toBe("executive");
    expect(resolveIxAuthGatewayRoleName("MODERATOR")).toBe("moderator");
    expect(resolveIxAuthGatewayRoleName("MEMBER")).toBe("member");
  });

  it("reads a gateway role name, which is what a signed-in session carries", () => {
    for (const role of IX_AUTH_LABELLED_GATEWAY_ROLES) {
      expect(resolveIxAuthGatewayRoleName(role)).toBe(role);
    }
  });

  it("ignores case and surrounding space, because both vocabularies reach it", () => {
    expect(resolveIxAuthGatewayRoleName("  executive ")).toBe("executive");
    expect(resolveIxAuthGatewayRoleName("Member")).toBe("member");
  });

  it("has no name for a role this build does not know", () => {
    expect(resolveIxAuthGatewayRoleName("auditor")).toBeUndefined();
    expect(resolveIxAuthGatewayRoleName("")).toBeUndefined();
    expect(resolveIxAuthGatewayRoleName("   ")).toBeUndefined();
  });
});

describe("ixAuthRoleLabelKey", () => {
  it("names one catalog key per rank", () => {
    expect(ixAuthRoleLabelKey("EXECUTIVE")).toBe("ixAuth.roles.executive");
    expect(ixAuthRoleLabelKey("superadmin")).toBe("ixAuth.roles.superadmin");
  });

  it("names no key for a role the catalog has no word for", () => {
    expect(ixAuthRoleLabelKey("auditor")).toBeUndefined();
  });
});

describe("ixAuthRoleLabel", () => {
  it("prints a word rather than a role code", () => {
    expect(ixAuthRoleLabel("EXECUTIVE")).toBe("Executive");
    expect(ixAuthRoleLabel("executive")).toBe("Executive");
    expect(ixAuthRoleLabel("MEMBER")).toBe("Staff");
    expect(ixAuthRoleLabel("SUPERADMIN")).toBe("System administrator");
  });

  it("gives every known rank its own label, so none reads as another", () => {
    const labels = IX_AUTH_LABELLED_GATEWAY_ROLES.map((role) => ixAuthRoleLabel(role));
    expect(new Set(labels).size).toBe(IX_AUTH_LABELLED_GATEWAY_ROLES.length);
    // A missing catalog entry would surface as the key itself, never as a word.
    expect(labels.some((label) => label.startsWith("ixAuth."))).toBe(false);
  });

  it("falls back to the configured name for a role it cannot translate", () => {
    // A deployment may map its own codes through gateway.auth.ixAuth.roleMap.
    expect(ixAuthRoleLabel("auditor")).toBe("auditor");
  });
});
