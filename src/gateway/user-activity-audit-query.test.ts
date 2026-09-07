import { describe, expect, it } from "vitest";
import { scopeUserActivityFilters, type UserActivityAuditReader } from "./user-activity-audit-query.js";

function ixAuth(params: {
  gatewayRole?: string;
  departments?: string[];
  isSuperAdmin?: boolean;
}): UserActivityAuditReader {
  return {
    kind: "ix-auth",
    actor: {
      profileId: "p-admin",
      email: "admin@example.com",
      ...(params.gatewayRole ? { gatewayRole: params.gatewayRole } : {}),
      departments: params.departments ?? [],
      isSuperAdmin: params.isSuperAdmin === true,
    },
  };
}

describe("activity ledger read authorization", () => {
  it("lets the host operator read everything unfiltered", () => {
    expect(scopeUserActivityFilters({ kind: "host" }, { kind: "login" })).toEqual({
      kind: "login",
    });
  });

  it("lets a system administrator read everything unfiltered", () => {
    expect(
      scopeUserActivityFilters(
        ixAuth({ gatewayRole: "superadmin", isSuperAdmin: true, departments: ["dept-rnd"] }),
        {},
      ),
    ).toEqual({});
  });

  it("narrows an administrator to their own departments", () => {
    expect(
      scopeUserActivityFilters(ixAuth({ gatewayRole: "admin", departments: ["dept-rnd"] }), {
        kind: "prompt",
      }),
    ).toEqual({ kind: "prompt", departments: ["dept-rnd"] });
  });

  it("narrows a department-less administrator to their own rows", () => {
    // An administrator with no department is an incomplete setup; the narrow reading of
    // an incomplete setup is the safe one.
    expect(scopeUserActivityFilters(ixAuth({ gatewayRole: "admin" }), {})).toEqual({
      profileId: "p-admin",
    });
  });

  it("refuses every other account", () => {
    for (const gatewayRole of ["executive", "moderator", "member", undefined]) {
      expect(scopeUserActivityFilters(ixAuth({ gatewayRole }), {})).toBeUndefined();
    }
  });

  it("does not let a requested filter widen a scoped reader", () => {
    const scoped = scopeUserActivityFilters(
      ixAuth({ gatewayRole: "admin", departments: ["dept-rnd"] }),
      { departments: ["dept-qa"] },
    );
    expect(scoped?.departments).toEqual(["dept-rnd"]);
  });
});
