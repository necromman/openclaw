// Durable store for IX-Auth browser login sessions.
//
// Row access goes through Kysely; only the DDL in ix-auth-sessions-schema.ts is raw SQL.
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  ensureIxAuthSessionsSchema,
  type IxAuthLoginSessionRow,
  type IxAuthSessionsDatabase,
} from "./ix-auth-sessions-schema.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

function ixAuthSessionsDb(db: DatabaseSync) {
  return getNodeSqliteKysely<IxAuthSessionsDatabase>(db);
}

/** Fields an insert supplies; the caller has already hashed every secret it can. */
export type IxAuthSessionInsert = Omit<IxAuthLoginSessionRow, "revoked_at" | "revoke_reason">;

/** Persist a freshly minted login session. */
export function insertIxAuthLoginSession(
  row: IxAuthSessionInsert,
  options: OpenClawStateDatabaseOptions = {},
): void {
  ensureIxAuthSessionsSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        ixAuthSessionsDb(db)
          .insertInto("ix_auth_login_sessions")
          .values({ ...row, revoked_at: null, revoke_reason: null }),
      );
    },
    options,
    { operationLabel: "ix-auth.sessions.insert" },
  );
}

/** Read one session by its token digest. Returns revoked and expired rows too. */
export function readIxAuthLoginSessionByDigest(
  tokenDigest: Uint8Array,
  options: OpenClawStateDatabaseOptions = {},
): IxAuthLoginSessionRow | undefined {
  ensureIxAuthSessionsSchema(options);
  const database = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    database.db,
    ixAuthSessionsDb(database.db)
      .selectFrom("ix_auth_login_sessions")
      .selectAll()
      .where("token_digest", "=", tokenDigest)
      .limit(1),
  ).rows[0];
}

/** Slide the idle window forward after a request proved the session is in use. */
export function touchIxAuthLoginSession(
  params: { sessionId: string; lastSeenAt: number; idleExpiresAt: number },
  options: OpenClawStateDatabaseOptions = {},
): void {
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        ixAuthSessionsDb(db)
          .updateTable("ix_auth_login_sessions")
          .set({ last_seen_at: params.lastSeenAt, idle_expires_at: params.idleExpiresAt })
          .where("id", "=", params.sessionId)
          .where("revoked_at", "is", null),
      );
    },
    options,
    { operationLabel: "ix-auth.sessions.touch" },
  );
}

/** Store the tokens returned by a rotation so the next refresh uses the current pair. */
export function updateIxAuthSessionTokens(
  params: {
    sessionId: string;
    accessToken: string;
    accessExpiresAt: number;
    refreshToken: string;
  },
  options: OpenClawStateDatabaseOptions = {},
): void {
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        ixAuthSessionsDb(db)
          .updateTable("ix_auth_login_sessions")
          .set({
            access_token: params.accessToken,
            access_expires_at: params.accessExpiresAt,
            refresh_token: params.refreshToken,
          })
          .where("id", "=", params.sessionId)
          .where("revoked_at", "is", null),
      );
    },
    options,
    { operationLabel: "ix-auth.sessions.rotate" },
  );
}

/** Revoke one session. Idempotent: an already revoked row keeps its first reason. */
export function revokeIxAuthLoginSession(
  params: { sessionId: string; revokedAt: number; reason: string },
  options: OpenClawStateDatabaseOptions = {},
): void {
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        ixAuthSessionsDb(db)
          .updateTable("ix_auth_login_sessions")
          .set({ revoked_at: params.revokedAt, revoke_reason: params.reason })
          .where("id", "=", params.sessionId)
          .where("revoked_at", "is", null),
      );
    },
    options,
    { operationLabel: "ix-auth.sessions.revoke" },
  );
}

/** Revoke every live session for one Gateway profile, for suspension or role change. */
export function revokeIxAuthSessionsForProfile(
  params: { profileId: string; revokedAt: number; reason: string },
  options: OpenClawStateDatabaseOptions = {},
): void {
  ensureIxAuthSessionsSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        ixAuthSessionsDb(db)
          .updateTable("ix_auth_login_sessions")
          .set({ revoked_at: params.revokedAt, revoke_reason: params.reason })
          .where("profile_id", "=", params.profileId)
          .where("revoked_at", "is", null),
      );
    },
    options,
    { operationLabel: "ix-auth.sessions.revoke-profile" },
  );
}

/**
 * Delete rows whose absolute lifetime ended well in the past.
 *
 * Revoked rows are kept for the same window so an operator can still correlate a
 * logout with the identity server's audit ledger.
 */
export function purgeExpiredIxAuthSessions(
  params: { expiredBefore: number },
  options: OpenClawStateDatabaseOptions = {},
): void {
  ensureIxAuthSessionsSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        ixAuthSessionsDb(db)
          .deleteFrom("ix_auth_login_sessions")
          .where("absolute_expires_at", "<", params.expiredBefore),
      );
    },
    options,
    { operationLabel: "ix-auth.sessions.purge" },
  );
}
