import { describe, expect, it } from "vitest";
import type {
  FolderAccessRule,
  FolderRulePermission,
  FolderRuleSubjectKind,
} from "../../packages/gateway-protocol/src/schema/folder-rules.js";
import {
  narrowerPermission,
  resolveFolderAccess,
  resolveFolderEffectiveRules,
  subjectIdentity,
  type FolderAccessIdentity,
} from "./folder-access-policy.js";

function rule(params: {
  path: string;
  kind: FolderRuleSubjectKind;
  id: string;
  permission: FolderRulePermission;
  inherit?: boolean;
}): FolderAccessRule {
  return {
    id: `${params.kind}:${params.id}:${params.path}`,
    folderPath: params.path,
    subjectKind: params.kind,
    subjectId: params.id,
    permission: params.permission,
    inherit: params.inherit ?? true,
    createdAt: 1,
    updatedAt: 1,
  };
}

const staff: FolderAccessIdentity = {
  profileId: "p-staff",
  gatewayRole: "member",
  departments: ["rnd"],
  isSuperAdmin: false,
};

describe("folder access policy", () => {
  it("hides anything no rule mentions", () => {
    expect(resolveFolderAccess({ folderPath: "00/x", identity: staff, rules: [] })).toEqual({
      permission: "hidden",
      inherited: false,
    });
  });

  it("gives a system administrator write without consulting a rule", () => {
    const verdict = resolveFolderAccess({
      folderPath: "00/x",
      identity: { departments: [], isSuperAdmin: true },
      rules: [rule({ path: "", kind: "role", id: "member", permission: "hidden" })],
    });
    expect(verdict.permission).toBe("write");
  });

  it("inherits a rule from an ancestor and says where it came from", () => {
    const verdict = resolveFolderAccess({
      folderPath: "00/a/b",
      identity: staff,
      rules: [rule({ path: "00", kind: "department", id: "rnd", permission: "read" })],
    });
    expect(verdict).toEqual({ permission: "read", sourcePath: "00", inherited: true });
  });

  it("ignores an ancestor rule that was written for that folder only", () => {
    const verdict = resolveFolderAccess({
      folderPath: "00/a",
      identity: staff,
      rules: [
        rule({ path: "00", kind: "department", id: "rnd", permission: "read", inherit: false }),
      ],
    });
    expect(verdict.permission).toBe("hidden");
  });

  it("lets a deeper folder overturn a shallower one, in both directions", () => {
    const openShare = rule({ path: "06", kind: "user", id: "p-staff", permission: "read" });
    const closeOneFolder = rule({
      path: "06/12. secure",
      kind: "department",
      id: "rnd",
      permission: "hidden",
    });
    // This is the case that decides the whole ordering: a personal rule opening a share
    // must not keep a department rule from closing one folder inside it.
    expect(
      resolveFolderAccess({
        folderPath: "06/12. secure",
        identity: staff,
        rules: [openShare, closeOneFolder],
      }).permission,
    ).toBe("hidden");
    expect(
      resolveFolderAccess({ folderPath: "06/other", identity: staff, rules: [openShare] })
        .permission,
    ).toBe("read");
  });

  it("prefers the more specific subject when several match the same folder", () => {
    const rules = [
      rule({ path: "00", kind: "role", id: "member", permission: "write" }),
      rule({ path: "00", kind: "department", id: "rnd", permission: "read" }),
      rule({ path: "00", kind: "user", id: "p-staff", permission: "hidden" }),
    ];
    expect(resolveFolderAccess({ folderPath: "00", identity: staff, rules }).permission).toBe(
      "hidden",
    );
    expect(
      resolveFolderAccess({
        folderPath: "00",
        identity: { ...staff, profileId: "p-other" },
        rules,
      }).permission,
    ).toBe("read");
    expect(
      resolveFolderAccess({
        folderPath: "00",
        identity: { ...staff, profileId: "p-other", departments: ["qa"] },
        rules,
      }).permission,
    ).toBe("write");
  });

  it("takes the narrower answer when a person has two departments", () => {
    const both: FolderAccessIdentity = { ...staff, departments: ["rnd", "qa"] };
    const verdict = resolveFolderAccess({
      folderPath: "00",
      identity: both,
      rules: [
        rule({ path: "00", kind: "department", id: "rnd", permission: "write" }),
        rule({ path: "00", kind: "department", id: "qa", permission: "hidden" }),
      ],
    });
    // Adding a department is not a way to widen a boundary.
    expect(verdict.permission).toBe("hidden");
  });

  it("hides a path it cannot place and the bookkeeping directories", () => {
    expect(
      resolveFolderAccess({ folderPath: undefined, identity: staff, rules: [] }).permission,
    ).toBe("hidden");
    expect(
      resolveFolderAccess({
        folderPath: "00/@eaDir",
        identity: staff,
        rules: [rule({ path: "", kind: "role", id: "member", permission: "write" })],
      }).permission,
    ).toBe("hidden");
  });

  it("matches a role rule only against the caller's own rank", () => {
    const rules = [rule({ path: "00", kind: "role", id: "executive", permission: "read" })];
    expect(resolveFolderAccess({ folderPath: "00", identity: staff, rules }).permission).toBe(
      "hidden",
    );
    expect(
      resolveFolderAccess({
        folderPath: "00",
        identity: { ...staff, gatewayRole: "executive" },
        rules,
      }).permission,
    ).toBe("read");
  });

  it("normalizes department slug case on both sides of the comparison", () => {
    const verdict = resolveFolderAccess({
      folderPath: "00",
      identity: { ...staff, departments: ["RnD"] },
      rules: [rule({ path: "00", kind: "department", id: "RND", permission: "read" })],
    });
    expect(verdict.permission).toBe("read");
  });
});

describe("effective rules for the editor", () => {
  it("resolves every subject named in the chain, deepest rule winning", () => {
    const effective = resolveFolderEffectiveRules({
      folderPath: "00/a",
      rules: [
        rule({ path: "", kind: "role", id: "member", permission: "read" }),
        rule({ path: "00", kind: "department", id: "rnd", permission: "write" }),
        rule({ path: "00/a", kind: "department", id: "rnd", permission: "hidden" }),
      ],
    });
    expect(effective).toEqual([
      {
        subjectKind: "department",
        subjectId: "rnd",
        permission: "hidden",
        sourcePath: "00/a",
        inherited: false,
      },
      {
        subjectKind: "role",
        subjectId: "member",
        permission: "read",
        sourcePath: "",
        inherited: true,
      },
    ]);
  });
});

describe("permission helpers", () => {
  it("picks the stricter of two permissions", () => {
    expect(narrowerPermission("write", "read")).toBe("read");
    expect(narrowerPermission("read", "hidden")).toBe("hidden");
    expect(narrowerPermission("write", "write")).toBe("write");
  });

  it("builds an identity that matches exactly one subject and no rank", () => {
    expect(subjectIdentity("user", "p1")).toEqual({
      profileId: "p1",
      departments: [],
      isSuperAdmin: false,
    });
    expect(subjectIdentity("department", "rnd").departments).toEqual(["rnd"]);
    expect(subjectIdentity("role", "admin").gatewayRole).toBe("admin");
    expect(subjectIdentity("role", "superadmin").isSuperAdmin).toBe(false);
  });
});
