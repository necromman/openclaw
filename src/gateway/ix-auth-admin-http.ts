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

type DepartmentGroup = { groupId: string; code: string; name: string };

type DepartmentListing =
  | { ok: true; departments: DepartmentGroup[] }
  | { ok: false; failure: IxAuthRelayFailure };

/**
 * The departments the identity server knows about, in one relay call.
 *
 * Every surface below reads departments through here, so the list an administrator is
 * shown and the memberships an invitation grants can never come from different sources.
 */
async function listDepartmentGroups(params: {
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<DepartmentListing> {
  const groups = await listIxAuthGroups(params.admin.call);
  if (!groups.ok) {
    return { ok: false, failure: groups };
  }
  const prefix = params.deps.settings.departmentGroupPrefix;
  return {
    ok: true,
    departments: groups.groups.filter((group) => isDepartmentGroupCode(group.code, prefix)),
  };
}

/** Read the departments a request asks for, still accepting the single-value field. */
function readRequestedDepartments(body: Record<string, unknown>): string[] {
  const listed = Array.isArray(body.departments) ? body.departments : [];
  const codes: string[] = [];
  for (const entry of listed) {
    const code = normalizeOptionalString(entry);
    if (code) {
      codes.push(code);
    }
  }
  const single = normalizeOptionalString(body.department);
  if (single) {
    codes.push(single);
  }
  return [...new Set(codes)];
}

type DepartmentGrant = { granted: string[]; failed: boolean };

/**
 * Put one account into the departments it was invited into.
 *
 * A code naming no department is reported rather than obeyed, and a code outside the
 * department prefix is not a department at all: neither may quietly place someone into
 * an ordinary group. Nothing is rolled back over a failed placement, because the account
 * exists by then and its link has already gone out.
 */
async function grantDepartments(params: {
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  userId: string;
  requested: readonly string[];
  fillAllWhenEmpty: boolean;
}): Promise<DepartmentGrant> {
  if (params.requested.length === 0 && !params.fillAllWhenEmpty) {
    return { granted: [], failed: false };
  }
  const listing = await listDepartmentGroups({ deps: params.deps, admin: params.admin });
  if (!listing.ok) {
    return { granted: [], failed: true };
  }
  const wanted =
    params.requested.length > 0
      ? params.requested
      : listing.departments.map((department) => department.code);
  const granted: string[] = [];
  let failed = false;
  for (const code of wanted) {
    const match = listing.departments.find((department) => department.code === code);
    if (!match) {
      failed = true;
      continue;
    }
    const added = await addIxAuthGroupMember({
      ...params.admin.call,
      groupId: match.groupId,
      userId: params.userId,
    });
    if (added.ok) {
      granted.push(code);
    } else {
      failed = true;
    }
  }
  return { granted, failed };
}

async function handleListDepartments(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<void> {
  const listing = await listDepartmentGroups({ deps: params.deps, admin: params.admin });
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  sendJson(params.res, 200, {
    departments: listing.departments.map((group) => ({ code: group.code, name: group.name })),
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
  const requested = readRequestedDepartments(body);
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
  const grant = await grantDepartments({
    deps: params.deps,
    admin: params.admin,
    userId: created.userId,
    requested,
    fillAllWhenEmpty: IX_AUTH_ALL_DEPARTMENT_ROLE_CODES.has(role.roleCode),
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
  const grant =
    decision === "approve"
      ? await grantDepartments({
          deps: params.deps,
          admin: params.admin,
          userId,
          requested: readRequestedDepartments(body),
          // Approving a signup chooses no role, so there is nothing to fill in.
          fillAllWhenEmpty: false,
        })
      : { granted: [], failed: false };
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
