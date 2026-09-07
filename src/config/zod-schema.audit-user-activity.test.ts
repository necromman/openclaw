import { describe, expect, it } from "vitest";
import { resolveUserActivityAuditPolicy } from "../audit/audit-config.js";
import { OpenClawSchema } from "./zod-schema.js";

const DAY_MS = 24 * 60 * 60_000;

describe("logging.audit.userActivity", () => {
  it("accepts the three declared keys", () => {
    expect(
      OpenClawSchema.safeParse({
        logging: {
          audit: { userActivity: { promptText: true, retentionDays: 30, maxRows: 5_000 } },
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown key inside the block", () => {
    expect(
      OpenClawSchema.safeParse({
        logging: { audit: { userActivity: { prompt_text: true } } },
      }).success,
    ).toBe(false);
  });

  it("rejects a zero or negative retention window", () => {
    expect(
      OpenClawSchema.safeParse({ logging: { audit: { userActivity: { retentionDays: 0 } } } })
        .success,
    ).toBe(false);
    expect(
      OpenClawSchema.safeParse({ logging: { audit: { userActivity: { maxRows: -1 } } } }).success,
    ).toBe(false);
  });
});

describe("activity ledger policy", () => {
  it("collects by default, without the question text", () => {
    expect(resolveUserActivityAuditPolicy(undefined)).toEqual({
      enabled: true,
      promptText: false,
      retentionMs: 90 * DAY_MS,
      maxRows: 1_000_000,
    });
  });

  it("follows the audit ledger switch rather than owning a second one", () => {
    expect(resolveUserActivityAuditPolicy({ logging: { audit: { enabled: false } } }).enabled).toBe(
      false,
    );
  });

  it("honours the configured window and cap", () => {
    expect(
      resolveUserActivityAuditPolicy({
        logging: { audit: { userActivity: { promptText: true, retentionDays: 7, maxRows: 10 } } },
      }),
    ).toEqual({ enabled: true, promptText: true, retentionMs: 7 * DAY_MS, maxRows: 10 });
  });
});
