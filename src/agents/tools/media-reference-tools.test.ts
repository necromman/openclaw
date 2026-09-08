import { afterEach, describe, expect, it } from "vitest";
import { saveMediaBuffer } from "../../media/store.js";
import { setDepartmentAgent } from "../../state/departments-store.js";
import { recordInboundMediaOwnership } from "../../state/inbound-media-store.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import { withOpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { createMediaListTool } from "./media-list-tool.js";
import { createMediaReadTool } from "./media-read-tool.js";
import {
  listReferenceableInboundMedia,
  resolveReferenceableInboundMedia,
  type MediaReferenceContext,
} from "./media-reference-context.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

const SESSION_KEY = "agent:rnd-bot:web";

function context(overrides: Partial<MediaReferenceContext> = {}): MediaReferenceContext {
  return {
    sessionKey: SESSION_KEY,
    agentId: "rnd-bot",
    profileId: "owner",
    departmentSlug: "rnd",
    ownershipEnforced: true,
    ...overrides,
  };
}

function recordUpload(overrides: Partial<Parameters<typeof recordInboundMediaOwnership>[0]> = {}) {
  recordInboundMediaOwnership({
    id: "att-1",
    sessionKey: SESSION_KEY,
    agentId: "rnd-bot",
    profileId: "owner",
    originalName: "spec.pdf",
    mime: "application/pdf",
    sizeBytes: 10,
    createdAt: 1,
    ...overrides,
  });
}

describe("attachment reference scope", () => {
  it("lists only the caller's own uploads", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload({ id: "mine" });
      recordUpload({ id: "theirs", profileId: "someone-else" });
      const listed = await listReferenceableInboundMedia({ context: context(), limit: 50 });
      expect(listed.map((row) => row.id)).toEqual(["mine"]);
    });
  });

  it("drops uploads made on an agent in another department", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "rnd", nowMs: 1 });
      setDepartmentAgent({ agentId: "qa-bot", departmentSlug: "qa", nowMs: 1 });
      recordUpload({ id: "here" });
      recordUpload({ id: "elsewhere", agentId: "qa-bot", sessionKey: "agent:qa-bot:web" });
      const listed = await listReferenceableInboundMedia({ context: context(), limit: 50 });
      expect(listed.map((row) => row.id)).toEqual(["here"]);
    });
  });

  it("answers one id with the same refusal whoever it belongs to", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload({ id: "theirs", profileId: "someone-else" });
      expect(await resolveReferenceableInboundMedia({ context: context(), id: "theirs" })).toEqual({
        ok: false,
        denial: "other-owner",
      });
      expect(await resolveReferenceableInboundMedia({ context: context(), id: "ghost" })).toEqual({
        ok: false,
        denial: "not-found",
      });
    });
  });

  it("stops offering an attachment whose session was deleted", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordInboundMediaOwnership({
        id: "gone",
        sessionKey: SESSION_KEY,
        agentId: "rnd-bot",
        profileId: "owner",
        mime: "application/pdf",
        sizeBytes: 1,
        createdAt: 1,
      });
      const { softDeleteInboundMediaForSession } = await import(
        "../../state/inbound-media-store.js"
      );
      softDeleteInboundMediaForSession({ sessionKey: SESSION_KEY, nowMs: 5 });
      expect(await resolveReferenceableInboundMedia({ context: context(), id: "gone" })).toEqual({
        ok: false,
        denial: "deleted",
      });
    });
  });

  it("falls back to the conversation when no account owns the upload", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload({ id: "same-chat", profileId: undefined });
      recordUpload({ id: "other-chat", profileId: undefined, sessionKey: "agent:rnd-bot:cli" });
      const anonymous = context({ profileId: undefined, ownershipEnforced: false });
      const listed = await listReferenceableInboundMedia({ context: anonymous, limit: 50 });
      expect(listed.map((row) => row.id)).toEqual(["same-chat"]);
    });
  });
});

describe("media_list and media_read tools", () => {
  it("reports the caller's attachments through media_list", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload({ id: "att-a", profileId: undefined, originalName: "예산.txt" });
      const tool = createMediaListTool({ agentSessionKey: SESSION_KEY, agentId: "rnd-bot" });
      const result = await tool.execute("call-1", {});
      const details = result.details as { scope: string; count: number };
      expect(details.scope).toBe("session");
      expect(details.count).toBe(1);
    });
  });

  it("filters media_list by the search argument", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload({ id: "att-a", profileId: undefined, originalName: "예산.txt" });
      recordUpload({ id: "att-b", profileId: undefined, originalName: "notes.txt" });
      const tool = createMediaListTool({ agentSessionKey: SESSION_KEY, agentId: "rnd-bot" });
      const result = await tool.execute("call-1", { search: "notes" });
      expect((result.details as { count: number }).count).toBe(1);
    });
  });

  it("returns extracted text through media_read", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const saved = await saveMediaBuffer(
        Buffer.from("품질 보고서 본문", "utf8"),
        "text/plain",
        "inbound",
        undefined,
        "보고서.txt",
      );
      recordUpload({
        id: saved.id,
        profileId: undefined,
        originalName: "보고서.txt",
        mime: "text/plain",
        sizeBytes: saved.size,
      });
      const tool = createMediaReadTool({ agentSessionKey: SESSION_KEY, agentId: "rnd-bot" });
      const result = await tool.execute("call-1", { id: saved.id });
      expect((result.details as { status: string }).status).toBe("ok");
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect(JSON.stringify(result.content)).toContain("품질 보고서 본문");
    });
  });

  it("refuses media_read for an attachment owned by another conversation", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload({ id: "att-x", profileId: undefined, sessionKey: "agent:rnd-bot:cli" });
      const tool = createMediaReadTool({ agentSessionKey: SESSION_KEY, agentId: "rnd-bot" });
      const result = await tool.execute("call-1", { id: "att-x" });
      expect((result.details as { status: string }).status).toBe("not-found");
    });
  });
});
