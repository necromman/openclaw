// Administrator-scoped relays to the identity server's own management API.
//
// These calls carry the signed-in administrator's access token, not the service key. The
// identity server therefore applies its own `ixauth:users:write` check a second time and
// records the real person in its audit ledger, so a Gateway bug cannot turn a member into
// an administrator and an invitation is never attributed to "the Gateway".
import { callIxAuthEndpoint, type IxAuthRelayFailure, type IxAuthRequestMeta } from "./ix-auth-client.js";
import type { IxAuthRuntimeSettings } from "./ix-auth-types.js";

/** Shared arguments for every administrator relay. */
export type IxAuthAdminCall = {
  settings: IxAuthRuntimeSettings;
  /** The administrator's own IX-Auth access token, taken from their login session row. */
  accessToken: string;
  meta: IxAuthRequestMeta;
};

/** One account waiting for a signup decision. */
export type IxAuthPendingSignup = {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt?: string;
};

/** One identity-server group, as seen by the invitation form. */
export type IxAuthGroupSummary = { groupId: string; code: string; name: string };

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  // Identity ids arrive as numbers on some routes and strings on others; both name the
  // same row, so they are normalized here rather than at each call site.
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  // SAFETY: the guard above rejected null, arrays, and non-objects.
  return value as Record<string, unknown>;
}

/**
 * Create an invited account.
 *
 * Omitting the password is what makes this an invitation: the identity server creates the
 * account as PENDING and mails a one-time link, so no administrator ever knows or hands
 * over a password.
 */
export async function createIxAuthInvitedUser(
  params: IxAuthAdminCall & { email: string; name: string; roles: string[] },
): Promise<({ ok: true; userId: string } | IxAuthRelayFailure)> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "admin/users",
    accessToken: params.accessToken,
    body: { email: params.email, name: params.name, roles: params.roles, invite: true },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const userId = readString(result.data, "id");
  if (!userId) {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned no user id",
    };
  }
  return { ok: true, userId };
}

/** Send the invitation mail again, invalidating the previous link. */
export async function resendIxAuthInvite(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/users/${encodeURIComponent(params.userId)}/invite`,
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** List every group so the invitation form can offer the department codes that exist. */
export async function listIxAuthGroups(
  params: IxAuthAdminCall,
): Promise<{ ok: true; groups: IxAuthGroupSummary[] } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "admin/groups",
    method: "GET",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const groups: IxAuthGroupSummary[] = [];
  for (const entry of result.items ?? []) {
    const record = asRecord(entry);
    const groupId = record ? readString(record, "id") : undefined;
    const code = record ? readString(record, "code") : undefined;
    if (record && groupId && code) {
      groups.push({ groupId, code, name: readString(record, "name") ?? code });
    }
  }
  return { ok: true, groups };
}

/**
 * Create one group, which is how a department comes into existence.
 *
 * No role is attached. Roles and departments are orthogonal (AUTH-DEPARTMENTS 3), and a
 * department group that carried a role would quietly promote everyone placed into it.
 */
export async function createIxAuthGroup(
  params: IxAuthAdminCall & { code: string; name: string },
): Promise<{ ok: true; groupId: string } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "admin/groups",
    accessToken: params.accessToken,
    body: { code: params.code, name: params.name },
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const groupId = readString(result.data, "id");
  if (!groupId) {
    return {
      ok: false,
      status: 502,
      code: "IXAUTH_UNAVAILABLE",
      message: "the identity server returned no group id",
    };
  }
  return { ok: true, groupId };
}

/** Put one account into one group, which is how a department is granted. */
export async function addIxAuthGroupMember(
  params: IxAuthAdminCall & { groupId: string; userId: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/groups/${encodeURIComponent(params.groupId)}/members`,
    accessToken: params.accessToken,
    body: { userId: Number(params.userId) },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/** List accounts held by `signup-mode: APPROVAL`. */
export async function listIxAuthPendingSignups(
  params: IxAuthAdminCall,
): Promise<{ ok: true; pending: IxAuthPendingSignup[] } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: "admin/signup-approvals",
    method: "GET",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  const pending: IxAuthPendingSignup[] = [];
  for (const entry of result.items ?? []) {
    const record = asRecord(entry);
    const userId = record ? readString(record, "userId") ?? readString(record, "id") : undefined;
    const email = record ? readString(record, "email") : undefined;
    if (record && userId && email) {
      pending.push({
        userId,
        email,
        name: readString(record, "name") ?? email,
        emailVerified: record.emailVerified === true,
        createdAt: readString(record, "createdAt"),
      });
    }
  }
  return { ok: true, pending };
}

/** Approve a waiting signup. The account becomes ACTIVE and can sign in immediately. */
export async function approveIxAuthSignup(
  params: IxAuthAdminCall & { userId: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/signup-approvals/${encodeURIComponent(params.userId)}/approve`,
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}

/**
 * Reject a waiting signup.
 *
 * The identity server disables the account rather than deleting it, so the same address
 * cannot simply try again and the refusal stays visible in the ledger.
 */
export async function rejectIxAuthSignup(
  params: IxAuthAdminCall & { userId: string; reason?: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/signup-approvals/${encodeURIComponent(params.userId)}/reject`,
    accessToken: params.accessToken,
    body: { reason: params.reason },
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
}
