// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ixAuthScreenNeedsToken,
  resolveIxAuthScreenFromLocation,
} from "./ix-auth-account-screen.ts";
import { createIxAuthScreenState } from "./ix-auth-form-state.ts";
import { findIxAuthSubmitBlocker } from "./ix-auth-sign-in-step.ts";

describe("resolveIxAuthScreenFromLocation", () => {
  it("reads the token out of an invitation link", () => {
    expect(
      resolveIxAuthScreenFromLocation({
        pathname: "/accept-invite",
        search: "?token=abc123",
        basePath: "",
      }),
    ).toEqual({ screen: "accept-invite", token: "abc123" });
  });

  it("recognizes every mail-link path", () => {
    const paths = {
      "/reset-password": "reset-password",
      "/verify-email": "verify-email",
      "/signup": "signup",
      "/forgot-password": "forgot-password",
    };
    for (const [pathname, screen] of Object.entries(paths)) {
      expect(
        resolveIxAuthScreenFromLocation({ pathname, search: "", basePath: "" }).screen,
      ).toBe(screen);
    }
  });

  it("falls back to sign-in for any other address", () => {
    // The gate stands in front of the whole application, so every deep link a signed-out
    // person opens arrives here and must not read as an error.
    expect(
      resolveIxAuthScreenFromLocation({ pathname: "/chat/main", search: "", basePath: "" }),
    ).toEqual({ screen: "sign-in" });
  });

  it("strips a configured base path before matching", () => {
    expect(
      resolveIxAuthScreenFromLocation({
        pathname: "/gw/accept-invite",
        search: "?token=t",
        basePath: "/gw",
      }),
    ).toEqual({ screen: "accept-invite", token: "t" });
  });

  it("treats an empty or absent token as no token", () => {
    expect(
      resolveIxAuthScreenFromLocation({ pathname: "/verify-email", search: "?token=", basePath: "" })
        .token,
    ).toBeUndefined();
    expect(
      resolveIxAuthScreenFromLocation({ pathname: "/verify-email", search: "", basePath: "" }).token,
    ).toBeUndefined();
  });
});

describe("ixAuthScreenNeedsToken", () => {
  it("marks only the screens that arrive from a mail link", () => {
    expect(ixAuthScreenNeedsToken("accept-invite")).toBe(true);
    expect(ixAuthScreenNeedsToken("reset-password")).toBe(true);
    expect(ixAuthScreenNeedsToken("verify-email")).toBe(true);
    expect(ixAuthScreenNeedsToken("signup")).toBe(false);
    expect(ixAuthScreenNeedsToken("sign-in")).toBe(false);
  });
});

describe("findIxAuthSubmitBlocker", () => {
  it("requires a matching confirmation on every screen that sets a new password", () => {
    const invite = {
      ...createIxAuthScreenState({ screen: "accept-invite", token: "t" }),
      password: "correct horse", // pragma: allowlist secret
      confirmPassword: "correct hors", // pragma: allowlist secret
    };
    expect(findIxAuthSubmitBlocker(invite)).toBe("passwordMismatch");
    expect(
      findIxAuthSubmitBlocker({ ...invite, confirmPassword: invite.password }),
    ).toBeUndefined();
  });

  it("blocks a token screen that has no token", () => {
    expect(findIxAuthSubmitBlocker(createIxAuthScreenState({ screen: "verify-email" }))).toBe(
      "missingToken",
    );
    expect(
      findIxAuthSubmitBlocker(createIxAuthScreenState({ screen: "verify-email", token: "t" })),
    ).toBeUndefined();
  });

  it("asks the password-recovery screen only for an address", () => {
    const state = createIxAuthScreenState({ screen: "forgot-password" });
    expect(findIxAuthSubmitBlocker(state)).toBe("missingEmail");
    expect(findIxAuthSubmitBlocker({ ...state, email: "person@example.com" })).toBeUndefined();
  });

  it("keeps the sign-in rules unchanged", () => {
    const state = createIxAuthScreenState({ screen: "sign-in" });
    expect(findIxAuthSubmitBlocker(state)).toBe("missingFields");
    expect(
      findIxAuthSubmitBlocker({ ...state, email: "person@example.com", password: "pw" }),
    ).toBeUndefined();
    expect(findIxAuthSubmitBlocker({ ...state, mfaChallenge: "ch" })).toBe("invalidCode");
  });
});
