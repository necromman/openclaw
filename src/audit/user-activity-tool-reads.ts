// Turns completed file-revealing tool calls into activity-ledger rows.
//
// Only completed calls are recorded: a blocked or failed call did not show anyone
// anything, and a ledger that cannot tell the difference answers the delivery question
// ("which materials did this person see") wrongly in the direction that matters.
//
// Attribution comes from the person whose question opened this turn, remembered when the
// Gateway proved their identity. A tool call whose session was never bound to a person -
// a cron run, a subagent started by the system - records nothing, because inventing an
// actor for it would be worse than the gap.
import type { TrustedToolExecutionEvent } from "../infra/diagnostic-events.js";
import { recordUserActivity } from "./user-activity-audit-recorder.js";
import { readSessionActivityActor } from "./user-activity-session-actors.js";

/** Project one tool execution event into the ledger. Returns whether a row was written. */
export function recordToolReadActivity(event: TrustedToolExecutionEvent): boolean {
  if (event.type !== "tool.execution.completed") {
    return false;
  }
  const readPaths = event.readPaths;
  if (!readPaths || readPaths.length === 0) {
    return false;
  }
  const actor = readSessionActivityActor(event.sessionKey);
  if (!actor) {
    return false;
  }
  return recordUserActivity({
    kind: "tool_read",
    actor,
    ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
    ...(event.agentId ? { agentId: event.agentId } : {}),
    detail: { toolName: event.toolName, paths: readPaths },
  });
}
