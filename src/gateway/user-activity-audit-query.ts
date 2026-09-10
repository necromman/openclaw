// One authorization and one query for the activity ledger, shared by every surface.
//
// The RPC the CLI and Control UI call, and the CSV export the browser downloads, must
// not answer differently about who may see whose rows. So both call in here, and the
// only thing they own is how the answer is serialized.
import { canUseIxAuthAdminApi } from "../auth/ix-auth/ix-auth-role-map.js";
import {
  listUserActivityAuditEvents,
  type UserActivityAuditEntry,
  type UserActivityAuditFilters,
} from "../state/user-activity-audit-store.js";
import type { IxAuthAuditActor } from "./ix-auth-audit-actor-type.js";

const DEFAULT_USER_ACTIVITY_LIST_LIMIT = 100;
const MAX_USER_ACTIVITY_LIST_LIMIT = 500;
/** One export is a spreadsheet, not a database dump. */
const MAX_USER_ACTIVITY_EXPORT_ROWS = 10_000;

export type UserActivityAuditReader =
  /** A caller the identity server vouched for; departments decide what they see. */
  | { kind: "ix-auth"; actor: IxAuthAuditActor }
  /**
   * The host operator: the shell that runs the Gateway, or the CLI on it.
   *
   * Outside the department boundary by construction - it already owns the SQLite file -
   * so narrowing its view would be theatre rather than a control.
   */
  | { kind: "host" };

export type UserActivityAuditQueryResult =
  | { ok: true; entries: UserActivityAuditEntry[]; nextCursor?: number }
  | { ok: false; code: "forbidden" };

/**
 * Narrow the requested filters to what this reader may see.
 *
 * `undefined` means the reader may see nothing. An administrator with no departments is
 * scoped to their own rows rather than to everyone's: a department-less administrator is
 * an incomplete setup, and the safe reading of an incomplete setup is the narrow one.
 */
export function scopeUserActivityFilters(
  reader: UserActivityAuditReader,
  requested: UserActivityAuditFilters,
): UserActivityAuditFilters | undefined {
  if (reader.kind === "host" || reader.actor.isSuperAdmin) {
    return requested;
  }
  if (!canUseIxAuthAdminApi(reader.actor.gatewayRole)) {
    return undefined;
  }
  if (reader.actor.departments.length === 0) {
    return { ...requested, profileId: reader.actor.profileId };
  }
  return { ...requested, departments: reader.actor.departments };
}

/** Authorize, scope, and read one page of the ledger. */
export function queryUserActivityAudit(params: {
  reader: UserActivityAuditReader;
  filters?: UserActivityAuditFilters;
  cursor?: number;
  limit?: number;
}): UserActivityAuditQueryResult {
  const filters = scopeUserActivityFilters(params.reader, params.filters ?? {});
  if (!filters) {
    return { ok: false, code: "forbidden" };
  }
  const page = listUserActivityAuditEvents({
    filters,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
    limit: Math.min(params.limit ?? DEFAULT_USER_ACTIVITY_LIST_LIMIT, MAX_USER_ACTIVITY_LIST_LIMIT),
  });
  return {
    ok: true,
    entries: page.entries,
    ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
  };
}

/**
 * Read up to `MAX_USER_ACTIVITY_EXPORT_ROWS` rows for one export.
 *
 * Paged internally rather than asking the store for a single huge page, so the export
 * cap and the query page size stay independent numbers.
 */
export function collectUserActivityAuditExport(params: {
  reader: UserActivityAuditReader;
  filters?: UserActivityAuditFilters;
}): { ok: true; entries: UserActivityAuditEntry[] } | { ok: false; code: "forbidden" } {
  const entries: UserActivityAuditEntry[] = [];
  let cursor: number | undefined;
  while (entries.length < MAX_USER_ACTIVITY_EXPORT_ROWS) {
    const page = queryUserActivityAudit({
      reader: params.reader,
      ...(params.filters ? { filters: params.filters } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: Math.min(MAX_USER_ACTIVITY_LIST_LIMIT, MAX_USER_ACTIVITY_EXPORT_ROWS - entries.length),
    });
    if (!page.ok) {
      return page;
    }
    entries.push(...page.entries);
    if (page.nextCursor === undefined) {
      break;
    }
    cursor = page.nextCursor;
  }
  return { ok: true, entries };
}
