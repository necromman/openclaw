// Shared resolution for the two attachment reference tools.
//
// `media_list` and `media_read` answer one question between them: which files did the
// person in this conversation upload, and what is inside one of them. Both need the same
// three facts - who this session belongs to, which agent it runs on, and which department
// that agent sits in - so they resolve them here rather than twice.
//
// Everything heavy is imported lazily inside the resolvers. These modules reach the state
// database, the department bindings and the document converters; importing them from a
// tool module would drag the Gateway and knowledge graphs into the agent startup bundle,
// which this fork already budgets tightly.
import { getRuntimeConfig } from "../../config/config.js";
import { createLazyRuntimeModule } from "../../shared/lazy-runtime.js";
import type { InboundMediaOwnership } from "../../state/inbound-media-store.js";

const getSessionStoreModule = createLazyRuntimeModule(
  () => import("../../gateway/session-utils-store.js"),
);
const getSessionProvenanceModule = createLazyRuntimeModule(
  () => import("../../config/sessions/session-entry-provenance.js"),
);
const getDepartmentsStoreModule = createLazyRuntimeModule(
  () => import("../../state/departments-store.js"),
);
const getInboundMediaStoreModule = createLazyRuntimeModule(
  () => import("../../state/inbound-media-store.js"),
);

/** Who and where a reference tool call is running for. */
export type MediaReferenceContext = {
  sessionKey?: string;
  agentId?: string;
  /** The account that created this session, absent when identity is not delegated. */
  profileId?: string;
  /** The department this agent is bound to, or undefined for an unbound agent. */
  departmentSlug?: string;
  /** True when the deployment attributes attachments to accounts at all. */
  ownershipEnforced: boolean;
};

/**
 * Resolve the caller's identity from the session it is running in.
 *
 * The session's creator is the person whose files these tools may reach. Deriving it from
 * the stored session rather than from a tool argument keeps the decision server-side: a
 * model cannot ask for somebody else by naming them.
 */
export async function resolveMediaReferenceContext(params: {
  sessionKey?: string;
  agentId?: string;
}): Promise<MediaReferenceContext> {
  const cfg = getRuntimeConfig();
  const ownershipEnforced = cfg.gateway?.auth?.mode === "ix-auth";
  const base = {
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ownershipEnforced,
  };
  const departmentSlug = params.agentId
    ? (await getDepartmentsStoreModule()).readDepartmentAgentBindings().get(params.agentId)
    : undefined;
  if (!params.sessionKey) {
    return { ...base, ...(departmentSlug ? { departmentSlug } : {}) };
  }
  const loaded = (await getSessionStoreModule()).loadGatewaySessionEntryReadOnly(params.sessionKey, {
    ...(params.agentId ? { agentId: params.agentId } : {}),
  });
  const profileId = (await getSessionProvenanceModule()).sessionCreatorProfileId(
    loaded.entry?.createdActor,
  );
  return {
    ...base,
    ...(profileId ? { profileId } : {}),
    ...(departmentSlug ? { departmentSlug } : {}),
  };
}

/**
 * True when an attachment recorded on `agentId` is inside this caller's department.
 *
 * Attachments are partitioned exactly the way sessions are: by the agent that owns them
 * (AUTH-DEPARTMENTS 6.3). An unbound agent is shared ground and only reaches shared
 * ground, so both sides must carry the same binding, including "none".
 */
export async function isSameDepartmentAgent(
  context: MediaReferenceContext,
  agentId: string | undefined,
): Promise<boolean> {
  if (!agentId) {
    // A row with no agent predates the binding or came from a surface that has none;
    // it is shared ground and belongs to the unbound pool.
    return context.departmentSlug === undefined;
  }
  if (agentId === context.agentId) {
    return true;
  }
  const bound = (await getDepartmentsStoreModule()).readDepartmentAgentBindings().get(agentId);
  return bound === context.departmentSlug;
}

/** One attachment as the reference tools describe it to the model. */
export type MediaReferenceEntry = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
  sessionKey?: string;
  agentId?: string;
};

/**
 * The attachments this caller may reference, newest first.
 *
 * Without delegated identity there is no account to own an upload, so the listing falls
 * back to the current session alone. That matches the shipped default for session
 * visibility (`self`): a token-mode deployment shows a caller its own conversation and
 * nothing wider, and attachments must not be the one thing that is wider.
 */
export async function listReferenceableInboundMedia(params: {
  context: MediaReferenceContext;
  search?: string;
  limit: number;
}): Promise<MediaReferenceEntry[]> {
  const store = await getInboundMediaStoreModule();
  const { context } = params;
  const rows = context.profileId
    ? store.listInboundMediaForProfile({
        profileId: context.profileId,
        ...(params.search ? { search: params.search } : {}),
        limit: store.INBOUND_MEDIA_QUERY_MAX,
      })
    : context.sessionKey
      ? store.listInboundMediaForSession({
          sessionKey: context.sessionKey,
          ...(params.search ? { search: params.search } : {}),
          limit: store.INBOUND_MEDIA_QUERY_MAX,
        })
      : [];
  const visible: MediaReferenceEntry[] = [];
  for (const row of rows) {
    if (visible.length >= params.limit) {
      break;
    }
    if (!(await isSameDepartmentAgent(context, row.agentId))) {
      continue;
    }
    visible.push(toReferenceEntry(row));
  }
  return visible;
}

function toReferenceEntry(row: InboundMediaOwnership): MediaReferenceEntry {
  return {
    id: row.id,
    name: row.originalName ?? row.id,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    uploadedAt: new Date(row.createdAt).toISOString(),
    ...(row.sessionKey ? { sessionKey: row.sessionKey } : {}),
    ...(row.agentId ? { agentId: row.agentId } : {}),
  };
}

/** Why one attachment cannot be opened by this caller. */
export type MediaReferenceDenial = "not-found" | "other-owner" | "other-department" | "deleted";

/** Resolve one attachment id for this caller, or say why it is out of reach. */
export async function resolveReferenceableInboundMedia(params: {
  context: MediaReferenceContext;
  id: string;
}): Promise<
  { ok: true; entry: MediaReferenceEntry } | { ok: false; denial: MediaReferenceDenial }
> {
  const store = await getInboundMediaStoreModule();
  const row = store.getInboundMediaOwnership(params.id);
  if (!row) {
    return { ok: false, denial: "not-found" };
  }
  if (row.deletedAt !== undefined) {
    return { ok: false, denial: "deleted" };
  }
  const { context } = params;
  const owned = context.profileId
    ? row.profileId === context.profileId
    : Boolean(context.sessionKey) && row.sessionKey === context.sessionKey;
  if (!owned) {
    return { ok: false, denial: "other-owner" };
  }
  if (!(await isSameDepartmentAgent(context, row.agentId))) {
    return { ok: false, denial: "other-department" };
  }
  return { ok: true, entry: toReferenceEntry(row) };
}
