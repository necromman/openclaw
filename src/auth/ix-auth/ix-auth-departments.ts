// Projects the department codes on a verified login into the Gateway's own tables.
//
// IX-Auth is canonical. This projection is never read to decide access - authorization
// reads the codes on the live token - so a stale row cannot widen anyone's reach. It
// exists so an operator can see who is in a department, so an agent can be bound to a
// department that some person actually belongs to, and so a removal is observable
// instead of silently disappearing with the next token.
import { invalidateOperatorRolePolicy } from "../../gateway/operator-role-policy.js";
import {
  listDepartmentsForProfile,
  normalizeDepartmentSlug,
  syncDepartmentMembership,
} from "../../state/departments-store.js";

function sameMembership(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((slug, index) => slug === next[index]);
}

/**
 * Refresh one profile's department membership from its freshly verified token.
 *
 * Returns true when the set actually changed, which is the only case that invalidates
 * cached access decisions. Connections established before the change keep the
 * departments proven at their handshake until they reconnect, the same window a role
 * change already has; terminating the identity session forces that reconnect.
 */
export function syncIxAuthDepartments(params: {
  profileId: string;
  departments: readonly string[];
  nowMs: number;
}): boolean {
  const next = [...new Set(params.departments.map(normalizeDepartmentSlug))]
    .filter((slug) => slug.length > 0)
    .toSorted();
  const previous = listDepartmentsForProfile(params.profileId);
  if (sameMembership(previous, next)) {
    return false;
  }
  syncDepartmentMembership({
    profileId: params.profileId,
    departments: next,
    nowMs: params.nowMs,
  });
  // Shares the role-change owner so one bump covers every access decision that yielded
  // mid-flight, instead of adding a second staleness signal that can disagree with it.
  invalidateOperatorRolePolicy(params.profileId);
  return true;
}
