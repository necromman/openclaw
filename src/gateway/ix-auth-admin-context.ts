// The administrator behind one `/auth/admin/*` request, and the departments they act on.
//
// Two things separate these routes from the anonymous account routes. They require a
// signed-in superadmin or admin, and they call the identity server with that person's own
// access token rather than the service key, so the identity server applies its permission
// model a second time and its ledger names the real actor.
//
// Invitations, signup approvals, and the user-management surface all resolve their caller
// here so the three can never drift on who is allowed in or on where a department list
// comes from.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  addIxAuthGroupMember,
  listIxAuthGroups,
  type IxAuthAdminCall,
} from "../auth/ix-auth/ix-auth-admin-client.js";
import type { IxAuthRelayFailure } from "../auth/ix-auth/ix-auth-client.js";
import { canUseIxAuthAdminApi } from "../auth/ix-auth/ix-auth-role-map.js";
import {
  matchesIxAuthCsrfDigest,
  resolveIxAuthSessionToken,
} from "../auth/ix-auth/ix-auth-sessions.js";
import { IX_AUTH_CSRF_HEADER_NAME, type IxAuthPrincipal } from "../auth/ix-auth/ix-auth-types.js";
import { sendJson } from "./http-common.js";
import { readRequestMeta, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { readIxAuthSessionCookie } from "./ix-auth-principal.js";

/** One resolved administrator, ready to act against the identity server. */
export type IxAuthAdminContext = {
  principal: IxAuthPrincipal;
  call: IxAuthAdminCall;
};

/** Translate one identity-server failure into this namespace's own answer. */
export function sendRelayFailure(res: ServerResponse, failure: IxAuthRelayFailure): void {
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
  if (failure.status === 404) {
    sendJson(res, 404, { error: "not_found" });
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
export async function resolveIxAuthAdminContext(params: {
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
  if (!canUseIxAuthAdminApi(resolution.principal.gatewayRole)) {
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

export type IxAuthDepartmentGroup = { groupId: string; code: string; name: string };

export type IxAuthDepartmentListing =
  | { ok: true; departments: IxAuthDepartmentGroup[] }
  | { ok: false; failure: IxAuthRelayFailure };

/**
 * The departments the identity server knows about, in one relay call.
 *
 * Every surface reads departments through here, so the list an administrator is shown and
 * the memberships an invitation grants can never come from different sources.
 */
export async function listIxAuthDepartmentGroups(params: {
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<IxAuthDepartmentListing> {
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

/** Keep only the codes that name a real department, dropping duplicates and blanks. */
export function readIxAuthDepartmentCodesFromBody(body: Record<string, unknown>): string[] {
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

export type IxAuthDepartmentGrant = { granted: string[]; failed: boolean };

/**
 * Put one account into the departments it was invited into.
 *
 * A code naming no department is reported rather than obeyed, and a code outside the
 * department prefix is not a department at all: neither may quietly place someone into an
 * ordinary group. Nothing is rolled back over a failed placement, because the account
 * exists by then and its link has already gone out.
 */
export async function grantIxAuthDepartments(params: {
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  userId: string;
  requested: readonly string[];
  fillAllWhenEmpty: boolean;
}): Promise<IxAuthDepartmentGrant> {
  if (params.requested.length === 0 && !params.fillAllWhenEmpty) {
    return { granted: [], failed: false };
  }
  const listing = await listIxAuthDepartmentGroups({ deps: params.deps, admin: params.admin });
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
