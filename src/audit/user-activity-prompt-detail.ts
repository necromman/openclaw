// Projects a question into the shape the ledger stores.
//
// Its own module so a caller that only needs the projection - a formatter, a test - does
// not pull in the durable store behind the recorder.
import { createHash } from "node:crypto";

/** Longest question text stored when `promptText` is on. */
const MAX_PROMPT_TEXT_CHARS = 2_000;

export type PromptDetail = {
  chars: number;
  digest: string;
  text?: string;
  truncated?: true;
};

/**
 * Project a question into ledger detail.
 *
 * The digest is always present so two people asking the same thing can be correlated, and
 * so an operator can prove a specific question was asked without the ledger holding it.
 * The text itself appears only under the explicit `promptText` opt-in.
 */
export function projectPromptDetail(text: string, storeText: boolean): PromptDetail {
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 32);
  const detail: PromptDetail = { chars: text.length, digest };
  if (!storeText) {
    return detail;
  }
  const stored = text.length > MAX_PROMPT_TEXT_CHARS ? text.slice(0, MAX_PROMPT_TEXT_CHARS) : text;
  return {
    ...detail,
    text: stored,
    ...(stored.length < text.length ? { truncated: true as const } : {}),
  };
}
