// Administrator-scoped relays to the identity server's own management API.
//
// These calls carry the signed-in administrator's access token, not the service key. The
// identity server therefore applies its own `ixauth:users:write` check a second time and
// records the real person in its audit ledger, so a Gateway bug cannot turn a member into
// an administrator and an invitation is never attributed to "the Gateway".
import { asFiniteNumber } from "@openclaw/normalization-core/number-coercion";
import { asOptionalRecord } from "@openclaw/normalization-core/record-coerce";
import { readStringValue } from "@openclaw/normalization-core/string-coerce";
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

function fieldText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  // Identity ids arrive as numbers on some routes and strings on others; both name the
  // same row, so they are normalized here rather than at each call site.
  return readStringValue(value) ?? asFiniteNumber(value)?.toString();
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
  const userId = fieldText(result.data, "id");
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
    const record = asOptionalRecord(entry);
    const groupId = record ? fieldText(record, "id") : undefined;
    const code = record ? fieldText(record, "code") : undefined;
    if (record && groupId && code) {
      groups.push({ groupId, code, name: fieldText(record, "name") ?? code });
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
  const groupId = fieldText(result.data, "id");
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

/**
 * How many accounts the identity server holds in one group.
 *
 * The fork's own projection only knows people who have signed in since the group was
 * made, so it cannot answer "is this department empty" on its own. This can: the identity
 * server is canonical for membership, and a delete that trusted the projection would drop
 * a department somebody was still in without ever having seen them.
 */
export async function countIxAuthGroupMembers(
  params: IxAuthAdminCall & { groupId: string },
): Promise<{ ok: true; count: number } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/groups/${encodeURIComponent(params.groupId)}/members`,
    method: "GET",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  if (!result.ok) {
    return result;
  }
  // The list shape differs between routes (a bare array under `data`, or `data.items`),
  // so both are read rather than assuming one and counting zero for the other.
  const nested = result.data.items;
  const items = result.items ?? (Array.isArray(nested) ? nested : []);
  return { ok: true, count: items.length };
}

/**
 * Delete one group, which is how a department stops existing.
 *
 * The caller must have already established that nobody is in it. The identity server has
 * no undo here: memberships attached to the group go with it.
 */
export async function deleteIxAuthGroup(
  params: IxAuthAdminCall & { groupId: string },
): Promise<{ ok: true } | IxAuthRelayFailure> {
  const result = await callIxAuthEndpoint({
    settings: params.settings,
    path: `admin/groups/${encodeURIComponent(params.groupId)}`,
    method: "DELETE",
    accessToken: params.accessToken,
    meta: params.meta,
  });
  return result.ok ? { ok: true } : result;
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
    const record = asOptionalRecord(entry);
    const userId = record ? fieldText(record, "userId") ?? fieldText(record, "id") : undefined;
    const email = record ? fieldText(record, "email") : undefined;
    if (record && userId && email) {
      pending.push({
        userId,
        email,
        name: fieldText(record, "name") ?? email,
        emailVerified: record.emailVerified === true,
        createdAt: fieldText(record, "createdAt"),
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
