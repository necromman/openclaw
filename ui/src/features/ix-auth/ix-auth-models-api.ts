// Control UI client for `/auth/admin/models`.
//
// It sits beside `ix-auth-admin-api.ts` rather than inside it for two reasons. The route
// answers a shape nothing else in that file uses, and it is the only one in the namespace
// reached with PUT: the policy is replaced whole so a screen holding a stale list cannot
// merge half of an older one back in.
//
// The catalog and the credential health this screen also needs do not come from here.
// They are ordinary Gateway methods (`models.list`, `models.authStatus`) that an
// administrator already holds `operator.read` for, so asking for them a second way would
// only be a second thing to keep in step.
import { readIxAuthCsrfToken } from "./ix-auth-session-api.ts";

/** Header the Gateway expects the session CSRF token in on mutating requests. */
const IX_AUTH_CSRF_HEADER = "x-openclaw-csrf";

/** The model region of the Gateway configuration an administrator owns. */
export type IxAuthModelPolicy = {
  /** Model that answers first. Empty means the Gateway default. */
  primary: string;
  /** Models tried in order when the primary cannot answer. */
  fallbacks: string[];
  /** Chat picker allowlist. Empty means every model is offered. */
  allow: string[];
  /** Small-task model. Empty means unset. */
  utilityModel: string;
};

/** What the read answers: the policy plus where a restart will read it back from. */
export type IxAuthModelPolicyView = IxAuthModelPolicy & { overridesPath?: string };

/** What the write answers: the stored policy plus whether it will survive a restart. */
export type IxAuthModelPolicySaved = IxAuthModelPolicy & { persisted: boolean };

export type IxAuthModelsFailure = { kind: "failed"; errorKey: string };

/** True for the failure shape both calls share. */
export function isIxAuthModelsFailure(value: unknown): value is IxAuthModelsFailure {
  return (
    value !== null &&
    typeof value === "object" &&
    // SAFETY: the null and typeof guard directly above proves this is an object.
    (value as { kind?: unknown }).kind === "failed"
  );
}

function errorKeyFor(status: number, code: string): string {
  switch (code) {
    case "forbidden":
    case "csrf_mismatch":
      return "adminForbidden";
    case "unauthenticated":
      return "adminUnauthenticated";
    case "model_not_allowed":
      return "modelNotAllowed";
    case "config_write_failed":
      return "modelWriteFailed";
    default:
      return status === 400 ? "adminRejected" : "unknown";
  }
}

async function callModelsRoute(params: {
  basePath: string;
  method: "GET" | "PUT";
  body?: IxAuthModelPolicy;
}): Promise<{ kind: "ok"; body: Record<string, unknown> } | IxAuthModelsFailure> {
  const csrfToken = readIxAuthCsrfToken();
  let response: Response;
  try {
    response = await fetch(`${params.basePath.replace(/\/+$/u, "")}/auth/admin/models`, {
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
      ? // SAFETY: the null and typeof guard directly above proves this is an object.
        (parsed as Record<string, unknown>)
      : {};
  if (!response.ok) {
    return {
      kind: "failed",
      errorKey: errorKeyFor(response.status, typeof body.error === "string" ? body.error : ""),
    };
  }
  return { kind: "ok", body };
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readPolicy(body: Record<string, unknown>): IxAuthModelPolicy {
  return {
    primary: readString(body.primary),
    fallbacks: readStrings(body.fallbacks),
    allow: readStrings(body.allow),
    utilityModel: readString(body.utilityModel),
  };
}

/** Read the policy the Gateway is running with. */
export async function fetchIxAuthModelPolicy(
  basePath: string,
): Promise<IxAuthModelPolicyView | IxAuthModelsFailure> {
  const result = await callModelsRoute({ basePath, method: "GET" });
  if (result.kind === "failed") {
    return result;
  }
  const overridesPath = readString(result.body.overridesPath);
  return {
    ...readPolicy(result.body),
    ...(overridesPath ? { overridesPath } : {}),
  };
}

/** Replace the policy. The answer says whether a restart will keep it. */
export async function saveIxAuthModelPolicy(params: {
  basePath: string;
  policy: IxAuthModelPolicy;
}): Promise<IxAuthModelPolicySaved | IxAuthModelsFailure> {
  const result = await callModelsRoute({
    basePath: params.basePath,
    method: "PUT",
    body: params.policy,
  });
  if (result.kind === "failed") {
    return result;
  }
  return { ...readPolicy(result.body), persisted: result.body.persisted === true };
}
