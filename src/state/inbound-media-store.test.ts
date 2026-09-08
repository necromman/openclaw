import { afterEach, describe, expect, it } from "vitest";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  INBOUND_MEDIA_LIST_MAX,
  getInboundMediaOwnership,
  listInboundMediaForProfile,
  listInboundMediaForSession,
  recordInboundMediaOwnership,
  softDeleteInboundMediaForSession,
} from "./inbound-media-store.js";
import { closeOpenClawAgentDatabasesForTest } from "./openclaw-agent-db.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

function record(overrides: Partial<Parameters<typeof recordInboundMediaOwnership>[0]> = {}) {
  recordInboundMediaOwnership({
    id: "m1",
    sessionKey: "agent:main:web",
    agentId: "main",
    profileId: "p1",
    originalName: "보고서.pdf",
    mime: "application/pdf",
    sizeBytes: 1234,
    createdAt: 1_000,
    ...overrides,
  });
}

describe("inbound media store", () => {
  it("records one attachment and reads it back by media id", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      record();
      expect(getInboundMediaOwnership("m1")).toEqual({
        id: "m1",
        sessionKey: "agent:main:web",
        agentId: "main",
        profileId: "p1",
        originalName: "보고서.pdf",
        mime: "application/pdf",
        sizeBytes: 1234,
        createdAt: 1_000,
      });
    });
  });

  it("keeps the first row when the same media id is persisted twice", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      record();
      record({ profileId: "p2", originalName: "다른.pdf" });
      expect(getInboundMediaOwnership("m1")?.profileId).toBe("p1");
    });
  });

  it("lists one person's attachments newest first and hides everyone else's", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      record({ id: "old", createdAt: 1 });
      record({ id: "new", createdAt: 2 });
      record({ id: "theirs", profileId: "p2", createdAt: 3 });
      expect(listInboundMediaForProfile({ profileId: "p1" }).map((row) => row.id)).toEqual([
        "new",
        "old",
      ]);
    });
  });

  it("matches the search argument against the original name, case-folded", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      record({ id: "a", originalName: "Quarterly Report.pdf" });
      record({ id: "b", originalName: "예산.xlsx" });
      expect(listInboundMediaForProfile({ profileId: "p1", search: "REPORT" }).map((r) => r.id)) //
        .toEqual(["a"]);
      expect(listInboundMediaForProfile({ profileId: "p1", search: "예산" }).map((r) => r.id)) //
        .toEqual(["b"]);
    });
  });

  it("lists by session when there is no account to attribute an upload to", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      record({ id: "mine", profileId: undefined, sessionKey: "agent:main:cli" });
      record({ id: "other", profileId: undefined, sessionKey: "agent:main:web" });
      expect(
        listInboundMediaForSession({ sessionKey: "agent:main:cli" }).map((row) => row.id),
      ).toEqual(["mine"]);
    });
  });

  it("clamps a listing to the tool ceiling by default", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      for (let index = 0; index < INBOUND_MEDIA_LIST_MAX + 5; index += 1) {
        record({ id: `m${index}`, createdAt: index });
      }
      expect(listInboundMediaForProfile({ profileId: "p1" })).toHaveLength(INBOUND_MEDIA_LIST_MAX);
    });
  });

  it("tombstones a deleted session's attachments without erasing the ownership fact", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      record({ id: "gone", sessionKey: "agent:main:web" });
      record({ id: "kept", sessionKey: "agent:main:cli" });
      expect(softDeleteInboundMediaForSession({ sessionKey: "agent:main:web", nowMs: 9_000 })).toBe(
        1,
      );
      expect(getInboundMediaOwnership("gone")).toMatchObject({
        profileId: "p1",
        deletedAt: 9_000,
      });
      expect(listInboundMediaForProfile({ profileId: "p1" }).map((row) => row.id)).toEqual([
        "kept",
      ]);
      // A second pass changes nothing: the tombstone is already set.
      expect(softDeleteInboundMediaForSession({ sessionKey: "agent:main:web", nowMs: 9_001 })).toBe(
        0,
      );
    });
  });
});
