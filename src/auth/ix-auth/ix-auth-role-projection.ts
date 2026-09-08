// Projects the Gateway role on a verified login into `user_profiles.role`.
//
// The role map (`ix-auth-role-map.ts`) answers "which Gateway role is this person" on
// every verified token. Everything downstream of the handshake, though, reads the role
// off the durable profile row: `resolveOperatorRolePolicyForProfile` looks up
// `user_profiles.role`, and from there come the connection's operator scopes, the
// session-others cap and the agent allowlist.
//
// Without this projection those two never met. Every identity-server login left the row
// null, so `gateway.roles.default` decided, and a system administrator connected with the
// default member's scopes: no `operator.admin`, no `operator.approvals`. The HTTP admin
// surfaces still worked, because they read the live token, which is why the gap looked
// like a Control UI bug rather than a missing row.
//
// IX-Auth stays canonical: this only ever writes what the freshly verified token says, so
// a role changed in the identity server lands on the next login. A code that maps to
// nothing leaves the stored role untouched - it is not evidence of a demotion.
import { invalidateOperatorRolePolicy } from "../../gateway/operator-role-policy.js";
import { getUserProfileRole, setUserProfileRole } from "../../state/user-profiles.js";
import { resolveIxAuthGatewayRole } from "./ix-auth-role-map.js";
import type { IxAuthRuntimeSettings } from "./ix-auth-types.js";

/**
 * Write the mapped Gateway role onto the profile when it differs from the stored one.
 *
 * Returns the role now in force, or undefined when nothing mapped. A write failure is
 * swallowed on purpose: the owner profile refuses role assignment by design, and a login
 * must not fail because a projection did.
 */
export function projectIxAuthGatewayRole(params: {
  profileId: string;
  roles: readonly string[];
  settings: Pick<IxAuthRuntimeSettings, "roleMap" | "superAdminRoles">;
}): string | undefined {
  const { gatewayRole } = resolveIxAuthGatewayRole({
    roles: [...params.roles],
    settings: params.settings,
  });
  if (gatewayRole === undefined) {
    return undefined;
  }
  try {
    if (getUserProfileRole(params.profileId) === gatewayRole) {
      return gatewayRole;
    }
    setUserProfileRole(params.profileId, gatewayRole);
  } catch {
    return undefined;
  }
  // Same owner as a department change, so one bump covers every access decision that was
  // already in flight.
  invalidateOperatorRolePolicy(params.profileId);
  return gatewayRole;
}
