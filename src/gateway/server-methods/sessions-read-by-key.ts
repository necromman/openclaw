import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { validateSessionsDescribeParams } from "../../../packages/gateway-protocol/src/index.js";
import type { SessionEntry } from "../../config/sessions.js";
import { prepareDepartmentGate } from "../department-access.js";
import { hasOperatorBoundary } from "../operator-role-policy.js";
import { resolveRequestedSessionAgentId as resolveRequestedGlobalAgentId } from "../session-request-agent.js";
import { createSessionListEntryFilter, prepareSessionSharing } from "../session-sharing.js";
import { readRecentSessionMessagesWithStatsAsync } from "../session-transcript-readers.js";
import { buildGatewaySessionRow } from "../session-utils.js";
import { readSessionPlacementFields } from "./session-placement-read-projection.js";
import { loadSessionEntriesForTarget, requireSessionKey } from "./sessions-shared.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

/**
 * Row predicate for a directly addressed session.
 *
 * The department verdict is folded in here so knowing a session key is not enough to
 * read one: the list hides it and this refuses it, which are the two halves the fence
 * needs to be real.
 */
function createRoleVisibilityFilter(
  client: Parameters<typeof hasOperatorBoundary>[0],
  cfg: Parameters<typeof hasOperatorBoundary>[1],
) {
  const boundaryFilter = hasOperatorBoundary(client, cfg)
    ? createSessionListEntryFilter({ client, cfg })
    : undefined;
  const departmentGate = prepareDepartmentGate({ cfg, client });
  if (!boundaryFilter && !departmentGate) {
    return undefined;
  }
  const isCreator = prepareSessionSharing({ client, cfg }).isCreator;
  return (
    agentId: string,
    key: string,
    entry: Pick<SessionEntry, "createdActor" | "visibility" | "incognito"> | undefined,
  ): boolean => {
    if (!entry) {
      return true;
    }
    const access = departmentGate?.agentAccess(agentId) ?? "open";
    if (access === "denied" || (access === "creator-only" && !isCreator(entry.createdActor))) {
      return false;
    }
    return boundaryFilter?.(key, entry) !== false;
  };
}

export const sessionByKeyReadHandlers: GatewayRequestHandlers = {
  "sessions.describe": ({ params, respond, context, client }) => {
    if (!assertValidParams(params, validateSessionsDescribeParams, "sessions.describe", respond)) {
      return;
    }
    const key = requireSessionKey(params.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { target, storePath, store, entry } = loadSessionEntriesForTarget({
      key,
      cfg,
      ...(requestedAgent.agentId ? { agentId: requestedAgent.agentId } : {}),
    });
    const boundaryFilter = createRoleVisibilityFilter(client, cfg);
    if (!entry || boundaryFilter?.(target.agentId, target.canonicalKey, entry) === false) {
      respond(true, { session: null }, undefined);
      return;
    }
    const row = buildGatewaySessionRow({
      cfg,
      storePath,
      store,
      key: target.canonicalKey,
      entry,
      agentId: target.agentId,
      includeDerivedTitles: params.includeDerivedTitles,
      includeLastMessage: params.includeLastMessage,
      transcriptUsageMaxBytes: 64 * 1024,
    });
    Object.assign(row, readSessionPlacementFields(context, row.sessionId));
    respond(true, { session: row });
  },
  "sessions.get": async ({ params, respond, context, client }) => {
    // SAFETY: Gateway dispatch supplies object params; each optional field is narrowed before use.
    const p = params as {
      key?: unknown;
      sessionKey?: unknown;
      limit?: unknown;
      agentId?: unknown;
    };
    const key = requireSessionKey(p.key ?? p.sessionKey, respond);
    if (!key) {
      return;
    }
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit)
        ? Math.max(1, Math.floor(p.limit))
        : 200;

    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(
      cfg,
      key,
      normalizeOptionalString(p.agentId),
    );
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { target, storePath, entry } = loadSessionEntriesForTarget({
      key,
      cfg,
      agentId: requestedAgent.agentId,
    });
    const boundaryFilter = createRoleVisibilityFilter(client, cfg);
    if (
      !entry?.sessionId ||
      boundaryFilter?.(target.agentId, target.canonicalKey, entry) === false
    ) {
      respond(true, { messages: [] }, undefined);
      return;
    }
    const sessionId = entry.sessionId;
    const { messages } = await readRecentSessionMessagesWithStatsAsync(
      {
        agentId: target.agentId,
        sessionEntry: entry,
        sessionId,
        sessionKey: target.canonicalKey,
        storePath,
      },
      {
        maxMessages: limit,
        maxLines: limit * 20 + 20,
        allowResetArchiveFallback: true,
      },
    );
    const currentCfg = context.getRuntimeConfig();
    const currentRequestedAgent = resolveRequestedGlobalAgentId(
      currentCfg,
      key,
      normalizeOptionalString(p.agentId),
    );
    const current = currentRequestedAgent.ok
      ? loadSessionEntriesForTarget({
          key,
          cfg: currentCfg,
          agentId: currentRequestedAgent.agentId,
        })
      : null;
    const currentBoundaryFilter = createRoleVisibilityFilter(client, currentCfg);
    if (
      !current ||
      current.target.agentId !== target.agentId ||
      current.target.canonicalKey !== target.canonicalKey ||
      current.storePath !== storePath ||
      current.entry?.sessionId !== sessionId ||
      currentBoundaryFilter?.(
        current.target.agentId,
        current.target.canonicalKey,
        current.entry,
      ) === false
    ) {
      respond(true, { messages: [] }, undefined);
      return;
    }
    respond(true, { messages }, undefined);
  },
};
