import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserActivityRecordParams } from "../audit/user-activity-audit-recorder.js";
import type { GatewayClient } from "./server-methods/client-types.js";

const recorded: UserActivityRecordParams[] = [];

vi.mock("../audit/user-activity-audit-recorder.js", () => ({
  recordUserActivity: (params: UserActivityRecordParams) => {
    recorded.push(params);
    return true;
  },
}));

const { recordAccessDeniedActivity, recordFileDownloadActivity, recordSessionViewActivity } =
  await import("./session-view-activity-audit.js");

function signedInClient(): GatewayClient {
  return {
    clientIp: "10.0.0.5",
    internal: {
      ixAuthAuditActor: {
        profileId: "p1",
        email: "kim@example.com",
        displayName: "Kim",
        gatewayRole: "member",
        departments: ["dept-rnd"],
        isSuperAdmin: false,
      },
    },
  } as unknown as GatewayClient;
}

beforeEach(() => {
  recorded.length = 0;
});

describe("session view recording", () => {
  it("records a read of someone else's transcript with the person who made it", () => {
    recordSessionViewActivity({
      client: signedInClient(),
      sessionKey: "agent:main",
      agentId: "main",
      ownedByCaller: false,
      surface: "chat.history",
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      kind: "session_view",
      sessionKey: "agent:main",
      agentId: "main",
      remoteIp: "10.0.0.5",
      detail: { surface: "chat.history" },
      actor: { source: "profile", profileId: "p1", email: "kim@example.com" },
    });
  });

  it("records nothing when the reader owns the session", () => {
    // Reading your own transcript is the product working, not an audit event.
    recordSessionViewActivity({
      client: signedInClient(),
      sessionKey: "agent:main",
      ownedByCaller: true,
      surface: "chat.history",
    });
    expect(recorded).toHaveLength(0);
  });

  it("records a refusal with the reason the boundary gave", () => {
    recordAccessDeniedActivity({
      client: signedInClient(),
      sessionKey: "agent:qa",
      agentId: "qa-bot",
      reason: "department",
      surface: "chat.history",
    });
    expect(recorded[0]).toMatchObject({
      kind: "access_denied",
      detail: { reason: "department", surface: "chat.history" },
    });
  });

  it("records a file the person opened, with its path", () => {
    recordFileDownloadActivity({
      client: signedInClient(),
      sessionKey: "agent:main",
      agentId: "main",
      path: "/mnt/nas/rnd/spec.pdf",
      preview: true,
    });
    expect(recorded[0]).toMatchObject({
      kind: "file_download",
      detail: { path: "/mnt/nas/rnd/spec.pdf", preview: true },
    });
  });

  it("attributes a chat-channel sender under its own source", () => {
    const client = {
      internal: { senderAttribution: { id: "telegram:4242", name: "Kim" } },
    } as unknown as GatewayClient;
    recordSessionViewActivity({
      client,
      sessionKey: "agent:main",
      ownedByCaller: false,
      surface: "chat.history",
    });
    expect(recorded[0]?.actor).toMatchObject({
      source: "channel",
      email: "telegram:4242",
      displayName: "Kim",
    });
  });

  it("attributes a connection that proved no account to the host operator", () => {
    recordSessionViewActivity({
      client: null,
      sessionKey: "agent:main",
      ownedByCaller: false,
      surface: "transcript-http",
    });
    expect(recorded[0]?.actor).toEqual({ source: "operator" });
  });
});
