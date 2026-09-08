// Connection scopes for a signed-in identity-server session.
//
// Every other authentication path treats `connect.scopes` as a request: the browser
// names what it wants, the Gateway caps it by the paired device, an optional
// `x-openclaw-scopes` proxy header, and finally the role definition. That order works
// when the credential itself carries the grant.
//
// An identity-server session is different. The person is named by a cookie the Gateway
// minted, their rank comes from the identity server's role map, and the page in front of
// them is a static bundle anyone can edit. So what the page asked for must not be able to
// narrow the grant either: a stale device-token scope list, or a proxy header, would
// silently demote a system administrator to whatever the last handshake happened to hold.
// That is exactly the defect this module exists to close - a superadmin whose role
// definition reads `["operator.admin"]` was landing without it, which disables secret
// mode and model account selection in the Control UI.
//
// So for these sessions the role definition is not the last cap, it is the whole answer.
import type { GatewayOperatorRoleDefinition } from "../config/types.gateway.js";
import { roleScopesAllow } from "../shared/operator-scope-compat.js";
import {
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
  QUESTIONS_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  type OperatorScope,
} from "./operator-scopes.js";

/**
 * The scopes an identity-server operator session can ever hold.
 *
 * The Control UI's own connect list, and nothing beyond it. The talk scopes are absent
 * on purpose: they belong to the talk surface, which authenticates separately, so
 * expanding a role here must never hand them out as a side effect.
 */
export const IX_AUTH_CONNECTION_SCOPE_CANDIDATES: readonly OperatorScope[] = Object.freeze([
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  APPROVALS_SCOPE,
  QUESTIONS_SCOPE,
  PAIRING_SCOPE,
]);

/**
 * Expand one role definition into the concrete scope list for an identity session.
 *
 * `operator.admin` implies every other operator scope (see `operator-scope-compat.ts`),
 * so a definition of `["operator.admin"]` expands to the whole candidate list rather than
 * a single entry the Control UI would have to reason about.
 *
 * Returns `undefined` when no role boundary is configured at all; the caller then keeps
 * the ordinary device-and-header path, because a deployment without `gateway.roles` has
 * no role definition to read.
 */
export function resolveIxAuthConnectionScopes(
  rolePolicy: GatewayOperatorRoleDefinition | undefined,
): OperatorScope[] | undefined {
  const allowedScopes = rolePolicy?.scopes;
  if (!allowedScopes) {
    return undefined;
  }
  return IX_AUTH_CONNECTION_SCOPE_CANDIDATES.filter((scope) =>
    roleScopesAllow({
      role: "operator",
      requestedScopes: [scope],
      allowedScopes,
    }),
  );
}
