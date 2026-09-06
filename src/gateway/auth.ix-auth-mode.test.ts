import { describe, expect, it } from "vitest";
import { resolveGatewayAuth } from "./auth-resolve.js";
import { assertGatewayAuthConfigured } from "./auth.js";

describe("assertGatewayAuthConfigured for ix-auth", () => {
  it("accepts a complete ix-auth config", () => {
    expect(() =>
      assertGatewayAuthConfigured({
        mode: "ix-auth",
        allowTailscale: false,
        ixAuth: { baseUrl: "http://ix-auth:9100", serviceKey: "a".repeat(32) },
      }),
    ).not.toThrow();
  });

  it("refuses ix-auth mode with no ixAuth block", () => {
    expect(() => assertGatewayAuthConfigured({ mode: "ix-auth", allowTailscale: false })).toThrow(
      /no ixAuth config was provided/u,
    );
  });

  it("refuses a shared token alongside ix-auth", () => {
    // A shared secret would be a way around per-person login, which is the whole point
    // of this mode.
    expect(() =>
      assertGatewayAuthConfigured({
        mode: "ix-auth",
        allowTailscale: false,
        token: "shared-token",
        ixAuth: { baseUrl: "http://ix-auth:9100", serviceKey: "a".repeat(32) },
      }),
    ).toThrow(/mutually exclusive|shared token is also configured/u);
  });

  it("leaves the existing modes validating exactly as before", () => {
    expect(() => assertGatewayAuthConfigured({ mode: "token", allowTailscale: false })).toThrow(
      /no token was configured/u,
    );
    expect(() =>
      assertGatewayAuthConfigured({ mode: "trusted-proxy", allowTailscale: false }),
    ).toThrow(/no trustedProxy config was provided/u);
    expect(() =>
      assertGatewayAuthConfigured({ mode: "none", allowTailscale: false }),
    ).not.toThrow();
  });
});

describe("resolveGatewayAuth for ix-auth", () => {
  it("keeps the configured mode and carries the ixAuth block through", () => {
    const resolved = resolveGatewayAuth({
      authConfig: {
        mode: "ix-auth",
        ixAuth: { baseUrl: "http://ix-auth:9100", serviceKey: "a".repeat(32) },
      },
      env: {},
    });
    expect(resolved.mode).toBe("ix-auth");
    expect(resolved.ixAuth?.baseUrl).toBe("http://ix-auth:9100");
  });

  it("does not enable Tailscale header auth in serve mode", () => {
    // Tailscale identity headers would be a second way in that bypasses the login.
    const resolved = resolveGatewayAuth({
      authConfig: {
        mode: "ix-auth",
        ixAuth: { baseUrl: "http://ix-auth:9100", serviceKey: "a".repeat(32) },
      },
      env: {},
      tailscaleMode: "serve",
    });
    expect(resolved.allowTailscale).toBe(false);
  });

  it("still infers token mode when nothing is configured, unchanged", () => {
    expect(resolveGatewayAuth({ authConfig: {}, env: {} }).mode).toBe("token");
  });

  it("still infers password mode from a configured password, unchanged", () => {
    expect(
      resolveGatewayAuth({ authConfig: { password: "hunter2" }, env: {} }).mode, // pragma: allowlist secret
    ).toBe("password");
  });
});
