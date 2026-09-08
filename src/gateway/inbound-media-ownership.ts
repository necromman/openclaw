// Records who uploaded each chat attachment, at the one place attachments become durable.
//
// `persistInboundImagesForTranscript` is where an attachment stops being request bytes and
// becomes a file the transcript points at. Everything the ownership row needs is known
// there and nowhere later: the session, its agent, and the signed-in person behind the
// connection. Writing it anywhere else would mean re-deriving an uploader from a media id,
// which is exactly the fact that was missing.
//
// Failures never propagate. An attachment that reached disk must still reach the model; a
// missing ownership row costs the uploader the two reference tools and denies non-owners
// the file, which is the safe direction to fail in.
import { logVerbose } from "../globals.js";
import { recordInboundMediaOwnership } from "../state/inbound-media-store.js";
import type { persistInboundImagesForTranscript } from "./chat-attachments.js";
import { readClientAuditActor } from "./ix-auth-audit-actor.js";
import type { GatewayClient } from "./server-methods/client-types.js";

type PersistedEntries = Awaited<ReturnType<typeof persistInboundImagesForTranscript>>["entries"];

/** Write one ownership row per attachment this turn persisted. */
export function recordChatSendInboundMediaOwnership(params: {
  entries: PersistedEntries;
  client: Pick<GatewayClient, "internal" | "authenticatedUserProfile"> | null | undefined;
  sessionKey?: string;
  agentId?: string;
  nowMs?: number;
}): void {
  if (params.entries.length === 0) {
    return;
  }
  // The verified IX-Auth account first, the durable profile second: a shared-secret
  // operator has a profile but no delegated identity, and both are worth attributing.
  const profileId =
    readClientAuditActor(params.client)?.profileId ??
    params.client?.authenticatedUserProfile?.profileId;
  const createdAt = params.nowMs ?? Date.now();
  for (const entry of params.entries) {
    try {
      recordInboundMediaOwnership({
        id: entry.id,
        ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
        ...(params.agentId ? { agentId: params.agentId } : {}),
        ...(profileId ? { profileId } : {}),
        ...(entry.originalName ? { originalName: entry.originalName } : {}),
        mime: entry.fact.contentType ?? "application/octet-stream",
        sizeBytes: entry.fact.sizeBytes ?? 0,
        createdAt,
      });
    } catch (error) {
      logVerbose(`[inbound-media] ownership write failed id=${entry.id}: ${String(error)}`);
    }
  }
}
