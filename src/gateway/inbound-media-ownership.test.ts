import { afterEach, describe, expect, it } from "vitest";
import { getInboundMediaOwnership } from "../state/inbound-media-store.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import { recordChatSendInboundMediaOwnership } from "./inbound-media-ownership.js";
import type { GatewayClient } from "./server-methods/client-types.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

type OwnershipClient = Parameters<typeof recordChatSendInboundMediaOwnership>[0]["client"];

function ixAuthClient(profileId: string): OwnershipClient {
  return {
    internal: { ixAuthAuditActor: { profileId, email: "who@example.test", departments: [] } },
  } as unknown as Pick<GatewayClient, "internal" | "authenticatedUserProfile">;
}

const IMAGE_ENTRY = {
  id: "img-1",
  path: "/media/inbound/img-1.png",
  sourceIndex: 0,
  imageKind: "inline" as const,
  originalName: "화면.png",
  fact: { url: "media://inbound/img-1.png", contentType: "image/png", sizeBytes: 12 },
};

const DOCUMENT_ENTRY = {
  id: "doc-1",
  path: "/media/inbound/doc-1.pdf",
  sourceIndex: 1,
  originalName: "보고서.pdf",
  fact: { url: "media://inbound/doc-1.pdf", contentType: "application/pdf", sizeBytes: 345 },
};

describe("chat send attachment ownership", () => {
  it("records both an inline image and an offloaded document", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordChatSendInboundMediaOwnership({
        entries: [IMAGE_ENTRY, DOCUMENT_ENTRY],
        client: ixAuthClient("p-1"),
        sessionKey: "agent:main:web",
        agentId: "main",
        nowMs: 500,
      });
      expect(getInboundMediaOwnership("img-1")).toEqual({
        id: "img-1",
        sessionKey: "agent:main:web",
        agentId: "main",
        profileId: "p-1",
        originalName: "화면.png",
        mime: "image/png",
        sizeBytes: 12,
        createdAt: 500,
      });
      expect(getInboundMediaOwnership("doc-1")).toMatchObject({
        mime: "application/pdf",
        originalName: "보고서.pdf",
        sizeBytes: 345,
      });
    });
  });

  it("still records the upload when no account proved itself", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordChatSendInboundMediaOwnership({
        entries: [DOCUMENT_ENTRY],
        client: null,
        sessionKey: "agent:main:cli",
        agentId: "main",
        nowMs: 7,
      });
      // No profile means only the conversation owns it; the row still has to exist so the
      // read gate can tell "nobody's file" from "a file that predates the table".
      const row = getInboundMediaOwnership("doc-1");
      expect(row).toMatchObject({ sessionKey: "agent:main:cli" });
      expect(row).not.toHaveProperty("profileId");
    });
  });

  it("writes nothing when the turn carried no attachment", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordChatSendInboundMediaOwnership({ entries: [], client: null, sessionKey: "agent:main:x" });
      expect(getInboundMediaOwnership("img-1")).toBeUndefined();
    });
  });
});
