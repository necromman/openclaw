// Bringing a staff list in from a spreadsheet, one file at a time.
//
// The identity server has its own bulk endpoint, and this relays to it rather than
// looping over the invitation route: one call gives one transaction per row, so a single
// bad address costs that row and nothing else. What the identity server's CSV contract
// has no room for is a department, which is a Gateway concept expressed as group
// membership, so the file is parsed here and the rows are handed over as JSON.
//
// Departments are applied after the import, per row, from the ids the identity server
// reported back. A row whose department did not take is reported rather than retried:
// the account exists by then and its invitation has already gone out.
import type { IncomingMessage, ServerResponse } from "node:http";
import { importIxAuthUsers } from "../auth/ix-auth/ix-auth-admin-users-client.js";
import { readJsonBody } from "./hooks.js";
import { sendJson } from "./http-common.js";
import {
  grantIxAuthDepartments,
  listIxAuthDepartmentGroups,
  type IxAuthAdminContext,
} from "./ix-auth-admin-context.js";
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import { IX_AUTH_MANAGEABLE_ROLE_CODES } from "./ix-auth-admin-users-guard.js";
import type { IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

/**
 * Rows one import may carry.
 *
 * A staff list is hundreds of people, not thousands, and every created row sends a mail;
 * a file larger than this is a mistake worth reporting rather than a job worth running.
 */
const IX_AUTH_BULK_IMPORT_MAX_ROWS = 500;

/** The uploaded file is text, so the JSON envelope carrying it needs real room. */
const IX_AUTH_BULK_BODY_MAX_BYTES = 256 * 1024;

/** Column names the header row may use, mapped onto the field each fills. */
const IX_AUTH_BULK_COLUMN_ALIASES: Readonly<
  Record<string, "email" | "name" | "roles" | "departments">
> = Object.freeze({
  email: "email",
  name: "name",
  displayname: "name",
  role: "roles",
  roles: "roles",
  department: "departments",
  departments: "departments",
});

/** Separators inside the role and department columns, since the comma splits cells. */
const IX_AUTH_BULK_VALUE_SEPARATORS = /[;|]/u;

/** One parsed row, still unvalidated. */
type IxAuthBulkImportRow = {
  line: number;
  email: string;
  name?: string;
  roles: string[];
  departments: string[];
};

type IxAuthBulkParseResult =
  | { ok: true; rows: IxAuthBulkImportRow[] }
  | { ok: false; error: "empty" | "too_many_rows" | "missing_email_column"; count?: number };

/**
 * Split one CSV line, honouring double quotes.
 *
 * Written out rather than pulled in because the file this reads is three or four columns
 * of names and addresses exported from a spreadsheet, and the one rule that actually
 * matters is that a quoted cell may contain the separator.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function splitMultiValue(cell: string): string[] {
  return cell
    .split(IX_AUTH_BULK_VALUE_SEPARATORS)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Read the uploaded file.
 *
 * A header row is required, because a file whose columns are guessed at by position puts
 * somebody's name in the role column and nobody notices until the invitations arrive.
 */
function parseIxAuthBulkCsv(csv: string): IxAuthBulkParseResult {
  const lines = csv
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const header = lines.shift();
  if (!header) {
    return { ok: false, error: "empty" };
  }
  const columns = splitCsvLine(header).map(
    (cell) => IX_AUTH_BULK_COLUMN_ALIASES[cell.toLowerCase().replaceAll(/[\s_-]/gu, "")],
  );
  if (!columns.includes("email")) {
    return { ok: false, error: "missing_email_column" };
  }
  if (lines.length > IX_AUTH_BULK_IMPORT_MAX_ROWS) {
    return { ok: false, error: "too_many_rows", count: lines.length };
  }
  if (lines.length === 0) {
    return { ok: false, error: "empty" };
  }
  const rows: IxAuthBulkImportRow[] = [];
  for (const [index, line] of lines.entries()) {
    const cells = splitCsvLine(line);
    const row: IxAuthBulkImportRow = {
      // Line numbers count the header, so they match what a spreadsheet shows.
      line: index + 2,
      email: "",
      roles: [],
      departments: [],
    };
    for (const [column, field] of columns.entries()) {
      const value = cells[column]?.trim() ?? "";
      if (!field || value.length === 0) {
        continue;
      }
      if (field === "email") {
        row.email = value;
      } else if (field === "name") {
        row.name = value;
      } else if (field === "roles") {
        row.roles = splitMultiValue(value).map((code) => code.toUpperCase());
      } else {
        row.departments = splitMultiValue(value);
      }
    }
    rows.push(row);
  }
  return { ok: true, rows };
}

/** Handle `POST /auth/admin/users/bulk`. */
export async function handleIxAuthUsersImport(params: {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
}): Promise<void> {
  const body = await readJsonBody(params.req, IX_AUTH_BULK_BODY_MAX_BYTES);
  const value = body.ok ? body.value : undefined;
  let envelope: Record<string, unknown> | undefined;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    // SAFETY: the guard on the line above rejected null, arrays, and non-objects.
    envelope = value as Record<string, unknown>;
  }
  const csv = typeof envelope?.csv === "string" ? envelope.csv : undefined;
  if (!csv) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const parsed = parseIxAuthBulkCsv(csv);
  if (!parsed.ok) {
    sendJson(params.res, 400, {
      error: parsed.error,
      limit: IX_AUTH_BULK_IMPORT_MAX_ROWS,
      count: parsed.count,
    });
    return;
  }
  // A role nobody in this deployment holds would create accounts with no rank at all, so
  // the whole file is refused rather than importing half of it and reporting the rest.
  const unknownRole = parsed.rows
    .flatMap((row) => row.roles)
    .find((code) => !IX_AUTH_MANAGEABLE_ROLE_CODES.includes(code));
  if (unknownRole) {
    sendJson(params.res, 400, { error: "invalid_role", message: unknownRole });
    return;
  }
  const superAdminRequested = parsed.rows.some((row) =>
    row.roles.some(
      (code) =>
        params.deps.settings.roleMap[code] !== undefined &&
        params.deps.settings.superAdminRoles.includes(params.deps.settings.roleMap[code] ?? ""),
    ),
  );
  if (superAdminRequested && !params.admin.principal.isSuperAdmin) {
    sendJson(params.res, 403, { error: "forbidden" });
    return;
  }
  const listing = await listIxAuthDepartmentGroups({ deps: params.deps, admin: params.admin });
  const knownDepartments = listing.ok
    ? new Set(listing.departments.map((department) => department.code))
    : new Set<string>();
  const unknownDepartment = parsed.rows
    .flatMap((row) => row.departments)
    .find((code) => !knownDepartments.has(code));
  if (unknownDepartment) {
    sendJson(params.res, 400, { error: "unknown_department", message: unknownDepartment });
    return;
  }
  const imported = await importIxAuthUsers({
    ...params.admin.call,
    users: parsed.rows.map((row) => ({
      email: row.email,
      name: row.name,
      roles: row.roles.length > 0 ? row.roles : undefined,
    })),
    invite: true,
  });
  if (!imported.ok) {
    sendJson(params.res, imported.status === 403 ? 403 : 400, {
      error: imported.status === 403 ? "forbidden" : "request_rejected",
      message: imported.message,
    });
    return;
  }
  let departmentFailures = 0;
  for (const result of imported.summary.results) {
    const row = parsed.rows.find((candidate) => candidate.line === result.line);
    if (!row || !result.userId || row.departments.length === 0) {
      continue;
    }
    const grant = await grantIxAuthDepartments({
      deps: params.deps,
      admin: params.admin,
      userId: result.userId,
      requested: row.departments,
      fillAllWhenEmpty: false,
    });
    if (grant.failed) {
      departmentFailures += 1;
    }
  }
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "users-imported",
    detail: {
      total: imported.summary.total,
      created: imported.summary.created,
      failed: imported.summary.failed,
      departmentFailures,
    },
  });
  sendJson(params.res, 200, { ...imported.summary, departmentFailures });
}
