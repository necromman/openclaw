/** Resolves whether the metadata-only audit ledger records new events. */
import type { OpenClawConfig } from "../config/types.openclaw.js";

export type AuditMessageMode = "off" | "direct" | "all";

/**
 * The ledger is on by default: an audit trail enabled only after an incident
 * cannot explain the incident. `logging.audit.enabled: false` stops new event inserts after
 * restart; audit queries still serve retained rows until they expire.
 */
export function isAuditLedgerEnabled(cfg: OpenClawConfig | undefined): boolean {
  return cfg?.logging?.audit?.enabled !== false;
}

/** Execution identity is retained only after an explicit startup-scoped opt-in. */
export function isExecutionIdentityCollectionEnabled(cfg: OpenClawConfig | undefined): boolean {
  return isAuditLedgerEnabled(cfg) && cfg?.logging?.audit?.executionIdentity === true;
}

/** Message metadata remains an explicit opt-in inside the default-on ledger. */
export function resolveAuditMessageMode(cfg: OpenClawConfig | undefined): AuditMessageMode {
  return cfg?.logging?.audit?.messages ?? "off";
}

/** 90 days is the deployment default the delivery contract quotes. */
const DEFAULT_USER_ACTIVITY_RETENTION_DAYS = 90;
const DEFAULT_USER_ACTIVITY_MAX_ROWS = 1_000_000;
const DAY_MS = 24 * 60 * 60_000;

export type UserActivityAuditPolicy = {
  enabled: boolean;
  /** Store the question itself, not just its shape. */
  promptText: boolean;
  retentionMs: number;
  maxRows: number;
};

/**
 * Resolve the person-attributed ledger policy.
 *
 * The ledger follows `logging.audit.enabled` rather than owning a second switch: one
 * operator-visible way to stop audit collection is easier to reason about than two, and
 * an installation that turns the audit subsystem off does not want this half of it on.
 */
export function resolveUserActivityAuditPolicy(
  cfg: OpenClawConfig | undefined,
): UserActivityAuditPolicy {
  const userActivity = cfg?.logging?.audit?.userActivity;
  return {
    enabled: isAuditLedgerEnabled(cfg),
    promptText: userActivity?.promptText === true,
    retentionMs: (userActivity?.retentionDays ?? DEFAULT_USER_ACTIVITY_RETENTION_DAYS) * DAY_MS,
    maxRows: userActivity?.maxRows ?? DEFAULT_USER_ACTIVITY_MAX_ROWS,
  };
}
