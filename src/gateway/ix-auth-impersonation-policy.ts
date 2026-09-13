import type { IxAuthPrincipal } from "../auth/ix-auth/ix-auth-types.js";
import { QUESTIONS_SCOPE, READ_SCOPE, WRITE_SCOPE } from "./operator-scopes.js";

const IMPERSONATION_WORK_SCOPES = new Set<string>([READ_SCOPE, WRITE_SCOPE, QUESTIONS_SCOPE]);

/** Verified actor claims restrict this login without changing the target's profile or data access. */
export function isIxAuthImpersonating(
  principal: Pick<IxAuthPrincipal, "claims"> | undefined,
): boolean {
  return Boolean(principal?.claims.impersonatorSubject || principal?.claims.impersonatorEmail);
}

export function limitIxAuthImpersonationScopes<Scope extends string>(
  scopes: Scope[],
  impersonating: boolean | undefined,
): Scope[] {
  return impersonating ? scopes.filter((scope) => IMPERSONATION_WORK_SCOPES.has(scope)) : scopes;
}

/** These management operations use ordinary read/write scopes and need their own boundary. */
export function isIxAuthImpersonationManagementMethod(method: string): boolean {
  return (
    method.startsWith("folders.rules.") ||
    method === "folders.subjects.list" ||
    method === "folders.tree.refresh" ||
    method.startsWith("device.scopes.") ||
    method.startsWith("doctor.") ||
    method.startsWith("users.authConnect.") ||
    method.startsWith("users.github.authorize.") ||
    [
      "users.setDisplayName",
      "users.setAvatar",
      "users.unlinkAuthProfile",
      "users.github.disconnect",
      "voicewake.set",
      "tts.enable",
      "tts.disable",
      "tts.setProvider",
      "tts.setPersona",
    ].includes(method)
  );
}
