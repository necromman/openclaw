// Control UI client for the Gateway's identity administration routes.
//
// Every call here rides the session cookie plus the session-bound CSRF token, and the
// Gateway forwards it to the identity server as the signed-in administrator. A member
// reaching these routes is refused by the Gateway, not by hiding the buttons.
import { asOptionalObjectRecord, readStringField } from "@openclaw/normalization-core/record-coerce";
import { readIxAuthCsrfToken } from "./ix-auth-session-api.ts";

/** Header the Gateway expects the session CSRF token in on mutating requests. */
const IX_AUTH_CSRF_HEADER = "x-openclaw-csrf";

/**
 * One department the identity server knows about.
 *
 * `code` is what authorization reads and never changes; `name` is what people read and
 * an operator may rename. The projection fields are decoration for the department screen
 * and every other caller can ignore them.
 */
export type IxAuthDepartmentOption = {
  code: string;
  name: string;
  /** Code with the department prefix removed, which is what a binding names. */
  slug?: string;
  /** The identity server's own group name, before any local rename. */
  identityName?: string;
  /** People projected into this department at sign-in, not a live directory count. */
  memberCount?: number;
  /** Agents bound to this department. */
  agents?: string[];
};

/** A department the fork still holds but the identity server no longer lists. */
export type IxAuthOrphanDepartment = {
  slug: string;
  name: string;
  memberCount: number;
  agents: string[];
};

/** Everything the department screen reads in one call. */
export type IxAuthDepartmentDirectory = {
  /** Group-code prefix that marks a department, `"dept-"` by default. */
  prefix: string;
  /**
   * Where the member counts came from. The identity server's directory counts everyone
   * placed in a department; the sign-in projection only counts people seen here.
   */
  memberCountSource: "identity" | "projection";
  departments: IxAuthDepartmentOption[];
  orphans: IxAuthOrphanDepartment[];
};

/** One invitation link the Gateway is still holding. */
export type IxAuthInviteLink = { email: string; link: string; capturedAtMs: number };

/** One account waiting for a signup decision. */
export type IxAuthPendingSignup = {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt?: string;
};

/** Outcome of issuing one invitation. */
export type IxAuthInviteResult = {
  email: string;
  userId: string;
  /** Departments actually granted. Empty when none was asked for or none took. */
  departments: string[];
  departmentFailed: boolean;
  /** Present only when there is no mail server and the Gateway kept the link. */
  inviteLink?: string;
};

export type IxAuthAdminFailure = { kind: "failed"; errorKey: string; message?: string };

function resolveAdminEndpoint(basePath: string, route: string): string {
  return `${basePath.replace(/\/+$/u, "")}/auth/admin/${route}`;
}

function mapAdminErrorToKey(status: number, code: string): string {
  switch (code) {
    case "forbidden":
      return "adminForbidden";
    case "unauthenticated":
      return "adminUnauthenticated";
    case "csrf_mismatch":
      return "adminForbidden";
    case "conflict":
      return "adminConflict";
    case "department_has_members":
      return "departmentHasMembers";
    case "member_count_unavailable":
      return "memberCountUnavailable";
    case "identity_unavailable":
      return "identityUnavailable";
    default:
      return status === 400 ? "adminRejected" : "unknown";
  }
}

async function callAdminRoute(params: {
  basePath: string;
  route: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, string | string[] | undefined>;
}): Promise<{ kind: "ok"; body: Record<string, unknown> } | IxAuthAdminFailure> {
  const csrfToken = readIxAuthCsrfToken();
  let response: Response;
  try {
    response = await fetch(resolveAdminEndpoint(params.basePath, params.route), {
      method: params.method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(params.method === "GET" ? {} : { "content-type": "application/json" }),
        ...(csrfToken ? { [IX_AUTH_CSRF_HEADER]: csrfToken } : {}),
      },
      body: params.method === "GET" ? undefined : JSON.stringify(params.body ?? {}),
    });
  } catch {
    return { kind: "failed", errorKey: "network" };
  }
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  const body =
    parsed !== null && typeof parsed === "object"
      // SAFETY: the null and typeof guard directly above proves this is an object.
      ? (parsed as Record<string, unknown>)
      : {};
  if (!response.ok) {
    return {
      kind: "failed",
      errorKey: mapAdminErrorToKey(response.status, typeof body.error === "string" ? body.error : ""),
      message: typeof body.message === "string" ? body.message : undefined,
    };
  }
  return { kind: "ok", body };
}

function readStringListField(record: unknown, key: string): string[] {
  if (record === null || typeof record !== "object") {
    return [];
  }
  // SAFETY: the null and typeof guard directly above proves this is an object.
  const value = (record as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function fieldText(record: unknown, key: string): string | undefined {
  return readStringField(asOptionalObjectRecord(record), key);
}

function readCountField(record: unknown, key: string): number {
  if (record === null || typeof record !== "object") {
    return 0;
  }
  // SAFETY: the null and typeof guard directly above proves this is an object.
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Departments, their projection, and any the identity server no longer lists. */
export async function fetchIxAuthDepartmentDirectory(
  basePath: string,
): Promise<IxAuthDepartmentDirectory | IxAuthAdminFailure> {
  const result = await callAdminRoute({ basePath, route: "departments", method: "GET" });
  if (result.kind === "failed") {
    return result;
  }
  const raw = Array.isArray(result.body.departments) ? result.body.departments : [];
  const departments: IxAuthDepartmentOption[] = [];
  for (const entry of raw) {
    const code = fieldText(entry, "code");
    if (!code) {
      continue;
    }
    departments.push({
      code,
      name: fieldText(entry, "name") ?? code,
      slug: fieldText(entry, "slug"),
      identityName: fieldText(entry, "identityName"),
      memberCount: readCountField(entry, "memberCount"),
      agents: readStringListField(entry, "agents"),
    });
  }
  const rawOrphans = Array.isArray(result.body.orphans) ? result.body.orphans : [];
  const orphans: IxAuthOrphanDepartment[] = [];
  for (const entry of rawOrphans) {
    const slug = fieldText(entry, "slug");
    if (!slug) {
      continue;
    }
    orphans.push({
      slug,
      name: fieldText(entry, "name") ?? slug,
      memberCount: readCountField(entry, "memberCount"),
      agents: readStringListField(entry, "agents"),
    });
  }
  return {
    prefix: fieldText(result.body, "prefix") ?? "",
    memberCountSource:
      fieldText(result.body, "memberCountSource") === "projection" ? "projection" : "identity",
    departments,
    orphans,
  };
}

/** List the departments an invitation may place someone into. */
export async function fetchIxAuthDepartments(
  basePath: string,
): Promise<IxAuthDepartmentOption[] | IxAuthAdminFailure> {
  const directory = await fetchIxAuthDepartmentDirectory(basePath);
  return "kind" in directory ? directory : directory.departments;
}

/**
 * Create one department.
 *
 * The Gateway mints the group code from the slug, so a caller cannot name a group outside
 * the department prefix and quietly create an ordinary one.
 */
export async function createIxAuthDepartment(params: {
  basePath: string;
  slug: string;
  name: string;
}): Promise<{ code: string; slug: string; name: string } | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "departments",
    method: "POST",
    body: { slug: params.slug, name: params.name },
  });
  if (result.kind === "failed") {
    return result;
  }
  return {
    code: fieldText(result.body, "code") ?? "",
    slug: fieldText(result.body, "slug") ?? params.slug,
    name: fieldText(result.body, "name") ?? params.name,
  };
}

/**
 * Rename one department.
 *
 * Only the display name moves. The group code is what the department fence reads, and
 * changing it would move everyone out of the department they are in.
 */
export async function renameIxAuthDepartment(params: {
  basePath: string;
  slug: string;
  name: string;
}): Promise<{ slug: string; name: string } | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "departments",
    method: "PATCH",
    body: { slug: params.slug, name: params.name },
  });
  if (result.kind === "failed") {
    return result;
  }
  return {
    slug: fieldText(result.body, "slug") ?? params.slug,
    name: fieldText(result.body, "name") ?? params.name,
  };
}

/**
 * Delete one department.
 *
 * Answers with the agents whose binding the delete removed. Their workspace and index
 * folders still name this department's folders, so the caller clears those next; the
 * Gateway cannot, because a config write is a different surface with its own checks.
 */
export async function deleteIxAuthDepartment(params: {
  basePath: string;
  slug: string;
}): Promise<{ slug: string; unboundAgents: string[] } | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "departments",
    method: "DELETE",
    body: { slug: params.slug },
  });
  if (result.kind === "failed") {
    return result;
  }
  return {
    slug: fieldText(result.body, "slug") ?? params.slug,
    unboundAgents: readStringListField(result.body, "unboundAgents"),
  };
}

/** Create one invited account and, when there is no mail server, get its link back. */
export async function issueIxAuthInvite(params: {
  basePath: string;
  email: string;
  name?: string;
  role?: string;
  /** Empty for an executive means "every department", filled in by the Gateway. */
  departments?: readonly string[];
}): Promise<IxAuthInviteResult | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "invites",
    method: "POST",
    body: {
      email: params.email,
      name: params.name,
      role: params.role,
      departments: [...(params.departments ?? [])],
    },
  });
  if (result.kind === "failed") {
    return result;
  }
  return {
    email: fieldText(result.body, "email") ?? params.email,
    userId: fieldText(result.body, "userId") ?? "",
    departments: readStringListField(result.body, "departments"),
    departmentFailed: result.body.departmentFailed === true,
    inviteLink: fieldText(result.body, "inviteLink"),
  };
}

/** Invitation links the Gateway is still holding, newest first. */
export async function fetchIxAuthInviteLinks(
  basePath: string,
): Promise<IxAuthInviteLink[] | IxAuthAdminFailure> {
  const result = await callAdminRoute({ basePath, route: "invites", method: "GET" });
  if (result.kind === "failed") {
    return result;
  }
  const raw = Array.isArray(result.body.invites) ? result.body.invites : [];
  const invites: IxAuthInviteLink[] = [];
  for (const entry of raw) {
    const email = fieldText(entry, "email");
    const link = fieldText(entry, "link");
    if (email && link) {
      const captured =
        entry !== null && typeof entry === "object"
          // SAFETY: the guard above proves entry is an object with readable fields.
          ? (entry as Record<string, unknown>).capturedAtMs
          : undefined;
      invites.push({
        email,
        link,
        capturedAtMs: typeof captured === "number" ? captured : 0,
      });
    }
  }
  return invites;
}

/** Drop one held link once an administrator has passed it on. */
export async function forgetIxAuthInvite(params: {
  basePath: string;
  email: string;
}): Promise<{ kind: "ok" } | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "invites",
    method: "DELETE",
    body: { email: params.email },
  });
  return result.kind === "failed" ? result : { kind: "ok" };
}

/** Accounts held by the identity server's approval mode. */
export async function fetchIxAuthPendingSignups(
  basePath: string,
): Promise<IxAuthPendingSignup[] | IxAuthAdminFailure> {
  const result = await callAdminRoute({ basePath, route: "signup-approvals", method: "GET" });
  if (result.kind === "failed") {
    return result;
  }
  const raw = Array.isArray(result.body.pending) ? result.body.pending : [];
  const pending: IxAuthPendingSignup[] = [];
  for (const entry of raw) {
    const userId = fieldText(entry, "userId");
    const email = fieldText(entry, "email");
    if (userId && email) {
      const verified =
        entry !== null && typeof entry === "object"
          // SAFETY: the guard above proves entry is an object with readable fields.
          ? (entry as Record<string, unknown>).emailVerified === true
          : false;
      pending.push({
        userId,
        email,
        name: fieldText(entry, "name") ?? email,
        emailVerified: verified,
        createdAt: fieldText(entry, "createdAt"),
      });
    }
  }
  return pending;
}

/** Approve or reject one waiting signup, optionally placing it into a department. */
export async function decideIxAuthSignup(params: {
  basePath: string;
  userId: string;
  decision: "approve" | "reject";
  reason?: string;
  departments?: readonly string[];
}): Promise<{ kind: "ok" } | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "signup-approvals",
    method: "POST",
    body: {
      userId: params.userId,
      decision: params.decision,
      reason: params.reason,
      departments: [...(params.departments ?? [])],
    },
  });
  return result.kind === "failed" ? result : { kind: "ok" };
}
