import { afterEach, describe, expect, it } from "vitest";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import { closeOpenClawAgentDatabasesForTest } from "./openclaw-agent-db.js";
import {
  appendUserActivityAuditEvent,
  listUserActivityAuditEvents,
  pruneUserActivityAuditEvents,
} from "./user-activity-audit-store.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

const DAY_MS = 24 * 60 * 60_000;

function appendLogin(params: {
  at: number;
  email: string;
  departments?: string[];
  profileId?: string;
}) {
  appendUserActivityAuditEvent({
    at: params.at,
    kind: "login",
    actor: {
      source: "profile",
      profileId: params.profileId ?? `profile-${params.email}`,
      email: params.email,
      gatewayRole: "member",
      departments: params.departments ?? [],
    },
  });
}

describe("user activity audit store", () => {
  it("reads an empty page without creating the table", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      expect(listUserActivityAuditEvents({ limit: 10 })).toEqual({ entries: [] });
      // A read must not be what installs the ledger, so a prune still finds nothing.
      expect(
        pruneUserActivityAuditEvents({ now: 0, retentionMs: DAY_MS, maxRows: 10 }),
      ).toBe(0);
    });
  });

  it("round-trips one row with its actor and detail", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendUserActivityAuditEvent({
        at: 1_000,
        kind: "prompt",
        actor: {
          source: "profile",
          profileId: "p1",
          email: "kim@example.com",
          displayName: "Kim",
          gatewayRole: "member",
          departments: ["dept-rnd"],
        },
        sessionKey: "agent:main",
        agentId: "main",
        detail: { chars: 12, digest: "abc" },
        remoteIp: "10.0.0.2",
      });
      const page = listUserActivityAuditEvents({ limit: 10 });
      expect(page.entries).toHaveLength(1);
      expect(page.entries[0]).toMatchObject({
        at: 1_000,
        kind: "prompt",
        actorSource: "profile",
        profileId: "p1",
        email: "kim@example.com",
        displayName: "Kim",
        gatewayRole: "member",
        departments: ["dept-rnd"],
        sessionKey: "agent:main",
        agentId: "main",
        detail: { chars: 12, digest: "abc" },
        remoteIp: "10.0.0.2",
      });
    });
  });

  it("returns newest first and pages by cursor", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendLogin({ at: 1, email: "a@example.com" });
      appendLogin({ at: 2, email: "b@example.com" });
      appendLogin({ at: 3, email: "c@example.com" });
      const first = listUserActivityAuditEvents({ limit: 2 });
      expect(first.entries.map((entry) => entry.email)).toEqual(["c@example.com", "b@example.com"]);
      expect(first.nextCursor).toBeDefined();
      const second = listUserActivityAuditEvents({ limit: 2, cursor: first.nextCursor });
      expect(second.entries.map((entry) => entry.email)).toEqual(["a@example.com"]);
      expect(second.nextCursor).toBeUndefined();
    });
  });

  it("filters by person, kind and time window", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendLogin({ at: 10, email: "a@example.com" });
      appendUserActivityAuditEvent({
        at: 20,
        kind: "file_download",
        actor: { source: "profile", profileId: "p2", email: "b@example.com" },
        detail: { path: "/mnt/nas/rnd/spec.pdf" },
      });
      expect(
        listUserActivityAuditEvents({ limit: 10, filters: { email: "b@example.com" } }).entries,
      ).toHaveLength(1);
      expect(
        listUserActivityAuditEvents({ limit: 10, filters: { kind: "login" } }).entries,
      ).toHaveLength(1);
      expect(
        listUserActivityAuditEvents({ limit: 10, filters: { from: 15, to: 25 } }).entries.map(
          (entry) => entry.kind,
        ),
      ).toEqual(["file_download"]);
    });
  });

  it("keeps only rows whose actor shares a department with the reader", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendLogin({ at: 1, email: "rnd@example.com", departments: ["dept-rnd"] });
      appendLogin({ at: 2, email: "qa@example.com", departments: ["dept-qa"] });
      appendLogin({ at: 3, email: "nobody@example.com" });
      const page = listUserActivityAuditEvents({
        limit: 10,
        filters: { departments: ["dept-rnd"] },
      });
      expect(page.entries.map((entry) => entry.email)).toEqual(["rnd@example.com"]);
    });
  });

  it("deletes rows past the retention window", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const now = 100 * DAY_MS;
      appendLogin({ at: now - 91 * DAY_MS, email: "old@example.com" });
      appendLogin({ at: now - 1_000, email: "new@example.com" });
      expect(
        pruneUserActivityAuditEvents({ now, retentionMs: 90 * DAY_MS, maxRows: 1_000 }),
      ).toBe(1);
      expect(listUserActivityAuditEvents({ limit: 10 }).entries.map((entry) => entry.email)).toEqual(
        ["new@example.com"],
      );
    });
  });

  it("drops the oldest rows once the row cap is exceeded", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      for (const index of [1, 2, 3, 4]) {
        appendLogin({ at: index, email: `p${index}@example.com` });
      }
      expect(pruneUserActivityAuditEvents({ now: 10, retentionMs: DAY_MS, maxRows: 2 })).toBe(2);
      expect(listUserActivityAuditEvents({ limit: 10 }).entries.map((entry) => entry.at)).toEqual([
        4, 3,
      ]);
    });
  });

  it("replaces a detail object that would not fit rather than storing half of it", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      appendUserActivityAuditEvent({
        at: 1,
        kind: "prompt",
        actor: { source: "operator" },
        detail: { text: "x".repeat(8_000) },
      });
      const entry = listUserActivityAuditEvents({ limit: 1 }).entries[0];
      expect(entry?.detail).toMatchObject({ error: "detail_too_large" });
    });
  });
});
