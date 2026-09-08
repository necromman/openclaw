// Which reader answers `openclaw audit users`, and how the operator is told.
//
// An ix-auth deployment has no shared secret, so the CLI running beside the Gateway
// cannot authenticate its own RPC: the handshake is refused with
// `reason=gateway_auth_required`. The delivered stack keeps the host shell off the
// customer's hands, so "run it on the host instead" is not an answer there - the command
// has to work from inside the container or it does not exist.
//
// The Gateway RPC stays the primary path anyway, and this is a fallback rather than the
// default, for one reason: in remote mode the CLI points at a Gateway on another host,
// and that host's ledger is not this filesystem. Reading locally without trying the RPC
// first would answer a question about the remote deployment out of a local database that
// is empty or, worse, belongs to a different deployment. So the RPC is asked first, and
// the local database answers only when the RPC left the question unanswered on a target
// whose ledger is genuinely this one.
import { truncateUtf16Safe } from "@openclaw/normalization-core/utf16-slice";
import type {
  AuditUserActivityListParams,
  AuditUserActivityListResult,
} from "../../packages/gateway-protocol/src/index.js";
import { sanitizeTerminalText } from "../../packages/terminal-core/src/safe-text.js";
import { parsePositiveAuditCursor } from "../audit/audit-cursor.js";
import {
  callGateway,
  isGatewayCredentialsRequiredError,
  isGatewayExplicitAuthRequiredError,
  isGatewayTransportError,
  isImplicitLocalGatewayTarget,
} from "../gateway/call.js";
import { queryUserActivityAudit } from "../gateway/user-activity-audit-query.js";
import { toAuditUserActivityWireEvent } from "../gateway/user-activity-audit-wire.js";

/** Close reasons come from the far side, so they are bounded before they reach a terminal. */
const MAX_UNAVAILABLE_REASON_CHARS = 120;

export type AuditUsersPage = {
  result: AuditUserActivityListResult;
  /** Present only when the local database answered; one line, shown before the page. */
  localNotice?: string;
};

/**
 * Whether a failure means "the Gateway did not answer" rather than "the Gateway answered no".
 *
 * A rejected request is a decision and it must stand. Falling back on `FORBIDDEN` would
 * turn an authorization answer into an authorization bypass, and falling back on
 * `INVALID_REQUEST` would hide a bad filter behind a second, differently validated path.
 * Only failures raised before any handler ran - transport close, timeout, credentials
 * that were never there - leave the question open, and only those are worth asking the
 * local database instead.
 */
export function isGatewayLedgerUnavailableError(error: unknown): boolean {
  if (isGatewayTransportError(error)) {
    return true;
  }
  if (isGatewayCredentialsRequiredError(error) || isGatewayExplicitAuthRequiredError(error)) {
    return true;
  }
  return error instanceof Error && error.name === "GatewayStoredDeviceAuthUnavailableError";
}

/** Why the RPC could not answer, in the words the operator sees on the notice line. */
function describeGatewayUnavailable(error: unknown): string {
  if (isGatewayTransportError(error)) {
    if (error.kind === "timeout") {
      return "the gateway did not answer in time";
    }
    const reason = truncateUtf16Safe(
      sanitizeTerminalText(error.reason ?? ""),
      MAX_UNAVAILABLE_REASON_CHARS,
    );
    return reason
      ? `the gateway closed the connection: ${reason}`
      : "the gateway closed the connection";
  }
  return "this host holds no gateway credentials";
}

/**
 * The one line that separates a local answer from an RPC answer.
 *
 * The department boundary is not reproduced here, and that is deliberate. The RPC narrows
 * an administrator to their own departments because the connection carries an account the
 * identity server vouched for. A local read carries no account: it stands on the fact that
 * whoever runs it can already open, copy, and edit the database file, so a filter over the
 * rows would be theatre rather than a control. What the local path owes the operator is
 * not a narrower page but an honest label on the wider one, so the difference between the
 * two answers is never silent.
 */
export function formatLocalLedgerNotice(error: unknown): string {
  return [
    `Local read: ${describeGatewayUnavailable(error)}.`,
    "Rows come from the state database on this host, so this page is the whole ledger",
    "and is not narrowed by department.",
  ].join(" ");
}

/**
 * Read one page straight from the state database.
 *
 * Routed through `queryUserActivityAudit` rather than the store, so the local path reuses
 * the single authorization point instead of adding a second one. The reader is `host`,
 * which is exactly what the RPC would have resolved for this same credential-less CLI
 * connection had it been able to open a socket.
 */
export function readLocalUserActivityPage(
  params: AuditUserActivityListParams,
): AuditUserActivityListResult {
  const cursor = parsePositiveAuditCursor(params.cursor);
  if (cursor === null) {
    throw new Error("--cursor must be a positive sequence number.");
  }
  const page = queryUserActivityAudit({
    reader: { kind: "host" },
    ...(cursor !== undefined ? { cursor } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    filters: {
      ...(params.profileId ? { profileId: params.profileId } : {}),
      ...(params.email ? { email: params.email } : {}),
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.from !== undefined ? { from: params.from } : {}),
      ...(params.to !== undefined ? { to: params.to } : {}),
    },
  });
  if (!page.ok) {
    // A host reader is never refused; this exists so the refusal can never pass silently.
    throw new Error("The local activity ledger refused a host read.");
  }
  return {
    events: page.entries.map(toAuditUserActivityWireEvent),
    ...(page.nextCursor !== undefined ? { nextCursor: String(page.nextCursor) } : {}),
  };
}

/**
 * Whether the failed call was aimed at the Gateway whose ledger this filesystem holds.
 *
 * A configuration that cannot be read is not a local target, and the failure worth
 * showing is still the first one: the operator asked about the ledger, not about config.
 */
async function targetsLocalGateway(originalError: unknown): Promise<boolean> {
  try {
    return await isImplicitLocalGatewayTarget({});
  } catch {
    throw originalError;
  }
}

/** Ask the Gateway, and fall back to this host's database when it never answered. */
export async function readAuditUsersPage(
  params: AuditUserActivityListParams,
): Promise<AuditUsersPage> {
  try {
    return {
      result: await callGateway<AuditUserActivityListResult>({
        method: "audit.userActivity.list",
        params,
      }),
    };
  } catch (error) {
    // The local database is only the same ledger when the call targeted the local
    // Gateway. A `--url` override or remote mode names another host, and answering that
    // question out of this filesystem would be a wrong answer rather than a fallback.
    if (!isGatewayLedgerUnavailableError(error) || !(await targetsLocalGateway(error))) {
      throw error;
    }
    return {
      result: readLocalUserActivityPage(params),
      localNotice: formatLocalLedgerNotice(error),
    };
  }
}
