// Person-attributed activity queries over the fork's own ledger.
//
// Kept out of `audit.ts` because the authorization is different in kind: the metadata
// ledger answers to operator scopes, while this one answers to the account the identity
// server vouched for, and to the departments that account belongs to.
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  type AuditUserActivityEvent,
  validateAuditUserActivityListParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { parsePositiveAuditCursor } from "../../audit/audit-cursor.js";
import type { UserActivityAuditEntry } from "../../state/user-activity-audit-store.js";
import { readClientAuditActor } from "../ix-auth-audit-actor.js";
import {
  queryUserActivityAudit,
  type UserActivityAuditReader,
} from "../user-activity-audit-query.js";
import type { GatewayClient } from "./client-types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

/**
 * Who is asking.
 *
 * A connection with no verified account is the host operator: the CLI on the Gateway
 * host, or an operator token. That caller already owns the database file, so the
 * department boundary is not a control over it.
 */
export function resolveUserActivityReader(client: GatewayClient | null): UserActivityAuditReader {
  const actor = readClientAuditActor(client);
  return actor ? { kind: "ix-auth", actor } : { kind: "host" };
}

function toWireEvent(entry: UserActivityAuditEntry): AuditUserActivityEvent {
  return {
    sequence: entry.sequence,
    at: entry.at,
    kind: entry.kind,
    actorSource: entry.actorSource,
    ...(entry.profileId ? { profileId: entry.profileId } : {}),
    ...(entry.email ? { email: entry.email } : {}),
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    ...(entry.gatewayRole ? { gatewayRole: entry.gatewayRole } : {}),
    departments: entry.departments,
    ...(entry.sessionKey ? { sessionKey: entry.sessionKey } : {}),
    ...(entry.agentId ? { agentId: entry.agentId } : {}),
    detail: entry.detail,
    ...(entry.remoteIp ? { remoteIp: entry.remoteIp } : {}),
    ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
  };
}

export const auditUserActivityHandlers: GatewayRequestHandlers = {
  "audit.userActivity.list": ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateAuditUserActivityListParams,
        "audit.userActivity.list",
        respond,
      )
    ) {
      return;
    }
    const cursor = parsePositiveAuditCursor(params.cursor);
    if (
      cursor === null ||
      (params.from !== undefined && params.to !== undefined && params.from > params.to)
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid audit.userActivity.list range or cursor"),
      );
      return;
    }
    const profileId = normalizeOptionalString(params.profileId);
    const email = normalizeOptionalString(params.email);
    const agentId = normalizeOptionalString(params.agentId);
    const sessionKey = normalizeOptionalString(params.sessionKey);
    const page = queryUserActivityAudit({
      reader: resolveUserActivityReader(client),
      ...(cursor !== undefined ? { cursor } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      filters: {
        ...(profileId ? { profileId } : {}),
        ...(email ? { email } : {}),
        ...(params.kind ? { kind: params.kind } : {}),
        ...(agentId ? { agentId } : {}),
        ...(sessionKey ? { sessionKey } : {}),
        ...(params.from !== undefined ? { from: params.from } : {}),
        ...(params.to !== undefined ? { to: params.to } : {}),
      },
    });
    if (!page.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.FORBIDDEN, "This account cannot read the activity ledger."),
      );
      return;
    }
    respond(true, {
      events: page.entries.map(toWireEvent),
      ...(page.nextCursor !== undefined ? { nextCursor: String(page.nextCursor) } : {}),
    });
  },
};
