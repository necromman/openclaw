// Records "who asked what" at the one point where the question, the session, the agent,
// and the caller that proved an identity are all resolved.
//
// The person is also remembered against the session here, so the tool calls this turn
// triggers can say whose reading they were. That binding is made where the identity was
// proven; nothing downstream re-derives a person from a session key.

import { isPromptTextRecorded, recordUserActivity } from "../audit/user-activity-audit-recorder.js";
import { projectPromptDetail } from "../audit/user-activity-prompt-detail.js";
import { rememberSessionActivityActor } from "../audit/user-activity-session-actors.js";
import { clientActivityActor } from "./ix-auth-audit-actor.js";
import type { GatewayClient } from "./server-methods/client-types.js";

/** Record one admitted question. Gateway-authored input records nothing. */
export function recordChatSendActivity(params: {
  client: GatewayClient | null;
  sessionKey: string;
  agentId: string;
  message: string;
  trustedSystemInput: boolean;
}): void {
  if (params.trustedSystemInput) {
    return;
  }
  const actor = clientActivityActor(params.client);
  rememberSessionActivityActor(params.sessionKey, actor);
  recordUserActivity({
    kind: "prompt",
    actor,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    detail: projectPromptDetail(params.message, isPromptTextRecorded()),
    ...(params.client?.clientIp ? { remoteIp: params.client.clientIp } : {}),
  });
}
