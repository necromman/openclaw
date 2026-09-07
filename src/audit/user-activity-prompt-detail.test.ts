import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { projectPromptDetail } from "./user-activity-prompt-detail.js";

describe("prompt projection", () => {
  it("records only the shape of a question by default", () => {
    const detail = projectPromptDetail("어떤 자료가 있나요?", false);
    expect(detail.text).toBeUndefined();
    expect(detail.chars).toBe("어떤 자료가 있나요?".length);
    expect(detail.digest).toBe(
      createHash("sha256").update("어떤 자료가 있나요?").digest("hex").slice(0, 32),
    );
  });

  it("records the question itself once the deployment opts in", () => {
    expect(projectPromptDetail("hello", true)).toMatchObject({ text: "hello", chars: 5 });
  });

  it("keeps the same digest whether or not the text is stored", () => {
    // The digest is what proves a specific question was asked without holding it, so it
    // must not depend on the storage decision.
    expect(projectPromptDetail("hello", true).digest).toBe(
      projectPromptDetail("hello", false).digest,
    );
  });

  it("bounds a very long question and says it did", () => {
    const detail = projectPromptDetail("x".repeat(5_000), true);
    expect(detail.text).toHaveLength(2_000);
    expect(detail.truncated).toBe(true);
    expect(detail.chars).toBe(5_000);
  });

  it("does not mark a question that fit as truncated", () => {
    expect(projectPromptDetail("short", true).truncated).toBeUndefined();
  });
});
