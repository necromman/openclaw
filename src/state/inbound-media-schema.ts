import type { DatabaseSync } from "node:sqlite";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

// Canonical additive schema for chat attachment ownership.
//
// The media store keeps inbound attachments under an opaque id and nothing else: the
// transcript carries `media://inbound/<id>` and the file carries its sanitized original
// name, but no record says who uploaded it, from which session, or on which agent. That
// gap is what let any signed-in person fetch any attachment id, and it is also what made
// an attachment unreachable once its chat turn scrolled out of the model's window.
//
// One row per stored inbound file closes both. Reads consult it before serving bytes, and
// the two reference tools list and open only the rows the caller owns.
//
// Kept feature-local for the same reason ix_auth_login_sessions, user_profiles and
// departments are: a deployment that never delegates identity never carries these rows.
//
// No department column. A session's department is derived from the agent that owns it
// (AUTH-DEPARTMENTS 6.3), so storing a second copy here would create a second owner that
// can disagree with the agent binding and would need a backfill whenever an agent moves.
// `agent_id` is the department key, resolved through `department_agents` at read time.
//
// `deleted_at` is a tombstone, not an erase. Deleting a session hides its attachments
// from the reference tools while the audit ledger's retention window still needs to
// explain what a person read, and the bytes stay under the media store's own lifecycle.
const INBOUND_MEDIA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbound_media (
  id TEXT NOT NULL PRIMARY KEY,
  session_key TEXT,
  agent_id TEXT,
  profile_id TEXT,
  original_name TEXT,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_inbound_media_profile
  ON inbound_media(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbound_media_session
  ON inbound_media(session_key, created_at DESC);
`;

export type InboundMediaDatabase = {
  inbound_media: {
    id: string;
    session_key: string | null;
    agent_id: string | null;
    profile_id: string | null;
    original_name: string | null;
    mime: string;
    size_bytes: number;
    created_at: number;
    deleted_at: number | null;
  };
};

export type InboundMediaRow = InboundMediaDatabase["inbound_media"];

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** Install the attachment ownership table on first use. Idempotent and cached per handle. */
export function ensureInboundMediaSchema(
  options: OpenClawStateDatabaseOptions,
  database = openOpenClawStateDatabase(options),
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      db.exec(INBOUND_MEDIA_SCHEMA_SQL); // sqlite-allow-raw -- Canonical feature-local additive DDL.
    },
    options,
    { operationLabel: "inboundMedia.schema.ensure" },
  );
  // Cache only a committed ensure so a rolled-back transaction stays retryable.
  ensuredDatabases.add(database.db);
}
