import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { saveMediaBuffer } from "../media/store.js";
import { setDepartmentAgent } from "../state/departments-store.js";
import { recordInboundMediaOwnership } from "../state/inbound-media-store.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  authorizeInboundMediaRead,
  isInboundMediaOwnershipEnforced,
  readInboundMediaIdFromSource,
} from "./inbound-media-access.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

function ixAuthConfig(): OpenClawConfig {
  return {
    gateway: { auth: { mode: "ix-auth" } },
    tools: { sessions: { visibility: "department" } },
  } as OpenClawConfig;
}

function recordUpload(overrides: Partial<Parameters<typeof recordInboundMediaOwnership>[0]> = {}) {
  recordInboundMediaOwnership({
    id: "att-1",
    sessionKey: "agent:rnd-bot:web",
    agentId: "rnd-bot",
    profileId: "owner",
    originalName: "spec.pdf",
    mime: "application/pdf",
    sizeBytes: 10,
    createdAt: 1,
    ...overrides,
  });
}

describe("inbound media access", () => {
  it("applies only where identity is delegated", () => {
    expect(isInboundMediaOwnershipEnforced(ixAuthConfig())).toBe(true);
    expect(isInboundMediaOwnershipEnforced({ gateway: { auth: { mode: "token" } } })).toBe(false);
    expect(isInboundMediaOwnershipEnforced(undefined)).toBe(false);
  });

  it("leaves a shared-secret deployment exactly as it was", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const decision = authorizeInboundMediaRead({
        cfg: { gateway: { auth: { mode: "token" } } } as OpenClawConfig,
        mediaId: "never-recorded",
        reader: {},
      });
      expect(decision.allowed).toBe(true);
    });
  });

  it("refuses an attachment that has no ownership row", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const decision = authorizeInboundMediaRead({
        cfg: ixAuthConfig(),
        mediaId: "legacy-file",
        reader: { profileId: "someone", departments: { departments: [], isSuperAdmin: false } },
      });
      expect(decision).toMatchObject({ allowed: false, reason: "no-ownership-record" });
    });
  });

  it("lets a super administrator reach a legacy attachment", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const decision = authorizeInboundMediaRead({
        cfg: ixAuthConfig(),
        mediaId: "legacy-file",
        reader: { profileId: "root", departments: { departments: [], isSuperAdmin: true } },
      });
      expect(decision.allowed).toBe(true);
    });
  });

  it("lets the uploader read their own attachment", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload();
      const decision = authorizeInboundMediaRead({
        cfg: ixAuthConfig(),
        mediaId: "att-1",
        reader: { profileId: "owner", departments: { departments: ["rnd"], isSuperAdmin: false } },
      });
      expect(decision.allowed).toBe(true);
    });
  });

  it("hides an attachment from another department, administrator or not", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "rnd", nowMs: 1 });
      recordUpload();
      for (const isGatewayAdmin of [false, true]) {
        const decision = authorizeInboundMediaRead({
          cfg: ixAuthConfig(),
          mediaId: "att-1",
          reader: {
            profileId: "outsider",
            departments: { departments: ["qa"], isSuperAdmin: false },
            isGatewayAdmin,
          },
        });
        expect(decision).toMatchObject({ allowed: false, reason: "department-boundary" });
      }
    });
  });

  it("lets an administrator of the same department read a colleague's attachment", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setDepartmentAgent({ agentId: "rnd-bot", departmentSlug: "rnd", nowMs: 1 });
      recordUpload();
      const decision = authorizeInboundMediaRead({
        cfg: ixAuthConfig(),
        mediaId: "att-1",
        reader: {
          profileId: "rnd-admin",
          departments: { departments: ["rnd"], isSuperAdmin: false },
          isGatewayAdmin: true,
        },
      });
      expect(decision.allowed).toBe(true);
    });
  });

  it("refuses a caller that proved no account", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload();
      const decision = authorizeInboundMediaRead({
        cfg: ixAuthConfig(),
        mediaId: "att-1",
        reader: { departments: { departments: ["rnd"], isSuperAdmin: false } },
      });
      expect(decision).toMatchObject({ allowed: false, reason: "no-reader-profile" });
    });
  });

  it("refuses a colleague whose session view does not reach that conversation", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      recordUpload();
      const decision = authorizeInboundMediaRead({
        cfg: ixAuthConfig(),
        mediaId: "att-1",
        reader: {
          profileId: "colleague",
          departments: { departments: ["rnd"], isSuperAdmin: false },
        },
      });
      expect(decision).toMatchObject({ allowed: false, reason: "session-visibility" });
    });
  });

  it("reads the attachment id from the URI and from the stored path alike", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const saved = await saveMediaBuffer(Buffer.from("hello"), "text/plain", "inbound");
      // The same file is reachable both ways, so a gate that understood only the URI form
      // would be bypassed by the path form.
      expect(await readInboundMediaIdFromSource(`media://inbound/${saved.id}`)).toBe(saved.id);
      expect(await readInboundMediaIdFromSource(saved.path)).toBe(saved.id);
      expect(await readInboundMediaIdFromSource("media://inbound/../escape")).toBeUndefined();
      expect(await readInboundMediaIdFromSource("/workspace/notes.md")).toBeUndefined();
    });
  });
});
