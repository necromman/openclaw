// Carries the person behind a connection as far as the audit ledger, and no further.
//
// `departmentHandshakeFacts` already puts the two facts authorization needs onto the
// connection. The activity ledger needs a few more - who this is, what they are called,
// what rank the Gateway resolved - which authorization must never read, because a name
// is not a permission. Keeping them in a separate bag makes that separation visible:
// nothing in the department fence looks at this field.
//
// Like the department facts, this is minted only from a locally verified token at
// handshake time. It is not the principal: no token, no session id, nothing bearer-like.
import type { IxAuthPrincipal } from "../auth/ix-auth/ix-auth-types.js";
import type { UserActivityAuditActor } from "../state/user-activity-audit-store.js";
import { departmentHandshakeFacts } from "./department-access.js";
import type { IxAuthAuditActor } from "./ix-auth-audit-actor-type.js";
import type { GatewayClient } from "./server-methods/client-types.js";

export type { IxAuthAuditActor };

/**
 * Every fact one verified principal contributes to its connection.
 *
 * The department facts and the attribution facts are minted together so a handshake has
 * one line for both, and so neither can be attached without the other.
 */
export function ixAuthConnectionFacts(principal: IxAuthPrincipal | undefined) {
  return { ...departmentHandshakeFacts(principal), ...ixAuthAuditActorFacts(principal) };
}

/** Project a verified principal into the connection's audit-attribution facts. */
export function ixAuthAuditActorFacts(principal: IxAuthPrincipal | undefined): {
  ixAuthAuditActor?: IxAuthAuditActor;
} {
  return principal
    ? {
        ixAuthAuditActor: {
          profileId: principal.profileId,
          email: principal.claims.email,
          ...(principal.claims.displayName ? { displayName: principal.claims.displayName } : {}),
          ...(principal.gatewayRole ? { gatewayRole: principal.gatewayRole } : {}),
          departments: principal.departments,
          isSuperAdmin: principal.isSuperAdmin,
        },
      }
    : {};
}

/** Shape one audit actor for the ledger. */
function toUserActivityActor(actor: IxAuthAuditActor): UserActivityAuditActor {
  return {
    source: "profile",
    profileId: actor.profileId,
    email: actor.email,
    ...(actor.displayName ? { displayName: actor.displayName } : {}),
    ...(actor.gatewayRole ? { gatewayRole: actor.gatewayRole } : {}),
    departments: actor.departments,
  };
}

/** The signed-in person behind this connection, if it proved one. */
export function readClientAuditActor(
  client: Pick<GatewayClient, "internal"> | null | undefined,
): IxAuthAuditActor | undefined {
  return client?.internal?.ixAuthAuditActor;
}

/**
 * The ledger actor for a connection that proved no account.
 *
 * The host shell, the CLI and internal dispatch all reach the Gateway without an
 * identity server in the picture. Recording them as an operator keeps the row honest
 * rather than attributing the action to nobody.
 */
function operatorActivityActor(
  client:
    | Pick<GatewayClient, "authenticatedUserId" | "authenticatedUserProfile">
    | null
    | undefined,
): UserActivityAuditActor {
  return {
    source: "operator",
    ...(client?.authenticatedUserProfile?.profileId
      ? { profileId: client.authenticatedUserProfile.profileId }
      : {}),
    ...(client?.authenticatedUserId ? { email: client.authenticatedUserId } : {}),
    ...(client?.authenticatedUserProfile?.displayName
      ? { displayName: client.authenticatedUserProfile.displayName }
      : {}),
  };
}

/**
 * The ledger actor for one Gateway connection, whichever way it authenticated.
 *
 * A message arriving over a chat channel has a sender but no account: nothing links a
 * Telegram id to a directory entry in this fork. Recording the channel sender under its
 * own source keeps that row findable without pretending it is a person the identity
 * server knows.
 */
export function clientActivityActor(client: GatewayClient | null): UserActivityAuditActor {
  const actor = readClientAuditActor(client);
  if (actor) {
    return toUserActivityActor(actor);
  }
  const sender = client?.internal?.senderAttribution;
  if (sender) {
    return {
      source: "channel",
      ...(sender.name ? { displayName: sender.name } : {}),
      email: sender.id,
    };
  }
  return operatorActivityActor(client);
}
