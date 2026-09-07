import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { ensureIxAuthSessionsSchema } from "./ix-auth-sessions-schema.js";
import {
  insertIxAuthLoginSession,
  purgeExpiredIxAuthSessions,
  readIxAuthLoginSessionByDigest,
  revokeIxAuthLoginSession,
  revokeIxAuthSessionsForProfile,
  touchIxAuthLoginSession,
  updateIxAuthSessionTokens,
} from "./ix-auth-sessions-store.js";
import { tableExists } from "./openclaw-state-db-schema-helpers.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "./openclaw-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    vi.restoreAllMocks();
    closeOpenClawStateDatabaseForTest();
    cleanup();
  });
});

function stateOptions() {
  const directory = tempDirs.make("openclaw-ix-auth-sessions-");
  return { path: join(directory, "openclaw.sqlite") };
}

const NOW = 1_800_000_000_000;

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    token_digest: new Uint8Array([1, 2, 3, 4]),
    csrf_digest: new Uint8Array([5, 6, 7, 8]),
    profile_id: "profile-1",
    identity_subject: "1042",
    identity_session_id: "sid-1",
    identity_email: "person@example.com",
    access_token: "access-1",
    access_expires_at: NOW + 900_000,
    refresh_token: "refresh-1",
    user_agent_digest: null,
    created_at: NOW,
    last_seen_at: NOW,
    idle_expires_at: NOW + 1_800_000,
    absolute_expires_at: NOW + 43_200_000,
    ...overrides,
  };
}

describe("ix-auth login session store", () => {
  it("does not create identity tables until the feature is used", () => {
    const options = stateOptions();
    const database = openOpenClawStateDatabase(options);
    expect(tableExists(database.db, "ix_auth_login_sessions")).toBe(false);
    ensureIxAuthSessionsSchema(options, database);
    expect(tableExists(database.db, "ix_auth_login_sessions")).toBe(true);
  });

  it("round-trips a session by its token digest", () => {
    const options = stateOptions();
    const row = buildRow();
    insertIxAuthLoginSession(row, options);
    const found = readIxAuthLoginSessionByDigest(row.token_digest, options);
    expect(found).toMatchObject({
      id: "session-1",
      profile_id: "profile-1",
      identity_subject: "1042",
      revoked_at: null,
    });
  });

  it("returns nothing for a digest that was never stored", () => {
    const options = stateOptions();
    insertIxAuthLoginSession(buildRow(), options);
    expect(readIxAuthLoginSessionByDigest(new Uint8Array([9, 9]), options)).toBeUndefined();
  });

  it("slides the idle window forward on touch", () => {
    const options = stateOptions();
    const row = buildRow();
    insertIxAuthLoginSession(row, options);
    touchIxAuthLoginSession(
      { sessionId: row.id, lastSeenAt: NOW + 60_000, idleExpiresAt: NOW + 1_860_000 },
      options,
    );
    expect(readIxAuthLoginSessionByDigest(row.token_digest, options)).toMatchObject({
      last_seen_at: NOW + 60_000,
      idle_expires_at: NOW + 1_860_000,
    });
  });

  it("persists a rotated token pair", () => {
    const options = stateOptions();
    const row = buildRow();
    insertIxAuthLoginSession(row, options);
    updateIxAuthSessionTokens(
      {
        sessionId: row.id,
        accessToken: "access-2",
        accessExpiresAt: NOW + 1_800_000,
        refreshToken: "refresh-2",
      },
      options,
    );
    // Losing the rotated refresh token would replay a revoked one on the next
    // rotation, which the identity server reads as theft and answers by killing
    // every session for that user.
    expect(readIxAuthLoginSessionByDigest(row.token_digest, options)).toMatchObject({
      access_token: "access-2",
      refresh_token: "refresh-2",
    });
  });

  it("revokes one session and keeps the first reason on a repeat", () => {
    const options = stateOptions();
    const row = buildRow();
    insertIxAuthLoginSession(row, options);
    revokeIxAuthLoginSession(
      { sessionId: row.id, revokedAt: NOW + 1, reason: "user-logout" },
      options,
    );
    revokeIxAuthLoginSession(
      { sessionId: row.id, revokedAt: NOW + 2, reason: "idle-expired" },
      options,
    );
    expect(readIxAuthLoginSessionByDigest(row.token_digest, options)).toMatchObject({
      revoked_at: NOW + 1,
      revoke_reason: "user-logout",
    });
  });

  it("revokes every live session for one profile without touching another profile", () => {
    const options = stateOptions();
    const mine = buildRow();
    const alsoMine = buildRow({
      id: "session-2",
      token_digest: new Uint8Array([2, 2, 2, 2]),
    });
    const other = buildRow({
      id: "session-3",
      token_digest: new Uint8Array([3, 3, 3, 3]),
      profile_id: "profile-2",
    });
    insertIxAuthLoginSession(mine, options);
    insertIxAuthLoginSession(alsoMine, options);
    insertIxAuthLoginSession(other, options);

    revokeIxAuthSessionsForProfile(
      { profileId: "profile-1", revokedAt: NOW + 5, reason: "suspended" },
      options,
    );
    expect(readIxAuthLoginSessionByDigest(mine.token_digest, options)?.revoked_at).toBe(NOW + 5);
    expect(readIxAuthLoginSessionByDigest(alsoMine.token_digest, options)?.revoked_at).toBe(
      NOW + 5,
    );
    expect(readIxAuthLoginSessionByDigest(other.token_digest, options)?.revoked_at).toBeNull();
  });

  it("purges rows whose absolute lifetime already ended", () => {
    const options = stateOptions();
    const expired = buildRow({ absolute_expires_at: NOW - 1 });
    const live = buildRow({ id: "session-live", token_digest: new Uint8Array([7, 7]) });
    insertIxAuthLoginSession(expired, options);
    insertIxAuthLoginSession(live, options);
    purgeExpiredIxAuthSessions({ expiredBefore: NOW }, options);
    expect(readIxAuthLoginSessionByDigest(expired.token_digest, options)).toBeUndefined();
    expect(readIxAuthLoginSessionByDigest(live.token_digest, options)).toBeDefined();
  });

  it("refuses two sessions sharing one token digest", () => {
    const options = stateOptions();
    insertIxAuthLoginSession(buildRow(), options);
    expect(() => insertIxAuthLoginSession(buildRow({ id: "session-clash" }), options)).toThrow();
  });
});
