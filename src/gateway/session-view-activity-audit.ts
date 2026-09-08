// Records transcript reads and refused reads against the person who made them.
//
// Reading your own transcript is not an audit event - it is the product working - so
// only a read of someone else's session is recorded. A refusal is always recorded: "who
// tried to open what and was told no" is the half of the department boundary that leaves
// no other trace, because the caller is answered with a plain not-found.
import { recordUserActivity } from "../audit/user-activity-audit-recorder.js";
import { clientActivityActor } from "./ix-auth-audit-actor.js";
import type { GatewayClient } from "./server-methods/client-types.js";

export type SessionViewSurface = "chat.history" | "chat.startup" | "transcript-http";

/** Record one person opening a transcript that is not their own. */
export function recordSessionViewActivity(params: {
  client: GatewayClient | null;
  sessionKey: string;
  agentId?: string;
  ownedByCaller: boolean;
  surface: SessionViewSurface;
}): void {
  if (params.ownedByCaller) {
    return;
  }
  recordUserActivity({
    kind: "session_view",
    actor: clientActivityActor(params.client),
    sessionKey: params.sessionKey,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    detail: { surface: params.surface },
    ...(params.client?.clientIp ? { remoteIp: params.client.clientIp } : {}),
  });
}

/** Record one person opening a file through the session file browser. */
export function recordFileDownloadActivity(params: {
  client: GatewayClient | null;
  sessionKey: string;
  agentId: string;
  path: string;
  preview: boolean;
}): void {
  recordUserActivity({
    kind: "file_download",
    actor: clientActivityActor(params.client),
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    detail: { path: params.path, ...(params.preview ? { preview: true } : {}) },
    ...(params.client?.clientIp ? { remoteIp: params.client.clientIp } : {}),
  });
}

/**
 * Record one refused attachment read.
 *
 * Attachment refusals get their own recording point rather than reusing the client-shaped
 * helper below: the media route answers ticket-authenticated requests that never build a
 * Gateway client, so the account has to be passed in directly. The reason is stored, the
 * verdict is not sent to the caller - they get a plain not-found (AUTH-DEPARTMENTS 4).
 */
export function recordInboundMediaDeniedActivity(params: {
  profileId?: string;
  mediaId?: string;
  reason: string;
  surface: string;
  sessionKey?: string;
  agentId?: string;
  remoteIp?: string;
}): void {
  recordUserActivity({
    kind: "access_denied",
    actor: params.profileId
      ? { source: "profile", profileId: params.profileId }
      : { source: "operator" },
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    detail: {
      reason: params.reason,
      surface: params.surface,
      ...(params.mediaId ? { mediaId: params.mediaId } : {}),
    },
    ...(params.remoteIp ? { remoteIp: params.remoteIp } : {}),
  });
}

/** Record one refused read, with the reason the boundary gave. */
export function recordAccessDeniedActivity(params: {
  client: GatewayClient | null;
  sessionKey?: string;
  agentId?: string;
  reason: string;
  surface: string;
}): void {
  recordUserActivity({
    kind: "access_denied",
    actor: clientActivityActor(params.client),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    detail: { reason: params.reason, surface: params.surface },
    ...(params.client?.clientIp ? { remoteIp: params.client.clientIp } : {}),
  });
}
