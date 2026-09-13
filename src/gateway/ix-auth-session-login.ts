import { readIxAuthDepartmentCodes } from "../auth/ix-auth/ix-auth-claims.js";
import type { IxAuthTokenBundle } from "../auth/ix-auth/ix-auth-client.js";
import { syncIxAuthDepartments } from "../auth/ix-auth/ix-auth-departments.js";
import { projectIxAuthGatewayRole } from "../auth/ix-auth/ix-auth-role-projection.js";
import { persistIxAuthLoginSession } from "../auth/ix-auth/ix-auth-sessions.js";
import type { IxAuthRuntimeSettings, IxAuthVerifiedClaims } from "../auth/ix-auth/ix-auth-types.js";
import { revokeIxAuthLoginSession } from "../state/ix-auth-sessions-store.js";
import { ensureProfileForEmail } from "../state/user-profiles.js";

/** Password login and impersonation project the same verified target identity. */
export function createIxAuthBrowserSession(params: {
  tokens: IxAuthTokenBundle;
  claims: IxAuthVerifiedClaims;
  settings: IxAuthRuntimeSettings;
  userAgent?: string;
  nowMs: number;
}) {
  const profileId = ensureProfileForEmail(params.claims.email).id;
  const session = persistIxAuthLoginSession({ ...params, profileId });
  const departments = readIxAuthDepartmentCodes({
    groups: params.claims.groups,
    prefix: params.settings.departmentGroupPrefix,
  });
  try {
    syncIxAuthDepartments({ profileId, departments, nowMs: params.nowMs });
    projectIxAuthGatewayRole({ profileId, roles: params.claims.roles, settings: params.settings });
  } catch (error) {
    revokeIxAuthLoginSession({
      sessionId: session.sessionId,
      revokedAt: params.nowMs,
      reason: "identity-projection-failed",
    });
    throw error;
  }
  return { session, profileId, departments };
}
