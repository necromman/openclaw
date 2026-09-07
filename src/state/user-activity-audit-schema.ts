import type { DatabaseSync } from "node:sqlite";
import type { Generated, Selectable } from "kysely";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

// Canonical additive schema for the person-attributed activity ledger.
//
// The existing `audit_events` ledger answers "which agent ran which tool". It cannot
// answer "which person asked this, and which files did that reveal", because its actor is
// a pseudonymised client or agent id and it stores no request content at all. Rather than
// widen a contract other readers depend on, this fork keeps a second, feature-local table
// whose actor is a real account.
//
// Kept feature-local for the same reason ix_auth_login_sessions and departments are:
// a deployment that never delegates identity never carries these rows at all.
//
// Retention is bounded and configurable (`logging.audit.userActivity.*`). This is a
// query ledger for the retention window, not a tamper-evident compliance archive - there
// is deliberately no hash chain, and an external SIEM stays the long-term record.
//
// `email` holds the actor's addressable identifier: the account address when
// `actor_source` is `profile`, and the channel-scoped sender id when it is `channel`,
// because a chat sender has no directory entry in this fork.
const USER_ACTIVITY_AUDIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_user_activity (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  actor_source TEXT NOT NULL,
  profile_id TEXT,
  email TEXT,
  display_name TEXT,
  gateway_role TEXT,
  departments TEXT NOT NULL,
  session_key TEXT,
  agent_id TEXT,
  detail TEXT NOT NULL,
  remote_ip TEXT,
  user_agent TEXT,
  request_id TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_audit_user_activity_time
  ON audit_user_activity(at DESC, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_activity_profile
  ON audit_user_activity(profile_id, at DESC, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_activity_kind
  ON audit_user_activity(kind, at DESC, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_activity_session
  ON audit_user_activity(session_key, at DESC, sequence DESC);
`;

/**
 * What the ledger can record.
 *
 * A closed list, so a later reader can enumerate the kinds instead of discovering them.
 * Free-text detail belongs in `detail`, never in a new kind invented at one call site.
 */
export const USER_ACTIVITY_AUDIT_KINDS = [
  "login",
  "logout",
  "login_failed",
  "prompt",
  "tool_read",
  "session_view",
  "file_download",
  "admin_action",
  "access_denied",
] as const;

export type UserActivityAuditKind = (typeof USER_ACTIVITY_AUDIT_KINDS)[number];

/** Where the actor identity came from. Channel senders have no account to attribute. */
export const USER_ACTIVITY_AUDIT_ACTOR_SOURCES = ["profile", "channel", "operator"] as const;

export type UserActivityAuditActorSource = (typeof USER_ACTIVITY_AUDIT_ACTOR_SOURCES)[number];

export type UserActivityAuditDatabase = {
  audit_user_activity: {
    // AUTOINCREMENT: the row id is assigned by SQLite, never supplied by an insert.
    sequence: Generated<number>;
    at: number;
    kind: string;
    actor_source: string;
    profile_id: string | null;
    email: string | null;
    display_name: string | null;
    gateway_role: string | null;
    departments: string;
    session_key: string | null;
    agent_id: string | null;
    detail: string;
    remote_ip: string | null;
    user_agent: string | null;
    request_id: string | null;
  };
};

export type UserActivityAuditRow = Selectable<UserActivityAuditDatabase["audit_user_activity"]>;

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** Install the activity ledger table on first use. Idempotent and cached per handle. */
export function ensureUserActivityAuditSchema(
  options: OpenClawStateDatabaseOptions,
  database = openOpenClawStateDatabase(options),
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      db.exec(USER_ACTIVITY_AUDIT_SCHEMA_SQL); // sqlite-allow-raw -- Canonical feature-local additive DDL.
    },
    options,
    { operationLabel: "auditUserActivity.schema.ensure" },
  );
  // Cache only a committed ensure so a rolled-back transaction stays retryable.
  ensuredDatabases.add(database.db);
}
