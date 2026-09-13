// The `/auth/admin/titles` route: read the job titles, create one, rename one, delete one.
//
// A title is the department mechanism applied to a different question. The identity
// server owns a group whose code carries the title prefix, and the fork owns the
// projection: the display name an operator chose and the people it has actually seen hold
// it. The five permission ranks stay exactly as they were; a title ranks nobody, it says
// what a person is, and the only thing that reads it is the folder rule plane.
//
// What a title deliberately does not do is bind an agent. A department partitions agents
// because a session lives inside one agent's store; a title cuts across that and would
// give an agent two owners that can disagree. So there is no unbinding to report on a
// delete and no folder to take back afterwards, which is the whole difference between
// this file and the department one beside it.
//
// Renaming writes only the fork's own name, for the same reason it does there: the
// identity server has a create and a delete for groups and nothing in between, and
// deleting and recreating a group to rename it would drop every membership it holds.
//
// Deleting relays both ways, identity server first, and is refused while anybody still
// holds the title. The rules that name a deleted title are left behind on purpose: they
// surface as orphans on the folder screen, because silently removing them would re-open
// folders the title was closing.
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { createIxAuthGroup, deleteIxAuthGroup } from "../auth/ix-auth/ix-auth-admin-client.js";
import {
  deleteTitle,
  listTitleMembers,
  listTitles,
  normalizeTitleSlug,
  upsertTitle,
} from "../state/titles-store.js";
import { sendJson } from "./http-common.js";
import {
  listIxAuthPrefixedGroups,
  sendRelayFailure,
  type IxAuthAdminContext,
  type IxAuthPrefixedGroup,
  type IxAuthPrefixedGroupListing,
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

type TitlesRouteParams = {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
};

function listTitleGroups(params: TitlesRouteParams): Promise<IxAuthPrefixedGroupListing> {
  return listIxAuthPrefixedGroups({
    admin: params.admin,
    prefix: params.deps.settings.titleGroupPrefix,
  });
}

/**
 * Merge the identity server's groups with the fork's own projection.
 *
 * The identity server decides which titles exist and the projection only decorates them.
 * A title the fork knows about but the identity server no longer lists is reported
 * separately, because the screens that choose from this list would otherwise offer a code
 * no group answers to.
 */
function projectTitles(params: {
  groups: readonly IxAuthPrefixedGroup[];
  prefix: string;
  /** Members per group code as the identity server lists them, or undefined when it would not say. */
  identityCounts: ReadonlyMap<string, number> | undefined;
}): { titles: Record<string, unknown>[]; orphans: Record<string, unknown>[] } {
  const local = new Map(listTitles().map((row) => [row.slug, row]));
  const seen = new Set<string>();
  const titles: Record<string, unknown>[] = [];
  for (const group of params.groups) {
    const slug = slugForPrefixedGroupCode(group.code, params.prefix);
    if (!slug) {
      continue;
    }
    seen.add(slug);
    const row = local.get(slug);
    // The operator-authored name wins when there is one. `upsertTitle` stores the bare
    // slug for a title nobody has named, and that is not a display name.
    const chosen = row && row.display_name !== slug ? row.display_name : group.name;
    // The identity server's count includes people who have never signed in here; the
    // projection only knows who has. The response says which one it is giving.
    const memberCount = params.identityCounts
      ? (params.identityCounts.get(group.code) ?? 0)
      : row
        ? listTitleMembers(slug).length
        : 0;
    titles.push({
      code: group.code,
      slug,
      name: chosen,
      identityName: group.name,
      memberCount,
    });
  }
  const orphans: Record<string, unknown>[] = [];
  for (const [slug, row] of local) {
    if (seen.has(slug)) {
      continue;
    }
    orphans.push({ slug, name: row.display_name, memberCount: listTitleMembers(slug).length });
  }
  return { titles, orphans };
}

async function handleList(params: TitlesRouteParams): Promise<void> {
  const listing = await listTitleGroups(params);
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const prefix = params.deps.settings.titleGroupPrefix;
  const counted = await countIxAuthIdentityMembersByCode({ admin: params.admin, prefix });
  sendJson(params.res, 200, {
    prefix,
    memberCountSource: counted ? "identity" : "projection",
    ...projectTitles({ groups: listing.groups, prefix, identityCounts: counted }),
  });
}

async function handleCreate(params: TitlesRouteParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const read = readIxAuthGroupBody(body);
  if (!read.ok) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const prefix = params.deps.settings.titleGroupPrefix;
  if (prefix.length === 0) {
    // With no prefix every group would be a title, so there is no code this route could
    // mint that would not also claim an unrelated group.
    sendJson(params.res, 400, { error: "title_prefix_unset" });
    return;
  }
  const listing = await listTitleGroups(params);
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const code = `${prefix}${read.slug}`;
  if (listing.groups.some((group) => group.code === code)) {
    sendJson(params.res, 409, { error: "conflict", message: code });
    return;
  }
  const created = await createIxAuthGroup({ ...params.admin.call, code, name: read.name });
  if (!created.ok) {
    sendRelayFailure(params.res, created);
    return;
  }
  // Recorded locally as well, so the title is listable and can be named in a folder rule
  // before anybody holding it has signed in.
  upsertTitle({ slug: read.slug, displayName: read.name, nowMs: Date.now() });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "title-create",
    detail: { code, slug: read.slug, name: read.name },
  });
  sendJson(params.res, 200, { code, slug: read.slug, name: read.name });
}

async function handleRename(params: TitlesRouteParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const read = readIxAuthGroupBody(body);
  if (!read.ok) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const listing = await listTitleGroups(params);
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const prefix = params.deps.settings.titleGroupPrefix;
  const known = listing.groups.some(
    (group) => slugForPrefixedGroupCode(group.code, prefix) === read.slug,
  );
  if (!known) {
    sendJson(params.res, 404, { error: "not_found" });
    return;
  }
  upsertTitle({ slug: read.slug, displayName: read.name, nowMs: Date.now() });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "title-rename",
    detail: { slug: read.slug, name: read.name },
  });
  sendJson(params.res, 200, { slug: read.slug, name: read.name });
}

/**
 * Delete one title.
 *
 * Identity group first, projection second, so a failure between the two leaves a title
 * the fork still lists and nobody can be granted, which the screen already shows as an
 * orphan. The reverse order would leave a live group the fork has forgotten, and people
 * would keep being placed into a title no operator can see.
 */
async function handleDelete(params: TitlesRouteParams): Promise<void> {
  const body = await readIxAuthJsonBody(params.req, params.res);
  if (!body) {
    return;
  }
  const slug = normalizeTitleSlug(normalizeOptionalString(body.slug) ?? "");
  if (!IX_AUTH_GROUP_SLUG_PATTERN.test(slug)) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const listing = await listTitleGroups(params);
  if (!listing.ok) {
    sendRelayFailure(params.res, listing.failure);
    return;
  }
  const prefix = params.deps.settings.titleGroupPrefix;
  const group = listing.groups.find(
    (entry) => slugForPrefixedGroupCode(entry.code, prefix) === slug,
  );
  // A title the identity server no longer lists is an orphan row: there is no group to
  // delete, and clearing the projection is the whole job.
  if (group) {
    const occupied = await countIxAuthGroupMembership({ admin: params.admin, group });
    // A count the identity server would not give is not proof of emptiness. The delete
    // waits for an answer rather than proceeding on the sign-in projection, which cannot
    // see somebody who was given the title and has not signed in yet.
    if (occupied === undefined) {
      sendJson(params.res, 503, { error: "member_count_unavailable" });
      return;
    }
    if (occupied > 0) {
      sendJson(params.res, 409, { error: "title_has_members", memberCount: occupied });
      return;
    }
    const removed = await deleteIxAuthGroup({ ...params.admin.call, groupId: group.groupId });
    if (!removed.ok) {
      sendRelayFailure(params.res, removed);
      return;
    }
  } else {
    const projected = listTitleMembers(slug).length;
    if (projected > 0) {
      sendJson(params.res, 409, { error: "title_has_members", memberCount: projected });
      return;
    }
  }
  deleteTitle(slug);
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "title-delete",
    detail: { slug, code: group?.code ?? null },
  });
  sendJson(params.res, 200, { slug });
}

/** Dispatch one `/auth/admin/titles` request for an already-resolved administrator. */
export async function handleIxAuthAdminTitlesRequest(params: TitlesRouteParams): Promise<void> {
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
