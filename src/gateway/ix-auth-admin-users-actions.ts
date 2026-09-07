// Everything an administrator can do to one existing account.
//
// Each handler follows the same order: read the account as it is now, apply the Gateway's
// own policy against it, relay the change, then end that person's sessions when the
// change altered what their token claims. Reading first is what makes the policy checks
// real, because "is this the last super administrator" cannot be answered from the
// request body.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { relayIxAuthPasswordForgot } from "../auth/ix-auth/ix-auth-account-client.js";
import { resendIxAuthInvite } from "../auth/ix-auth/ix-auth-admin-client.js";
import {
  deleteIxAuthUser,
  getIxAuthUser,
  removeIxAuthGroupMember,
  replaceIxAuthUserRoles,
  resetIxAuthUserMfa,
  unlockIxAuthUser,
  updateIxAuthUser,
  IX_AUTH_SETTABLE_USER_STATUSES,
  type IxAuthUserSummary,
} from "../auth/ix-auth/ix-auth-admin-users-client.js";
import { sendJson } from "./http-common.js";
import {
  grantIxAuthDepartments,
  listIxAuthDepartmentGroups,
  readIxAuthDepartmentCodesFromBody,
  sendRelayFailure,
  type IxAuthAdminContext,
} from "./ix-auth-admin-context.js";
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import {
  endIxAuthUserSessions,
  grantsSuperAdmin,
  isSelfIxAuthUser,
  rejectLastSuperAdminRemoval,
  rejectSelfTarget,
  rejectSuperAdminTarget,
  IX_AUTH_MANAGEABLE_ROLE_CODES,
} from "./ix-auth-admin-users-guard.js";
import { projectIxAuthUser } from "./ix-auth-admin-users-view.js";
import type { IxAuthAdminUsersTarget } from "./ix-auth-http-paths.js";
import { readIxAuthJsonBody, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { waitForIxAuthInviteLink } from "./ix-auth-invite-links.js";

type ActionParams = {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  userId: string;
};

/** Read the account as it stands, answering the relay failure when it cannot be read. */
async function loadTarget(params: ActionParams): Promise<IxAuthUserSummary | undefined> {
  const current = await getIxAuthUser({ ...params.admin.call, userId: params.userId });
  if (!current.ok) {
    sendRelayFailure(params.res, current);
    return undefined;
  }
  return current.user;
}

function sendUser(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  user: IxAuthUserSummary;
  extra?: Record<string, unknown>;
}): void {
  sendJson(params.res, 200, {
    user: projectIxAuthUser({
      user: params.user,
      settings: params.deps.settings,
      self: isSelfIxAuthUser({ admin: params.admin, userId: params.user.id }),
    }),
    ...params.extra,
  });
}

/**
 * Change the display name, the account status, or both.
 *
 * Deactivating is the recommended way to remove someone, so the same guards that protect
 * a deletion apply here: nobody deactivates themselves, an ordinary administrator does
 * not reach a super administrator, and the last super administrator stays reachable.
 */
async function handleUpdateUser(params: ActionParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const name = normalizeOptionalString(body.name);
  const status = normalizeOptionalString(body.status)?.toUpperCase();
  if (status !== undefined && !IX_AUTH_SETTABLE_USER_STATUSES.has(status)) {
    sendJson(params.res, 400, { error: "invalid_status" });
    return;
  }
  if (name === undefined && status === undefined) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  // Renaming yourself is harmless; switching your own account off is how an operator locks
  // the whole deployment out of its own administration. Decided before the account is read,
  // so a refusal costs no relay call.
  if (
    status !== undefined &&
    rejectSelfTarget({ res: params.res, admin: params.admin, userId: params.userId })
  ) {
    return;
  }
  const target = await loadTarget(params);
  if (!target) {
    return;
  }
  if (status !== undefined) {
    if (rejectSuperAdminTarget({ ...params, target })) {
      return;
    }
    if (status === "DISABLED" && (await rejectLastSuperAdminRemoval({ ...params, target }))) {
      return;
    }
  }
  const updated = await updateIxAuthUser({
    ...params.admin.call,
    userId: params.userId,
    name,
    status,
  });
  if (!updated.ok) {
    sendRelayFailure(params.res, updated);
    return;
  }
  const takedown =
    status === "DISABLED"
      ? await endIxAuthUserSessions({ ...params, target, reason: "account disabled" })
      : undefined;
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: status === "DISABLED" ? "user-disabled" : "user-update",
    targetUserId: params.userId,
    detail: { name, status },
  });
  sendUser({ ...params, user: updated.user, extra: { sessions: takedown } });
}

/**
 * Delete one account.
 *
 * The identity server's delete is a soft delete: the row stays, its status becomes
 * `DISABLED`, and its sessions end. The Gateway does not pretend otherwise, and the
 * response says which it was so a screen can word its confirmation honestly.
 */
async function handleDeleteUser(params: ActionParams): Promise<void> {
  if (!params.admin.principal.isSuperAdmin) {
    sendJson(params.res, 403, { error: "forbidden" });
    return;
  }
  if (rejectSelfTarget({ res: params.res, admin: params.admin, userId: params.userId })) {
    return;
  }
  const target = await loadTarget(params);
  if (!target) {
    return;
  }
  if (await rejectLastSuperAdminRemoval({ ...params, target })) {
    return;
  }
  const deleted = await deleteIxAuthUser({ ...params.admin.call, userId: params.userId });
  if (!deleted.ok) {
    sendRelayFailure(params.res, deleted);
    return;
  }
  const takedown = await endIxAuthUserSessions({ ...params, target, reason: "account deleted" });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-disabled",
    targetUserId: params.userId,
    detail: { deleted: true, email: target.email },
  });
  sendJson(params.res, 200, { userId: params.userId, softDeleted: true, sessions: takedown });
}

/**
 * Replace the whole role set.
 *
 * Nobody edits their own roles: an administrator who could would either lock themselves
 * out or promote themselves, and neither belongs in a self-service screen.
 */
async function handleReplaceRoles(params: ActionParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const requested = Array.isArray(body.roles) ? body.roles : [];
  const roles: string[] = [];
  for (const entry of requested) {
    const code = normalizeOptionalString(entry)?.toUpperCase();
    if (!code || !IX_AUTH_MANAGEABLE_ROLE_CODES.includes(code)) {
      sendJson(params.res, 400, { error: "invalid_role" });
      return;
    }
    roles.push(code);
  }
  if (roles.length === 0) {
    sendJson(params.res, 400, { error: "invalid_role" });
    return;
  }
  if (rejectSelfTarget({ res: params.res, admin: params.admin, userId: params.userId })) {
    return;
  }
  const wantsSuperAdmin = grantsSuperAdmin({ roles, settings: params.deps.settings });
  // Granting a rank is the same privilege as holding it: an administrator who could hand
  // out super-admin could hand it to a second account of their own. Decided from the
  // request alone, so a refusal costs no relay call.
  if (wantsSuperAdmin && !params.admin.principal.isSuperAdmin) {
    sendJson(params.res, 403, { error: "forbidden" });
    return;
  }
  const target = await loadTarget(params);
  if (!target) {
    return;
  }
  if (rejectSuperAdminTarget({ ...params, target })) {
    return;
  }
  if (!wantsSuperAdmin && (await rejectLastSuperAdminRemoval({ ...params, target }))) {
    return;
  }
  const replaced = await replaceIxAuthUserRoles({
    ...params.admin.call,
    userId: params.userId,
    roles,
  });
  if (!replaced.ok) {
    sendRelayFailure(params.res, replaced);
    return;
  }
  const takedown = await endIxAuthUserSessions({ ...params, target, reason: "roles changed" });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-roles",
    targetUserId: params.userId,
    detail: { from: target.roles, to: roles },
  });
  sendUser({ ...params, user: replaced.user, extra: { sessions: takedown } });
}

/**
 * Replace the whole department set.
 *
 * The identity server has no "set these groups" call, so the difference is computed here
 * and applied as adds and removes. Only departments are touched: a code outside the
 * configured prefix is another kind of group entirely, and this screen has no business
 * moving anyone in or out of one.
 */
async function handleReplaceDepartments(params: ActionParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  // An administrator who could widen their own departments could read every session in
  // the company by editing one field on their own row.
  if (rejectSelfTarget({ res: params.res, admin: params.admin, userId: params.userId })) {
    return;
  }
  const requested = readIxAuthDepartmentCodesFromBody(body);
  const listing = await listIxAuthDepartmentGroups({ deps: params.deps, admin: params.admin });
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  for (const code of requested) {
    if (!listing.departments.some((department) => department.code === code)) {
      sendJson(params.res, 400, { error: "unknown_department", message: code });
      return;
    }
  }
  const target = await loadTarget(params);
  if (!target) {
    return;
  }
  const prefix = params.deps.settings.departmentGroupPrefix;
  const current = target.groups.filter((code) => prefix.length > 0 && code.startsWith(prefix));
  let failed = false;
  for (const code of current) {
    if (requested.includes(code)) {
      continue;
    }
    const group = listing.departments.find((department) => department.code === code);
    if (!group) {
      // A department the account is in but the prefix no longer names. Left alone rather
      // than guessed at: removing it would need a group id this listing does not have.
      failed = true;
      continue;
    }
    const removed = await removeIxAuthGroupMember({
      ...params.admin.call,
      groupId: group.groupId,
      userId: params.userId,
    });
    failed = failed || !removed.ok;
  }
  const grant = await grantIxAuthDepartments({
    deps: params.deps,
    admin: params.admin,
    userId: params.userId,
    requested: requested.filter((code) => !current.includes(code)),
    fillAllWhenEmpty: false,
  });
  const takedown = await endIxAuthUserSessions({
    ...params,
    target,
    reason: "departments changed",
  });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-departments",
    targetUserId: params.userId,
    detail: { from: current, to: requested },
  });
  sendJson(params.res, 200, {
    userId: params.userId,
    departments: requested,
    departmentFailed: failed || grant.failed,
    sessions: takedown,
  });
}

/**
 * Ask the identity server to mail this person a password-reset link.
 *
 * The link itself is never returned. Password-reset mail is deliberately not retained by
 * the Gateway's mail hook: a reset link signs its holder in, and one sitting on an
 * administration screen is a credential anyone walking past can use. A deployment with no
 * mail server resends the invitation instead, whose one-time link the Gateway does keep
 * because accepting it requires choosing a password.
 */
async function handlePasswordReset(params: ActionParams): Promise<void> {
  const target = await loadTarget(params);
  if (!target) {
    return;
  }
  const requested = await relayIxAuthPasswordForgot({
    settings: params.deps.settings,
    email: target.email,
    meta: params.admin.call.meta,
  });
  if (!requested.ok) {
    sendRelayFailure(params.res, requested);
    return;
  }
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-password-reset",
    targetUserId: params.userId,
    detail: { email: target.email },
  });
  sendJson(params.res, 200, { userId: params.userId, email: target.email, mailed: true });
}

/** Send the invitation again, and hand back its link where there is no mail server. */
async function handleResendInvite(params: ActionParams): Promise<void> {
  const target = await loadTarget(params);
  if (!target) {
    return;
  }
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
    detail: { email: target.email },
  });
  const inviteLink =
    (await waitForIxAuthInviteLink({ email: target.email, nowMs: Date.now() })) || undefined;
  sendJson(params.res, 200, { userId: params.userId, email: target.email, inviteLink });
}

async function handleUnlock(params: ActionParams): Promise<void> {
  const unlocked = await unlockIxAuthUser({ ...params.admin.call, userId: params.userId });
  if (!unlocked.ok) {
    sendRelayFailure(params.res, unlocked);
    return;
  }
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-unlock",
    targetUserId: params.userId,
  });
  sendJson(params.res, 200, { userId: params.userId, unlocked: true });
}

async function handleMfaReset(params: ActionParams): Promise<void> {
  const reset = await resetIxAuthUserMfa({ ...params.admin.call, userId: params.userId });
  if (!reset.ok) {
    sendRelayFailure(params.res, reset);
    return;
  }
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-mfa-reset",
    targetUserId: params.userId,
    detail: { reset: reset.reset },
  });
  sendJson(params.res, 200, { userId: params.userId, reset: reset.reset });
}

/** End every session this account holds, on both sides, and close its sockets. */
async function handleRevokeSessions(params: ActionParams): Promise<void> {
  const target = await loadTarget(params);
  if (!target) {
    return;
  }
  const takedown = await endIxAuthUserSessions({
    ...params,
    target,
    reason: "signed out by an administrator",
  });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-sessions-revoked",
    targetUserId: params.userId,
    detail: takedown,
  });
  sendJson(params.res, 200, { userId: params.userId, sessions: takedown });
}

/** Methods each per-account action accepts. */
const IX_AUTH_USER_ACTION_METHODS: ReadonlyMap<string, string> = new Map([
  ["roles", "PUT"],
  ["departments", "PUT"],
  ["password-reset", "POST"],
  ["invite", "POST"],
  ["unlock", "POST"],
  ["mfa-reset", "POST"],
  ["sessions", "DELETE"],
]);

/** Dispatch one mutating request against one account. */
export async function handleIxAuthAdminUserAction(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  method: string;
  target: IxAuthAdminUsersTarget;
}): Promise<void> {
  const { target } = params;
  if (target.kind !== "user" && target.kind !== "action") {
    sendJson(params.res, 404, { error: "not_found" });
    return;
  }
  const action: ActionParams = { ...params, userId: target.userId };
  if (target.kind === "user") {
    if (params.method === "PATCH") {
      await handleUpdateUser(action);
      return;
    }
    if (params.method === "DELETE") {
      await handleDeleteUser(action);
      return;
    }
    sendJson(params.res, 405, { error: "method_not_allowed" });
    return;
  }
  if (IX_AUTH_USER_ACTION_METHODS.get(target.action) !== params.method) {
    sendJson(params.res, 405, { error: "method_not_allowed" });
    return;
  }
  switch (target.action) {
    case "roles":
      await handleReplaceRoles(action);
      return;
    case "departments":
      await handleReplaceDepartments(action);
      return;
    case "password-reset":
      await handlePasswordReset(action);
      return;
    case "invite":
      await handleResendInvite(action);
      return;
    case "unlock":
      await handleUnlock(action);
      return;
    case "mfa-reset":
      await handleMfaReset(action);
      return;
    default:
      await handleRevokeSessions(action);
  }
}
