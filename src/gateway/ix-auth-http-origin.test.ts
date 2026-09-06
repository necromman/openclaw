import { describe, expect, it } from "vitest";
import { isAllowedIxAuthBrowserOrigin } from "./ix-auth-http.js";

const LOOPBACK = {
  requestHost: "127.0.0.1:18791",
  allowedOrigins: undefined,
  isLocalClient: true,
};

describe("isAllowedIxAuthBrowserOrigin", () => {
  it("accepts a same-origin fetch that carries no Origin header", () => {
    // Chrome omits Origin on same-origin GET requests. Demanding it would reject the
    // session probe the Control UI makes on every page load.
    expect(
      isAllowedIxAuthBrowserOrigin({ ...LOOPBACK, fetchSite: "same-origin" }),
    ).toBe(true);
  });

  it("accepts a user-initiated navigation", () => {
    expect(isAllowedIxAuthBrowserOrigin({ ...LOOPBACK, fetchSite: "none" })).toBe(true);
  });

  it("rejects a cross-site request that omits Origin", () => {
    expect(isAllowedIxAuthBrowserOrigin({ ...LOOPBACK, fetchSite: "cross-site" })).toBe(false);
    expect(isAllowedIxAuthBrowserOrigin({ ...LOOPBACK, fetchSite: "same-site" })).toBe(false);
  });

  it("rejects a request with neither Origin nor a fetch-site declaration", () => {
    expect(isAllowedIxAuthBrowserOrigin(LOOPBACK)).toBe(false);
  });

  it("accepts a matching loopback Origin", () => {
    expect(
      isAllowedIxAuthBrowserOrigin({ ...LOOPBACK, origin: "http://127.0.0.1:18791" }),
    ).toBe(true);
  });

  it("rejects a foreign Origin even when the fetch site claims same-origin", () => {
    // A present Origin is authoritative; Sec-Fetch-Site never rescues a bad one.
    expect(
      isAllowedIxAuthBrowserOrigin({
        ...LOOPBACK,
        origin: "http://evil.example",
        fetchSite: "same-origin",
      }),
    ).toBe(false);
  });

  it("accepts an Origin named in the allowlist", () => {
    expect(
      isAllowedIxAuthBrowserOrigin({
        requestHost: "gateway.example",
        origin: "https://gateway.example",
        allowedOrigins: ["https://gateway.example"],
        isLocalClient: false,
      }),
    ).toBe(true);
  });
});
