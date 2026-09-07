/** Operator CLI for the person-attributed activity ledger. */
import {
  parseStrictPositiveInteger,
  timestampMsToIsoString,
} from "@openclaw/normalization-core/number-coercion";
import { truncateUtf16Safe } from "@openclaw/normalization-core/utf16-slice";
import type {
  AuditUserActivityEvent,
  AuditUserActivityListParams,
  AuditUserActivityListResult,
} from "../../packages/gateway-protocol/src/index.js";
import { sanitizeTerminalText } from "../../packages/terminal-core/src/safe-text.js";
import { parseAbsoluteTimeMs } from "../cron/parse.js";
import { callGateway } from "../gateway/call.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";

const DEFAULT_AUDIT_USERS_LIMIT = 100;
const MAX_AUDIT_USERS_LIMIT = 500;
const MAX_SUMMARY_CHARS = 80;

export type AuditUsersCommandOptions = {
  email?: string;
  profileId?: string;
  kind?: AuditUserActivityListParams["kind"];
  agentId?: string;
  sessionKey?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: string;
  json?: boolean;
};

function parseTimestamp(value: string | undefined, flag: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed) && parseAbsoluteTimeMs(trimmed) !== null) {
    return parsed;
  }
  throw new Error(`${flag} must be ISO 8601 or Unix milliseconds.`);
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseStrictPositiveInteger(value);
  if (parsed === undefined || parsed > MAX_AUDIT_USERS_LIMIT) {
    throw new Error(`--limit must be between 1 and ${MAX_AUDIT_USERS_LIMIT}.`);
  }
  return parsed;
}

/**
 * One line of human-readable context per row.
 *
 * The detail object differs per kind, so this reads only the field that makes that kind
 * legible and leaves the rest to `--json`.
 */
function summarizeDetail(event: AuditUserActivityEvent): string {
  const detail = event.detail;
  const candidate =
    typeof detail.text === "string"
      ? detail.text
      : Array.isArray(detail.paths)
        ? detail.paths.filter((item) => typeof item === "string").join(" ")
        : typeof detail.path === "string"
          ? detail.path
          : typeof detail.action === "string"
            ? detail.action
            : typeof detail.reason === "string"
              ? detail.reason
              : typeof detail.digest === "string"
                ? `sha256:${detail.digest}`
                : "";
  return truncateUtf16Safe(sanitizeTerminalText(candidate), MAX_SUMMARY_CHARS);
}

function formatRows(events: readonly AuditUserActivityEvent[]): string[] {
  const rows = ["TIME\tKIND\tPERSON\tROLE\tDEPARTMENTS\tAGENT\tSUMMARY"];
  for (const event of events) {
    rows.push(
      [
        timestampMsToIsoString(event.at) ?? String(event.at),
        event.kind,
        event.email ?? event.profileId ?? event.actorSource,
        event.gatewayRole ?? "-",
        event.departments.join(",") || "-",
        event.agentId ?? "-",
        summarizeDetail(event),
      ].join("\t"),
    );
  }
  return rows;
}

/** `openclaw audit users` - who signed in, asked what, and opened which files. */
export async function auditUsersCommand(
  options: AuditUsersCommandOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const from = parseTimestamp(options.since, "--since");
  const to = parseTimestamp(options.until, "--until");
  if (from !== undefined && to !== undefined && from > to) {
    throw new Error("--since must be at or before --until.");
  }
  const params: AuditUserActivityListParams = {
    limit: parseLimit(options.limit) ?? DEFAULT_AUDIT_USERS_LIMIT,
    ...(options.email ? { email: options.email } : {}),
    ...(options.profileId ? { profileId: options.profileId } : {}),
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
  };
  const result = await callGateway<AuditUserActivityListResult>({
    method: "audit.userActivity.list",
    params,
  });
  if (options.json) {
    writeRuntimeJson(runtime, result);
    return;
  }
  for (const row of formatRows(result.events)) {
    runtime.log(row);
  }
  if (result.nextCursor) {
    runtime.log(`More records: --cursor ${result.nextCursor}`);
  }
}
