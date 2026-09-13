// Replace the job titles one account holds.
//
// It sits apart from `ix-auth-admin-users-actions.ts` so that file stays under the
// repository's per-file ceiling, and because the shape is its own: the identity server
// has no "set these groups" call, so the difference is computed here and applied as adds
// and removes, one at a time, with every step that did not take named in the answer.
//
// Only titles are touched. A code outside the configured title prefix is another kind of
// group entirely, and this route has no business moving anyone in or out of one.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { addIxAuthGroupMember } from "../auth/ix-auth/ix-auth-admin-client.js";
import {
  getIxAuthUser,
  removeIxAuthGroupMember,
} from "../auth/ix-auth/ix-auth-admin-users-client.js";
import { sendJson } from "./http-common.js";
import {
  listIxAuthPrefixedGroups,
  sendRelayFailure,
  type IxAuthAdminContext,
} from "./ix-auth-admin-context.js";
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import {
  endIxAuthUserSessions,
  rejectSelfTarget,
  rejectSuperAdminTarget,
} from "./ix-auth-admin-users-guard.js";
import { projectIxAuthUser } from "./ix-auth-admin-users-view.js";
import { readIxAuthJsonBody, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

type TitleActionParams = {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
  userId: string;
};

/** Keep only the codes worth relaying, dropping duplicates and blanks. */
function readTitleCodesFromBody(body: Record<string, unknown>): string[] {
  const listed = Array.isArray(body.titles) ? body.titles : [];
  const codes: string[] = [];
  for (const entry of listed) {
    const code = normalizeOptionalString(entry);
    if (code) {
      codes.push(code);
    }
  }
  return [...new Set(codes)];
}

/** Replace the whole title set of one account. */
export async function handleIxAuthReplaceTitles(params: TitleActionParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  // Titles name folder rules, so an administrator who could add one to their own row
  // could open a folder to themselves without anybody else deciding they should.
  if (rejectSelfTarget({ res: params.res, admin: params.admin, userId: params.userId })) {
    return;
  }
  const prefix = params.deps.settings.titleGroupPrefix;
  const requested = readTitleCodesFromBody(body);
  const listing = await listIxAuthPrefixedGroups({ admin: params.admin, prefix });
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  for (const code of requested) {
    if (!listing.groups.some((group) => group.code === code)) {
      sendJson(params.res, 400, { error: "unknown_title", message: code });
      return;
    }
  }
  const current = await getIxAuthUser({ ...params.admin.call, userId: params.userId });
  if (!current.ok) {
    sendRelayFailure(params.res, current);
    return;
  }
  const target = current.user;
  // The same protection the role and department routes carry: an ordinary administrator
  // does not reshape what a system administrator is.
  if (rejectSuperAdminTarget({ ...params, target })) {
    return;
  }
  const held = target.groups.filter((code) => prefix.length > 0 && code.startsWith(prefix));
  const failedTitles: string[] = [];
  const applied = new Set(held);
  for (const code of held) {
    if (requested.includes(code)) {
      continue;
    }
    const group = listing.groups.find((entry) => entry.code === code);
    if (!group) {
      // A title the account holds that the prefix no longer names. Left alone rather than
      // guessed at: removing it would need a group id this listing does not have.
      failedTitles.push(code);
      continue;
    }
    const removed = await removeIxAuthGroupMember({
      ...params.admin.call,
      groupId: group.groupId,
      userId: params.userId,
    });
    if (removed.ok) {
      applied.delete(code);
    } else {
      failedTitles.push(code);
    }
  }
  for (const code of requested) {
    if (held.includes(code)) {
      continue;
    }
    const group = listing.groups.find((entry) => entry.code === code);
    if (!group) {
      failedTitles.push(code);
      continue;
    }
    const added = await addIxAuthGroupMember({
      ...params.admin.call,
      groupId: group.groupId,
      userId: params.userId,
    });
    if (added.ok) {
      applied.add(code);
    } else {
      failedTitles.push(code);
    }
  }
  // Titles ride in the access token, so an open session keeps the old set until it is
  // replaced. Ending the sessions is what makes a withdrawn title take effect now.
  const takedown = await endIxAuthUserSessions({ ...params, target, reason: "titles changed" });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "user-titles",
    targetUserId: params.userId,
    detail: { from: held, to: requested, failed: failedTitles },
  });
  sendJson(params.res, 200, {
    userId: params.userId,
    titles: [...applied],
    requested,
    titleFailed: failedTitles.length > 0,
    failedTitles,
    sessions: takedown,
    user: projectIxAuthUser({
      user: {
        ...target,
        groups: [...new Set([...target.groups.filter((code) => !held.includes(code)), ...applied])],
      },
      settings: params.deps.settings,
      self: false,
    }),
  });
}
