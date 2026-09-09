// Department access boundary for the ix-auth Gateway mode.
//
// IX-Auth owns membership and hands it over as verified group codes on every access
// token; the fork owns enforcement. The rule is three lines: a super administrator sees
// everything; a person with departments reaches the agents bound to those departments
// plus every unbound agent, and nothing else; a person with no department reaches only
// the sessions they created, on unbound agents.
//
// Departments partition agents, not sessions. A session lives inside exactly one agent's
// store, workspace, skills and knowledge, so the agent already is the data boundary;
// stamping a second department onto the session would create two owners that can
// disagree and would need a backfill for every session that predates the feature.
import {
  ErrorCodes,
  errorShape,
  type ErrorShape,
} from "../../packages/gateway-protocol/src/index.js";
import type { SessionCreatedActor } from "../config/sessions/session-entry-provenance.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  normalizeDepartmentSlug,
  readDepartmentAgentBindings,
} from "../state/departments-store.js";
import type { GatewayClient } from "./server-methods/client-types.js";
import { isSessionCreatorProfile } from "./session-creator.js";

/**
 * What one caller may do with the sessions of one agent.
 *
 * `open` leaves the ordinary sharing rules in charge, `creator-only` narrows them to the
 * caller's own sessions, and `denied` hides the agent and its sessions completely.
 */
export type DepartmentAgentAccess = "open" | "creator-only" | "denied";

/** Prepared department verdicts for one caller. Absent when the boundary is inactive. */
type DepartmentGate = {
  /** Departments carried by the caller's verified token, for diagnostics and listings. */
  departments: readonly string[];
  /** Verdict for one agent's sessions. */
  agentAccess: (agentId: string) => DepartmentAgentAccess;
  /** True when the caller may select the agent for a new session or a run. */
  allowsAgent: (agentId: string) => boolean;
};

/**
 * True when this deployment enforces the department boundary.
 *
 * The switch is the existing session-visibility key rather than a new option: the
 * boundary only means anything when identity comes from IX-Auth, and `department` is
 * exactly the scope between "only my own sessions" and "every session".
 */
export function isDepartmentScopeEnabled(cfg: OpenClawConfig | undefined): boolean {
  if (!cfg) {
    return false;
  }
  // Read directly rather than through the plugin SDK resolver: that module reaches back
  // into the Gateway client, and importing it here would close an import cycle.
  return cfg.gateway?.auth?.mode === "ix-auth" && cfg.tools?.sessions?.visibility === "department";
}

/**
 * Department facts proven by one verified IX-Auth login.
 *
 * `profileId` and `gatewayRole` ride along because the folder rules (R) name people and
 * ranks as rule subjects, and a rule subject is an authorization input. They are read
 * from this bag rather than from the audit bag next door, which stays attribution-only:
 * a name in the ledger is still not a permission.
 */
export type DepartmentIdentity = {
  departments: readonly string[];
  isSuperAdmin: boolean;
  profileId?: string | undefined;
  gatewayRole?: string | undefined;
};

/**
 * Handshake fields carrying the department boundary onto the connection.
 *
 * The principal itself stays behind: request handling needs the codes and the
 * super-admin verdict, and keeping tokens out of the long-lived client removes a place
 * they could leak. Spread into the client's `internal` bag, empty outside ix-auth mode.
 */
export function departmentHandshakeFacts(principal: DepartmentIdentity | undefined): {
  ixAuthDepartments?: DepartmentIdentity;
} {
  return principal
    ? {
        ixAuthDepartments: {
          departments: principal.departments,
          isSuperAdmin: principal.isSuperAdmin,
          ...(principal.profileId ? { profileId: principal.profileId } : {}),
          ...(principal.gatewayRole ? { gatewayRole: principal.gatewayRole } : {}),
        },
      }
    : {};
}

/**
 * The verified identity facts on one connection, or undefined for a host caller.
 *
 * Exported for the folder rule surface, which needs the same three facts (person,
 * departments, rank) and must read them from the authorization bag rather than from the
 * ledger bag.
 */
export function readClientDepartmentIdentity(
  client: Pick<GatewayClient, "internal"> | null,
): DepartmentIdentity | undefined {
  return readClientDepartments(client);
}

/** Departments proven by the caller's login, or undefined when it carried no principal. */
function readClientDepartments(
  client: Pick<GatewayClient, "internal"> | null,
): DepartmentIdentity | undefined {
  return client?.internal?.ixAuthDepartments;
}

/**
 * Caller identity for a department decision.
 *
 * HTTP surfaces that never build a Gateway client pass `identity` straight from the
 * request's verified principal; everything else passes the client it already has.
 */
type DepartmentCaller = {
  client?: Pick<GatewayClient, "internal"> | null;
  identity?: DepartmentIdentity | undefined;
};

function resolveDepartmentIdentity(caller: DepartmentCaller): DepartmentIdentity | undefined {
  return caller.identity ?? readClientDepartments(caller.client ?? null);
}

/**
 * Prepare department verdicts for one caller.
 *
 * Returns undefined when the boundary does not apply, so every call site keeps its
 * existing behaviour by simply skipping the check. Bindings are read once per prepared
 * gate rather than cached across requests: an operator who rebinds an agent must not
 * have to restart the Gateway before the fence moves.
 */
export function prepareDepartmentGate(
  params: { cfg: OpenClawConfig | undefined } & DepartmentCaller,
): DepartmentGate | undefined {
  if (!isDepartmentScopeEnabled(params.cfg)) {
    return undefined;
  }
  const identity = resolveDepartmentIdentity(params);
  if (identity?.isSuperAdmin === true) {
    return undefined;
  }
  // A caller with no verified principal is not an IX-Auth browser session; internal and
  // host-minted runs keep their existing authority instead of being fenced into a
  // department they can never have.
  if (!identity) {
    return undefined;
  }
  const departments = new Set(identity.departments.map(normalizeDepartmentSlug));
  const bindings = readDepartmentAgentBindings();
  const agentAccess = (agentId: string): DepartmentAgentAccess => {
    const bound = bindings.get(agentId);
    if (bound === undefined) {
      // An unbound agent is deliberately outside the partition: the fence is opt-in per
      // agent, so shared ground keeps its ordinary rules and the default home session
      // stays usable. Someone with no department has no place in the partition at all,
      // so shared ground is where their own sessions - and only those - live.
      return departments.size > 0 ? "open" : "creator-only";
    }
    return departments.has(bound) ? "open" : "denied";
  };
  return {
    departments: [...departments].toSorted(),
    agentAccess,
    allowsAgent: (agentId: string) => agentAccess(agentId) !== "denied",
  };
}

/**
 * Authorize one agent for one caller, or explain the refusal.
 *
 * This is the single creation-side gate; the read side uses `agentAccess` directly so it
 * can distinguish "hidden" from "yours only".
 */
export function authorizeDepartmentAgent(
  params: { cfg: OpenClawConfig | undefined; agentId: string } & DepartmentCaller,
): ErrorShape | undefined {
  const gate = prepareDepartmentGate(params);
  return gate && !gate.allowsAgent(params.agentId)
    ? errorShape(ErrorCodes.FORBIDDEN, `Agent "${params.agentId}" belongs to another department.`, {
        details: { code: "DEPARTMENT_ACCESS_DENIED", agentId: params.agentId },
      })
    : undefined;
}

/**
 * Row-level verdict for one session, given the agent that owns it.
 *
 * The single predicate every read surface shares: list, direct read, transcript, and
 * event fan-out must agree, or hiding a row somewhere only moves the leak.
 */
export function isDepartmentVisibleSession(params: {
  cfg: OpenClawConfig | undefined;
  client: Pick<GatewayClient, "internal" | "authenticatedUserProfile"> | null;
  agentId: string;
  createdActor: SessionCreatedActor | undefined;
}): boolean {
  const gate = prepareDepartmentGate(params);
  if (!gate) {
    return true;
  }
  const access = gate.agentAccess(params.agentId);
  if (access === "denied") {
    return false;
  }
  if (access === "open") {
    return true;
  }
  const profileId = params.client?.authenticatedUserProfile?.profileId;
  return profileId !== undefined && isSessionCreatorProfile(params.createdActor, profileId);
}

/** Stable cache dimension so one caller's department view never serves another's. */
export function departmentCacheKeyPart(
  params: { cfg: OpenClawConfig | undefined } & DepartmentCaller,
): string {
  if (!isDepartmentScopeEnabled(params.cfg)) {
    return "";
  }
  const identity = resolveDepartmentIdentity(params);
  if (!identity) {
    return "dept:none";
  }
  return identity.isSuperAdmin
    ? "dept:*"
    : `dept:${[...new Set(identity.departments.map(normalizeDepartmentSlug))].toSorted().join(",")}`;
}
