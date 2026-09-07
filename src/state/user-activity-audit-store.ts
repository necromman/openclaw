// Durable store for the person-attributed activity ledger.
//
// Row access goes through Kysely; only the DDL in user-activity-audit-schema.ts is raw SQL.
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { tableExists } from "./openclaw-state-db-schema-helpers.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";
import {
  ensureUserActivityAuditSchema,
  type UserActivityAuditActorSource,
  type UserActivityAuditDatabase,
  type UserActivityAuditKind,
  type UserActivityAuditRow,
} from "./user-activity-audit-schema.js";

/** Bounded batch so one prune pass cannot hold the write lock over a huge ledger. */
const USER_ACTIVITY_PRUNE_BATCH_ROWS = 1_024;

function activityDb(db: DatabaseSync) {
  return getNodeSqliteKysely<UserActivityAuditDatabase>(db);
}

export type UserActivityAuditActor = {
  source: UserActivityAuditActorSource;
  profileId?: string;
  email?: string;
  displayName?: string;
  gatewayRole?: string;
  departments?: readonly string[];
};

export type UserActivityAuditAppend = {
  at: number;
  kind: UserActivityAuditKind;
  actor: UserActivityAuditActor;
  sessionKey?: string;
  agentId?: string;
  detail?: Record<string, unknown>;
  remoteIp?: string;
  userAgent?: string;
  requestId?: string;
};

export type UserActivityAuditEntry = {
  sequence: number;
  at: number;
  kind: UserActivityAuditKind;
  actorSource: UserActivityAuditActorSource;
  profileId?: string;
  email?: string;
  displayName?: string;
  gatewayRole?: string;
  departments: string[];
  sessionKey?: string;
  agentId?: string;
  detail: Record<string, unknown>;
  remoteIp?: string;
  userAgent?: string;
  requestId?: string;
};

export type UserActivityAuditFilters = {
  profileId?: string;
  email?: string;
  kind?: UserActivityAuditKind;
  agentId?: string;
  sessionKey?: string;
  /** Restrict to rows whose actor belongs to at least one of these departments. */
  departments?: readonly string[];
  from?: number;
  to?: number;
};

export type UserActivityAuditPage = {
  entries: UserActivityAuditEntry[];
  nextCursor?: number;
};

/** Longest field values stored. A ledger row is evidence, not a copy of the payload. */
const MAX_TEXT_FIELD_CHARS = 512;
const MAX_DETAIL_CHARS = 4_096;

function boundedText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > MAX_TEXT_FIELD_CHARS ? trimmed.slice(0, MAX_TEXT_FIELD_CHARS) : trimmed;
}

/**
 * Serialize the detail object under a hard cap.
 *
 * An oversized detail is replaced rather than truncated mid-string: a half JSON document
 * would fail to parse on read and the whole row would be unreadable.
 */
function serializeDetail(detail: Record<string, unknown> | undefined): string {
  if (!detail) {
    return "{}";
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(detail);
  } catch {
    return JSON.stringify({ error: "detail_not_serializable" });
  }
  if (encoded === undefined) {
    return "{}";
  }
  return encoded.length > MAX_DETAIL_CHARS
    ? JSON.stringify({ error: "detail_too_large", bytes: encoded.length })
    : encoded;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    // SAFETY: the object test directly above proves the cast.
    return parsed as Record<string, unknown>;
  } catch {
    // A corrupt row must not break a whole page of otherwise readable evidence.
    return {};
  }
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rowToEntry(row: UserActivityAuditRow): UserActivityAuditEntry {
  return {
    sequence: row.sequence,
    at: row.at,
    // SAFETY: only this module writes these columns, and it writes the closed unions.
    kind: row.kind as UserActivityAuditKind,
    // SAFETY: same writer, same closed union.
    actorSource: row.actor_source as UserActivityAuditActorSource,
    ...(row.profile_id ? { profileId: row.profile_id } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.gateway_role ? { gatewayRole: row.gateway_role } : {}),
    departments: parseJsonStringArray(row.departments),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    detail: parseJsonObject(row.detail),
    ...(row.remote_ip ? { remoteIp: row.remote_ip } : {}),
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}),
  };
}

/**
 * Append one activity row synchronously.
 *
 * Synchronous on purpose. The metadata ledger can afford a bounded queue that drops on
 * overflow because a lost run event costs a diagnostic; a lost login or file read costs
 * the answer to "who saw this", which is the whole point of this table.
 */
export function appendUserActivityAuditEvent(
  append: UserActivityAuditAppend,
  options: OpenClawStateDatabaseOptions = {},
): number {
  ensureUserActivityAuditSchema(options);
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      const result = executeSqliteQuerySync(
        db,
        activityDb(db)
          .insertInto("audit_user_activity")
          .values({
            at: append.at,
            kind: append.kind,
            actor_source: append.actor.source,
            profile_id: boundedText(append.actor.profileId),
            email: boundedText(append.actor.email),
            display_name: boundedText(append.actor.displayName),
            gateway_role: boundedText(append.actor.gatewayRole),
            departments: JSON.stringify([...(append.actor.departments ?? [])]),
            session_key: boundedText(append.sessionKey),
            agent_id: boundedText(append.agentId),
            detail: serializeDetail(append.detail),
            remote_ip: boundedText(append.remoteIp),
            user_agent: boundedText(append.userAgent),
            request_id: boundedText(append.requestId),
          }),
      );
      return Number(result.insertId ?? 0);
    },
    options,
    { operationLabel: "auditUserActivity.append" },
  );
}

/** How many rows one scan pass reads while looking for department matches. */
const USER_ACTIVITY_SCAN_BATCH_ROWS = 500;
/** Ceiling on how far one page will scan for matches before giving up. */
const USER_ACTIVITY_MAX_SCAN_ROWS = 20_000;

/**
 * Newest-first page over the ledger, filtered to what the caller may read.
 *
 * Every filter but one is a column, so SQLite applies it. The department set lives inside
 * a JSON column, so that one is applied while scanning: the page keeps reading batches
 * until it has a full page of matches or runs out of rows. Filtering a single fetched
 * page instead would end a listing early - a short page with no cursor reads as "that is
 * all there is", which for an administrator scoped to one department is wrong.
 */
export function listUserActivityAuditEvents(
  params: {
    filters?: UserActivityAuditFilters;
    cursor?: number;
    limit: number;
  },
  options: OpenClawStateDatabaseOptions = {},
): UserActivityAuditPage {
  const database = openOpenClawStateDatabase(options);
  // Reading must not be what creates the table: a deployment that never recorded an
  // activity row should stay without one, and an empty page is the honest answer.
  if (!tableExists(database.db, "audit_user_activity")) {
    return { entries: [] };
  }
  const filters = params.filters ?? {};
  const departmentScope = filters.departments;
  const matchesScope = (row: UserActivityAuditRow): boolean =>
    !departmentScope ||
    parseJsonStringArray(row.departments).some((code) => departmentScope.includes(code));
  const batchRows = departmentScope
    ? USER_ACTIVITY_SCAN_BATCH_ROWS
    : Math.min(params.limit + 1, USER_ACTIVITY_SCAN_BATCH_ROWS);
  const entries: UserActivityAuditEntry[] = [];
  let cursor = params.cursor;
  let scanned = 0;
  let exhausted = false;
  while (entries.length < params.limit && scanned < USER_ACTIVITY_MAX_SCAN_ROWS) {
    let query = activityDb(database.db).selectFrom("audit_user_activity").selectAll();
    if (cursor !== undefined) {
      query = query.where("sequence", "<", cursor);
    }
    if (filters.profileId) {
      query = query.where("profile_id", "=", filters.profileId);
    }
    if (filters.email) {
      query = query.where("email", "=", filters.email);
    }
    if (filters.kind) {
      query = query.where("kind", "=", filters.kind);
    }
    if (filters.agentId) {
      query = query.where("agent_id", "=", filters.agentId);
    }
    if (filters.sessionKey) {
      query = query.where("session_key", "=", filters.sessionKey);
    }
    if (filters.from !== undefined) {
      query = query.where("at", ">=", filters.from);
    }
    if (filters.to !== undefined) {
      query = query.where("at", "<=", filters.to);
    }
    const rows = executeSqliteQuerySync(
      database.db,
      query.orderBy("sequence", "desc").limit(batchRows),
    ).rows;
    scanned += rows.length;
    for (const row of rows) {
      cursor = row.sequence;
      if (matchesScope(row)) {
        entries.push(rowToEntry(row));
      }
      if (entries.length >= params.limit) {
        break;
      }
    }
    if (rows.length < batchRows) {
      exhausted = true;
      break;
    }
  }
  // Reaching the end of the table is the only proof that nothing remains. A short page
  // is not: a department scan that stopped at the row ceiling has more to find, and
  // withholding the cursor there would truncate the listing without saying so.
  return {
    entries,
    ...(exhausted || cursor === undefined ? {} : { nextCursor: cursor }),
  };
}

/**
 * Delete one bounded batch of rows that are past the retention window or over the row cap.
 *
 * Returns how many rows went away so the caller can keep sweeping until it reaches zero.
 */
export function pruneUserActivityAuditEvents(
  params: { now: number; retentionMs: number; maxRows: number },
  options: OpenClawStateDatabaseOptions = {},
): number {
  if (!tableExists(openOpenClawStateDatabase(options).db, "audit_user_activity")) {
    return 0;
  }
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      const kysely = activityDb(db);
      const expiredCutoff = params.now - params.retentionMs;
      const expired = executeSqliteQuerySync(
        db,
        kysely
          .deleteFrom("audit_user_activity")
          .where("sequence", "in", (builder) =>
            builder
              .selectFrom("audit_user_activity")
              .select("sequence")
              .where("at", "<", expiredCutoff)
              .orderBy("sequence", "asc")
              .limit(USER_ACTIVITY_PRUNE_BATCH_ROWS),
          ),
      );
      const expiredRows = Number(expired.numAffectedRows ?? 0n);
      if (expiredRows > 0) {
        return expiredRows;
      }
      const counted = executeSqliteQuerySync(
        db,
        kysely
          .selectFrom("audit_user_activity")
          .select((builder) => builder.fn.countAll<number>().as("total")),
      ).rows[0];
      const total = counted?.total ?? 0;
      if (total <= params.maxRows) {
        return 0;
      }
      const overflow = Math.min(total - params.maxRows, USER_ACTIVITY_PRUNE_BATCH_ROWS);
      const trimmed = executeSqliteQuerySync(
        db,
        kysely
          .deleteFrom("audit_user_activity")
          .where("sequence", "in", (builder) =>
            builder
              .selectFrom("audit_user_activity")
              .select("sequence")
              .orderBy("sequence", "asc")
              .limit(overflow),
          ),
      );
      return Number(trimmed.numAffectedRows ?? 0n);
    },
    options,
    { operationLabel: "auditUserActivity.prune" },
  );
}
