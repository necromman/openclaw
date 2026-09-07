// Control UI client for the Gateway's own /auth/* routes.
//
// The browser never sees an identity-server token: it posts credentials here and the
// Gateway returns only a session cookie. Everything below therefore uses
// `credentials: "same-origin"` and carries no bearer token of its own.

/** Header the Gateway expects the session CSRF token in on mutating requests. */
const IX_AUTH_CSRF_HEADER = "x-openclaw-csrf";

/**
 * The session probe gates the whole pre-connection screen, including for Gateways that
 * do not use this mode at all. A stalled request must not strand those on a splash, so
 * it fails fast and the caller falls through to the shared-token form.
 */
const IX_AUTH_PROBE_TIMEOUT_MS = 8_000;

/** Signed-in user as reported by the Gateway. */
export type IxAuthSessionUser = {
  profileId: string;
  email: string;
  displayName: string;
  roles: string[];
  groups: string[];
  gatewayRole?: string;
  departments?: string[];
  isSuperAdmin?: boolean;
  impersonatedBy?: string;
};

export type IxAuthSessionState = {
  authenticated: boolean;
  /** Present only when the Gateway runs in ix-auth mode. */
  authMode?: "ix-auth";
  user?: IxAuthSessionUser;
  /** Only surfaced to users who can actually open it. */
  adminConsoleUrl?: string;
  /** True when the identity server accepts signups, which decides the signup link. */
  selfSignupEnabled?: boolean;
};

export type IxAuthLoginResult =
  | { kind: "authenticated"; user: IxAuthSessionUser; csrfToken: string }
  | { kind: "mfa-required"; challenge: string }
  | { kind: "failed"; errorKey: string; retryAfterMs?: number; lockedUntilMs?: number };

function resolveIxAuthEndpoint(basePath: string, route: string): string {
  const trimmed = basePath.replace(/\/+$/u, "");
  return `${trimmed}/auth/${route}`;
}

/**
 * Read the CSRF token the Gateway set alongside the session cookie.
 *
 * It rides in a script-readable cookie precisely so a reloaded page can recover it
 * without the Gateway having to hand out a fresh one on every probe.
 */
export function readIxAuthCsrfToken(cookieSource = document.cookie): string | undefined {
  for (const part of cookieSource.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    if (name.endsWith("-csrf") && name.includes("openclaw-session")) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

function mapErrorBodyToKey(status: number, body: Record<string, unknown>): string {
  const code = typeof body.error === "string" ? body.error : "";
  switch (code) {
    case "account_locked":
      return "accountLocked";
    case "account_disabled":
      return "accountDisabled";
    case "account_pending_approval":
      return "accountPendingApproval";
    case "account_pending":
      return "accountPending";
    case "rate_limited":
      return "rateLimited";
    case "identity_unavailable":
      return "identityUnavailable";
    case "invalid_code":
      return "invalidCode";
    case "invalid_credentials":
      return "invalidCredentials";
    default:
      return status === 401 ? "invalidCredentials" : "unknown";
  }
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === "object"
      // SAFETY: the preceding typeof guard proves parsed is a non-null object.
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readSessionUser(body: Record<string, unknown>): IxAuthSessionUser | undefined {
  const user = body.user;
  if (user === null || typeof user !== "object") {
    return undefined;
  }
  // SAFETY: the null and typeof guard directly above proves user is an object.
  const record = user as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email : undefined;
  const profileId = typeof record.profileId === "string" ? record.profileId : undefined;
  if (!email || !profileId) {
    return undefined;
  }
  return {
    profileId,
    email,
    displayName: typeof record.displayName === "string" ? record.displayName : email,
    roles: Array.isArray(record.roles) ? record.roles.filter((r) => typeof r === "string") : [],
    groups: Array.isArray(record.groups) ? record.groups.filter((g) => typeof g === "string") : [],
    gatewayRole: typeof record.gatewayRole === "string" ? record.gatewayRole : undefined,
    departments: Array.isArray(record.departments)
      ? record.departments.filter((d) => typeof d === "string")
      : undefined,
    isSuperAdmin: record.isSuperAdmin === true,
    impersonatedBy: typeof record.impersonatedBy === "string" ? record.impersonatedBy : undefined,
  };
}

/**
 * Resolve the console link the Gateway reported.
 *
 * The built-in console route is a Gateway path, so it has to be read relative to the
 * mount point: a Gateway served under a base path would otherwise send administrators to
 * the host root. An operator-configured absolute URL is passed through untouched.
 */
function resolveAdminConsoleUrl(basePath: string, value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return value;
  }
  return `${basePath.replace(/\/+$/u, "")}${value}`;
}

/**
 * Ask the Gateway whether this browser already holds a session.
 *
 * Returns an unauthenticated state rather than throwing when the Gateway is not in
 * ix-auth mode, so the caller can fall through to the existing connection screen.
 */
export async function probeIxAuthSession(basePath: string): Promise<IxAuthSessionState> {
  let response: Response;
  try {
    response = await fetch(resolveIxAuthEndpoint(basePath, "me"), {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(IX_AUTH_PROBE_TIMEOUT_MS),
    });
  } catch {
    return { authenticated: false };
  }
  if (!response.ok) {
    return { authenticated: false };
  }
  const body = await readJsonResponse(response);
  if (body.authMode !== "ix-auth") {
    return { authenticated: false };
  }
  return {
    authenticated: body.authenticated === true,
    authMode: "ix-auth",
    user: readSessionUser(body),
    adminConsoleUrl: resolveAdminConsoleUrl(basePath, body.adminConsoleUrl),
    selfSignupEnabled: body.selfSignupEnabled === true,
  };
}

async function submitIxAuthCredentials(params: {
  basePath: string;
  route: "login" | "mfa";
  body: Record<string, string>;
}): Promise<IxAuthLoginResult> {
  let response: Response;
  try {
    response = await fetch(resolveIxAuthEndpoint(params.basePath, params.route), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(params.body),
    });
  } catch {
    return { kind: "failed", errorKey: "network" };
  }
  const body = await readJsonResponse(response);
  if (!response.ok) {
    return {
      kind: "failed",
      errorKey: mapErrorBodyToKey(response.status, body),
      retryAfterMs: typeof body.retryAfterMs === "number" ? body.retryAfterMs : undefined,
      lockedUntilMs: typeof body.lockedUntilMs === "number" ? body.lockedUntilMs : undefined,
    };
  }
  if (body.mfaRequired === true && typeof body.challenge === "string") {
    return { kind: "mfa-required", challenge: body.challenge };
  }
  const user = readSessionUser(body);
  const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : undefined;
  if (body.authenticated !== true || !user || !csrfToken) {
    return { kind: "failed", errorKey: "unknown" };
  }
  return { kind: "authenticated", user, csrfToken };
}

/** Submit email and password. May return an MFA challenge instead of a session. */
export async function submitIxAuthLogin(params: {
  basePath: string;
  email: string;
  password: string;
}): Promise<IxAuthLoginResult> {
  return await submitIxAuthCredentials({
    basePath: params.basePath,
    route: "login",
    body: { email: params.email, password: params.password },
  });
}

/** Complete a two-step sign-in with the authenticator code. */
export async function submitIxAuthMfaCode(params: {
  basePath: string;
  challenge: string;
  code: string;
}): Promise<IxAuthLoginResult> {
  return await submitIxAuthCredentials({
    basePath: params.basePath,
    route: "mfa",
    body: { challenge: params.challenge, code: params.code },
  });
}

/** End the session on both the Gateway and the identity server. */
export async function submitIxAuthLogout(basePath: string): Promise<void> {
  const csrfToken = readIxAuthCsrfToken();
  try {
    await fetch(resolveIxAuthEndpoint(basePath, "logout"), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(csrfToken ? { [IX_AUTH_CSRF_HEADER]: csrfToken } : {}),
      },
    });
  } catch {
    // The page reloads regardless: a failed logout call must not strand the user on a
    // screen that still looks signed in.
  }
}
