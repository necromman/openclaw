// Projection of ledger rows into what the screen actually shows.
//
// Kept out of the component so the interesting decisions - which detail field makes a
// kind legible, how a filter becomes a query - are testable without a DOM.
import type { AuditUserActivityEvent } from "../../../../packages/gateway-protocol/src/schema/audit-user-activity.js";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import { t } from "../../i18n/index.ts";

/** What an empty cell reads as, so a missing value never looks like a blank column. */
const AUDIT_MISSING_VALUE = "-";

export const AUDIT_ACTIVITY_KIND_OPTIONS = [
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

type AuditActivityKind = (typeof AUDIT_ACTIVITY_KIND_OPTIONS)[number];

export type AuditActivityFilters = {
  person: string;
  kind: AuditActivityKind | "";
  since: string;
  until: string;
};

export const EMPTY_AUDIT_ACTIVITY_FILTERS: AuditActivityFilters = {
  person: "",
  kind: "",
  since: "",
  until: "",
};

/** Translate one kind into its label. Unknown kinds keep their wire name. */
export function auditKindLabel(kind: string): string {
  const label = t(`ixAuth.audit.kinds.${kind}`);
  return label === `ixAuth.audit.kinds.${kind}` ? kind : label;
}

/** Midnight-inclusive end of a date-input day, so `until` includes the day it names. */
function endOfDayMs(value: string): number | undefined {
  const parsed = Date.parse(`${value}T23:59:59.999`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function startOfDayMs(value: string): number | undefined {
  const parsed = Date.parse(`${value}T00:00:00.000`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Turn the filter bar into query parameters.
 *
 * `person` is matched as an address, because that is what an administrator has in hand;
 * a profile id is a database key nobody types.
 */
export function auditFilterQuery(filters: AuditActivityFilters): Record<string, string | number> {
  const from = filters.since ? startOfDayMs(filters.since) : undefined;
  const to = filters.until ? endOfDayMs(filters.until) : undefined;
  return {
    ...(filters.person.trim() ? { email: filters.person.trim() } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

/** Query string for the CSV export route, which takes the same filters. */
export function auditExportSearch(filters: AuditActivityFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(auditFilterQuery(filters))) {
    query.set(key, String(value));
  }
  const search = query.toString();
  return search ? `?${search}` : "";
}

/** The one line of context that makes a row readable without expanding it. */
export function auditRowSummary(event: AuditUserActivityEvent): string {
  const detail = event.detail;
  if (typeof detail.text === "string") {
    return detail.text;
  }
  if (Array.isArray(detail.paths)) {
    return detail.paths.filter((item): item is string => typeof item === "string").join(", ");
  }
  for (const field of ["path", "action", "reason", "surface"]) {
    const value = detail[field];
    if (typeof value === "string") {
      return value;
    }
  }
  return typeof detail.chars === "number" ? t("ixAuth.audit.promptHidden") : "";
}

/** Who the row is about, preferring what a person would recognize. */
export function auditRowPerson(event: AuditUserActivityEvent): string {
  return event.displayName ?? event.email ?? event.profileId ?? event.actorSource;
}

/**
 * The rank a row records, in the words the rest of the screens use.
 *
 * The ledger stores the Gateway role name as it stood when the row was written, which is
 * a code. A reader scanning for "who was an administrator" should not have to know that
 * `superadmin` is the top rank, so the same table the invitation and directory screens
 * read from names it here too.
 *
 * A row with no role (an operator shell, a channel sender) keeps the placeholder the
 * column already used, and a role this build has no word for keeps its configured name:
 * a deployment may map its own codes through `gateway.auth.ixAuth.roleMap`.
 */
export function auditRowRole(event: AuditUserActivityEvent): string {
  const role = event.gatewayRole?.trim();
  return role ? ixAuthRoleLabel(role) : AUDIT_MISSING_VALUE;
}
