// Administrator-scoped relays to the identity server's user-management API.
//
// Like the invitation relays beside them, every call here carries the signed-in
// administrator's access token rather than the service key, so the identity server
// applies its own `ixauth:users:write` and `ixauth:roles:write` checks a second time and
// its ledger names the real person.
//
// The identity server's own shapes are normalized once, here, so no Gateway route and no
// browser screen has to know that an account id arrives as a number on one route and a
// string on the next.
import { asFiniteNumber } from "@openclaw/normalization-core/number-coercion";
import { asOptionalRecord } from "@openclaw/normalization-core/record-coerce";
import { readStringValue } from "@openclaw/normalization-core/string-coerce";
import { callIxAuthEndpoint, type IxAuthRelayFailure } from "./ix-auth-client.js";
import type { IxAuthAdminCall } from "./ix-auth-admin-client.js";

/** Account states the identity server uses. `LOCKED` is automatic, not administrative. */
export type IxAuthUserStatus =
  | "ACTIVE"
  | "LOCKED"
  | "DISABLED"
  | "PENDING"
  | "PENDING_APPROVAL";

/** The two states an administrator may set directly. */
export const IX_AUTH_SETTABLE_USER_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "DISABLED",
]);

const IX_AUTH_USER_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "LOCKED",
  "DISABLED",
  "PENDING",
  "PENDING_APPROVAL",
]);

/** One account as the user-management screen reads it. */
export type IxAuthUserSummary = {
  id: string;
  email: string;
  name: string;
  status: IxAuthUserStatus;
  /** Effective role codes: direct grants and the ones a group carries. */
  roles: string[];
  /** Every group code, department or not. The Gateway filters by its own prefix. */
  groups: string[];
  failedCount: number;
  lockedUntil?: string;
  lastLoginAt?: string;
  createdAt?: string;
};

/** One page of accounts, with the identity server's own paging counters. */
export type IxAuthUserPage = {
  users: IxAuthUserSummary[];
  page: number;
  size: number;
  total: number;
};

function fieldText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  // Identity ids arrive as numbers on some routes and strings on others; both name the
  // same row, so they are normalized here rather than at each call site.
  return readStringValue(value) ?? asFiniteNumber(value)?.toString();
}

function readStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function fieldCount(record: Record<string, unknown>, key: string): number {
  return asFiniteNumber(record[key]) ?? 0;
}

/**
 * Read one account row.
 *
 * An unreadable id or email means the row cannot be acted on, so it is dropped rather
 * than shown as a half-account an administrator would then click.
 */
export function readIxAuthUserSummary(value: unknown): IxAuthUserSummary | undefined {
  const record = asOptionalRecord(value);
  const id = record ? fieldText(record, "id") : undefined;
  const email = record ? fieldText(record, "email") : undefined;
  if (!record || !id || !email) {
    return undefined;
  }
  const status = fieldText(record, "status") ?? "";
  return {
    id,
    email,
    name: fieldText(record, "name") ?? email,
    // SAFETY: the membership test directly above proves the cast.
    status: IX_AUTH_USER_STATUSES.has(status) ? (status as IxAuthUserStatus) : "ACTIVE",
    roles: readStringList(record, "roles"),
    groups: readStringList(record, "groups"),
    failedCount: fieldCount(record, "failedCount"),
    lockedUntil: fieldText(record, "lockedUntil"),
    lastLoginAt: fieldText(record, "lastLoginAt"),
    createdAt: fieldText(record, "createdAt"),
  };
}

/** One page of accounts, filtered by the identity server itself. */
export async function listIxAuthUsers(
  params: IxAuthAdminCall & {
    query?: string;
    status?: string;
    role?: string;
    page: number;
    size: number;
  },
): Promise<({ ok: true } & IxAuthUserPage) | IxAuthRelayFailure> {
  const search = new URLSearchParams();
  if (params.query) {
    search.set("q", params.query);
  }
  if (params.status) {
    search.set("status", params.status);
  }
  if (params.role) {
    search.set("role", params.role);
  }
  search.set("page", String(params.page));
  search.set("size", String(params.size));
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users?${search.toString()}`,
    method: "GET",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const items = Array.isArray(result.data.items) ? result.data.items : [];
  const users: IxAuthUserSummary[] = [];
  for (const entry of items) {
    const user = readIxAuthUserSummary(entry);
    if (user) {
      users.push(user);
    }
  }
  return {
    ok: true,
    users,
    page: fieldCount(result.data, "page"),
    size: fieldCount(result.data, "size"),
    total: fieldCount(result.data, "total"),
  };
}

/** One account, without the detail payload's sessions and audit trail. */
export async function getIxAuthUser(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true; user: IxAuthUserSummary } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}`,
    method: "GET",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const user = readIxAuthUserSummary(result.data);
  return user
    ? { ok: true, user }
    : {
        ok: false,
        status: 502,
        code: "IXAUTH_UNAVAILABLE",
        message: "the identity server returned an unreadable account",
      };
}

/** Everything the detail panel shows: the account plus its live sessions and MFA state. */
export type IxAuthUserDetail = {
  user: IxAuthUserSummary;
  emailVerified: boolean;
  mfaEnabled: boolean;
  sessionCount: number;
};

export async function getIxAuthUserDetail(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true; detail: IxAuthUserDetail } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}/detail`,
    method: "GET",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const user = readIxAuthUserSummary(result.data);
  if (!user) {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned an unreadable account",
    };
  }
  const mfa = asOptionalRecord(result.data.mfa);
  const sessions = Array.isArray(result.data.sessions) ? result.data.sessions : [];
  return {
    ok: true,
    detail: {
      user,
      emailVerified: result.data.emailVerified === true,
      // The identity server names this field differently across its own screens, so both
      // spellings are read rather than picking one and showing "off" when it is on.
      mfaEnabled: mfa?.enabled === true || mfa?.totpEnabled === true,
      sessionCount: sessions.length,
    },
  };
}

/** Change the display name, the account status, or both. */
export async function updateIxAuthUser(
  params: IxAuthAdminCall & { userId: string; name?: string; status?: string },
): Promise<{ ok: true; user: IxAuthUserSummary } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}`,
    method: "PATCH",
    accessToken: params.accessToken,
    body: { name: params.name, status: params.status },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const user = readIxAuthUserSummary(result.data);
  return user
    ? { ok: true, user }
    : {
        ok: false,
        status: 502,
        code: "IXAUTH_UNAVAILABLE",
        message: "the identity server returned an unreadable account",
      };
}

/** Replace the whole role set. The identity server has no add-one or remove-one call. */
export async function replaceIxAuthUserRoles(
  params: IxAuthAdminCall & { userId: string; roles: readonly string[] },
): Promise<{ ok: true; user: IxAuthUserSummary } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}/roles`,
    method: "PUT",
    accessToken: params.accessToken,
    body: { roles: [...params.roles] },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const user = readIxAuthUserSummary(result.data);
  return user
    ? { ok: true, user }
    : {
        ok: false,
        status: 502,
        code: "IXAUTH_UNAVAILABLE",
        message: "the identity server returned an unreadable account",
      };
}

/** Take one account out of one group, which is how a department is withdrawn. */
export async function removeIxAuthGroupMember(
  params: IxAuthAdminCall & { groupId: string; userId: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/groups/${encodeURIComponent(params.groupId)}/members/${encodeURIComponent(
      params.userId,
    )}`,
    method: "DELETE",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** Clear an automatic lockout so the person can try their password again. */
export async function unlockIxAuthUser(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}/unlock`,
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** Clear two-step verification for someone who lost both phone and backup codes. */
export async function resetIxAuthUserMfa(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true; reset: boolean } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}/mfa-reset`,
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true, reset: result.data.reset === true } : result;
}

/** End every identity-server session this account holds. */
export async function revokeIxAuthUserSessions(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true; revoked: number } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}/sessions`,
    method: "DELETE",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true, revoked: fieldCount(result.data, "revoked") } : result;
}

/**
 * Delete one account.
 *
 * The identity server treats this as a soft delete: the row stays, its status becomes
 * `DISABLED`, and its sessions are revoked. Nothing here can erase an account, and the
 * screens say so rather than promising an erasure that does not happen.
 */
export async function deleteIxAuthUser(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}`,
    method: "DELETE",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** One row's outcome in a bulk import. */
export type IxAuthBulkRowResult = {
  line: number;
  email?: string;
  status: string;
  userId?: string;
  error?: string;
};

export type IxAuthBulkSummary = {
  total: number;
  created: number;
  failed: number;
  invited: number;
  results: IxAuthBulkRowResult[];
};

/** One account the import wants to create. */
export type IxAuthBulkUser = { email: string; name?: string; roles?: readonly string[] };

/**
 * Create many accounts in one call.
 *
 * The JSON shape is used rather than the identity server's CSV shape because the Gateway
 * has already parsed the file: it has to, since departments are a Gateway concern that
 * the identity server's three-column CSV contract has no room for. Re-serializing rows
 * back into CSV only to have them parsed again would add a quoting bug for nothing.
 *
 * One bad row does not fail the rest: the identity server runs each row in its own
 * transaction and reports the outcome per line.
 */
export async function importIxAuthUsers(
  params: IxAuthAdminCall & { users: readonly IxAuthBulkUser[]; invite: boolean },
): Promise<{ ok: true; summary: IxAuthBulkSummary } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "admin/users/bulk",
    accessToken: params.accessToken,
    body: {
      users: params.users.map((user) => ({
        email: user.email,
        name: user.name,
        roles: user.roles ? [...user.roles] : undefined,
      })),
      invite: params.invite,
    },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const rows = Array.isArray(result.data.results) ? result.data.results : [];
  const results: IxAuthBulkRowResult[] = [];
  for (const entry of rows) {
    const record = asOptionalRecord(entry);
    if (!record) {
      continue;
    }
    results.push({
      line: fieldCount(record, "line"),
      email: fieldText(record, "email"),
      status: fieldText(record, "status") ?? "FAILED",
      userId: fieldText(record, "userId"),
      error: fieldText(record, "error"),
    });
  }
  return {
    ok: true,
    summary: {
      total: fieldCount(result.data, "total"),
      created: fieldCount(result.data, "created"),
      failed: fieldCount(result.data, "failed"),
      invited: fieldCount(result.data, "invited"),
      results,
    },
  };
}
