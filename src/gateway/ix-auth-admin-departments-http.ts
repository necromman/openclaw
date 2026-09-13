// The `/auth/admin/departments` route: read the departments, create one, rename one.
//
// A department is two things at once, and this file is where that shows. The identity
// server owns the group whose code decides who is in it, and it is reached through the
// signed-in administrator's own token like every other route in this namespace. The fork
// owns the projection: who has actually been seen in it, which agents are bound to it,
// and the display name an operator chose.
//
// Renaming writes only the fork's own name. The identity server has a create and a delete
// for groups and nothing in between (`AccessAdminController`, `/admin/groups`), so there
// is no rename to relay; inventing one by deleting and recreating the group would drop
// every membership it holds. The code, which is what authorization reads, never changes.
//
// Deleting relays both ways: the group goes on the identity server and the projection
// goes here. It is refused while anyone is still in the group, because a department is
// the shape of a boundary and emptying one silently is how people lose access without
// anybody deciding they should.
//
// Every route here is open to an administrator, not only to a system administrator (P).
// The earlier rule read "an ordinary administrator lives inside the boundary, so it must
// not move it", which sounded right and was wrong in practice: running the company's
// departments is the same job as running its accounts, and splitting the two meant the
// person who does that job had to ask someone else to press the button. What actually
// guards the boundary is elsewhere and stays: nobody, of any rank, may edit their own
// departments (`rejectSelfTarget` in `ix-auth-admin-users-actions.ts`), an administrator
// may not touch a system administrator's row, and a department with members in it cannot
// be deleted. Creating an empty department grants its creator nothing.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { createIxAuthGroup, deleteIxAuthGroup } from "../auth/ix-auth/ix-auth-admin-client.js";
import {
  deleteDepartment,
  listDepartmentMembers,
  listDepartments,
  normalizeDepartmentSlug,
  readDepartmentAgentBindings,
  upsertDepartment,
} from "../state/departments-store.js";
import { sendJson } from "./http-common.js";
import {
  listIxAuthDepartmentGroups,
  sendRelayFailure,
  type IxAuthAdminContext,
  type IxAuthDepartmentGroup,
} from "./ix-auth-admin-context.js";
import {
  countIxAuthGroupMembership,
  countIxAuthIdentityMembersByCode,
  readIxAuthGroupBody,
  slugForPrefixedGroupCode,
  IX_AUTH_GROUP_SLUG_PATTERN,
} from "./ix-auth-admin-group-helpers.js";
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import { readIxAuthJsonBody, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

type DepartmentsRouteParams = {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
};

/**
 * Merge the identity server's groups with the fork's own projection.
 *
 * The order is deliberate: the identity server decides which departments exist, and the
 * projection only decorates them. A department the fork knows about but the identity
 * server does not is reported separately rather than mixed in, because the invitation and
 * user screens read this list to choose from, and offering a code no group answers to
 * would produce an "unknown department" the moment someone picked it.
 */
function projectDepartments(params: {
  groups: readonly IxAuthDepartmentGroup[];
  prefix: string;
  /** Members per group code as the identity server lists them, or undefined when it would not say. */
  identityCounts: ReadonlyMap<string, number> | undefined;
}): {
  departments: Record<string, unknown>[];
  orphans: Record<string, unknown>[];
} {
  const bindings = readDepartmentAgentBindings();
  const agentsFor = (slug: string) =>
    [...bindings.entries()].filter(([, bound]) => bound === slug).map(([agentId]) => agentId);
  const local = new Map(listDepartments().map((row) => [row.slug, row]));
  const seen = new Set<string>();
  const departments: Record<string, unknown>[] = [];
  for (const group of params.groups) {
    const slug = slugForPrefixedGroupCode(group.code, params.prefix);
    if (!slug) {
      continue;
    }
    seen.add(slug);
    const row = local.get(slug);
    // The operator-authored name wins when there is one. `upsertDepartment` stores the
    // bare slug for a department nobody has named, and that is not a display name.
    const chosen = row && row.display_name !== slug ? row.display_name : group.name;
    // The identity server's count includes people who have never signed in here; the
    // projection only knows who has. The response says which one it is giving.
    const memberCount = params.identityCounts
      ? (params.identityCounts.get(group.code) ?? 0)
      : row
        ? listDepartmentMembers(slug).length
        : 0;
    departments.push({
      code: group.code,
      slug,
      name: chosen,
      identityName: group.name,
      memberCount,
      agents: agentsFor(slug),
    });
  }
  const orphans: Record<string, unknown>[] = [];
  for (const [slug, row] of local) {
    if (seen.has(slug)) {
      continue;
    }
    orphans.push({
      slug,
      name: row.display_name,
      memberCount: listDepartmentMembers(slug).length,
      agents: agentsFor(slug),
    });
  }
  return { departments, orphans };
}

async function handleList(params: DepartmentsRouteParams): Promise<void> {
  const listing = await listIxAuthDepartmentGroups({ deps: params.deps, admin: params.admin });
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const prefix = params.deps.settings.departmentGroupPrefix;
  const counted = await countIxAuthIdentityMembersByCode({ admin: params.admin, prefix });
  const projected = projectDepartments({
    groups: listing.departments,
    prefix,
    identityCounts: counted,
  });
  sendJson(params.res, 200, {
    prefix,
    memberCountSource: counted ? "identity" : "projection",
    ...projected,
  });
}

async function handleCreate(params: DepartmentsRouteParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const read = readIxAuthGroupBody(body);
  if (!read.ok) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const prefix = params.deps.settings.departmentGroupPrefix;
  if (prefix.length === 0) {
    // With no prefix every group is a department, so there is no code this route could
    // mint that would not also claim an unrelated group.
    sendJson(params.res, 400, { error: "department_prefix_unset" });
    return;
  }
  const listing = await listIxAuthDepartmentGroups({ deps: params.deps, admin: params.admin });
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const code = `${prefix}${read.slug}`;
  if (listing.departments.some((group) => group.code === code)) {
    sendJson(params.res, 409, { error: "conflict", message: code });
    return;
  }
  const created = await createIxAuthGroup({ ...params.admin.call, code, name: read.name });
  if (!created.ok) {
    sendRelayFailure(params.res, created);
    return;
  }
  // Recorded locally as well, so the department is listable and bindable before anyone
  // in it has signed in. Without this the row appears only at the first sign-in and an
  // operator cannot bind an agent to a department they just created.
  upsertDepartment({ slug: read.slug, displayName: read.name, nowMs: Date.now() });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "department-create",
    detail: { code, slug: read.slug, name: read.name },
  });
  sendJson(params.res, 200, { code, slug: read.slug, name: read.name });
}

async function handleRename(params: DepartmentsRouteParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const read = readIxAuthGroupBody(body);
  if (!read.ok) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const listing = await listIxAuthDepartmentGroups({ deps: params.deps, admin: params.admin });
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const prefix = params.deps.settings.departmentGroupPrefix;
  const known = listing.departments.some(
    (group) => slugForPrefixedGroupCode(group.code, prefix) === read.slug,
  );
  if (!known) {
    sendJson(params.res, 404, { error: "not_found" });
    return;
  }
  upsertDepartment({ slug: read.slug, displayName: read.name, nowMs: Date.now() });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "department-rename",
    detail: { slug: read.slug, name: read.name },
  });
  sendJson(params.res, 200, { slug: read.slug, name: read.name });
}

/**
 * Delete one department.
 *
 * Two stores have to agree afterwards, and they are removed in the order that leaves the
 * safe state if the second step never runs: the identity group goes first, so a failure
 * after it leaves a department the fork still lists but nobody can be granted, which the
 * screen already shows as an orphan. Removing the projection first would instead leave a
 * live group that the fork has forgotten, and people would keep being placed into a
 * department no operator can see.
 *
 * The agents that lose their binding are named in the answer. Their configured workspace
 * and index folders still point at this department's folders, and only the caller holding
 * the config write can clear those.
 */
async function handleDelete(params: DepartmentsRouteParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const slug = normalizeDepartmentSlug(normalizeOptionalString(body.slug) ?? "");
  if (!IX_AUTH_GROUP_SLUG_PATTERN.test(slug)) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const listing = await listIxAuthDepartmentGroups({ deps: params.deps, admin: params.admin });
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const prefix = params.deps.settings.departmentGroupPrefix;
  const group = listing.departments.find(
    (entry) => slugForPrefixedGroupCode(entry.code, prefix) === slug,
  );
  // A department the identity server no longer lists is an orphan row: there is no group
  // to delete, and clearing the projection is the whole job.
  if (group) {
    const occupied = await countIxAuthGroupMembership({ admin: params.admin, group });
    // A count the identity server would not give is not proof of emptiness. The delete
    // waits for an answer rather than proceeding on the sign-in projection, which cannot
    // see a person who was placed in the department and has not signed in yet.
    if (occupied === undefined) {
      sendJson(params.res, 503, { error: "member_count_unavailable" });
      return;
    }
    if (occupied > 0) {
      sendJson(params.res, 409, { error: "department_has_members", memberCount: occupied });
      return;
    }
    const removed = await deleteIxAuthGroup({ ...params.admin.call, groupId: group.groupId });
    if (!removed.ok) {
      sendRelayFailure(params.res, removed);
      return;
    }
  } else {
    const projected = listDepartmentMembers(slug).length;
    if (projected > 0) {
      sendJson(params.res, 409, { error: "department_has_members", memberCount: projected });
      return;
    }
  }
  const { unboundAgents } = deleteDepartment(slug);
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "department-delete",
    detail: { slug, code: group?.code ?? null, unboundAgents },
  });
  sendJson(params.res, 200, { slug, unboundAgents });
}

/** Dispatch one `/auth/admin/departments` request for an already-resolved administrator. */
export async function handleIxAuthAdminDepartmentsRequest(
  params: DepartmentsRouteParams,
): Promise<void> {
  if (params.req.method === "GET") {
    await handleList(params);
    return;
  }
  if (params.req.method === "POST") {
    await handleCreate(params);
    return;
  }
  if (params.req.method === "PATCH") {
    await handleRename(params);
    return;
  }
  if (params.req.method === "DELETE") {
    await handleDelete(params);
    return;
  }
  sendJson(params.res, 404, { error: "not_found" });
}
