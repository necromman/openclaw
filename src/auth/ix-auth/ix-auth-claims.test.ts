import { describe, expect, it } from "vitest";
import { parseIxAuthTokenClaims, readIxAuthDepartmentCodes } from "./ix-auth-claims.js";

const NOW = 1_800_000_000_000;

function buildPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://gateway.example",
    aud: "openclaw",
    sub: "1042",
    exp: Math.floor(NOW / 1000) + 900,
    iat: Math.floor(NOW / 1000),
    email: "person@example.com",
    name: "Person Example",
    ixauth_roles: ["ADMIN"],
    ixauth_groups: ["dept-sales", "everyone"],
    ixauth_sid: "sid-1",
    ixauth_pv: 7,
    ...overrides,
  };
}

const SETTINGS = {
  issuer: "https://gateway.example",
  audience: "openclaw",
  departmentClaim: "ixauth_groups",
};

describe("parseIxAuthTokenClaims", () => {
  it("narrows a well-formed payload into the closed contract", () => {
    const result = parseIxAuthTokenClaims({ payload: buildPayload(), settings: SETTINGS, nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.claims).toMatchObject({
      subject: "1042",
      email: "person@example.com",
      displayName: "Person Example",
      roles: ["ADMIN"],
      groups: ["dept-sales", "everyone"],
      identitySessionId: "sid-1",
      permissionsVersion: 7,
    });
    expect(result.claims.impersonatorSubject).toBeUndefined();
  });

  it("rejects a token minted by another issuer", () => {
    const result = parseIxAuthTokenClaims({
      payload: buildPayload({ iss: "https://other.example" }),
      settings: SETTINGS,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "issuer_mismatch" });
  });

  it("rejects a token minted for another audience", () => {
    const result = parseIxAuthTokenClaims({
      payload: buildPayload({ aud: "other-app" }),
      settings: SETTINGS,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "audience_mismatch" });
  });

  it("accepts an audience array that contains the configured value", () => {
    const result = parseIxAuthTokenClaims({
      payload: buildPayload({ aud: ["other-app", "openclaw"] }),
      settings: SETTINGS,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an expired token beyond the allowed clock skew", () => {
    const result = parseIxAuthTokenClaims({
      payload: buildPayload(),
      settings: SETTINGS,
      nowMs: NOW + 900_000 + 61_000,
    });
    expect(result).toEqual({ ok: false, reason: "token_expired" });
  });

  it("still accepts a just-expired token inside the clock skew allowance", () => {
    const result = parseIxAuthTokenClaims({
      payload: buildPayload(),
      settings: SETTINGS,
      nowMs: NOW + 900_000 + 30_000,
    });
    expect(result.ok).toBe(true);
  });

  it.each(["sub", "email", "ixauth_sid", "exp"])("rejects a payload missing %s", (claim) => {
    const payload = buildPayload();
    delete payload[claim];
    const result = parseIxAuthTokenClaims({ payload, settings: SETTINGS, nowMs: NOW });
    expect(result.ok).toBe(false);
  });

  it("carries the impersonating administrator when act is present", () => {
    const result = parseIxAuthTokenClaims({
      payload: buildPayload({ act: { sub: "1", email: "admin@example.com" } }),
      settings: SETTINGS,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.impersonatorEmail).toBe("admin@example.com");
      expect(result.claims.impersonatorSubject).toBe("1");
    }
  });

  it("reads the group claim named in configuration", () => {
    const result = parseIxAuthTokenClaims({
      payload: buildPayload({ custom_groups: ["dept-rnd"] }),
      settings: { ...SETTINGS, departmentClaim: "custom_groups" },
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.groups).toEqual(["dept-rnd"]);
    }
  });
});

describe("readIxAuthDepartmentCodes", () => {
  it("keeps only prefixed groups and strips the prefix", () => {
    expect(
      readIxAuthDepartmentCodes({ groups: ["dept-sales", "everyone", "dept-rnd"], prefix: "dept-" }),
    ).toEqual(["sales", "rnd"]);
  });

  it("treats every group as a department when the prefix is empty", () => {
    expect(readIxAuthDepartmentCodes({ groups: ["sales", "rnd"], prefix: "" })).toEqual([
      "sales",
      "rnd",
    ]);
  });

  it("drops a group that is only the prefix", () => {
    expect(readIxAuthDepartmentCodes({ groups: ["dept-"], prefix: "dept-" })).toEqual([]);
  });
});
