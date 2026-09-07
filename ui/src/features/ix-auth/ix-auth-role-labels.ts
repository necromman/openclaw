// One place that turns a role into the words a person reads.
//
// Two vocabularies arrive at the screens: the identity server's upper-case role codes
// (on an invitation form) and the Gateway role names it maps onto (in `/auth/me`). They
// name the same five ranks, so both resolve here rather than each screen inventing its
// own table and drifting from the other.
import { t } from "../../i18n/index.ts";

/** Identity-server role codes the fork ships, and the Gateway role each becomes. */
const IX_AUTH_ROLE_CODE_TO_GATEWAY_ROLE: Readonly<Record<string, string>> = Object.freeze({
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  EXECUTIVE: "executive",
  MODERATOR: "moderator",
  MEMBER: "member",
});

/** Gateway role names, most privileged first, matching the Gateway's own precedence. */
export const IX_AUTH_LABELLED_GATEWAY_ROLES: readonly string[] = Object.freeze([
  "superadmin",
  "admin",
  "executive",
  "moderator",
  "member",
]);

/**
 * The Gateway role one name refers to, or undefined for a role this build has no
 * word for.
 *
 * A deployment may map its own role codes through `gateway.auth.ixAuth.roleMap`, so an
 * unknown name is ordinary rather than an error: the caller prints it as configured.
 */
export function resolveIxAuthGatewayRoleName(role: string): string | undefined {
  const trimmed = role.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const mapped = IX_AUTH_ROLE_CODE_TO_GATEWAY_ROLE[trimmed.toUpperCase()];
  if (mapped !== undefined) {
    return mapped;
  }
  const lowered = trimmed.toLowerCase();
  return IX_AUTH_LABELLED_GATEWAY_ROLES.includes(lowered) ? lowered : undefined;
}

/** Catalog key for one role, or undefined when there is nothing to look up. */
export function ixAuthRoleLabelKey(role: string): string | undefined {
  const name = resolveIxAuthGatewayRoleName(role);
  return name === undefined ? undefined : `ixAuth.roles.${name}`;
}

/**
 * The label to show for one role.
 *
 * An unrecognized role falls back to its own text: a person seeing `auditor` learns more
 * than one seeing a blank, and the operator who configured that name will recognize it.
 */
export function ixAuthRoleLabel(role: string): string {
  const key = ixAuthRoleLabelKey(role);
  return key === undefined ? role : t(key);
}
