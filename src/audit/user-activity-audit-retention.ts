// Retention for the person-attributed ledger, on the sweep the audit writer already runs.
//
// It shares that sweep rather than owning a timer so a deployment has one place where
// audit rows age out, and so the bounded-batch/"more work pending" contract the writer
// already implements applies to this table too.
import { getRuntimeConfig } from "../config/io.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import { pruneUserActivityAuditEvents } from "../state/user-activity-audit-store.js";
import { resolveUserActivityAuditPolicy } from "./audit-config.js";

/**
 * Delete one bounded batch of expired or over-cap activity rows.
 *
 * Runs even when collection is disabled: turning collection off must not strand rows
 * past their retention window, the same posture the metadata ledger takes.
 */
export function pruneExpiredUserActivityAudit(database: OpenClawStateDatabaseOptions = {}): number {
  const policy = resolveUserActivityAuditPolicy(getRuntimeConfig());
  return pruneUserActivityAuditEvents(
    { now: Date.now(), retentionMs: policy.retentionMs, maxRows: policy.maxRows },
    database,
  );
}
