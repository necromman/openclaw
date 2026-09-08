// One protocol projection for the person-attributed ledger, shared by every reader.
//
// The RPC answers from inside the Gateway process, and `openclaw audit users` can answer
// from the state database directly when the Gateway cannot be reached. Two projections
// would let those two answers drift in field shape, and a `--json` consumer would then
// have to know which path produced its page. So both call this one.
import type { AuditUserActivityEvent } from "../../packages/gateway-protocol/src/index.js";
import type { UserActivityAuditEntry } from "../state/user-activity-audit-store.js";

/** Project one stored ledger entry onto the wire event shape. */
export function toAuditUserActivityWireEvent(
  entry: UserActivityAuditEntry,
): AuditUserActivityEvent {
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
