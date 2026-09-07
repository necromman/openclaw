// Control UI client for the Gateway's identity administration routes.
//
// Every call here rides the session cookie plus the session-bound CSRF token, and the
// Gateway forwards it to the identity server as the signed-in administrator. A member
// reaching these routes is refused by the Gateway, not by hiding the buttons.
import { readIxAuthCsrfToken } from "./ix-auth-session-api.ts";

/** Header the Gateway expects the session CSRF token in on mutating requests. */
const IX_AUTH_CSRF_HEADER = "x-openclaw-csrf";

/** One department the identity server knows about. */
export type IxAuthDepartmentOption = { code: string; name: string };

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
  department?: string;
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
    case "identity_unavailable":
      return "identityUnavailable";
    default:
      return status === 400 ? "adminRejected" : "unknown";
  }
}

async function callAdminRoute(params: {
  basePath: string;
  route: string;
  method: "GET" | "POST" | "DELETE";
  body?: Record<string, string | undefined>;
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

function readStringField(record: unknown, key: string): string | undefined {
  if (record === null || typeof record !== "object") {
    return undefined;
  }
  // SAFETY: the null and typeof guard directly above proves this is an object.
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** List the departments an invitation may place someone into. */
export async function fetchIxAuthDepartments(
  basePath: string,
): Promise<IxAuthDepartmentOption[] | IxAuthAdminFailure> {
  const result = await callAdminRoute({ basePath, route: "departments", method: "GET" });
  if (result.kind === "failed") {
    return result;
  }
  const raw = Array.isArray(result.body.departments) ? result.body.departments : [];
  const departments: IxAuthDepartmentOption[] = [];
  for (const entry of raw) {
    const code = readStringField(entry, "code");
    if (code) {
      departments.push({ code, name: readStringField(entry, "name") ?? code });
    }
  }
  return departments;
}

/** Create one invited account and, when there is no mail server, get its link back. */
export async function issueIxAuthInvite(params: {
  basePath: string;
  email: string;
  name?: string;
  role?: string;
  department?: string;
}): Promise<IxAuthInviteResult | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "invites",
    method: "POST",
    body: {
      email: params.email,
      name: params.name,
      role: params.role,
      department: params.department,
    },
  });
  if (result.kind === "failed") {
    return result;
  }
  return {
    email: readStringField(result.body, "email") ?? params.email,
    userId: readStringField(result.body, "userId") ?? "",
    department: readStringField(result.body, "department"),
    departmentFailed: result.body.departmentFailed === true,
    inviteLink: readStringField(result.body, "inviteLink"),
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
    const email = readStringField(entry, "email");
    const link = readStringField(entry, "link");
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
    const userId = readStringField(entry, "userId");
    const email = readStringField(entry, "email");
    if (userId && email) {
      const verified =
        entry !== null && typeof entry === "object"
          // SAFETY: the guard above proves entry is an object with readable fields.
          ? (entry as Record<string, unknown>).emailVerified === true
          : false;
      pending.push({
        userId,
        email,
        name: readStringField(entry, "name") ?? email,
        emailVerified: verified,
        createdAt: readStringField(entry, "createdAt"),
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
  department?: string;
}): Promise<{ kind: "ok" } | IxAuthAdminFailure> {
  const result = await callAdminRoute({
    basePath: params.basePath,
    route: "signup-approvals",
    method: "POST",
    body: {
      userId: params.userId,
      decision: params.decision,
      reason: params.reason,
      department: params.department,
    },
  });
  return result.kind === "failed" ? result : { kind: "ok" };
}
