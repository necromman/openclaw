// Control UI client for the Gateway's user-management routes.
//
// Every call rides the session cookie plus the session-bound CSRF token, exactly like the
// invitation routes beside it. Nothing here is a permission check: an account that may
// not manage users is refused by the Gateway, and the screen only decides what is worth
// drawing.
import { asFiniteNumber } from "@openclaw/normalization-core/number-coercion";
import { readStringField } from "@openclaw/normalization-core/record-coerce";
import { readIxAuthCsrfToken } from "./ix-auth-session-api.ts";

/** Header the Gateway expects the session CSRF token in on mutating requests. */
const IX_AUTH_CSRF_HEADER = "x-openclaw-csrf";

/** Account states the identity server uses. */
export type IxAuthUserStatus =
  | "ACTIVE"
  | "LOCKED"
  | "DISABLED"
  | "PENDING"
  | "PENDING_APPROVAL";

/** One account row, as the Gateway projects it. */
export type IxAuthManagedUser = {
  id: string;
  email: string;
  displayName: string;
  status: IxAuthUserStatus;
  roles: string[];
  gatewayRole?: string;
  isSuperAdmin: boolean;
  departments: string[];
  lastLoginAt?: string;
  createdAt?: string;
  locked: boolean;
  lockedUntil?: string;
  failedCount: number;
  /** True for the signed-in administrator's own row, decided by the Gateway. */
  self: boolean;
};

export type IxAuthUserPage = {
  users: IxAuthManagedUser[];
  page: number;
  size: number;
  total: number;
  /** True when the Gateway narrowed the page by department after fetching it. */
  departmentFilterApplied: boolean;
};

export type IxAuthUserDetail = {
  user: IxAuthManagedUser;
  emailVerified: boolean;
  mfaEnabled: boolean;
  sessionCount: number;
};

/** One row's outcome in a bulk import. */
export type IxAuthImportRow = {
  /** The spreadsheet line, header counted, so the row can be found in the file. */
  line: number;
  email?: string;
  status: string;
  error?: string;
  /** Present when the row asked for departments: which took and which did not. */
  departments?: { granted: string[]; failed: string[] };
};

export type IxAuthImportSummary = {
  total: number;
  created: number;
  failed: number;
  invited: number;
  departmentFailures: number;
  results: IxAuthImportRow[];
};

export type IxAuthUsersFailure = { kind: "failed"; errorKey: string; message?: string };

export function isIxAuthUsersFailure(value: unknown): value is IxAuthUsersFailure {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  // SAFETY: the guard above proves this is a plain object.
  return (value as { kind?: unknown }).kind === "failed";
}

/**
 * Map one Gateway refusal onto the sentence a person reads.
 *
 * The policy refusals get their own words because "forbidden" tells an administrator
 * nothing about what to do instead, and these three are the ones they will actually meet.
 */
function mapUsersErrorToKey(status: number, code: string): string {
  switch (code) {
    case "self_forbidden":
      return "usersSelfForbidden";
    case "last_super_admin":
      return "usersLastSuperAdmin";
    case "unknown_department":
      return "usersUnknownDepartment";
    case "invalid_role":
      return "usersInvalidRole";
    case "too_many_rows":
      return "usersTooManyRows";
    case "missing_email_column":
      return "usersMissingEmailColumn";
    case "empty":
      return "usersEmptyFile";
    case "forbidden":
    case "csrf_mismatch":
      return "adminForbidden";
    case "unauthenticated":
      return "adminUnauthenticated";
    case "conflict":
      return "adminConflict";
    case "identity_unavailable":
      return "identityUnavailable";
    case "not_found":
      return "usersNotFound";
    case "member_count_unavailable":
      return "memberCountUnavailable";
    default:
      return status === 400 ? "adminRejected" : "unknown";
  }
}

async function callUsersRoute(params: {
  basePath: string;
  path: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
}): Promise<{ kind: "ok"; body: Record<string, unknown> } | IxAuthUsersFailure> {
  const csrfToken = readIxAuthCsrfToken();
  let response: Response;
  try {
    response = await fetch(`${params.basePath.replace(/\/+$/u, "")}/auth/admin/users${params.path}`, {
      method: params.method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(params.method === "GET" ? {} : { "content-type": "application/json" }),
        ...(csrfToken ? { [IX_AUTH_CSRF_HEADER]: csrfToken } : {}),
      },
      body: params.method === "GET" ? undefined : JSON.stringify(params.body ?? {}),
    });
  } catch {
    return { kind: "failed", errorKey: "network" };
  }
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  const body =
    parsed !== null && typeof parsed === "object"
      // SAFETY: the null and typeof guard directly above proves this is an object.
      ? (parsed as Record<string, unknown>)
      : {};
  if (!response.ok) {
    return {
      kind: "failed",
      errorKey: mapUsersErrorToKey(response.status, typeof body.error === "string" ? body.error : ""),
      message: typeof body.message === "string" ? body.message : undefined,
    };
  }
  return { kind: "ok", body };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  // SAFETY: the guard above proves this is a plain object.
  return value as Record<string, unknown>;
}

function readStrings(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function fieldCount(record: Record<string, unknown>, key: string): number {
  return asFiniteNumber(record[key]) ?? 0;
}

function readUser(value: unknown): IxAuthManagedUser | undefined {
  const record = readRecord(value);
  const id = record ? readStringField(record, "id") : undefined;
  const email = record ? readStringField(record, "email") : undefined;
  if (!record || !id || !email) {
    return undefined;
  }
  const status = readStringField(record, "status") ?? "ACTIVE";
  return {
    id,
    email,
    displayName: readStringField(record, "displayName") ?? email,
    // SAFETY: an unexpected status only affects the label, never a decision.
    status: status as IxAuthUserStatus,
    roles: readStrings(record, "roles"),
    gatewayRole: readStringField(record, "gatewayRole"),
    isSuperAdmin: record.isSuperAdmin === true,
    departments: readStrings(record, "departments"),
    lastLoginAt: readStringField(record, "lastLoginAt"),
    createdAt: readStringField(record, "createdAt"),
    locked: record.locked === true,
    lockedUntil: readStringField(record, "lockedUntil"),
    failedCount: fieldCount(record, "failedCount"),
    self: record.self === true,
  };
}

/** One page of accounts, filtered as the screen asked. */
export async function fetchIxAuthUsers(params: {
  basePath: string;
  query?: string;
  status?: string;
  role?: string;
  department?: string;
  page?: number;
  size?: number;
}): Promise<IxAuthUserPage | IxAuthUsersFailure> {
  const search = new URLSearchParams();
  for (const [key, value] of [
    ["query", params.query],
    ["status", params.status],
    ["role", params.role],
    ["department", params.department],
  ] as const) {
    if (value) {
      search.set(key, value);
    }
  }
  search.set("page", String(params.page ?? 0));
  if (params.size) {
    search.set("size", String(params.size));
  }
  const result = await callUsersRoute({
    basePath: params.basePath,
    path: `?${search.toString()}`,
    method: "GET",
  });
  if (result.kind === "failed") {
    return result;
  }
  const raw = Array.isArray(result.body.users) ? result.body.users : [];
  const users: IxAuthManagedUser[] = [];
  for (const entry of raw) {
    const user = readUser(entry);
    if (user) {
      users.push(user);
    }
  }
  return {
    users,
    page: fieldCount(result.body, "page"),
    size: fieldCount(result.body, "size"),
    total: fieldCount(result.body, "total"),
    departmentFilterApplied: result.body.departmentFilterApplied === true,
  };
}

/** One account with the extra facts the detail panel shows. */
export async function fetchIxAuthUserDetail(params: {
  basePath: string;
  userId: string;
}): Promise<IxAuthUserDetail | IxAuthUsersFailure> {
  const result = await callUsersRoute({
    basePath: params.basePath,
    path: `/${encodeURIComponent(params.userId)}`,
    method: "GET",
  });
  if (result.kind === "failed") {
    return result;
  }
  const user = readUser(result.body.user);
  if (!user) {
    return { kind: "failed", errorKey: "unknown" };
  }
  return {
    user,
    emailVerified: result.body.emailVerified === true,
    mfaEnabled: result.body.mfaEnabled === true,
    sessionCount: fieldCount(result.body, "sessionCount"),
  };
}

function unwrapUser(
  result: { kind: "ok"; body: Record<string, unknown> } | IxAuthUsersFailure,
): IxAuthManagedUser | IxAuthUsersFailure {
  if (result.kind === "failed") {
    return result;
  }
  return readUser(result.body.user) ?? { kind: "failed", errorKey: "unknown" };
}

/** Change the display name, the account status, or both. */
export async function updateIxAuthUser(params: {
  basePath: string;
  userId: string;
  displayName?: string;
  status?: IxAuthUserStatus;
}): Promise<IxAuthManagedUser | IxAuthUsersFailure> {
  return unwrapUser(
    await callUsersRoute({
      basePath: params.basePath,
      path: `/${encodeURIComponent(params.userId)}`,
      method: "PATCH",
      body: { name: params.displayName, status: params.status },
    }),
  );
}

/** Replace the whole role set. The Gateway refuses a rank this session may not grant. */
export async function replaceIxAuthUserRoles(params: {
  basePath: string;
  userId: string;
  roles: readonly string[];
}): Promise<IxAuthManagedUser | IxAuthUsersFailure> {
  return unwrapUser(
    await callUsersRoute({
      basePath: params.basePath,
      path: `/${encodeURIComponent(params.userId)}/roles`,
      method: "PUT",
      body: { roles: [...params.roles] },
    }),
  );
}

/**
 * Replace the whole department set.
 *
 * A 200 here is not "done": the Gateway applies the change one department at a time
 * against the identity server, and reports the ones that did not take. Callers show
 * those by name rather than treating the answer as a plain success.
 */
export async function replaceIxAuthUserDepartments(params: {
  basePath: string;
  userId: string;
  departments: readonly string[];
}): Promise<
  | { kind: "ok"; departmentFailed: boolean; failedDepartments: string[]; departments: string[] }
  | IxAuthUsersFailure
> {
  const result = await callUsersRoute({
    basePath: params.basePath,
    path: `/${encodeURIComponent(params.userId)}/departments`,
    method: "PUT",
    body: { departments: [...params.departments] },
  });
  if (result.kind === "failed") {
    return result;
  }
  return {
    kind: "ok",
    departmentFailed: result.body.departmentFailed === true,
    failedDepartments: readStrings(result.body, "failedDepartments"),
    departments: readStrings(result.body, "departments"),
  };
}

/** The per-account buttons, each one relay call. */
export type IxAuthUserActionName =
  | "password-reset"
  | "invite"
  | "unlock"
  | "mfa-reset"
  | "sessions";

/** Run one per-account action and report anything the screen should show afterwards. */
export async function runIxAuthUserAction(params: {
  basePath: string;
  userId: string;
  action: IxAuthUserActionName;
}): Promise<{ kind: "ok"; inviteLink?: string; revoked?: number } | IxAuthUsersFailure> {
  const result = await callUsersRoute({
    basePath: params.basePath,
    path: `/${encodeURIComponent(params.userId)}/${params.action}`,
    method: params.action === "sessions" ? "DELETE" : "POST",
  });
  if (result.kind === "failed") {
    return result;
  }
  const sessions = readRecord(result.body.sessions);
  return {
    kind: "ok",
    inviteLink: readStringField(result.body, "inviteLink"),
    revoked: sessions ? fieldCount(sessions, "identitySessions") : undefined,
  };
}

/**
 * Delete one account.
 *
 * The identity server's delete is a soft delete: the account is deactivated and its
 * sessions end, but the row stays so its history keeps making sense.
 */
export async function deleteIxAuthUser(params: {
  basePath: string;
  userId: string;
}): Promise<{ kind: "ok" } | IxAuthUsersFailure> {
  const result = await callUsersRoute({
    basePath: params.basePath,
    path: `/${encodeURIComponent(params.userId)}`,
    method: "DELETE",
  });
  return result.kind === "failed" ? result : { kind: "ok" };
}

/** Create many accounts from one spreadsheet export. */
export async function importIxAuthUsers(params: {
  basePath: string;
  csv: string;
}): Promise<IxAuthImportSummary | IxAuthUsersFailure> {
  const result = await callUsersRoute({
    basePath: params.basePath,
    path: "/bulk",
    method: "POST",
    body: { csv: params.csv },
  });
  if (result.kind === "failed") {
    return result;
  }
  const rows = Array.isArray(result.body.results) ? result.body.results : [];
  const results: IxAuthImportRow[] = [];
  for (const entry of rows) {
    const record = readRecord(entry);
    if (record) {
      const departments = readRecord(record.departments);
      results.push({
        line: fieldCount(record, "line"),
        email: readStringField(record, "email"),
        status: readStringField(record, "status") ?? "FAILED",
        error: readStringField(record, "error"),
        ...(departments
          ? {
              departments: {
                granted: readStrings(departments, "granted"),
                failed: readStrings(departments, "failed"),
              },
            }
          : {}),
      });
    }
  }
  return {
    total: fieldCount(result.body, "total"),
    created: fieldCount(result.body, "created"),
    failed: fieldCount(result.body, "failed"),
    invited: fieldCount(result.body, "invited"),
    departmentFailures: fieldCount(result.body, "departmentFailures"),
    results,
  };
}
