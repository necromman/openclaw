import { describe, expect, it } from "vitest";
import {
  compareSecretStringsSafely,
  isSecureGatewayBrowserContext,
  readPrefixedCookieValues,
  readRequestCookieMap,
  readRequestCookieValue,
  serializeGatewaySetCookie,
} from "./cookie-header.js";

describe("readRequestCookieMap", () => {
  it("parses a normal cookie header", () => {
    const cookies = readRequestCookieMap("a=1; b=two; c=three");
    expect([...cookies]).toEqual([
      ["a", "1"],
      ["b", "two"],
      ["c", "three"],
    ]);
  });

  it("keeps the first value when a name repeats", () => {
    expect(readRequestCookieMap("a=first; a=second").get("a")).toBe("first");
  });

  it("ignores malformed segments without discarding the rest", () => {
    const cookies = readRequestCookieMap("broken; =novalue; good=yes");
    expect(cookies.get("good")).toBe("yes");
    expect(cookies.size).toBe(1);
  });

  it("returns an empty map for a missing header", () => {
    expect(readRequestCookieMap(undefined).size).toBe(0);
  });

  it("joins a repeated header before parsing", () => {
    expect(readRequestCookieMap(["a=1", "b=2"]).get("b")).toBe("2");
  });
});

describe("readRequestCookieValue", () => {
  it("reads one named cookie from a request", () => {
    const req = { headers: { cookie: "session=abc; other=1" } };
    expect(readRequestCookieValue(req, "session")).toBe("abc");
    expect(readRequestCookieValue(req, "absent")).toBeUndefined();
  });
});

describe("readPrefixedCookieValues", () => {
  it("collects every cookie under one prefix", () => {
    expect(readPrefixedCookieValues("p_a=1; other=2; p_b=3", "p")).toEqual(["1", "3"]);
  });

  it("requires the underscore separator so a longer name does not match", () => {
    expect(readPrefixedCookieValues("prefixed=1", "p")).toEqual([]);
  });
});

describe("compareSecretStringsSafely", () => {
  it("matches identical secrets", () => {
    expect(compareSecretStringsSafely("token-value", "token-value")).toBe(true);
  });

  it("rejects different secrets, including ones of different length", () => {
    expect(compareSecretStringsSafely("token-value", "token-valuf")).toBe(false);
    expect(compareSecretStringsSafely("short", "much-longer-secret")).toBe(false);
  });
});

describe("serializeGatewaySetCookie", () => {
  const baseAttributes = {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };

  it("emits the expected attribute set", () => {
    const cookie = serializeGatewaySetCookie({
      name: "openclaw-session",
      value: "abc",
      attributes: { ...baseAttributes, maxAgeSeconds: 3600 },
    });
    expect(cookie).toBe("openclaw-session=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600");
  });

  it("forces Secure and Path=/ for a __Host- prefixed cookie", () => {
    // Browsers silently drop a __Host- cookie that lacks either, so the serializer
    // must not let a caller produce one that will never be stored.
    const cookie = serializeGatewaySetCookie({
      name: "__Host-openclaw-session",
      value: "abc",
      attributes: { ...baseAttributes, path: "/nested", secure: false },
    });
    expect(cookie).toContain("Path=/;");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Path=/nested");
  });

  it("omits HttpOnly for a script-readable cookie", () => {
    const cookie = serializeGatewaySetCookie({
      name: "openclaw-session-csrf",
      value: "abc",
      attributes: { ...baseAttributes, httpOnly: false },
    });
    expect(cookie).not.toContain("HttpOnly");
  });

  it("clamps a negative Max-Age to zero", () => {
    const cookie = serializeGatewaySetCookie({
      name: "c",
      value: "",
      attributes: { ...baseAttributes, maxAgeSeconds: -5 },
    });
    expect(cookie).toContain("Max-Age=0");
  });

  it.each([
    ["semicolon in value", "a", "bad;value"],
    ["newline in value", "a", "bad\nvalue"],
    ["semicolon in name", "bad;name", "v"],
  ])("refuses header injection through %s", (_label, name, value) => {
    expect(() =>
      serializeGatewaySetCookie({ name, value, attributes: baseAttributes }),
    ).toThrow(/unsupported character/u);
  });
});

describe("isSecureGatewayBrowserContext", () => {
  it("treats a TLS socket as secure", () => {
    expect(
      isSecureGatewayBrowserContext({
        encrypted: true,
        remoteAddressIsLoopback: false,
        fromTrustedProxy: false,
      }),
    ).toBe(true);
  });

  it("treats loopback as secure so plain-HTTP development still stores cookies", () => {
    expect(
      isSecureGatewayBrowserContext({
        encrypted: false,
        remoteAddressIsLoopback: true,
        fromTrustedProxy: false,
      }),
    ).toBe(true);
  });

  it("honours x-forwarded-proto only from a trusted proxy", () => {
    expect(
      isSecureGatewayBrowserContext({
        encrypted: false,
        remoteAddressIsLoopback: false,
        forwardedProto: "https",
        fromTrustedProxy: true,
      }),
    ).toBe(true);
    // An untrusted client claiming HTTPS would induce a Secure cookie the browser
    // then refuses to store, which reads as a broken login.
    expect(
      isSecureGatewayBrowserContext({
        encrypted: false,
        remoteAddressIsLoopback: false,
        forwardedProto: "https",
        fromTrustedProxy: false,
      }),
    ).toBe(false);
  });

  it("reads only the first hop of a forwarded proto chain", () => {
    expect(
      isSecureGatewayBrowserContext({
        encrypted: false,
        remoteAddressIsLoopback: false,
        forwardedProto: "https, http",
        fromTrustedProxy: true,
      }),
    ).toBe(true);
    expect(
      isSecureGatewayBrowserContext({
        encrypted: false,
        remoteAddressIsLoopback: false,
        forwardedProto: "http, https",
        fromTrustedProxy: true,
      }),
    ).toBe(false);
  });
});
