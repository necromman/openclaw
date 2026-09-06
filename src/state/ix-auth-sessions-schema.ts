import type { DatabaseSync } from "node:sqlite";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

// Canonical additive schema for IX-Auth browser login sessions. Kept feature-local so
// deployments that never enable ix-auth mode do not carry identity tables at all, the
// same posture user_profiles takes.
//
// Only digests are stored. The session token that the browser holds and the CSRF token
// it echoes are never written in the clear, so a stolen database file cannot be replayed
// as a live session. The IX-Auth refresh token is stored because the Gateway, not the
// browser, performs rotation; it is the one secret this table holds.
const IX_AUTH_SESSIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ix_auth_login_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  token_digest BLOB NOT NULL UNIQUE,
  csrf_digest BLOB NOT NULL,
  profile_id TEXT NOT NULL,
  identity_subject TEXT NOT NULL,
  identity_session_id TEXT NOT NULL,
  identity_email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_token TEXT NOT NULL,
  user_agent_digest BLOB,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ix_auth_sessions_profile
  ON ix_auth_login_sessions(profile_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_ix_auth_sessions_subject
  ON ix_auth_login_sessions(identity_subject, revoked_at);

CREATE INDEX IF NOT EXISTS idx_ix_auth_sessions_expiry
  ON ix_auth_login_sessions(absolute_expires_at);
`;

export type IxAuthSessionsDatabase = {
  ix_auth_login_sessions: {
    id: string;
    token_digest: Uint8Array;
    csrf_digest: Uint8Array;
    profile_id: string;
    identity_subject: string;
    identity_session_id: string;
    identity_email: string;
    access_token: string;
    access_expires_at: number;
    refresh_token: string;
    user_agent_digest: Uint8Array | null;
    created_at: number;
    last_seen_at: number;
    idle_expires_at: number;
    absolute_expires_at: number;
    revoked_at: number | null;
    revoke_reason: string | null;
  };
};

export type IxAuthLoginSessionRow = IxAuthSessionsDatabase["ix_auth_login_sessions"];

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** Install the login-session table on first use. Idempotent and cached per handle. */
export function ensureIxAuthSessionsSchema(
  options: OpenClawStateDatabaseOptions,
  database = openOpenClawStateDatabase(options),
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      db.exec(IX_AUTH_SESSIONS_SCHEMA_SQL); // sqlite-allow-raw -- Canonical feature-local additive DDL.
    },
    options,
    { operationLabel: "ix-auth.sessions.schema.ensure" },
  );
  // Cache only a committed ensure so a rolled-back transaction stays retryable.
  ensuredDatabases.add(database.db);
}
