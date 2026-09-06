import { describe, expect, it } from "vitest";
import { classifyIxAuthHttpPath } from "./ix-auth-http-paths.js";

describe("classifyIxAuthHttpPath", () => {
  it.each([
    ["/auth/login", "login"],
    ["/auth/mfa", "mfa"],
    ["/auth/logout", "logout"],
    ["/auth/refresh", "refresh"],
    ["/auth/me", "me"],
  ])("classifies %s", (pathname, expected) => {
    expect(classifyIxAuthHttpPath(pathname)).toBe(expected);
  });

  it.each(["/", "/health", "/authorize", "/auth-extra", "/api/auth/login"])(
    "leaves %s to later stages",
    (pathname) => {
      expect(classifyIxAuthHttpPath(pathname)).toBe("outside");
    },
  );

  it("claims an unknown path inside the namespace instead of falling through", () => {
    // Falling through would let a plugin or hook base path claim a sub-path of the
    // authentication namespace.
    expect(classifyIxAuthHttpPath("/auth")).toBe("unknown");
    expect(classifyIxAuthHttpPath("/auth/")).toBe("unknown");
    expect(classifyIxAuthHttpPath("/auth/register")).toBe("unknown");
    expect(classifyIxAuthHttpPath("/auth/login/extra")).toBe("unknown");
  });
});
