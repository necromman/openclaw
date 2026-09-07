// `GET /auth/admin/audit/export.csv` - the activity ledger as a downloadable file.
//
// It lives on the identity BFF rather than beside the RPC because a browser download has
// to be a plain authenticated GET: an RPC result cannot become a file the browser saves
// without the page holding the whole export in memory first.
//
// Authorization is `resolveIxAuthAdminContext` (session, administrator, and CSRF on
// anything that is not a GET) followed by the same department scoping the RPC applies, so
// an administrator's export cannot contain a row their screen would have hidden.
import type { IncomingMessage, ServerResponse } from "node:http";
import { USER_ACTIVITY_AUDIT_KINDS } from "../state/user-activity-audit-schema.js";
import type { UserActivityAuditFilters } from "../state/user-activity-audit-store.js";
import type { IxAuthAdminContext } from "./ix-auth-admin-context.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";
import { formatUserActivityAuditCsv } from "./user-activity-audit-csv.js";
import { collectUserActivityAuditExport } from "./user-activity-audit-query.js";

function requestQuery(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://localhost").searchParams;
}

function readTimestamp(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function readFilters(req: IncomingMessage): UserActivityAuditFilters {
  const query = requestQuery(req);
  const kind = query.get("kind");
  const from = readTimestamp(query.get("from"));
  const to = readTimestamp(query.get("to"));
  return {
    ...(query.get("profileId") ? { profileId: query.get("profileId") as string } : {}),
    ...(query.get("email") ? { email: query.get("email") as string } : {}),
    ...(kind && (USER_ACTIVITY_AUDIT_KINDS as readonly string[]).includes(kind)
      ? // SAFETY: the membership test directly above proves the cast.
        { kind: kind as UserActivityAuditFilters["kind"] }
      : {}),
    ...(query.get("agentId") ? { agentId: query.get("agentId") as string } : {}),
    ...(query.get("sessionKey") ? { sessionKey: query.get("sessionKey") as string } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

/** Answer one export request with a CSV body, or 403 when the caller may read nothing. */
export function handleIxAuthAdminAuditExport(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): void {
  const { principal } = params.admin;
  const collected = collectUserActivityAuditExport({
    reader: {
      kind: "ix-auth",
      actor: {
        profileId: principal.profileId,
        email: principal.claims.email,
        ...(principal.claims.displayName ? { displayName: principal.claims.displayName } : {}),
        ...(principal.gatewayRole ? { gatewayRole: principal.gatewayRole } : {}),
        departments: principal.departments,
        isSuperAdmin: principal.isSuperAdmin,
      },
    },
    filters: readFilters(params.req),
  });
  if (!collected.ok) {
    params.res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    params.res.end(JSON.stringify({ error: "forbidden" }));
    return;
  }
  const body = formatUserActivityAuditCsv(collected.entries);
  params.res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    // Downloaded, never rendered: the ledger holds user-authored text, and a browser that
    // displayed it inline would be executing whatever a question happened to contain.
    "content-disposition": 'attachment; filename="user-activity.csv"',
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  params.res.end(body);
}
