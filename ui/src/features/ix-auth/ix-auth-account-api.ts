// Control UI client for the Gateway's account-lifecycle routes.
//
// These are the screens a person reaches with no session: signing up, following a link
// out of a mail message, or asking for a new password. Like the sign-in client, nothing
// here carries a bearer token; the Gateway answers on its own routes.

/** One account-lifecycle submission. Never says whether an address is registered. */
export type IxAuthAccountResult =
  | { kind: "accepted" }
  | { kind: "failed"; errorKey: string; message?: string };

function resolveAccountEndpoint(basePath: string, route: string): string {
  return `${basePath.replace(/\/+$/u, "")}/auth/${route}`;
}

function mapAccountErrorToKey(status: number, code: string): string {
  switch (code) {
    case "signup_disabled":
      return "signupDisabled";
    case "signup_rejected":
      return "signupRejected";
    case "password_rejected":
      return "passwordRejected";
    case "terms_required":
      return "termsRequired";
    case "invalid_token":
      return "invalidToken";
    case "rate_limited":
      return "rateLimited";
    case "identity_unavailable":
      return "identityUnavailable";
    case "origin_not_allowed":
      return "unknown";
    default:
      return status === 400 ? "invalidToken" : "unknown";
  }
}

async function postAccountRoute(params: {
  basePath: string;
  route: string;
  body: Record<string, string | undefined>;
}): Promise<IxAuthAccountResult> {
  let response: Response;
  try {
    response = await fetch(resolveAccountEndpoint(params.basePath, params.route), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(params.body),
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
    const code = typeof body.error === "string" ? body.error : "";
    return {
      kind: "failed",
      errorKey: mapAccountErrorToKey(response.status, code),
      // The identity server's own wording is the only useful part of a password-policy
      // refusal, since the rules are configurable and the Gateway does not know them.
      message: typeof body.message === "string" ? body.message : undefined,
    };
  }
  return { kind: "accepted" };
}

/** Ask for an account. The answer is the same whether or not the address is known. */
export async function submitIxAuthSignup(params: {
  basePath: string;
  email: string;
  password: string;
  name?: string;
}): Promise<IxAuthAccountResult> {
  return await postAccountRoute({
    basePath: params.basePath,
    route: "signup",
    body: { email: params.email, password: params.password, name: params.name },
  });
}

/** Ask for a password-reset mail. Also answers identically for unknown addresses. */
export async function submitIxAuthPasswordForgot(params: {
  basePath: string;
  email: string;
}): Promise<IxAuthAccountResult> {
  return await postAccountRoute({
    basePath: params.basePath,
    route: "password/forgot",
    body: { email: params.email },
  });
}

/** Set a new password using the token from a reset link. */
export async function submitIxAuthPasswordReset(params: {
  basePath: string;
  token: string;
  newPassword: string;
}): Promise<IxAuthAccountResult> {
  return await postAccountRoute({
    basePath: params.basePath,
    route: "password/reset",
    body: { token: params.token, newPassword: params.newPassword },
  });
}

/** Confirm an address using the token from a verification link. */
export async function submitIxAuthEmailVerify(params: {
  basePath: string;
  token: string;
}): Promise<IxAuthAccountResult> {
  return await postAccountRoute({
    basePath: params.basePath,
    route: "email/verify",
    body: { token: params.token },
  });
}

/** Accept an invitation by choosing the first password. */
export async function submitIxAuthInviteAccept(params: {
  basePath: string;
  token: string;
  password: string;
  name?: string;
}): Promise<IxAuthAccountResult> {
  return await postAccountRoute({
    basePath: params.basePath,
    route: "invite/accept",
    body: { token: params.token, password: params.password, name: params.name },
  });
}
