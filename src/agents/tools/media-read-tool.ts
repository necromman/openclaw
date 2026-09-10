/**
 * media_read built-in tool.
 *
 * Opens one file the person in this conversation attached to chat and hands it back as
 * model input: an image as an image block, a document as extracted text. It is the second
 * half of `media_list`, and it applies the same server-decided scope - the session's own
 * account, inside the department its agent belongs to - so naming somebody else's id
 * returns "not found" rather than their file.
 *
 * Text extraction reuses the knowledge indexer's converter, so a PDF, Word, Excel,
 * PowerPoint or Hangul file reads here exactly as it reads in the document index,
 * including the LibreOffice hop, the built-in Hangul reader, and the CP949 fallback for
 * legacy Korean text files.
 */
import { Type } from "typebox";
import { createLazyRuntimeModule } from "../../shared/lazy-runtime.js";
import { MEDIA_REFERENCE_TOOL_HINT } from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import {
  asToolParamsRecord,
  imageResultFromFile,
  readToolStringParam,
  textResult,
} from "./common.js";
import { getGatewayToolCallerIdentity } from "./gateway-caller-context.js";
import {
  resolveMediaReferenceContext,
  resolveReferenceableInboundMedia,
  type MediaReferenceEntry,
} from "./media-reference-context.js";

const getMediaStoreModule = createLazyRuntimeModule(() => import("../../media/store.js"));
const getKnowledgeConvertModule = createLazyRuntimeModule(
  () => import("../../knowledge/convert.js"),
);

/** Ceiling on the bytes this tool will read from the media store for one call. */
const MEDIA_READ_MAX_BYTES = 20 * 1024 * 1024;

/** Ceiling on the characters handed back to the model after extraction. */
const MEDIA_READ_MAX_CHARS = 60_000;

const MediaReadToolSchema = Type.Object(
  {
    id: Type.String({ description: "Attachment id from media_list." }),
  },
  { additionalProperties: false },
);

const MEDIA_READ_TOOL_DESCRIPTION =
  "Open one attachment the user uploaded, by the id media_list reported. Images return as images; PDF, Word, Excel, PowerPoint, Hangul (hwp, hwpx) and text return as extracted text. " +
  `Reads at most ${Math.round(MEDIA_READ_MAX_BYTES / (1024 * 1024))} MB and returns at most ${MEDIA_READ_MAX_CHARS} characters. ` +
  MEDIA_REFERENCE_TOOL_HINT;

function describeEntry(entry: MediaReferenceEntry): string {
  return `${entry.name} (${entry.mime}, ${entry.sizeBytes} bytes, uploaded ${entry.uploadedAt})`;
}

function extensionOf(entry: MediaReferenceEntry): string {
  const match = /\.([a-z0-9]{1,16})$/i.exec(entry.name);
  return match?.[1]?.toLowerCase() ?? "";
}

function truncateForModel(body: string): { text: string; truncated: boolean } {
  return body.length <= MEDIA_READ_MAX_CHARS
    ? { text: body, truncated: false }
    : { text: body.slice(0, MEDIA_READ_MAX_CHARS), truncated: true };
}

export function createMediaReadTool(opts?: {
  agentSessionKey?: string;
  agentId?: string;
}): AnyAgentTool {
  return {
    label: "Attachment",
    name: "media_read",
    description: MEDIA_READ_TOOL_DESCRIPTION,
    parameters: MediaReadToolSchema,
    execute: async (_toolCallId, rawArgs) => {
      const params = asToolParamsRecord(rawArgs);
      const id = readToolStringParam(params, "id", { required: true });
      const caller = getGatewayToolCallerIdentity();
      const context = await resolveMediaReferenceContext({
        ...((opts?.agentSessionKey ?? caller?.sessionKey)
          ? { sessionKey: opts?.agentSessionKey ?? caller?.sessionKey }
          : {}),
        ...((opts?.agentId ?? caller?.agentId)
          ? { agentId: opts?.agentId ?? caller?.agentId }
          : {}),
      });
      const resolved = await resolveReferenceableInboundMedia({ context, id });
      if (!resolved.ok) {
        // One answer for every refusal: an id that belongs to another person must not be
        // distinguishable from one that never existed.
        return textResult(`Attachment not found: ${id}`, {
          status: "not-found",
          id,
          reason: resolved.denial,
        });
      }
      const entry = resolved.entry;
      const store = await getMediaStoreModule();
      if (entry.sizeBytes > MEDIA_READ_MAX_BYTES) {
        return textResult(
          `Attachment too large to open: ${describeEntry(entry)}. Limit is ${MEDIA_READ_MAX_BYTES} bytes.`,
          { status: "too-large", ...entry },
        );
      }
      if (entry.mime.startsWith("image/")) {
        const path = await store.resolveMediaBufferPath(entry.id, "inbound");
        return await imageResultFromFile({
          label: "media_read",
          path,
          extraText: `Attachment ${describeEntry(entry)}`,
          details: { id: entry.id, name: entry.name, media: { outbound: false } },
        });
      }
      const { buffer } = await store.readMediaBuffer(entry.id, "inbound", MEDIA_READ_MAX_BYTES);
      const converted = await (
        await getKnowledgeConvertModule()
      ).convertKnowledgeSource({ buffer, extension: extensionOf(entry) });
      if (!converted.ok) {
        return textResult(
          `Attachment ${describeEntry(entry)}: text extraction unavailable (${converted.reason}).`,
          { status: "no-text", reason: converted.reason, ...entry },
        );
      }
      const { text, truncated } = truncateForModel(converted.body);
      const header = `Attachment ${describeEntry(entry)}${truncated ? ", truncated" : ""}:`;
      return textResult(`${header}\n\n${text}`, {
        status: "ok",
        truncated,
        converter: converted.converter,
        ...entry,
      });
    },
  };
}
