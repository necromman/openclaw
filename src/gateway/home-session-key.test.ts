import { describe, expect, test } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isHomeSessionKey, resolveCallerMainKey } from "./home-session-key.js";

const ixAuth: OpenClawConfig = { gateway: { auth: { mode: "ix-auth" } } };

function personHomeKey(profileId: string): string {
  return resolveCallerMainKey({
    cfg: ixAuth,
    client: {
      authenticatedUserProfile: {
        profileId,
        displayName: profileId,
        hasAvatar: false,
        updatedAt: 1,
      },
    },
  });
}

describe("isHomeSessionKey", () => {
  test("accepts the configured word, every person-scoped home, and both key shapes", () => {
    const mine = personHomeKey("profile-mine");
    const theirs = personHomeKey("profile-theirs");
    expect(mine).not.toBe(theirs);
    for (const rest of ["main", mine, theirs]) {
      expect(isHomeSessionKey({ key: `agent:main:${rest}`, cfg: ixAuth })).toBe(true);
      expect(isHomeSessionKey({ key: `agent:work:${rest}`, cfg: ixAuth })).toBe(true);
      expect(isHomeSessionKey({ key: rest, cfg: ixAuth })).toBe(true);
      expect(isHomeSessionKey({ key: `AGENT:MAIN:${rest.toUpperCase()}`, cfg: ixAuth })).toBe(true);
    }
  });

  test("follows a renamed main word", () => {
    const cfg: OpenClawConfig = { session: { mainKey: "home" } };
    expect(isHomeSessionKey({ key: "agent:main:home", cfg })).toBe(true);
    expect(isHomeSessionKey({ key: "agent:main:home-u0123456789abcdef", cfg })).toBe(true);
    expect(isHomeSessionKey({ key: "agent:main:main", cfg })).toBe(false);
  });

  test("refuses ordinary sessions and near-miss suffixes", () => {
    for (const key of [
      "",
      "global",
      "unknown",
      "agent:main:planning",
      "agent:main:mainline",
      "agent:main:main-u0123456789abcde",
      "agent:main:main-u0123456789abcdeff",
      "agent:main:main-uzzzzzzzzzzzzzzzz",
      "agent:main:main-0123456789abcdef",
      "agent:main:sub-main-u0123456789abcdef",
    ]) {
      expect(isHomeSessionKey({ key, cfg: ixAuth }), key).toBe(false);
    }
  });
});
