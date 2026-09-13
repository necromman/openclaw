import { ConnectErrorDetailCodes } from "@openclaw/gateway-protocol/connect-error-details";
import { describe, expect, it } from "vitest";
import {
  classifyIxAuthConnectFailure,
  decideIxAuthRecovery,
  rememberIxAuthReturnPath,
  takeIxAuthReturnPath,
} from "./ix-auth-reconnect.ts";

describe("classifyIxAuthConnectFailure", () => {
  it("reads a refused handshake as unauthorized", () => {
    expect(
      classifyIxAuthConnectFailure({
        code: ConnectErrorDetailCodes.AUTH_REQUIRED,
        authReason: "gateway_auth_required",
      }),
    ).toBe("unauthorized");
  });

  it("keeps an unreachable identity server apart from a refused session", () => {
    expect(
      classifyIxAuthConnectFailure({
        code: ConnectErrorDetailCodes.AUTH_IDENTITY_UNAVAILABLE,
        authReason: "identity_unavailable",
      }),
    ).toBe("identity-unavailable");
  });

  it("leaves every other failure to the ordinary reconnect supervisor", () => {
    expect(
      classifyIxAuthConnectFailure({
        code: ConnectErrorDetailCodes.PROTOCOL_MISMATCH,
        authReason: null,
      }),
    ).toBe("other");
    expect(classifyIxAuthConnectFailure({})).toBe("other");
  });
});

describe("decideIxAuthRecovery", () => {
  it("shows the sign-in screen when the Gateway says this browser is signed out", () => {
    expect(
      decideIxAuthRecovery({
        failure: "unauthorized",
        probe: { authenticated: false, authMode: "ix-auth" },
      }),
    ).toBe("show-gate");
  });

  it("reconnects instead of signing out when the session is still good", () => {
    expect(
      decideIxAuthRecovery({
        failure: "unauthorized",
        probe: { authenticated: true, authMode: "ix-auth" },
      }),
    ).toBe("retry-connect");
  });

  it("waits out a deployment window rather than deciding anything", () => {
    expect(
      decideIxAuthRecovery({
        failure: "identity-unavailable",
        probe: { authenticated: true, authMode: "ix-auth" },
      }),
    ).toBe("keep-waiting");
    // The maintenance page answers 503 while the containers are swapped, which the probe
    // reports as "nobody answered". That is not an answer to act on.
    expect(
      decideIxAuthRecovery({
        failure: "unauthorized",
        probe: { authenticated: false, unavailable: true },
      }),
    ).toBe("keep-waiting");
    expect(decideIxAuthRecovery({ failure: "unauthorized", probe: undefined })).toBe(
      "keep-waiting",
    );
  });

  it("leaves unrelated failures to the reconnect supervisor", () => {
    expect(
      decideIxAuthRecovery({
        failure: "other",
        probe: { authenticated: false, authMode: "ix-auth" },
      }),
    ).toBe("keep-waiting");
  });
});

describe("ix-auth return path", () => {
  it("hands back the remembered address exactly once", () => {
    rememberIxAuthReturnPath("/chat/main?focus=1");
    expect(takeIxAuthReturnPath()).toBe("/chat/main?focus=1");
    expect(takeIxAuthReturnPath()).toBeUndefined();
  });

  it("refuses an address that would leave this application", () => {
    rememberIxAuthReturnPath("//evil.example/steal");
    expect(takeIxAuthReturnPath()).toBeUndefined();
    rememberIxAuthReturnPath("https://evil.example/steal");
    expect(takeIxAuthReturnPath()).toBeUndefined();
  });
});
