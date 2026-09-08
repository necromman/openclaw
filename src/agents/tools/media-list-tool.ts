/**
 * media_list built-in tool.
 *
 * Lists the files the person in this conversation attached to chat, so a later turn - or a
 * later conversation - can reach an upload the model's window no longer holds. Scope is
 * decided by the server from the session, never from a tool argument: the session's own
 * account, inside the department its agent belongs to.
 */
import { Type } from "typebox";
import { INBOUND_MEDIA_LIST_MAX } from "../../state/inbound-media-store.js";
import { MEDIA_REFERENCE_TOOL_HINT } from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import {
  asToolParamsRecord,
  jsonResult,
  readPositiveIntegerParam,
  readToolStringParam,
} from "./common.js";
import { getGatewayToolCallerIdentity } from "./gateway-caller-context.js";
import {
  listReferenceableInboundMedia,
  resolveMediaReferenceContext,
} from "./media-reference-context.js";

const MediaListToolSchema = Type.Object(
  {
    search: Type.Optional(
      Type.String({
        description: "Case-insensitive substring of the original file name.",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: INBOUND_MEDIA_LIST_MAX,
        description: `Maximum rows to return (default and ceiling ${INBOUND_MEDIA_LIST_MAX}).`,
      }),
    ),
  },
  { additionalProperties: false },
);

const MediaListOutputSchema = Type.Object(
  {
    scope: Type.Union([Type.Literal("profile"), Type.Literal("session"), Type.Literal("none")]),
    count: Type.Integer({ minimum: 0 }),
    attachments: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          name: Type.String(),
          mime: Type.String(),
          sizeBytes: Type.Integer({ minimum: 0 }),
          uploadedAt: Type.String(),
          sessionKey: Type.Optional(Type.String()),
          agentId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const MEDIA_LIST_TOOL_DESCRIPTION =
  "List files the user attached to chat, newest first: id, original name, type, size, upload time, conversation and agent. " +
  `Optional 'search' matches the file name; at most ${INBOUND_MEDIA_LIST_MAX} rows. ` +
  MEDIA_REFERENCE_TOOL_HINT;

export function createMediaListTool(opts?: {
  agentSessionKey?: string;
  agentId?: string;
}): AnyAgentTool {
  return {
    label: "Attachments",
    name: "media_list",
    description: MEDIA_LIST_TOOL_DESCRIPTION,
    parameters: MediaListToolSchema,
    outputSchema: MediaListOutputSchema,
    execute: async (_toolCallId, rawArgs) => {
      const params = asToolParamsRecord(rawArgs);
      const caller = getGatewayToolCallerIdentity();
      const context = await resolveMediaReferenceContext({
        ...((opts?.agentSessionKey ?? caller?.sessionKey)
          ? { sessionKey: opts?.agentSessionKey ?? caller?.sessionKey }
          : {}),
        ...((opts?.agentId ?? caller?.agentId)
          ? { agentId: opts?.agentId ?? caller?.agentId }
          : {}),
      });
      const search = readToolStringParam(params, "search");
      const limit =
        readPositiveIntegerParam(params, "limit", { max: INBOUND_MEDIA_LIST_MAX }) ??
        INBOUND_MEDIA_LIST_MAX;
      const attachments = await listReferenceableInboundMedia({
        context,
        ...(search ? { search } : {}),
        limit,
      });
      const scope = context.profileId ? "profile" : context.sessionKey ? "session" : "none";
      return jsonResult({ scope, count: attachments.length, attachments });
    },
  };
}
