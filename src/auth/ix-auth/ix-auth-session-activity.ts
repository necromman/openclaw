// Slide the idle window of an IX-Auth login session on real browser activity.
//
// The session resolver only extends the window when a caller asks it to (`touch`), and
// every caller asks it not to: the WebSocket handshake, the HTTP authorizer, the admin
// console proxy and `/auth/me` all pass `touch: false` so that a reconnect storm or a
// second document cannot keep an abandoned browser signed in. The one route that does
// touch, `POST /auth/refresh`, is not called by the Control UI at all.
//
// The result in production was that `last_seen_at` never moved: every session died
// exactly `idleTimeoutMs` after sign-in no matter how hard the person was working, and
// the death only became visible on the next probe - typically the one that followed a
// redeploy, which is why it read as "the deploy signed me out".
//
// Activity is therefore recorded here instead, from the two places that mean a person
// did something: an authenticated HTTP request, and a request frame on an admitted
// WebSocket. A handshake by itself still does not count, so the documented rule that a
// reconnect loop cannot keep a dead tab alive is preserved.
import {
  readIxAuthLoginSessionById,
  touchIxAuthLoginSession,
} from "../../state/ix-auth-sessions-store.js";

/**
 * Smallest gap between two idle-window writes for one session.
 *
 * A busy Control UI issues many requests per second and each write is a SQLite
 * transaction, so the window is nudged at most once a minute. That is three orders of
 * magnitude finer than the shortest idle timeout worth configuring.
 */
export const IX_AUTH_ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

/** Bound on the throttle map, which only ever holds one entry per live session. */
const ACTIVITY_TRACKER_MAX_ENTRIES = 1_024;

const lastNotedAtBySession = new Map<string, number>();

function pruneActivityTracker(nowMs: number): void {
  if (lastNotedAtBySession.size <= ACTIVITY_TRACKER_MAX_ENTRIES) {
    return;
  }
  for (const [sessionId, notedAt] of lastNotedAtBySession) {
    if (nowMs - notedAt >= IX_AUTH_ACTIVITY_TOUCH_INTERVAL_MS) {
      lastNotedAtBySession.delete(sessionId);
    }
  }
}

/** Forget the in-memory throttle. Tests only; sessions themselves live in SQLite. */
export function resetIxAuthSessionActivityTrackerForTest(): void {
  lastNotedAtBySession.clear();
}

/**
 * Record that the person behind `loginSessionId` just did something.
 *
 * Returns true when the session is still live, whether or not this call wrote. Never
 * resurrects a row: a revoked or already expired session is left exactly as it is, so
 * the authority to end a session stays with the resolver and with logout.
 */
export function noteIxAuthSessionActivity(loginSessionId: string, nowMs = Date.now()): boolean {
  const notedAt = lastNotedAtBySession.get(loginSessionId);
  if (notedAt !== undefined && nowMs - notedAt < IX_AUTH_ACTIVITY_TOUCH_INTERVAL_MS) {
    return true;
  }
  const row = readIxAuthLoginSessionById(loginSessionId);
  if (!row || row.revoked_at !== null) {
    lastNotedAtBySession.delete(loginSessionId);
    return false;
  }
  if (row.idle_expires_at <= nowMs || row.absolute_expires_at <= nowMs) {
    lastNotedAtBySession.delete(loginSessionId);
    return false;
  }
  lastNotedAtBySession.set(loginSessionId, nowMs);
  pruneActivityTracker(nowMs);
  if (nowMs - row.last_seen_at < IX_AUTH_ACTIVITY_TOUCH_INTERVAL_MS) {
    return true;
  }
  // The configured idle timeout is whatever the last writer used, carried in the row
  // itself, so this needs no settings load on a hot path. The absolute deadline still
  // caps it: activity extends an idle window, never a session's total lifetime.
  const idleWindowMs = row.idle_expires_at - row.last_seen_at;
  if (idleWindowMs <= 0) {
    return true;
  }
  touchIxAuthLoginSession({
    sessionId: loginSessionId,
    lastSeenAt: nowMs,
    idleExpiresAt: Math.min(nowMs + idleWindowMs, row.absolute_expires_at),
  });
  return true;
}

/** Same, but never throws: activity bookkeeping must not fail a request. */
export function noteIxAuthSessionActivitySafely(loginSessionId: string, nowMs?: number): void {
  try {
    noteIxAuthSessionActivity(loginSessionId, nowMs);
  } catch {
    // A state-database hiccup is not a reason to refuse work the caller already
    // authorized. The session simply keeps its current idle deadline.
  }
}
