// Ownership boundary for chat attachments.
//
// An inbound attachment is served by media id alone: whoever holds the id holds the file.
// That is fine when the Gateway secret is the only credential, and wrong the moment
// identity is delegated, because every signed-in person shares one media store. The
// department fence stops at sessions and transcripts, so an attachment id was the one
// reference that crossed it.
//
// This module is the single verdict for "may this person read this attachment", used by
// the Control UI media route and by the two reference tools. It answers the same way the
// session boundary does: a super administrator sees everything, the uploader sees their
// own file, and everyone else sees it only when the session it belongs to is visible to
// them under the department fence and their role's ceiling on other people's sessions.
//
// A file with no ownership row is legacy - uploaded before this table existed - and has no
// owner to compare against, so only a super administrator reaches it. Refusals are
// not-found, never forbidden, so an id cannot be probed for existence (AUTH-DEPARTMENTS 4).
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveInboundMediaReference } from "../media/media-reference.js";
import {
  getInboundMediaOwnership,
  type InboundMediaOwnership,
} from "../state/inbound-media-store.js";
import { prepareDepartmentGate, type DepartmentIdentity } from "./department-access.js";
import { resolveOperatorRolePolicyForProfile } from "./operator-role-policy.js";
import { createProfileSessionEntryFilter } from "./session-sharing.js";
import { loadGatewaySessionEntryReadOnly } from "./session-utils.js";

/** The person asking for one attachment, as far as this decision needs to know them. */
export type InboundMediaReader = {
  /** The signed-in account, absent for shared-secret and internal callers. */
  profileId?: string;
  /** Verified department facts from the same login; absent outside ix-auth mode. */
  departments?: DepartmentIdentity;
  /** True when the caller holds `operator.admin` on this request. */
  isGatewayAdmin?: boolean;
};

/** Why one attachment read was refused. Diagnostic and ledger text, never sent to the caller. */
type InboundMediaDenialReason =
  | "no-ownership-record"
  | "no-reader-profile"
  | "department-boundary"
  | "session-visibility";

export type InboundMediaDecision =
  | { allowed: true; ownership?: InboundMediaOwnership }
  | { allowed: false; reason: InboundMediaDenialReason; ownership?: InboundMediaOwnership };

/**
 * True when this deployment owns attachments per person.
 *
 * The switch is the auth mode alone, not the session-visibility key: a shared-secret
 * deployment has one operator and no account to attribute an upload to, so a boundary
 * there would only break existing installs. Where identity is delegated the boundary
 * always applies, including with visibility `self`, because `self` is the strictest
 * setting and must not be looser than `department` for attachments.
 */
export function isInboundMediaOwnershipEnforced(cfg: OpenClawConfig | undefined): boolean {
  return cfg?.gateway?.auth?.mode === "ix-auth";
}

/**
 * The inbound media id a source names, or undefined when it names something else.
 *
 * Resolved through the media resolver rather than the URI parser alone: the same file is
 * reachable as `media://inbound/<id>` and as its absolute path inside the store, and a
 * gate that only understood the URI form would be bypassed by the other one.
 */
export async function readInboundMediaIdFromSource(source: string): Promise<string | undefined> {
  try {
    return (await resolveInboundMediaReference(source))?.id;
  } catch {
    // A reference the resolver rejects is not a readable attachment either; the media
    // open path fails it on its own.
    return undefined;
  }
}

/** Decide one attachment read from the reference string a request carried. */
export async function authorizeInboundMediaSource(params: {
  cfg: OpenClawConfig | undefined;
  source: string;
  reader: InboundMediaReader;
}): Promise<InboundMediaDecision & { mediaId?: string }> {
  if (!isInboundMediaOwnershipEnforced(params.cfg)) {
    return { allowed: true };
  }
  const mediaId = await readInboundMediaIdFromSource(params.source);
  if (!mediaId) {
    // Not an attachment: workspace and outbound files keep the folder allowlist as their
    // only boundary, which is the boundary they already had.
    return { allowed: true };
  }
  const decision = authorizeInboundMediaRead({ cfg: params.cfg, mediaId, reader: params.reader });
  return { ...decision, mediaId };
}

function isSessionVisibleToReader(params: {
  cfg: OpenClawConfig;
  profileId: string;
  sessionKey: string;
  agentId?: string;
}): boolean {
  const loaded = loadGatewaySessionEntryReadOnly(
    params.sessionKey,
    params.agentId ? { agentId: params.agentId } : undefined,
  );
  const entry = loaded.entry;
  if (!entry) {
    // The session is gone. Its attachment keeps its uploader, and the uploader path
    // already returned above, so nobody else inherits a reason to read it.
    return false;
  }
  const rolePolicy = resolveOperatorRolePolicyForProfile(params.profileId, params.cfg);
  return createProfileSessionEntryFilter({
    profileId: params.profileId,
    ...(rolePolicy ? { sessionCap: rolePolicy.sessions.others } : {}),
  })(loaded.canonicalKey, entry);
}

/**
 * Decide whether one person may read one inbound attachment.
 *
 * Synchronous by design: every input is either already in memory or a single indexed
 * SQLite read, and the callers that need this verdict are inside request paths that
 * must not gain an extra await boundary where the policy could change underneath them.
 */
export function authorizeInboundMediaRead(params: {
  cfg: OpenClawConfig | undefined;
  mediaId: string;
  reader: InboundMediaReader;
}): InboundMediaDecision {
  const cfg = params.cfg;
  if (!isInboundMediaOwnershipEnforced(cfg) || !cfg) {
    return { allowed: true };
  }
  if (params.reader.departments?.isSuperAdmin === true) {
    return { allowed: true, ...ownershipOf(params.mediaId) };
  }
  const ownership = getInboundMediaOwnership(params.mediaId);
  if (!ownership) {
    return { allowed: false, reason: "no-ownership-record" };
  }
  const profileId = params.reader.profileId;
  if (!profileId) {
    return { allowed: false, reason: "no-reader-profile", ownership };
  }
  if (ownership.profileId === profileId) {
    return { allowed: true, ownership };
  }
  const gate = prepareDepartmentGate({ cfg, identity: params.reader.departments });
  if (gate && ownership.agentId && gate.agentAccess(ownership.agentId) !== "open") {
    return { allowed: false, reason: "department-boundary", ownership };
  }
  // Administrator authority is checked after the fence, never before it: the same order
  // session sharing uses, so an administrator of one department cannot read another's.
  if (params.reader.isGatewayAdmin === true) {
    return { allowed: true, ownership };
  }
  if (!ownership.sessionKey) {
    return { allowed: false, reason: "session-visibility", ownership };
  }
  const visible = isSessionVisibleToReader({
    cfg,
    profileId,
    sessionKey: ownership.sessionKey,
    ...(ownership.agentId ? { agentId: ownership.agentId } : {}),
  });
  return visible
    ? { allowed: true, ownership }
    : { allowed: false, reason: "session-visibility", ownership };
}

function ownershipOf(mediaId: string): { ownership?: InboundMediaOwnership } {
  const ownership = getInboundMediaOwnership(mediaId);
  return ownership ? { ownership } : {};
}
