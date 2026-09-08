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
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { createIxAuthGroup } from "../auth/ix-auth/ix-auth-admin-client.js";
import {
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
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import { readIxAuthJsonBody, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

/** A department slug: lowercase, digits and inner hyphens, short enough to read. */
const DEPARTMENT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

/** Longest display name a department may carry. Long enough for a full team name. */
const DEPARTMENT_NAME_MAX_LENGTH = 80;

type DepartmentsRouteParams = {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
};

/** The slug behind one group code, or undefined when the code is not a department. */
function slugForGroupCode(code: string, prefix: string): string | undefined {
  if (prefix.length === 0 || !code.startsWith(prefix)) {
    return undefined;
  }
  const slug = normalizeDepartmentSlug(code.slice(prefix.length));
  return slug.length > 0 ? slug : undefined;
}

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
    const slug = slugForGroupCode(group.code, params.prefix);
    if (!slug) {
      continue;
    }
    seen.add(slug);
    const row = local.get(slug);
    // The operator-authored name wins when there is one. `upsertDepartment` stores the
    // bare slug for a department nobody has named, and that is not a display name.
    const chosen = row && row.display_name !== slug ? row.display_name : group.name;
    departments.push({
      code: group.code,
      slug,
      name: chosen,
      identityName: group.name,
      memberCount: row ? listDepartmentMembers(slug).length : 0,
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
  const projected = projectDepartments({ groups: listing.departments, prefix });
  sendJson(params.res, 200, { prefix, ...projected });
}

/** Read and check the `{ slug, name }` body both writers take. */
function readDepartmentBody(body: Record<string, unknown>):
  | { ok: true; slug: string; name: string }
  | { ok: false } {
  const slug = normalizeDepartmentSlug(normalizeOptionalString(body.slug) ?? "");
  const name = normalizeOptionalString(body.name) ?? "";
  if (!DEPARTMENT_SLUG_PATTERN.test(slug)) {
    return { ok: false };
  }
  if (name.length === 0 || name.length > DEPARTMENT_NAME_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, slug, name };
}

/**
 * Only the top rank may change the department set.
 *
 * Reading is open to every administrator because the invitation and user screens need the
 * list to choose from. Writing is not: a department is where the boundary is drawn, and
 * an ordinary administrator lives inside it (AUTH-DEPARTMENTS 4). The check is the same
 * one the boundary itself uses, the token's own rank rather than a scope.
 */
function rejectNonSuperAdmin(params: DepartmentsRouteParams): boolean {
  if (params.admin.principal.isSuperAdmin) {
    return false;
  }
  params.deps.onSecurityEvent?.({
    action: "ix-auth.admin.denied",
    outcome: "denied",
    clientIp: params.deps.clientIp,
    profileId: params.admin.principal.profileId,
    identitySubject: params.admin.principal.claims.subject,
    loginSessionId: params.admin.principal.loginSessionId,
    reason: "role",
  });
  sendJson(params.res, 403, { error: "forbidden" });
  return true;
}

async function handleCreate(params: DepartmentsRouteParams): Promise<void> {
  if (rejectNonSuperAdmin(params)) {
    return;
  }
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const read = readDepartmentBody(body);
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
  if (rejectNonSuperAdmin(params)) {
    return;
  }
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const read = readDepartmentBody(body);
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
    (group) => slugForGroupCode(group.code, prefix) === read.slug,
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
  sendJson(params.res, 404, { error: "not_found" });
}
