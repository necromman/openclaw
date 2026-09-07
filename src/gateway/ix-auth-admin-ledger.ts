// One seam every administrator action passes through.
//
// The identity server already records these in its own ledger, attributed to the real
// person because the relay carries their access token. What that ledger cannot answer is
// "what did an administrator do from inside this app", which is the question the audit
// work (DELIVERY-PLAN stage H) has to answer for the whole deployment, not just for
// identity.
//
// That ledger now exists, so this writes one `admin_action` row per call in addition to
// the diagnostic channels it already used: the security-event callback the rest of the
// authentication namespace uses, and a verbose log line. Routing every action through one
// function is what made this a single edit rather than a dozen.
import { recordUserActivity } from "../audit/user-activity-audit-recorder.js";
import { logVerbose } from "../globals.js";
import type { IxAuthAdminContext } from "./ix-auth-admin-context.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

/**
 * The administrator actions this fork can take from inside the app.
 *
 * A closed list rather than free text: a name that only appears in one call site cannot
 * be searched for later, and stage H needs to enumerate the kinds it stores.
 */
export type IxAuthAdminActionName =
  | "invite"
  | "invite-resend"
  | "signup-decision"
  | "user-update"
  | "user-roles"
  | "user-departments"
  | "user-password-reset"
  | "user-unlock"
  | "user-mfa-reset"
  | "user-sessions-revoked"
  | "user-disabled"
  | "users-imported";

/** Record one administrator action against one target account. */
export function recordIxAuthAdminAction(params: {
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  action: IxAuthAdminActionName;
  targetUserId?: string;
  detail?: Record<string, unknown>;
}): void {
  const { principal } = params.admin;
  params.deps.onSecurityEvent?.({
    action: "ix-auth.admin.action",
    outcome: "succeeded",
    clientIp: params.deps.clientIp,
    profileId: principal.profileId,
    identitySubject: principal.claims.subject,
    loginSessionId: principal.loginSessionId,
    reason: params.action,
  });
  recordUserActivity({
    kind: "admin_action",
    actor: {
      source: "profile",
      profileId: principal.profileId,
      email: principal.claims.email,
      ...(principal.claims.displayName ? { displayName: principal.claims.displayName } : {}),
      ...(principal.gatewayRole ? { gatewayRole: principal.gatewayRole } : {}),
      departments: principal.departments,
    },
    detail: {
      action: params.action,
      ...(params.targetUserId ? { targetUserId: params.targetUserId } : {}),
      ...params.detail,
    },
    ...(params.deps.clientIp ? { remoteIp: params.deps.clientIp } : {}),
  });
  logVerbose(
    `[ix-auth] admin action=${params.action} actor=${principal.claims.email} target=${
      params.targetUserId ?? "-"
    } detail=${JSON.stringify(params.detail ?? {})}`,
  );
}
