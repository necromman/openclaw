import { describe, expect, it } from "vitest";
import type { UserActivityAuditEntry } from "../state/user-activity-audit-store.js";
import { formatUserActivityAuditCsv } from "./user-activity-audit-csv.js";

function entry(overrides: Partial<UserActivityAuditEntry> = {}): UserActivityAuditEntry {
  return {
    sequence: 1,
    at: Date.UTC(2026, 8, 8, 12, 0, 0),
    kind: "login",
    actorSource: "profile",
    departments: [],
    detail: {},
    ...overrides,
  };
}

describe("activity ledger CSV", () => {
  it("writes a header even with no rows", () => {
    expect(formatUserActivityAuditCsv([])).toBe(
      "at,kind,actorSource,profileId,email,displayName,gatewayRole,departments,sessionKey,agentId,remoteIp,detail\n",
    );
  });

  it("renders one row per record with detail kept whole", () => {
    const csv = formatUserActivityAuditCsv([
      entry({
        kind: "tool_read",
        email: "kim@example.com",
        gatewayRole: "member",
        departments: ["dept-rnd", "dept-qa"],
        agentId: "rnd-bot",
        detail: { toolName: "read", paths: ["/mnt/nas/rnd/spec.pdf"] },
      }),
    ]);
    const [, row] = csv.trimEnd().split("\n");
    expect(row).toContain('"tool_read"');
    expect(row).toContain('"kim@example.com"');
    expect(row).toContain('"dept-rnd dept-qa"');
    expect(row).toContain('{""toolName"":""read""');
  });

  it("escapes quotes rather than breaking the row", () => {
    const csv = formatUserActivityAuditCsv([entry({ displayName: 'Kim "The Lead"' })]);
    expect(csv).toContain('"Kim ""The Lead"""');
    expect(csv.trimEnd().split("\n")).toHaveLength(2);
  });

  it("keeps a spreadsheet from reading a stored value as a formula", () => {
    // The ledger holds attacker-influenced text: a question, a file path. A cell that
    // starts with = would otherwise execute on open.
    const csv = formatUserActivityAuditCsv([entry({ displayName: "=1+1" })]);
    expect(csv).toContain(`"'=1+1"`);
  });
});
