// Writes the person-attributed activity ledger.
//
// Every recording point in the Gateway calls one of the helpers here rather than the
// store, so the policy questions - is collection on, may the question text be stored,
// how much of a value is worth keeping - are answered in one place.
//
// Failures never propagate. A ledger that can break a login is worse than a ledger with
// a hole in it, so a write error becomes a diagnostic line and nothing else.
import { getRuntimeConfig } from "../config/io.js";
import { logVerbose } from "../globals.js";
import type { UserActivityAuditKind } from "../state/user-activity-audit-schema.js";
import {
  appendUserActivityAuditEvent,
  type UserActivityAuditActor,
} from "../state/user-activity-audit-store.js";
import { resolveUserActivityAuditPolicy } from "./audit-config.js";

export type { UserActivityAuditActor };

export type UserActivityRecordParams = {
  kind: UserActivityAuditKind;
  actor: UserActivityAuditActor;
  sessionKey?: string;
  agentId?: string;
  detail?: Record<string, unknown>;
  remoteIp?: string;
  userAgent?: string;
  requestId?: string;
  at?: number;
};

/** Record one activity row. Returns whether a row was written. */
export function recordUserActivity(params: UserActivityRecordParams): boolean {
  const policy = resolveUserActivityAuditPolicy(getRuntimeConfig());
  if (!policy.enabled) {
    return false;
  }
  try {
    appendUserActivityAuditEvent({
      at: params.at ?? Date.now(),
      kind: params.kind,
      actor: params.actor,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.detail ? { detail: params.detail } : {}),
      ...(params.remoteIp ? { remoteIp: params.remoteIp } : {}),
      ...(params.userAgent ? { userAgent: params.userAgent } : {}),
      ...(params.requestId ? { requestId: params.requestId } : {}),
    });
    return true;
  } catch (error) {
    logVerbose(`[audit] user activity write failed kind=${params.kind}: ${String(error)}`);
    return false;
  }
}

/** Whether this deployment stores question text. Read once per recording point. */
export function isPromptTextRecorded(): boolean {
  return resolveUserActivityAuditPolicy(getRuntimeConfig()).promptText;
}
