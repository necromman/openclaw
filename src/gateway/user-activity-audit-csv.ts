// CSV projection of the activity ledger.
//
// One row per ledger row, with the JSON detail kept whole in its last column: an export
// that flattened detail into named columns would need a different header per kind, and a
// spreadsheet with nine header shapes is not an export anyone can use.
import type { UserActivityAuditEntry } from "../state/user-activity-audit-store.js";

const CSV_COLUMNS = [
  "at",
  "kind",
  "actorSource",
  "profileId",
  "email",
  "displayName",
  "gatewayRole",
  "departments",
  "sessionKey",
  "agentId",
  "remoteIp",
  "detail",
] as const;

/**
 * Quote one field for CSV.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with a quote character so a spreadsheet
 * opens the value as text: a ledger holds attacker-influenced strings (a file path, a
 * question), and those are exactly the cells a formula injection would land in.
 */
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

function entryFields(entry: UserActivityAuditEntry): string[] {
  return [
    new Date(entry.at).toISOString(),
    entry.kind,
    entry.actorSource,
    entry.profileId ?? "",
    entry.email ?? "",
    entry.displayName ?? "",
    entry.gatewayRole ?? "",
    entry.departments.join(" "),
    entry.sessionKey ?? "",
    entry.agentId ?? "",
    entry.remoteIp ?? "",
    JSON.stringify(entry.detail),
  ];
}

/** Render one export. Ends with a newline so `cat`-ing two exports stays well formed. */
export function formatUserActivityAuditCsv(entries: readonly UserActivityAuditEntry[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    lines.push(entryFields(entry).map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}
