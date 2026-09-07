import { describe, expect, it } from "vitest";
import {
  classifyIxAuthHttpPath,
  isIxAuthAdminProxyPath,
  resolveIxAuthAdminProxyUpstreamPath,
} from "./ix-auth-http-paths.js";

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

describe("resolveIxAuthAdminProxyUpstreamPath", () => {
  it.each([
    ["/admin/identity", "/admin-ui"],
    ["/admin/identity/", "/admin-ui"],
    ["/admin/identity/api/login", "/admin-ui/api/login"],
    ["/admin/identity/api/mfa/verify", "/admin-ui/api/mfa/verify"],
    ["/admin/identity/admin/users", "/admin/users"],
    ["/admin/identity/admin/audit-logs/export", "/admin/audit-logs/export"],
  ])("maps %s onto %s", (pathname, expected) => {
    expect(resolveIxAuthAdminProxyUpstreamPath(pathname)).toBe(expected);
  });

  it.each([
    // Inside the namespace but naming no upstream route. Forwarding these would let a
    // caller pick the identity server's path for it.
    "/admin/identity/health",
    "/admin/identity/.well-known/jwks.json",
    "/admin/identity/auth/login",
    "/admin/identity/admin",
    "/admin/identity/admin/../auth/login",
    "/admin/identity/apixyz",
  ])("refuses to forward %s", (pathname) => {
    expect(resolveIxAuthAdminProxyUpstreamPath(pathname)).toBeUndefined();
  });

  it.each(["/admin", "/admin/identityx", "/", "/auth/me"])(
    "leaves %s outside the namespace",
    (pathname) => {
      expect(isIxAuthAdminProxyPath(pathname)).toBe(false);
      expect(resolveIxAuthAdminProxyUpstreamPath(pathname)).toBeUndefined();
    },
  );

  it("claims every path under the prefix so nothing else can serve one", () => {
    expect(isIxAuthAdminProxyPath("/admin/identity")).toBe(true);
    expect(isIxAuthAdminProxyPath("/admin/identity/anything")).toBe(true);
  });
});
