// Activity-ledger rows for the identity routes.
//
// The identity server keeps its own authentication ledger, but that one answers "who
// signed in to the identity server". The delivery contract asks the same question about
// this deployment, next to the questions and file reads that followed, which is only
// answerable from one table. So sign-in, sign-out and refused sign-in are recorded here.
import type { IncomingMessage } from "node:http";
import { recordUserActivity } from "../audit/user-activity-audit-recorder.js";
import { resolveIxAuthGatewayRole } from "../auth/ix-auth/ix-auth-role-map.js";
import type { IxAuthRuntimeSettings, IxAuthVerifiedClaims } from "../auth/ix-auth/ix-auth-types.js";
import type { UserActivityAuditActor } from "../state/user-activity-audit-store.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

function requestFacts(req: IncomingMessage, deps: IxAuthHttpDependencies) {
  const userAgent = req.headers["user-agent"];
  const requestId = req.headers["x-request-id"];
  return {
    ...(deps.clientIp ? { remoteIp: deps.clientIp } : {}),
    ...(typeof userAgent === "string" ? { userAgent } : {}),
    ...(typeof requestId === "string" ? { requestId } : {}),
  };
}

/** Record a completed sign-in against the account it authenticated. */
export function recordIxAuthLoginActivity(params: {
  req: IncomingMessage;
  deps: IxAuthHttpDependencies;
  profileId: string;
  claims: IxAuthVerifiedClaims;
  departments: readonly string[];
  settings: Pick<IxAuthRuntimeSettings, "roleMap" | "superAdminRoles">;
}): void {
  const { gatewayRole } = resolveIxAuthGatewayRole({
    roles: params.claims.roles,
    settings: params.settings,
  });
  const actor: UserActivityAuditActor = {
    source: "profile",
    profileId: params.profileId,
    email: params.claims.email,
    ...(params.claims.displayName ? { displayName: params.claims.displayName } : {}),
    ...(gatewayRole ? { gatewayRole } : {}),
    departments: params.departments,
  };
  recordUserActivity({
    kind: "login",
    actor,
    detail: { identitySessionId: params.claims.identitySessionId },
    ...requestFacts(params.req, params.deps),
  });
}

/** Record a sign-out against the account whose session was revoked. */
export function recordIxAuthLogoutActivity(params: {
  req: IncomingMessage;
  deps: IxAuthHttpDependencies;
  profileId: string;
  email: string;
}): void {
  recordUserActivity({
    kind: "logout",
    actor: { source: "profile", profileId: params.profileId, email: params.email },
    ...requestFacts(params.req, params.deps),
  });
}

/**
 * Record a refused sign-in.
 *
 * The submitted address is stored, the outcome of looking it up is not: a ledger row
 * that distinguished "no such account" from "wrong password" would be an account
 * enumeration oracle for anyone who can read the ledger.
 */
export function recordIxAuthLoginFailureActivity(params: {
  req: IncomingMessage;
  deps: IxAuthHttpDependencies;
  email?: string;
  reason: string;
}): void {
  recordUserActivity({
    kind: "login_failed",
    actor: {
      source: "profile",
      ...(params.email ? { email: params.email } : {}),
    },
    detail: { reason: params.reason },
    ...requestFacts(params.req, params.deps),
  });
}
