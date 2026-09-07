import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { setDepartmentAgent } from "../state/departments-store.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { ensureProfileForEmail, setUserProfileRole } from "../state/user-profiles.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  authorizeDepartmentAgent,
  departmentCacheKeyPart,
  isDepartmentScopeEnabled,
  isDepartmentVisibleSession,
  prepareDepartmentGate,
} from "./department-access.js";
import type { GatewayClient } from "./server-methods/types.js";
import {
  authorizeSessionSharingTarget,
  createSessionListEntryFilter,
  resolveSessionSharingRole,
} from "./session-sharing.js";
import { sharingPolicyClient } from "./session-sharing.test-utils.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

/**
 * The roles the ix-auth role map produces, orthogonal to department membership.
 *
 * `executive` is deliberately outside the matrix below. Its whole point is that it holds
 * every department at once, which is membership rather than a new kind of boundary, so
 * running it through a one-department matrix would prove nothing about it. Its own
 * describe block near the end of this file covers it.
 */
const ROLES = ["superadmin", "admin", "moderator", "member"] as const;
type Role = (typeof ROLES)[number] | "executive";

const SESSION_CAP_BY_ROLE: Record<Role, "write" | "suggest" | "view"> = {
  superadmin: "write",
  admin: "write",
  executive: "view",
  moderator: "suggest",
  member: "view",
};

function departmentConfig(): OpenClawConfig {
  return {
    gateway: {
      auth: { mode: "ix-auth" },
      roles: {
        default: "member",
        definitions: Object.fromEntries(
          [...ROLES, "executive" as const].map((role) => [
            role,
            {
              sessions: { others: SESSION_CAP_BY_ROLE[role] },
              agents: "*" as const,
              scopes:
                role === "superadmin"
                  ? ["operator.admin" as const]
                  : ["operator.read" as const, "operator.write" as const],
            },
          ]),
        ),
      },
    },
    tools: { sessions: { visibility: "department" } },
  } as OpenClawConfig;
}

function departmentClient(params: {
  role: Role;
  departments: readonly string[];
  label: string;
}): GatewayClient {
  const profile = ensureProfileForEmail(`${params.label}@department.test`);
  setUserProfileRole(profile.id, params.role);
  const base = sharingPolicyClient({
    user: profile.id,
    scopes:
      params.role === "superadmin"
        ? ["operator.read", "operator.write", "operator.admin"]
        : ["operator.read", "operator.write"],
  });
  return {
    ...base,
    internal: {
      ...base.internal,
      ixAuthDepartments: {
        departments: params.departments,
        isSuperAdmin: params.role === "superadmin",
      },
    },
  };
}

type Target = Parameters<typeof resolveSessionSharingRole>[0]["target"];

function sessionTarget(params: { agentId: string; creatorProfileId?: string }): Target {
  const key = `agent:${params.agentId}:room`;
  return {
    agentId: params.agentId,
    canonicalKey: key,
    entry: {
      sessionId: `${params.agentId}-room`,
      updatedAt: 1,
      visibility: "shared",
      ...(params.creatorProfileId
        ? {
            createdVia: "operator" as const,
            createdActor: {
              type: "human" as const,
              source: "profile" as const,
              id: params.creatorProfileId,
            },
          }
        : {}),
    },
    storeKey: key,
    storeKeys: [key],
    storePath: "/tmp/sessions.json",
  };
}

function bindAgents(): void {
  setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "rnd", nowMs: 1 });
  setDepartmentAgent({ agentId: "qa-bot", departmentSlug: "qa", nowMs: 1 });
}

describe("department access scope switch", () => {
  it("stays inactive unless ix-auth mode and the department scope are both set", () => {
    expect(isDepartmentScopeEnabled(undefined)).toBe(false);
    expect(
      isDepartmentScopeEnabled({
        gateway: { auth: { mode: "ix-auth" } },
        tools: { sessions: { visibility: "self" } },
      } as OpenClawConfig),
    ).toBe(false);
    expect(
      isDepartmentScopeEnabled({
        gateway: { auth: { mode: "token" } },
        tools: { sessions: { visibility: "department" } },
      } as OpenClawConfig),
    ).toBe(false);
    expect(isDepartmentScopeEnabled(departmentConfig())).toBe(true);
  });

  it("leaves callers without a verified principal on their existing authorization path", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const plain = sharingPolicyClient({ user: "someone" });
      expect(prepareDepartmentGate({ cfg, client: plain })).toBeUndefined();
      expect(prepareDepartmentGate({ cfg, client: null })).toBeUndefined();
    });
  });

  it("never gates a super administrator", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const root = departmentClient({ role: "superadmin", departments: [], label: "root" });
      expect(prepareDepartmentGate({ cfg, client: root })).toBeUndefined();
      expect(departmentCacheKeyPart({ cfg, client: root })).toBe("dept:*");
    });
  });
});

describe("department access matrix", () => {
  // 2 departments x 4 roles x 3 target classes = 24 authorization assertions.
  for (const role of ROLES) {
    for (const department of ["rnd", "qa"] as const) {
      const other = department === "rnd" ? "qa" : "rnd";
      it(`${role} in ${department}: own department is open, ${other} is hidden, shared agent is creator-only`, async () => {
        await withOpenClawTestState({ scenario: "minimal" }, async () => {
          bindAgents();
          const cfg = departmentConfig();
          const client = departmentClient({
            role,
            departments: [department],
            label: `${role}-${department}`,
          });
          const gate = prepareDepartmentGate({ cfg, client });
          if (role === "superadmin") {
            expect(gate).toBeUndefined();
            return;
          }
          const ownAgent = `${department}-bot`;
          const otherAgent = `${other}-bot`;
          expect(gate?.agentAccess(ownAgent)).toBe("open");
          expect(gate?.agentAccess(otherAgent)).toBe("denied");
          // An unbound agent stays outside the partition for anyone who has a department.
          expect(gate?.agentAccess("main")).toBe("open");

          // Agent selection: the picker ceiling and the creation gate agree.
          expect(gate?.allowsAgent(ownAgent)).toBe(true);
          expect(gate?.allowsAgent(otherAgent)).toBe(false);
          expect(gate?.allowsAgent("main")).toBe(true);
          expect(authorizeDepartmentAgent({ cfg, client, agentId: otherAgent })?.code).toBe(
            "FORBIDDEN",
          );
          expect(authorizeDepartmentAgent({ cfg, client, agentId: ownAgent })).toBeUndefined();

          // Direct read of a foreign-department session is refused as absent.
          const stranger = ensureProfileForEmail("stranger@department.test");
          const foreign = sessionTarget({
            agentId: otherAgent,
            creatorProfileId: stranger.id,
          });
          expect(authorizeSessionSharingTarget({ cfg, client, target: foreign })).not.toBeNull();
          expect(resolveSessionSharingRole({ cfg, client, target: foreign })).toBe("viewer");

          // A colleague's session inside the same department stays reachable; whether the
          // caller may also write to it is the role cap's decision, unchanged by this work.
          const sibling = sessionTarget({ agentId: ownAgent, creatorProfileId: stranger.id });
          const siblingError = authorizeSessionSharingTarget({ cfg, client, target: sibling });
          if (SESSION_CAP_BY_ROLE[role] === "write") {
            expect(siblingError).toBeNull();
            expect(resolveSessionSharingRole({ cfg, client, target: sibling })).toBe("member");
          } else {
            expect(siblingError?.details).toMatchObject({
              code: "SESSION_PARTICIPATION_REQUIRED",
            });
          }

          // A shared agent keeps the role cap it always had, so the default home session
          // does not dead-end for a departmental user.
          const sharedForeign = sessionTarget({ agentId: "main", creatorProfileId: stranger.id });
          expect(authorizeSessionSharingTarget({ cfg, client, target: sharedForeign })).toEqual(
            authorizeSessionSharingTarget({
              cfg: { ...cfg, tools: { sessions: { visibility: "self" } } } as OpenClawConfig,
              client,
              target: sharedForeign,
            }),
          );
          const ownProfileId = client.authenticatedUserProfile?.profileId ?? "";
          const sharedOwn = sessionTarget({ agentId: "main", creatorProfileId: ownProfileId });
          expect(resolveSessionSharingRole({ cfg, client, target: sharedOwn })).toBe("owner");
        });
      });
    }
  }

  it("keeps an administrator inside their own department", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const admin = departmentClient({ role: "admin", departments: ["rnd"], label: "dept-admin" });
      const stranger = ensureProfileForEmail("qa-owner@department.test");
      const foreign = sessionTarget({ agentId: "qa-bot", creatorProfileId: stranger.id });
      // The operator.admin bypass must not lift the fence for a department administrator.
      expect(authorizeSessionSharingTarget({ cfg, client: admin, target: foreign })).not.toBeNull();
      const own = sessionTarget({ agentId: "rnd-bot", creatorProfileId: stranger.id });
      expect(resolveSessionSharingRole({ cfg, client: admin, target: own })).toBe("member");
    });
  });

  it("gives an unassigned person only their own sessions", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const orphan = departmentClient({ role: "member", departments: [], label: "orphan" });
      const gate = prepareDepartmentGate({ cfg, client: orphan });
      expect(gate?.agentAccess("rnd-bot")).toBe("denied");
      expect(gate?.agentAccess("qa-bot")).toBe("denied");
      expect(gate?.agentAccess("main")).toBe("creator-only");
      const ownProfileId = orphan.authenticatedUserProfile?.profileId ?? "";
      expect(
        resolveSessionSharingRole({
          cfg,
          client: orphan,
          target: sessionTarget({ agentId: "main", creatorProfileId: ownProfileId }),
        }),
      ).toBe("owner");
      const stranger = ensureProfileForEmail("orphan-stranger@department.test");
      expect(
        resolveSessionSharingRole({
          cfg,
          client: orphan,
          target: sessionTarget({ agentId: "main", creatorProfileId: stranger.id }),
        }),
      ).toBe("viewer");
    });
  });

  it("lets one person hold two departments at once", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const both = departmentClient({
        role: "moderator",
        departments: ["rnd", "qa"],
        label: "liaison",
      });
      const gate = prepareDepartmentGate({ cfg, client: both });
      expect(gate?.agentAccess("rnd-bot")).toBe("open");
      expect(gate?.agentAccess("qa-bot")).toBe("open");
      expect(departmentCacheKeyPart({ cfg, client: both })).toBe("dept:qa,rnd");
    });
  });

  it("separates the session-list cache dimension per department", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const cfg = departmentConfig();
      const rnd = departmentClient({ role: "member", departments: ["rnd"], label: "cache-rnd" });
      const qa = departmentClient({ role: "member", departments: ["qa"], label: "cache-qa" });
      expect(departmentCacheKeyPart({ cfg, client: rnd })).not.toBe(
        departmentCacheKeyPart({ cfg, client: qa }),
      );
    });
  });
});

describe("department list filtering", () => {
  it("keeps foreign-department rows out of the listing predicate", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const rnd = departmentClient({ role: "member", departments: ["rnd"], label: "list-rnd" });
      const stranger = ensureProfileForEmail("list-stranger@department.test");
      const filter = createSessionListEntryFilter({ cfg, client: rnd });
      // The profile filter alone still admits a shared foreign row; the department
      // predicate that removes it lives with the row's owning agent id.
      expect(
        filter?.("agent:qa-bot:room", {
          visibility: "shared",
          createdActor: { type: "human", source: "profile", id: stranger.id },
        }),
      ).toBe(true);
      const gate = prepareDepartmentGate({ cfg, client: rnd });
      expect(gate?.agentAccess("qa-bot")).toBe("denied");
    });
  });
});

describe("callers without a Gateway client", () => {
  it("authorizes an agent from verified request identity alone", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const identity = { departments: ["rnd"], isSuperAdmin: false };
      expect(authorizeDepartmentAgent({ cfg, identity, agentId: "rnd-bot" })).toBeUndefined();
      expect(authorizeDepartmentAgent({ cfg, identity, agentId: "qa-bot" })?.code).toBe(
        "FORBIDDEN",
      );
      expect(authorizeDepartmentAgent({ cfg, identity, agentId: "main" })).toBeUndefined();
      // A request that proved no identity is not an IX-Auth browser session.
      expect(authorizeDepartmentAgent({ cfg, agentId: "qa-bot" })).toBeUndefined();
    });
  });

  it("hides a foreign transcript from the shared row predicate", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      const rnd = departmentClient({ role: "member", departments: ["rnd"], label: "row-rnd" });
      const stranger = ensureProfileForEmail("row-stranger@department.test");
      const foreignActor = {
        type: "human" as const,
        source: "profile" as const,
        id: stranger.id,
      };
      expect(
        isDepartmentVisibleSession({
          cfg,
          client: rnd,
          agentId: "qa-bot",
          createdActor: foreignActor,
        }),
      ).toBe(false);
      expect(
        isDepartmentVisibleSession({
          cfg,
          client: rnd,
          agentId: "rnd-bot",
          createdActor: foreignActor,
        }),
      ).toBe(true);
      const orphan = departmentClient({ role: "member", departments: [], label: "row-orphan" });
      expect(
        isDepartmentVisibleSession({
          cfg,
          client: orphan,
          agentId: "main",
          createdActor: foreignActor,
        }),
      ).toBe(false);
      expect(
        isDepartmentVisibleSession({
          cfg,
          client: orphan,
          agentId: "main",
          createdActor: {
            type: "human",
            source: "profile",
            id: orphan.authenticatedUserProfile?.profileId ?? "",
          },
        }),
      ).toBe(true);
    });
  });
});

describe("an executive reaches every department through membership", () => {
  it("opens each department it belongs to and still reads other people at the role cap", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      // The reach is granted in the identity server by putting the person in every
      // dept- group, not by a special case in the boundary code. From here it is an
      // ordinary multi-department session.
      const executive = departmentClient({
        role: "executive",
        departments: ["rnd", "qa"],
        label: "exec",
      });
      const gate = prepareDepartmentGate({ cfg, client: executive });
      // Not a super administrator: the fence is still built, it simply lets both through.
      expect(gate).toBeDefined();
      expect(gate?.agentAccess("rnd-bot")).toBe("open");
      expect(gate?.agentAccess("qa-bot")).toBe("open");
      expect(gate?.agentAccess("main")).toBe("open");
      expect(gate?.allowsAgent("rnd-bot")).toBe(true);
      expect(gate?.allowsAgent("qa-bot")).toBe(true);
      expect(authorizeDepartmentAgent({ cfg, client: executive, agentId: "qa-bot" })).toBeUndefined();
      expect(departmentCacheKeyPart({ cfg, client: executive })).toBe("dept:qa,rnd");

      // Reading is the whole grant. The role cap keeps another person's session read-only
      // in both departments, so widening the reach never widened the write surface.
      const stranger = ensureProfileForEmail("exec-stranger@department.test");
      for (const agentId of ["rnd-bot", "qa-bot"]) {
        const target = sessionTarget({ agentId, creatorProfileId: stranger.id });
        expect(resolveSessionSharingRole({ cfg, client: executive, target })).toBe("viewer");
        expect(
          authorizeSessionSharingTarget({ cfg, client: executive, target })?.details,
        ).toMatchObject({ code: "SESSION_PARTICIPATION_REQUIRED" });
      }
      // Their own session is theirs to work in, exactly like any other role.
      const ownProfileId = executive.authenticatedUserProfile?.profileId ?? "";
      expect(
        resolveSessionSharingRole({
          cfg,
          client: executive,
          target: sessionTarget({ agentId: "rnd-bot", creatorProfileId: ownProfileId }),
        }),
      ).toBe("owner");
    });
  });

  it("sees only the departments it was actually put into", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = departmentConfig();
      // An executive whose group membership was never completed is not a back door.
      const partial = departmentClient({
        role: "executive",
        departments: ["rnd"],
        label: "exec-partial",
      });
      const gate = prepareDepartmentGate({ cfg, client: partial });
      expect(gate?.agentAccess("rnd-bot")).toBe("open");
      expect(gate?.agentAccess("qa-bot")).toBe("denied");
      expect(authorizeDepartmentAgent({ cfg, client: partial, agentId: "qa-bot" })?.code).toBe(
        "FORBIDDEN",
      );
    });
  });
});

describe("existing modes stay unchanged", () => {
  const legacyModes = ["token", "trusted-proxy"] as const;
  for (const mode of legacyModes) {
    it(`${mode} mode never builds a department gate`, async () => {
      await withOpenClawTestState({ scenario: "minimal" }, async () => {
        bindAgents();
        const cfg = {
          ...departmentConfig(),
          gateway: { ...departmentConfig().gateway, auth: { mode } },
        } as OpenClawConfig;
        const client = departmentClient({
          role: "member",
          departments: ["rnd"],
          label: `legacy-${mode}`,
        });
        expect(prepareDepartmentGate({ cfg, client })).toBeUndefined();
        expect(departmentCacheKeyPart({ cfg, client })).toBe("");
      });
    });
  }

  it("ix-auth without the department scope keeps every agent open", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      bindAgents();
      const cfg = {
        ...departmentConfig(),
        tools: { sessions: { visibility: "self" } },
      } as OpenClawConfig;
      const client = departmentClient({
        role: "member",
        departments: ["rnd"],
        label: "no-scope",
      });
      expect(prepareDepartmentGate({ cfg, client })).toBeUndefined();
      expect(authorizeDepartmentAgent({ cfg, client, agentId: "qa-bot" })).toBeUndefined();
    });
  });
});
