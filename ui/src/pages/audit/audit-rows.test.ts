import { describe, expect, it } from "vitest";
import type { AuditUserActivityEvent } from "../../../../packages/gateway-protocol/src/schema/audit-user-activity.js";
import {
  auditExportSearch,
  auditFilterQuery,
  auditKindLabel,
  auditRowPerson,
  auditRowSummary,
  EMPTY_AUDIT_ACTIVITY_FILTERS,
} from "./audit-rows.ts";

function event(overrides: Partial<AuditUserActivityEvent> = {}): AuditUserActivityEvent {
  return {
    sequence: 1,
    at: 0,
    kind: "login",
    actorSource: "profile",
    departments: [],
    detail: {},
    ...overrides,
  };
}

describe("audit filters", () => {
  it("sends nothing when the bar is empty", () => {
    expect(auditFilterQuery(EMPTY_AUDIT_ACTIVITY_FILTERS)).toEqual({});
    expect(auditExportSearch(EMPTY_AUDIT_ACTIVITY_FILTERS)).toBe("");
  });

  it("matches a person by address and trims what was typed", () => {
    expect(
      auditFilterQuery({ ...EMPTY_AUDIT_ACTIVITY_FILTERS, person: "  kim@example.com " }),
    ).toEqual({ email: "kim@example.com" });
  });

  it("includes the whole day named by the end of the range", () => {
    const query = auditFilterQuery({
      ...EMPTY_AUDIT_ACTIVITY_FILTERS,
      since: "2026-09-01",
      until: "2026-09-02",
    });
    expect(query.from).toBe(Date.parse("2026-09-01T00:00:00.000"));
    expect(query.to).toBe(Date.parse("2026-09-02T23:59:59.999"));
  });

  it("gives the export the same filters as the table", () => {
    const search = auditExportSearch({
      ...EMPTY_AUDIT_ACTIVITY_FILTERS,
      person: "kim@example.com",
      kind: "tool_read",
    });
    expect(search).toContain("email=kim%40example.com");
    expect(search).toContain("kind=tool_read");
  });
});

describe("audit row projection", () => {
  it("prefers the name a reader would recognize", () => {
    expect(auditRowPerson(event({ displayName: "Kim", email: "kim@example.com" }))).toBe("Kim");
    expect(auditRowPerson(event({ email: "kim@example.com" }))).toBe("kim@example.com");
    expect(auditRowPerson(event({ actorSource: "operator" }))).toBe("operator");
  });

  it("summarizes each kind by the field that makes it legible", () => {
    expect(auditRowSummary(event({ kind: "prompt", detail: { text: "안녕하세요" } }))).toBe(
      "안녕하세요",
    );
    expect(
      auditRowSummary(event({ kind: "tool_read", detail: { paths: ["/a.md", "/b.md"] } })),
    ).toBe("/a.md, /b.md");
    expect(auditRowSummary(event({ kind: "file_download", detail: { path: "/c.pdf" } }))).toBe(
      "/c.pdf",
    );
    expect(auditRowSummary(event({ kind: "admin_action", detail: { action: "user-roles" } }))).toBe(
      "user-roles",
    );
    expect(
      auditRowSummary(event({ kind: "access_denied", detail: { reason: "department" } })),
    ).toBe("department");
  });

  it("says the text is absent rather than showing an empty question", () => {
    // The deployment default records only a question's shape; the row still has to read
    // as "a question happened" rather than as an empty cell.
    expect(auditRowSummary(event({ kind: "prompt", detail: { chars: 12, digest: "abc" } }))).toBe(
      "ixAuth.audit.promptHidden",
    );
  });

  it("keeps an unknown kind readable instead of blanking it", () => {
    expect(auditKindLabel("some_future_kind")).toBe("some_future_kind");
  });
});
