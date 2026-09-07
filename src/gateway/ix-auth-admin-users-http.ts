// The Gateway's own user-management surface, `/auth/admin/users`.
//
// It exists so an administrator never has to sign in a second time at the identity
// server's console to add a colleague or change a role. Everything here relays to the
// identity server with that administrator's own access token; the Gateway adds the
// policy the identity server has no opinion about (who outranks whom, what happens to
// live sessions) and the departments the identity server models only as groups.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  getIxAuthUserDetail,
  listIxAuthUsers,
} from "../auth/ix-auth/ix-auth-admin-users-client.js";
import { sendJson } from "./http-common.js";
import { sendRelayFailure, type IxAuthAdminContext } from "./ix-auth-admin-context.js";
import { handleIxAuthAdminUserAction } from "./ix-auth-admin-users-actions.js";
import { handleIxAuthUsersImport } from "./ix-auth-admin-users-bulk.js";
import { isSelfIxAuthUser } from "./ix-auth-admin-users-guard.js";
import { projectIxAuthUser } from "./ix-auth-admin-users-view.js";
import { parseIxAuthAdminUsersPath } from "./ix-auth-http-paths.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

/** Accounts per page when the browser does not say. The identity server caps at 100. */
const IX_AUTH_USERS_DEFAULT_PAGE_SIZE = 25;
const IX_AUTH_USERS_MAX_PAGE_SIZE = 100;

/** Statuses the list filter accepts, matching the identity server's own enum. */
const IX_AUTH_LISTABLE_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "LOCKED",
  "DISABLED",
  "PENDING",
  "PENDING_APPROVAL",
]);

function readPositiveInteger(value: string | null, fallback: number, max: number): number {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

async function handleListUsers(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<void> {
  const url = new URL(params.req.url ?? "/", "http://gateway.invalid");
  const status = url.searchParams.get("status")?.toUpperCase();
  const role = url.searchParams.get("role")?.toUpperCase();
  const department = normalizeOptionalString(url.searchParams.get("department"));
  const page = await listIxAuthUsers({
    ...params.admin.call,
    query: normalizeOptionalString(url.searchParams.get("query")),
    status: status && IX_AUTH_LISTABLE_STATUSES.has(status) ? status : undefined,
    // A role code the deployment does not use answers with an empty page rather than an
    // error, which is the identity server's own contract for this filter.
    role: role && /^[A-Z][A-Z0-9_]*$/u.test(role) ? role : undefined,
    page: readPositiveInteger(url.searchParams.get("page"), 0, Number.MAX_SAFE_INTEGER),
    size: readPositiveInteger(
      url.searchParams.get("size"),
      IX_AUTH_USERS_DEFAULT_PAGE_SIZE,
      IX_AUTH_USERS_MAX_PAGE_SIZE,
    ),
  });
  if (!page.ok) {
    sendRelayFailure(params.res, page);
    return;
  }
  const rows = page.users.map((user) =>
    projectIxAuthUser({
      user,
      settings: params.deps.settings,
      self: isSelfIxAuthUser({ admin: params.admin, userId: user.id }),
    }),
  );
  // The identity server's list API filters by text, status, and role, but not by group.
  // Narrowing by department therefore happens here, over the page that was fetched, and
  // the response says so: a screen that showed "3 of 40" without that flag would look
  // like it had lost rows.
  const filtered = department ? rows.filter((row) => row.departments.includes(department)) : rows;
  sendJson(params.res, 200, {
    users: filtered,
    page: page.page,
    size: page.size,
    total: page.total,
    departmentFilterApplied: department !== undefined,
  });
}

async function handleReadUser(params: {
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  userId: string;
}): Promise<void> {
  const detail = await getIxAuthUserDetail({ ...params.admin.call, userId: params.userId });
  if (!detail.ok) {
    sendRelayFailure(params.res, detail);
    return;
  }
  sendJson(params.res, 200, {
    user: projectIxAuthUser({
      user: detail.detail.user,
      settings: params.deps.settings,
      self: isSelfIxAuthUser({ admin: params.admin, userId: params.userId }),
    }),
    emailVerified: detail.detail.emailVerified,
    mfaEnabled: detail.detail.mfaEnabled,
    sessionCount: detail.detail.sessionCount,
  });
}

/** Dispatch one `/auth/admin/users*` request for an already resolved administrator. */
export async function handleIxAuthAdminUsersRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<void> {
  const target = parseIxAuthAdminUsersPath(params.pathname);
  if (!target) {
    sendJson(params.res, 404, { error: "not_found" });
    return;
  }
  const method = params.req.method ?? "GET";
  if (target.kind === "collection") {
    if (method !== "GET") {
      sendJson(params.res, 405, { error: "method_not_allowed" });
      return;
    }
    await handleListUsers(params);
    return;
  }
  if (target.kind === "bulk") {
    if (method !== "POST") {
      sendJson(params.res, 405, { error: "method_not_allowed" });
      return;
    }
    await handleIxAuthUsersImport(params);
    return;
  }
  if (target.kind === "user" && method === "GET") {
    await handleReadUser({ ...params, userId: target.userId });
    return;
  }
  await handleIxAuthAdminUserAction({ ...params, method, target });
}
