// Remembers which person a session is currently answering.
//
// A tool call happens inside an agent run, long after the WebSocket frame that started
// it, so the connection that proved the identity is no longer in scope. Rather than
// re-derive a person from a session key - which the audit subsystem forbids, because a
// session key is routing metadata and not an identity - the last person whose question
// entered the session is remembered here at the moment it is proven, and read back when
// that same turn's tool calls report in.
//
// Bounded and in-memory on purpose: an entry that survives a restart would attribute a
// new turn to whoever asked before the restart.
import type { UserActivityAuditActor } from "../state/user-activity-audit-store.js";

/** Enough for a busy deployment's live sessions; oldest entries fall out first. */
const MAX_TRACKED_SESSIONS = 512;

const sessionActors = new Map<string, UserActivityAuditActor>();

/** Bind the person whose question is entering this session. */
export function rememberSessionActivityActor(
  sessionKey: string,
  actor: UserActivityAuditActor,
): void {
  // Re-inserting moves the key to the end so the eviction below stays least-recent-first.
  sessionActors.delete(sessionKey);
  sessionActors.set(sessionKey, actor);
  while (sessionActors.size > MAX_TRACKED_SESSIONS) {
    const oldest = sessionActors.keys().next();
    if (oldest.done) {
      return;
    }
    sessionActors.delete(oldest.value);
  }
}

/** The person this session is currently answering, if one was ever proven. */
export function readSessionActivityActor(
  sessionKey: string | undefined,
): UserActivityAuditActor | undefined {
  return sessionKey ? sessionActors.get(sessionKey) : undefined;
}

/** Drop every binding. Test seam; the map is process-local state. */
export function clearSessionActivityActorsForTest(): void {
  sessionActors.clear();
}
