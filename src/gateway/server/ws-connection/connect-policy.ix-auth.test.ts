import { describe, expect, it } from "vitest";
import type { ConnectParams } from "../../../../packages/gateway-protocol/src/index.js";
import {
  controlUiPairingKindAuthorizesSession,
  evaluateMissingDeviceIdentity,
  isIxAuthControlUiOperatorAuth,
  isTrustedProxyControlUiOperatorAuth,
  shouldClearUnboundScopesForMissingDeviceIdentity,
  shouldSkipControlUiPairing,
} from "./connect-policy.js";

const CONTROL_UI_IX_AUTH = {
  isControlUi: true,
  role: "operator" as const,
  authMode: "ix-auth",
  authOk: true,
  authMethod: "ix-auth" as const,
};

describe("isIxAuthControlUiOperatorAuth", () => {
  it("recognizes an authenticated Control UI operator in ix-auth mode", () => {
    expect(isIxAuthControlUiOperatorAuth(CONTROL_UI_IX_AUTH)).toBe(true);
  });

  it.each([
    ["a non Control UI client", { isControlUi: false }],
    ["a node role", { role: "node" as const }],
    ["another auth mode", { authMode: "token" }],
    ["a failed authentication", { authOk: false }],
    ["another auth method", { authMethod: "token" as const }],
  ])("does not recognize %s", (_label, override) => {
    expect(isIxAuthControlUiOperatorAuth({ ...CONTROL_UI_IX_AUTH, ...override })).toBe(false);
  });
});

describe("evaluateMissingDeviceIdentity with ix-auth", () => {
  const baseParams = {
    hasDeviceIdentity: false,
    role: "operator" as const,
    isControlUi: true,
    sharedAuthOk: false,
    authOk: true,
    hasSharedAuth: false,
    isLocalClient: false,
  };

  it("admits a Control UI operator with no paired device", () => {
    // This is the requirement: sign in from any machine, no device pairing.
    expect(evaluateMissingDeviceIdentity({ ...baseParams, ixAuthOk: true })).toEqual({
      kind: "allow",
    });
  });

  it("still rejects the same client without a verified session", () => {
    expect(evaluateMissingDeviceIdentity({ ...baseParams, ixAuthOk: false })).toEqual({
      kind: "reject-control-ui-insecure-auth",
    });
  });

  it("does not extend the exemption to node clients", () => {
    expect(
      evaluateMissingDeviceIdentity({
        ...baseParams,
        role: "node",
        isControlUi: false,
        ixAuthOk: true,
      }),
    ).not.toEqual({ kind: "allow" });
  });

  it("keeps the trusted-proxy exemption working unchanged", () => {
    expect(evaluateMissingDeviceIdentity({ ...baseParams, trustedProxyAuthOk: true })).toEqual({
      kind: "allow",
    });
  });

  it("keeps a device-bearing client on the existing allow path", () => {
    expect(evaluateMissingDeviceIdentity({ ...baseParams, hasDeviceIdentity: true })).toEqual({
      kind: "allow",
    });
  });
});

describe("shouldClearUnboundScopesForMissingDeviceIdentity", () => {
  it("discards browser-declared scopes for an ix-auth session", () => {
    // The Control UI asks for operator.admin by default. Scopes must come from the
    // person's mapped role, never from what the page requested.
    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "allow" },
        authMethod: "ix-auth",
      }),
    ).toBe(true);
  });

  it.each(["token", "password", "trusted-proxy"])(
    "keeps discarding declared scopes for %s, unchanged",
    (authMethod) => {
      expect(
        shouldClearUnboundScopesForMissingDeviceIdentity({
          decision: { kind: "allow" },
          authMethod,
        }),
      ).toBe(true);
    },
  );

  it("leaves device-token sessions alone", () => {
    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "allow" },
        authMethod: "device-token",
      }),
    ).toBe(false);
  });
});

describe("isTrustedProxyControlUiOperatorAuth regression", () => {
  it("is unaffected by the new ix-auth mode", () => {
    expect(
      isTrustedProxyControlUiOperatorAuth({
        isControlUi: true,
        role: "operator",
        authMode: "trusted-proxy",
        authOk: true,
        authMethod: "trusted-proxy",
      }),
    ).toBe(true);
    expect(
      isTrustedProxyControlUiOperatorAuth({
        isControlUi: true,
        role: "operator",
        authMode: "ix-auth",
        authOk: true,
        authMethod: "ix-auth",
      }),
    ).toBe(false);
  });
});

describe("shouldSkipControlUiPairing with an identity-server session", () => {
  const base = {
    isControlUi: true,
    device: { id: "device-1" } as ConnectParams["device"],
    role: "operator" as const,
    authMode: "ix-auth",
    authMethod: "ix-auth",
  };

  it("exempts a signed-in Control UI operator from device pairing", () => {
    // The mode's promise is "signed in from any PC, no pairing". Before this, the
    // exemption only held for loopback clients, where local self-pairing covered it, so a
    // containerized deployment asked every signed-in person to approve a device instead.
    expect(shouldSkipControlUiPairing(base)).toBe("identity-session");
    expect(controlUiPairingKindAuthorizesSession("identity-session")).toBe(true);
  });

  it("does not exempt a node-role connection", () => {
    expect(shouldSkipControlUiPairing({ ...base, role: "node" })).toBeNull();
  });

  it("does not exempt a client that is not the Control UI", () => {
    expect(shouldSkipControlUiPairing({ ...base, isControlUi: false })).toBeNull();
  });

  it("does not exempt a session authenticated some other way", () => {
    expect(shouldSkipControlUiPairing({ ...base, authMethod: "device-token" })).toBeNull();
    expect(shouldSkipControlUiPairing({ ...base, authMode: "token" })).toBeNull();
  });

  it("leaves the pairing record in charge for every other kind", () => {
    expect(controlUiPairingKindAuthorizesSession(null)).toBe(false);
    expect(controlUiPairingKindAuthorizesSession("tailscale-device")).toBe(false);
  });
});
