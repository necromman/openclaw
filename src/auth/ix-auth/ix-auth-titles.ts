// Projects the job titles on a verified login into the Gateway's own tables.
//
// The same posture the department projection takes: IX-Auth is canonical, this is a copy
// an operator can read, and authorization never consults it. It exists so a title can be
// listed and named in a folder rule before anyone holding it has signed in here, and so a
// withdrawn title is visibly gone rather than quietly absent from the next token.
import { invalidateOperatorRolePolicy } from "../../gateway/operator-role-policy.js";
import {
  listTitlesForProfile,
  normalizeTitleSlug,
  syncTitleMembership,
} from "../../state/titles-store.js";

function sameMembership(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((slug, index) => slug === next[index]);
}

/**
 * Refresh one profile's titles from its freshly verified token.
 *
 * Returns true when the set actually changed, which is the only case that invalidates
 * cached access decisions. Connections established before the change keep the titles
 * proven at their handshake until they reconnect, the same window a role or department
 * change already has.
 */
export function syncIxAuthTitles(params: {
  profileId: string;
  titles: readonly string[];
  nowMs: number;
}): boolean {
  const next = [...new Set(params.titles.map(normalizeTitleSlug))]
    .filter((slug) => slug.length > 0)
    .toSorted();
  const previous = listTitlesForProfile(params.profileId);
  if (sameMembership(previous, next)) {
    return false;
  }
  syncTitleMembership({ profileId: params.profileId, titles: next, nowMs: params.nowMs });
  // Shares the role-change owner so one bump covers every access decision that yielded
  // mid-flight, instead of adding a third staleness signal that can disagree with them.
  invalidateOperatorRolePolicy(params.profileId);
  return true;
}
