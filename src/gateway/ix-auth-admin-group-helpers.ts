// What the department and the title routes both have to get right.
//
// Departments and job titles are the same mechanism twice: a group on the identity
// server whose code carries a configured prefix, plus a projection the fork owns for the
// name and the membership it has actually seen. The two routes stay separate files
// because their consequences differ (a department binds agents and hands out folders; a
// title does neither), but the parts below are where a second copy would be a defect
// rather than a difference: a slug the identity server would accept and this one would
// not, or a delete that proceeds on a member count the identity server refused to give.
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { countIxAuthGroupMembers } from "../auth/ix-auth/ix-auth-admin-client.js";
import {
  scanIxAuthDirectory,
  type IxAuthAdminContext,
  type IxAuthPrefixedGroup,
} from "./ix-auth-admin-context.js";

/** A group slug: lowercase, digits and inner hyphens, short enough to read. */
export const IX_AUTH_GROUP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

/** Longest display name a department or a title may carry. Long enough for a full name. */
const IX_AUTH_GROUP_NAME_MAX_LENGTH = 80;

/** The slug behind one group code, or undefined when the code is not of this kind. */
export function slugForPrefixedGroupCode(code: string, prefix: string): string | undefined {
  if (prefix.length === 0 || !code.startsWith(prefix)) {
    return undefined;
  }
  const slug = code.slice(prefix.length).trim().toLowerCase();
  return slug.length > 0 ? slug : undefined;
}

/** Read and check the `{ slug, name }` body the create and rename writers take. */
export function readIxAuthGroupBody(
  body: Record<string, unknown>,
): { ok: true; slug: string; name: string } | { ok: false } {
  const slug = (normalizeOptionalString(body.slug) ?? "").trim().toLowerCase();
  const name = normalizeOptionalString(body.name) ?? "";
  if (!IX_AUTH_GROUP_SLUG_PATTERN.test(slug)) {
    return { ok: false };
  }
  if (name.length === 0 || name.length > IX_AUTH_GROUP_NAME_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, slug, name };
}

/**
 * Members per group code, read from the identity server's own directory.
 *
 * Undefined when the directory could not be read, so the caller can fall back to the
 * sign-in projection and say so, rather than showing every group as empty.
 */
export async function countIxAuthIdentityMembersByCode(params: {
  admin: IxAuthAdminContext;
  prefix: string;
}): Promise<Map<string, number> | undefined> {
  const scan = await scanIxAuthDirectory({ admin: params.admin });
  if (!scan.ok) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const user of scan.users) {
    for (const code of user.groups) {
      if (params.prefix.length > 0 && code.startsWith(params.prefix)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * How many people the identity server still places in one group.
 *
 * The group-membership read is asked first, as the contract documents it; the deployed
 * server answers it with 405, so the directory walk is the working path. Neither answer
 * is ever replaced by the local projection: that only knows who has signed in here, and
 * "nobody has signed in yet" is not "nobody is in it".
 */
export async function countIxAuthGroupMembership(params: {
  admin: IxAuthAdminContext;
  group: IxAuthPrefixedGroup;
}): Promise<number | undefined> {
  const members = await countIxAuthGroupMembers({
    ...params.admin.call,
    groupId: params.group.groupId,
  });
  if (members.ok) {
    return members.count;
  }
  const scan = await scanIxAuthDirectory({ admin: params.admin });
  if (!scan.ok) {
    return undefined;
  }
  return scan.users.filter((user) => user.groups.includes(params.group.code)).length;
}
