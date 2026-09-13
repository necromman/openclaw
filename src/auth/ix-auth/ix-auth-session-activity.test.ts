import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  insertIxAuthLoginSession,
  readIxAuthLoginSessionById,
  revokeIxAuthLoginSession,
} from "../../state/ix-auth-sessions-store.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import {
  IX_AUTH_ACTIVITY_TOUCH_INTERVAL_MS,
  noteIxAuthSessionActivity,
  noteIxAuthSessionActivitySafely,
  resetIxAuthSessionActivityTrackerForTest,
} from "./ix-auth-session-activity.js";

const IDLE_WINDOW_MS = 1_800_000;
const ABSOLUTE_WINDOW_MS = 43_200_000;
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

let sessionCounter = 0;

function seedSession(params: {
  nowMs: number;
  idleWindowMs?: number;
  absoluteWindowMs?: number;
}): string {
  sessionCounter += 1;
  const id = `session-${sessionCounter}`;
  const idleWindowMs = params.idleWindowMs ?? IDLE_WINDOW_MS;
  insertIxAuthLoginSession({
    id,
    token_digest: Buffer.from(`token-${id}`.padEnd(32, "0")),
    csrf_digest: Buffer.from(`csrf-${id}`.padEnd(32, "0")),
    profile_id: `profile-${id}`,
    identity_subject: "42",
    identity_session_id: `identity-${id}`,
    identity_email: "worker@example.test",
    access_token: "header.payload.signature",
    access_expires_at: params.nowMs + 900_000,
    refresh_token: `refresh-${id}`,
    user_agent_digest: null,
    created_at: params.nowMs,
    last_seen_at: params.nowMs,
    idle_expires_at: params.nowMs + idleWindowMs,
    absolute_expires_at: params.nowMs + (params.absoluteWindowMs ?? ABSOLUTE_WINDOW_MS),
  });
  return id;
}

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", tempDirs.make("ix-auth-session-activity-"));
  resetIxAuthSessionActivityTrackerForTest();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetIxAuthSessionActivityTrackerForTest();
  closeOpenClawStateDatabaseForTest();
});

describe("IX-Auth session activity", () => {
  it("slides the idle window forward by the session's own idle timeout", () => {
    const now = Date.now();
    const id = seedSession({ nowMs: now });
    const later = now + IDLE_WINDOW_MS - 60_000;

    expect(noteIxAuthSessionActivity(id, later)).toBe(true);

    const row = readIxAuthLoginSessionById(id);
    expect(row?.last_seen_at).toBe(later);
    expect(row?.idle_expires_at).toBe(later + IDLE_WINDOW_MS);
  });

  it("keeps a continuously used session alive past the original deadline", () => {
    const now = Date.now();
    const id = seedSession({ nowMs: now });
    let at = now;
    // An hour of steady work, which spans the moment an untouched session used to die.
    for (let step = 0; step < 40; step += 1) {
      at += IDLE_WINDOW_MS / 20;
      expect(noteIxAuthSessionActivity(id, at)).toBe(true);
    }
    const row = readIxAuthLoginSessionById(id);
    expect(at).toBeGreaterThan(now + IDLE_WINDOW_MS);
    expect(row?.revoked_at).toBeNull();
    expect(row?.idle_expires_at).toBeGreaterThan(at);
  });

  it("records the first activity of a freshly signed-in session", () => {
    const now = Date.now();
    const id = seedSession({ nowMs: now });
    // A browser probes `/auth/me` seconds after signing in. This used to write nothing,
    // because `last_seen_at` was still the sign-in instant, and a burst of page loads
    // inside the first minute left the row reading `last_seen_at == created_at`.
    const soon = now + 5_000;

    expect(noteIxAuthSessionActivity(id, soon)).toBe(true);

    const row = readIxAuthLoginSessionById(id);
    expect(row?.last_seen_at).toBe(soon);
    expect(row?.idle_expires_at).toBe(soon + IDLE_WINDOW_MS);
  });

  it("writes at most once per throttle interval", () => {
    const now = Date.now();
    const id = seedSession({ nowMs: now });
    const first = now + IX_AUTH_ACTIVITY_TOUCH_INTERVAL_MS;
    noteIxAuthSessionActivity(id, first);
    noteIxAuthSessionActivity(id, first + 1_000);
    noteIxAuthSessionActivity(id, first + 2_000);

    expect(readIxAuthLoginSessionById(id)?.last_seen_at).toBe(first);
  });

  it("never extends past the absolute deadline", () => {
    const now = Date.now();
    const id = seedSession({ nowMs: now, absoluteWindowMs: IDLE_WINDOW_MS + 60_000 });
    const later = now + IDLE_WINDOW_MS - 1_000;

    noteIxAuthSessionActivity(id, later);

    const row = readIxAuthLoginSessionById(id);
    expect(row?.idle_expires_at).toBe(now + IDLE_WINDOW_MS + 60_000);
  });

  it("does not resurrect a session that already expired or was revoked", () => {
    const now = Date.now();
    const expired = seedSession({ nowMs: now });
    const revoked = seedSession({ nowMs: now });
    revokeIxAuthLoginSession({ sessionId: revoked, revokedAt: now, reason: "user-logout" });

    expect(noteIxAuthSessionActivity(expired, now + IDLE_WINDOW_MS + 1)).toBe(false);
    expect(noteIxAuthSessionActivity(revoked, now + 1_000)).toBe(false);
    expect(readIxAuthLoginSessionById(expired)?.idle_expires_at).toBe(now + IDLE_WINDOW_MS);
    expect(readIxAuthLoginSessionById(revoked)?.revoked_at).toBe(now);
  });

  it("reports an unknown session instead of creating one", () => {
    expect(noteIxAuthSessionActivity("no-such-session", Date.now())).toBe(false);
    expect(() => noteIxAuthSessionActivitySafely("no-such-session")).not.toThrow();
  });
});
