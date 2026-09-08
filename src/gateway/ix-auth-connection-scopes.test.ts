import { describe, expect, it } from "vitest";
import type { GatewayOperatorRoleDefinition } from "../config/types.gateway.js";
import {
  IX_AUTH_CONNECTION_SCOPE_CANDIDATES,
  resolveIxAuthConnectionScopes,
} from "./ix-auth-connection-scopes.js";

/** The five role definitions the delivery template ships (chris-local/AUTH-IXAUTH.md). */
const ROLE_DEFINITIONS: Record<string, GatewayOperatorRoleDefinition> = {
  superadmin: { sessions: { others: "write" }, agents: "*", scopes: ["operator.admin"] },
  admin: {
    sessions: { others: "write" },
    agents: "*",
    scopes: ["operator.read", "operator.write", "operator.approvals", "operator.questions"],
  },
  executive: {
    sessions: { others: "view" },
    agents: "*",
    scopes: ["operator.read", "operator.write", "operator.questions"],
  },
  moderator: {
    sessions: { others: "suggest" },
    agents: "*",
    scopes: ["operator.read", "operator.write", "operator.approvals", "operator.questions"],
  },
  member: {
    sessions: { others: "view" },
    agents: "*",
    scopes: ["operator.read", "operator.write", "operator.questions"],
  },
};

describe("resolveIxAuthConnectionScopes", () => {
  it("gives a system administrator operator.admin", () => {
    // The defect this closes: a superadmin landed without operator.admin, which disables
    // secret mode and model account selection in the Control UI.
    const scopes = resolveIxAuthConnectionScopes(ROLE_DEFINITIONS.superadmin);
    expect(scopes).toContain("operator.admin");
    // operator.admin implies the rest, so the whole Control UI surface comes with it.
    expect(scopes).toEqual([...IX_AUTH_CONNECTION_SCOPE_CANDIDATES]);
  });

  it("gives an administrator read, write, approvals and questions but not admin", () => {
    expect(resolveIxAuthConnectionScopes(ROLE_DEFINITIONS.admin)).toEqual([
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.questions",
    ]);
  });

  it("withholds approvals from an executive and a member", () => {
    for (const role of ["executive", "member"] as const) {
      expect(resolveIxAuthConnectionScopes(ROLE_DEFINITIONS[role])).toEqual([
        "operator.read",
        "operator.write",
        "operator.questions",
      ]);
    }
  });

  it("keeps a moderator's approvals", () => {
    expect(resolveIxAuthConnectionScopes(ROLE_DEFINITIONS.moderator)).toContain(
      "operator.approvals",
    );
  });

  it("returns nothing for a denied role, so the connection holds no scope", () => {
    expect(
      resolveIxAuthConnectionScopes({ sessions: { others: "none" }, agents: [], scopes: [] }),
    ).toEqual([]);
  });

  it("stays out of the way when no role boundary is configured", () => {
    // undefined means "keep the ordinary device-and-header path", which is not the same
    // answer as "grant nothing".
    expect(resolveIxAuthConnectionScopes(undefined)).toBeUndefined();
  });

  it("never hands out a talk scope as a side effect of operator.admin", () => {
    const scopes = resolveIxAuthConnectionScopes(ROLE_DEFINITIONS.superadmin) ?? [];
    expect(scopes).not.toContain("operator.talk");
    expect(scopes).not.toContain("operator.talk.secrets");
  });
});
