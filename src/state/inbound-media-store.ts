// Durable store for chat attachment ownership.
//
// Row access goes through Kysely; only the DDL in inbound-media-schema.ts is raw SQL.
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  ensureInboundMediaSchema,
  type InboundMediaDatabase,
  type InboundMediaRow,
} from "./inbound-media-schema.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

function inboundMediaDb(db: DatabaseSync) {
  return getNodeSqliteKysely<InboundMediaDatabase>(db);
}

/** One stored attachment, as the reference tools and the read gate see it. */
export type InboundMediaOwnership = {
  id: string;
  sessionKey?: string;
  agentId?: string;
  profileId?: string;
  originalName?: string;
  mime: string;
  sizeBytes: number;
  createdAt: number;
  deletedAt?: number;
};

/** Facts recorded when one attachment is persisted. */
export type InboundMediaOwnershipInput = {
  id: string;
  sessionKey?: string;
  agentId?: string;
  profileId?: string;
  originalName?: string;
  mime: string;
  sizeBytes: number;
  createdAt: number;
};

/** Hard cap on what one tool response may show, so a listing never grows without bound. */
export const INBOUND_MEDIA_LIST_MAX = 50;

/**
 * Hard cap on one query.
 *
 * Larger than the tool cap because the caller still has to drop rows the department fence
 * hides, and a fence that trimmed the page before filtering would silently show fewer
 * than fifty files to anyone whose agent shares the store with another department.
 */
export const INBOUND_MEDIA_QUERY_MAX = 200;

function toOwnership(row: InboundMediaRow): InboundMediaOwnership {
  return {
    id: row.id,
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.profile_id ? { profileId: row.profile_id } : {}),
    ...(row.original_name ? { originalName: row.original_name } : {}),
    mime: row.mime,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  };
}

/**
 * Record who uploaded one attachment.
 *
 * Idempotent on the media id: the id is a UUID minted by the media store for these exact
 * bytes, so a retried persist describes the same file and must not create a second row.
 */
export function recordInboundMediaOwnership(
  input: InboundMediaOwnershipInput,
  options: OpenClawStateDatabaseOptions = {},
): void {
  ensureInboundMediaSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        inboundMediaDb(db)
          .insertInto("inbound_media")
          .values({
            id: input.id,
            session_key: input.sessionKey ?? null,
            agent_id: input.agentId ?? null,
            profile_id: input.profileId ?? null,
            original_name: input.originalName ?? null,
            mime: input.mime,
            size_bytes: input.sizeBytes,
            created_at: input.createdAt,
            deleted_at: null,
          })
          .onConflict((conflict) => conflict.column("id").doNothing()),
      );
    },
    options,
    { operationLabel: "inboundMedia.record" },
  );
}

/** One attachment by media id, tombstoned rows included. Undefined when never recorded. */
export function getInboundMediaOwnership(
  id: string,
  options: OpenClawStateDatabaseOptions = {},
): InboundMediaOwnership | undefined {
  ensureInboundMediaSchema(options);
  const database = openOpenClawStateDatabase(options);
  const row = executeSqliteQuerySync(
    database.db,
    inboundMediaDb(database.db).selectFrom("inbound_media").selectAll().where("id", "=", id),
  ).rows[0];
  return row ? toOwnership(row) : undefined;
}

/** Filters shared by the attachment listings. */
export type InboundMediaListFilters = {
  /** Case-insensitive substring over the original file name. */
  search?: string;
  limit?: number;
};

function buildListing(
  database: ReturnType<typeof openOpenClawStateDatabase>,
  filters: InboundMediaListFilters,
) {
  const limit = Math.max(
    1,
    Math.min(filters.limit ?? INBOUND_MEDIA_LIST_MAX, INBOUND_MEDIA_QUERY_MAX),
  );
  let statement = inboundMediaDb(database.db)
    .selectFrom("inbound_media")
    .selectAll()
    .where("deleted_at", "is", null);
  const search = filters.search?.trim();
  if (search) {
    // SQLite LIKE folds ASCII case only, so fold both sides explicitly: an original name
    // here is as likely to be Korean as English.
    statement = statement.where((eb) =>
      eb(eb.fn("lower", ["original_name"]), "like", `%${search.toLowerCase()}%`),
    );
  }
  return { statement, limit };
}

function runListing(
  database: ReturnType<typeof openOpenClawStateDatabase>,
  built: ReturnType<typeof buildListing>,
): InboundMediaOwnership[] {
  return executeSqliteQuerySync(
    database.db,
    built.statement.orderBy("created_at", "desc").orderBy("id", "desc").limit(built.limit),
  ).rows.map(toOwnership);
}

/** One person's attachments, newest first, tombstoned rows excluded. */
export function listInboundMediaForProfile(
  query: InboundMediaListFilters & { profileId: string },
  options: OpenClawStateDatabaseOptions = {},
): InboundMediaOwnership[] {
  ensureInboundMediaSchema(options);
  const database = openOpenClawStateDatabase(options);
  const built = buildListing(database, query);
  return runListing(database, {
    ...built,
    statement: built.statement.where("profile_id", "=", query.profileId),
  });
}

/**
 * One session's attachments, newest first, tombstoned rows excluded.
 *
 * The fallback for a deployment with no delegated identity: there is no account to own an
 * upload there, so the conversation itself is the narrowest honest owner.
 */
export function listInboundMediaForSession(
  query: InboundMediaListFilters & { sessionKey: string },
  options: OpenClawStateDatabaseOptions = {},
): InboundMediaOwnership[] {
  ensureInboundMediaSchema(options);
  const database = openOpenClawStateDatabase(options);
  const built = buildListing(database, query);
  return runListing(database, {
    ...built,
    statement: built.statement.where("session_key", "=", query.sessionKey),
  });
}

/**
 * Tombstone every attachment of one session. Returns how many rows changed.
 *
 * Deleting a session must stop its attachments from answering the reference tools, but it
 * must not erase the ownership fact: the activity ledger keeps 90 days of "who read what",
 * and a row that vanished would leave those entries unexplainable.
 */
export function softDeleteInboundMediaForSession(
  params: { sessionKey: string; nowMs: number },
  options: OpenClawStateDatabaseOptions = {},
): number {
  ensureInboundMediaSchema(options);
  let changed = 0;
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      const result = executeSqliteQuerySync(
        db,
        inboundMediaDb(db)
          .updateTable("inbound_media")
          .set({ deleted_at: params.nowMs })
          .where("session_key", "=", params.sessionKey)
          .where("deleted_at", "is", null),
      );
      changed = Number(result.numAffectedRows ?? 0);
    },
    options,
    { operationLabel: "inboundMedia.soft-delete-session" },
  );
  return changed;
}
