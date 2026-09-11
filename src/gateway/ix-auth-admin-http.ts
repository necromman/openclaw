// Administration routes for invitations and signup approvals.
//
// The caller is resolved and the department helpers live in `ix-auth-admin-context.ts`,
// which the user-management routes share, so who may act and where departments come from
// is decided in one place for the whole `/auth/admin` namespace.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  approveIxAuthSignup,
  createIxAuthInvitedUser,
  listIxAuthPendingSignups,
  rejectIxAuthSignup,
  resendIxAuthInvite,
} from "../auth/ix-auth/ix-auth-admin-client.js";
import { sendJson } from "./http-common.js";
import {
  grantIxAuthDepartments,
  readIxAuthDepartmentCodesFromBody,
  resolveIxAuthAdminContext,
  sendRelayFailure,
  type IxAuthAdminContext,
} from "./ix-auth-admin-context.js";
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import type { IxAuthHttpRoute } from "./ix-auth-http-paths.js";
import { readIxAuthJsonBody, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import {
  forgetIxAuthInviteLink,
  listIxAuthInviteLinks,
  waitForIxAuthInviteLink,
} from "./ix-auth-invite-links.js";

/** Role codes an invitation may grant. Anything else is rejected before the relay. */
const IX_AUTH_INVITABLE_ROLE_CODES: ReadonlySet<string> = new Set([
  "SUPERADMIN",
  "ADMIN",
  "EXECUTIVE",
  "MODERATOR",
  "MEMBER",
]);

/** The role an invitation grants when the form does not say. */
const IX_AUTH_DEFAULT_INVITE_ROLE_CODE = "MEMBER";

/**
 * Role codes whose invitation covers every department when none is named.
 *
 * An executive reads across the whole company, and that reach is membership in every
 * department group rather than a hole in the boundary code. Filling the list in here,
 * from the identity server's own groups, is what keeps it honest: a browser that posts
 * an empty list gets the real departments, never a list it invented.
 */
const IX_AUTH_ALL_DEPARTMENT_ROLE_CODES: ReadonlySet<string> = new Set(["EXECUTIVE"]);

/**
 * Read the role code an invitation should grant.
 *
 * A role that maps onto a super-admin name is reserved for a super-admin session, so an
 * ordinary administrator cannot invite someone into a rank above their own and then sign
 * in as them.
 */
function readInviteRoleCode(params: {
  value: unknown;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): { ok: true; roleCode: string } | { ok: false } {
  const requested = normalizeOptionalString(params.value)?.toUpperCase();
  const roleCode = requested ?? IX_AUTH_DEFAULT_INVITE_ROLE_CODE;
  if (!IX_AUTH_INVITABLE_ROLE_CODES.has(roleCode)) {
    return { ok: false };
  }
  const mapped = params.deps.settings.roleMap[roleCode];
  const grantsSuperAdmin =
    mapped !== undefined && params.deps.settings.superAdminRoles.includes(mapped);
  if (grantsSuperAdmin && !params.admin.principal.isSuperAdmin) {
    return { ok: false };
  }
  return { ok: true, roleCode };
}

async function handleIssueInvite(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  body: Record<string, unknown>;
}): Promise<void> {
  const { body } = params;
  const email = normalizeOptionalString(body.email);
  if (!email) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const role = readInviteRoleCode({ value: body.role, deps: params.deps, admin: params.admin });
  if (!role.ok) {
    sendJson(params.res, 403, { error: "forbidden" });
    return;
  }
  const requested = readIxAuthDepartmentCodesFromBody(body);
  const created = await createIxAuthInvitedUser({
    ...params.admin.call,
    email,
    // The identity server requires a display name. The local part is a placeholder the
    // invited person replaces when they accept.
    name: normalizeOptionalString(body.name) ?? email.split("@")[0] ?? email,
    roles: [role.roleCode],
  });
  if (!created.ok) {
    sendRelayFailure(params.res, created);
    return;
  }
  // Departments are granted here rather than at first sign-in, so the invited person
  // lands inside them instead of appearing unassigned until someone notices.
  const grant = await grantIxAuthDepartments({
    deps: params.deps,
    admin: params.admin,
    userId: created.userId,
    requested,
    fillAllWhenEmpty: IX_AUTH_ALL_DEPARTMENT_ROLE_CODES.has(role.roleCode),
  });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "invite",
    targetUserId: created.userId,
    detail: { email, role: role.roleCode, departments: grant.granted },
  });
  params.deps.onSecurityEvent?.({
    action: "ix-auth.invite.issued",
    outcome: "succeeded",
    clientIp: params.deps.clientIp,
    profileId: params.admin.principal.profileId,
    identitySubject: params.admin.principal.claims.subject,
    loginSessionId: params.admin.principal.loginSessionId,
  });
  const inviteLink = (await waitForIxAuthInviteLink({ email, nowMs: Date.now() })) || undefined;
  sendJson(params.res, 200, {
    email,
    userId: created.userId,
    departments: grant.granted,
    // Kept beside the list so a screen that only knows one department still reads one.
    department: grant.granted[0],
    departmentFailed: grant.failed,
    // Present only when the identity server handed the mail back instead of sending it.
    // Its absence is the signal that the invitation was actually mailed.
    inviteLink,
  });
}

async function handleResendInvite(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  userId: string;
  email: string;
}): Promise<void> {
  const resent = await resendIxAuthInvite({ ...params.admin.call, userId: params.userId });
  if (!resent.ok) {
    sendRelayFailure(params.res, resent);
    return;
  }
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "invite-resend",
    targetUserId: params.userId,
    detail: { email: params.email },
  });
  const inviteLink =
    (await waitForIxAuthInviteLink({ email: params.email, nowMs: Date.now() })) || undefined;
  sendJson(params.res, 200, { email: params.email, userId: params.userId, inviteLink });
}

async function handleInvitesRoute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<void> {
  if (params.req.method === "GET") {
    sendJson(params.res, 200, { invites: listIxAuthInviteLinks(Date.now()) });
    return;
  }
  if (params.req.method === "DELETE") {
    const body = await readIxAuthJsonBody(params.req, params.res);
    if (!body) {
      return;
    }
    const email = normalizeOptionalString(body.email);
    if (!email) {
      sendJson(params.res, 400, { error: "invalid_body" });
      return;
    }
    sendJson(params.res, 200, { forgotten: forgetIxAuthInviteLink(email) });
    return;
  }
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const userId = normalizeOptionalString(body.userId);
  const email = normalizeOptionalString(body.email);
  if (userId && email) {
    await handleResendInvite({ ...params, userId, email });
    return;
  }
  await handleIssueInvite({ res: params.res, deps: params.deps, admin: params.admin, body });
}

async function handleApprovalsRoute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<void> {
  if (params.req.method === "GET") {
    const pending = await listIxAuthPendingSignups(params.admin.call);
    if (!pending.ok) {
      sendRelayFailure(params.res, pending);
      return;
    }
    sendJson(params.res, 200, { pending: pending.pending });
    return;
  }
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const userId = normalizeOptionalString(body.userId);
  const decision = normalizeOptionalString(body.decision);
  if (!userId || (decision !== "approve" && decision !== "reject")) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const outcome =
    decision === "approve"
      ? await approveIxAuthSignup({ ...params.admin.call, userId })
      : await rejectIxAuthSignup({
          ...params.admin.call,
          userId,
          reason: normalizeOptionalString(body.reason),
        });
  if (!outcome.ok) {
    sendRelayFailure(params.res, outcome);
    return;
  }
  const grant =
    decision === "approve"
      ? await grantIxAuthDepartments({
          deps: params.deps,
          admin: params.admin,
          userId,
          requested: readIxAuthDepartmentCodesFromBody(body),
          // Approving a signup chooses no role, so there is nothing to fill in.
          fillAllWhenEmpty: false,
        })
      : { granted: [], failed: false, failedCodes: [] };
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "signup-decision",
    targetUserId: userId,
    detail: { decision, departments: grant.granted },
  });
  params.deps.onSecurityEvent?.({
    action: "ix-auth.signup.decided",
    outcome: "succeeded",
    clientIp: params.deps.clientIp,
    profileId: params.admin.principal.profileId,
    identitySubject: params.admin.principal.claims.subject,
    loginSessionId: params.admin.principal.loginSessionId,
    reason: decision,
  });
  sendJson(params.res, 200, {
    userId,
    decision,
    departments: grant.granted,
    department: grant.granted[0],
    departmentFailed: grant.failed,
  });
}

/** Dispatch one administration route after proving the caller may use it. */
export async function handleIxAuthAdminHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  route: IxAuthHttpRoute;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const admin = await resolveIxAuthAdminContext(params);
  if (!admin) {
    return;
  }
  if (params.route === "admin-departments") {
    // Loaded on demand: only the department screen reads or writes this surface, and the
    // invitation form's one call for the list can afford the import.
    const departmentsModule = await import("./ix-auth-admin-departments-http.js");
    await departmentsModule.handleIxAuthAdminDepartmentsRequest({ ...params, admin });
    return;
  }
  if (params.route === "admin-models") {
    // Loaded on demand: only the model screen reads or writes this surface, and it pulls
    // the configuration mutation machinery with it.
    const modelsModule = await import("./ix-auth-admin-models-http.js");
    await modelsModule.handleIxAuthAdminModelsRequest({ ...params, admin });
    return;
  }
  if (params.route === "admin-invites") {
    await handleInvitesRoute({ ...params, admin });
    return;
  }
  if (params.route === "admin-approvals") {
    await handleApprovalsRoute({ ...params, admin });
    return;
  }
  if (params.route === "admin-audit-export") {
    // Loaded on demand: nothing else in this namespace reads the activity ledger.
    const exportModule = await import("./ix-auth-admin-audit-http.js");
    exportModule.handleIxAuthAdminAuditExport({ ...params, admin });
    return;
  }
  if (params.route === "admin-users") {
    // Loaded on demand: the user-management surface is the largest part of this
    // namespace and no other route needs it.
    const usersModule = await import("./ix-auth-admin-users-http.js");
    await usersModule.handleIxAuthAdminUsersRequest({ ...params, admin });
    return;
  }
  sendJson(params.res, 404, { error: "not_found" });
}
