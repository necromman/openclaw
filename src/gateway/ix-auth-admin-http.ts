// Administration routes for invitations and signup approvals.
//
// Two things separate these from the anonymous account routes. They require a signed-in
// superadmin or admin, and they call the identity server with that person's own access
// token rather than the service key, so the identity server applies its permission model
// a second time and its ledger names the real actor.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  addIxAuthGroupMember,
  approveIxAuthSignup,
  createIxAuthInvitedUser,
  listIxAuthGroups,
  listIxAuthPendingSignups,
  rejectIxAuthSignup,
  resendIxAuthInvite,
  type IxAuthAdminCall,
} from "../auth/ix-auth/ix-auth-admin-client.js";
import type { IxAuthRelayFailure } from "../auth/ix-auth/ix-auth-client.js";
import { canOpenIxAuthAdminConsole } from "../auth/ix-auth/ix-auth-role-map.js";
import {
  matchesIxAuthCsrfDigest,
  resolveIxAuthSessionToken,
} from "../auth/ix-auth/ix-auth-sessions.js";
import { IX_AUTH_CSRF_HEADER_NAME, type IxAuthPrincipal } from "../auth/ix-auth/ix-auth-types.js";
import { sendJson } from "./http-common.js";
import type { IxAuthHttpRoute } from "./ix-auth-http-paths.js";
import {
  readIxAuthJsonBody,
  readRequestMeta,
  type IxAuthHttpDependencies,
} from "./ix-auth-http-shared.js";
import {
  forgetIxAuthInviteLink,
  listIxAuthInviteLinks,
  waitForIxAuthInviteLink,
} from "./ix-auth-invite-links.js";
import { readIxAuthSessionCookie } from "./ix-auth-principal.js";

/** Role codes an invitation may grant. Anything else is rejected before the relay. */
const IX_AUTH_INVITABLE_ROLE_CODES: ReadonlySet<string> = new Set([
  "SUPERADMIN",
  "ADMIN",
  "MODERATOR",
  "MEMBER",
]);

/** The role an invitation grants when the form does not say. */
const IX_AUTH_DEFAULT_INVITE_ROLE_CODE = "MEMBER";

/** One resolved administrator, ready to act against the identity server. */
type IxAuthAdminContext = {
  principal: IxAuthPrincipal;
  call: IxAuthAdminCall;
};

function sendRelayFailure(res: ServerResponse, failure: IxAuthRelayFailure): void {
  if (failure.code === "IXAUTH_UNAVAILABLE") {
    sendJson(res, 503, { error: "identity_unavailable", message: failure.message });
    return;
  }
  if (failure.status === 403 || failure.status === 401) {
    // The identity server refused this administrator. Reporting its own wording would
    // teach a caller which of its permissions is missing.
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  if (failure.status === 409) {
    sendJson(res, 409, { error: "conflict", message: failure.message });
    return;
  }
  sendJson(res, 400, { error: "request_rejected", message: failure.message });
}

/**
 * Resolve the administrator behind this request, or answer and return undefined.
 *
 * The mutating methods also require the session-bound CSRF token, matching the rest of
 * the authentication namespace: the session cookie alone must never be enough to create
 * an account from a page the operator did not open.
 */
async function resolveAdminContext(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
}): Promise<IxAuthAdminContext | undefined> {
  const sessionToken = readIxAuthSessionCookie({
    req: params.req,
    settings: params.deps.settings,
  });
  const meta = readRequestMeta(params.req, params.deps.clientIp);
  const resolution = sessionToken
    ? await resolveIxAuthSessionToken({
        sessionToken,
        settings: params.deps.settings,
        meta,
        nowMs: Date.now(),
        touch: false,
      })
    : undefined;
  if (!resolution?.ok) {
    sendJson(params.res, 401, { error: "unauthenticated" });
    return undefined;
  }
  if (!canOpenIxAuthAdminConsole(resolution.principal.gatewayRole)) {
    params.deps.onSecurityEvent?.({
      action: "ix-auth.admin.denied",
      outcome: "denied",
      clientIp: params.deps.clientIp,
      profileId: resolution.principal.profileId,
      identitySubject: resolution.principal.claims.subject,
      loginSessionId: resolution.principal.loginSessionId,
      reason: "role",
    });
    sendJson(params.res, 403, { error: "forbidden" });
    return undefined;
  }
  if (params.req.method !== "GET") {
    const presented = params.req.headers[IX_AUTH_CSRF_HEADER_NAME];
    const csrfToken = typeof presented === "string" ? presented : undefined;
    if (
      !csrfToken ||
      !matchesIxAuthCsrfDigest({ presented: csrfToken, storedDigest: resolution.row.csrf_digest })
    ) {
      sendJson(params.res, 403, { error: "csrf_mismatch" });
      return undefined;
    }
  }
  return {
    principal: resolution.principal,
    call: {
      settings: params.deps.settings,
      accessToken: resolution.row.access_token,
      meta,
    },
  };
}

/** Department codes carry the configured prefix; everything else is an ordinary group. */
function isDepartmentGroupCode(code: string, prefix: string): boolean {
  return prefix.length > 0 && code.startsWith(prefix);
}

async function resolveDepartmentGroupId(params: {
  admin: IxAuthAdminContext;
  departmentCode: string;
}): Promise<{ ok: true; groupId: string } | { ok: false; failure?: IxAuthRelayFailure }> {
  const groups = await listIxAuthGroups(params.admin.call);
  if (!groups.ok) {
    return { ok: false, failure: groups };
  }
  const match = groups.groups.find((group) => group.code === params.departmentCode);
  return match ? { ok: true, groupId: match.groupId } : { ok: false };
}

async function handleListDepartments(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<void> {
  const groups = await listIxAuthGroups(params.admin.call);
  if (!groups.ok) {
    sendRelayFailure(params.res, groups);
    return;
  }
  const prefix = params.deps.settings.departmentGroupPrefix;
  sendJson(params.res, 200, {
    departments: groups.groups
      .filter((group) => isDepartmentGroupCode(group.code, prefix))
      .map((group) => ({ code: group.code, name: group.name })),
  });
}

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
  const department = normalizeOptionalString(body.department);
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
  // The department is granted here rather than at first sign-in, so the invited person
  // lands inside their department instead of appearing unassigned until someone notices.
  let departmentGranted = false;
  if (department) {
    const group = await resolveDepartmentGroupId({
      admin: params.admin,
      departmentCode: department,
    });
    if (group.ok) {
      const added = await addIxAuthGroupMember({
        ...params.admin.call,
        groupId: group.groupId,
        userId: created.userId,
      });
      departmentGranted = added.ok;
    }
  }
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
    department: departmentGranted ? department : undefined,
    departmentFailed: Boolean(department) && !departmentGranted,
    // Present only when the identity server handed the mail back instead of sending it.
    // Its absence is the signal that the invitation was actually mailed.
    inviteLink,
  });
}

async function handleResendInvite(params: {
  res: ServerResponse;
  admin: IxAuthAdminContext;
  userId: string;
  email: string;
}): Promise<void> {
  const resent = await resendIxAuthInvite({ ...params.admin.call, userId: params.userId });
  if (!resent.ok) {
    sendRelayFailure(params.res, resent);
    return;
  }
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
    await handleResendInvite({ res: params.res, admin: params.admin, userId, email });
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
  let departmentGranted = false;
  const department = decision === "approve" ? normalizeOptionalString(body.department) : undefined;
  if (department) {
    const group = await resolveDepartmentGroupId({
      admin: params.admin,
      departmentCode: department,
    });
    if (group.ok) {
      const added = await addIxAuthGroupMember({
        ...params.admin.call,
        groupId: group.groupId,
        userId,
      });
      departmentGranted = added.ok;
    }
  }
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
    department: departmentGranted ? department : undefined,
    departmentFailed: Boolean(department) && !departmentGranted,
  });
}

/** Dispatch one administration route after proving the caller may use it. */
export async function handleIxAuthAdminHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  route: IxAuthHttpRoute;
  deps: IxAuthHttpDependencies;
}): Promise<void> {
  const admin = await resolveAdminContext(params);
  if (!admin) {
    return;
  }
  if (params.route === "admin-departments") {
    await handleListDepartments({ res: params.res, deps: params.deps, admin });
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
  sendJson(params.res, 404, { error: "not_found" });
}
