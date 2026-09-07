// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  buildIxAuthLoginProps,
  clearIxAuthFormSecrets,
  createEmptyIxAuthFormState,
  formatIxAuthLockoutTime,
} from "./ix-auth-form-state.ts";

describe("createEmptyIxAuthFormState", () => {
  it("starts with nothing typed and nothing in flight", () => {
    expect(createEmptyIxAuthFormState()).toEqual({
      screen: "sign-in",
      email: "",
      password: "",
      confirmPassword: "",
      name: "",
      showPassword: false,
      mfaCode: "",
      submitting: false,
    });
  });
});

describe("clearIxAuthFormSecrets", () => {
  it("drops the password and code but keeps the typed email", () => {
    // A password must not outlive the request that used it.
    const cleared = clearIxAuthFormSecrets({
      ...createEmptyIxAuthFormState(),
      email: "person@example.com",
      password: "hunter2", // pragma: allowlist secret
      confirmPassword: "hunter2", // pragma: allowlist secret
      showPassword: true,
      mfaCode: "123456",
      submitting: true,
      errorKey: "invalidCredentials",
    });
    expect(cleared.password).toBe("");
    expect(cleared.confirmPassword).toBe("");
    expect(cleared.mfaCode).toBe("");
    expect(cleared.showPassword).toBe(false);
    expect(cleared.submitting).toBe(false);
    expect(cleared.email).toBe("person@example.com");
    expect(cleared.errorKey).toBe("invalidCredentials");
  });
});

describe("formatIxAuthLockoutTime", () => {
  it("returns undefined when no expiry is known", () => {
    expect(formatIxAuthLockoutTime(undefined)).toBeUndefined();
    expect(formatIxAuthLockoutTime(Number.NaN)).toBeUndefined();
  });

  it("formats a known expiry as a wall-clock time", () => {
    expect(formatIxAuthLockoutTime(Date.UTC(2026, 8, 7, 4, 5), "en-US")).toMatch(/\d{2}:\d{2}/u);
  });
});

describe("buildIxAuthLoginProps", () => {
  const base = { ...createEmptyIxAuthFormState(), email: "person@example.com" };

  it("clears the error whenever a field changes", () => {
    // Leaving a stale error under a field the user just corrected reads as a bug.
    const onChange = vi.fn();
    const props = buildIxAuthLoginProps({
      resourceBasePath: "",
      state: { ...base, errorKey: "invalidCredentials" },
      selfSignupEnabled: false,
      handlers: { onChange, onSubmit: vi.fn(), onNavigate: vi.fn() },
    });
    props.onPasswordChange("typed");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ password: "typed", errorKey: undefined }),
    );
  });

  it("toggles password visibility from the current state", () => {
    const onChange = vi.fn();
    buildIxAuthLoginProps({
      resourceBasePath: "",
      state: { ...base, showPassword: true },
      selfSignupEnabled: false,
      handlers: { onChange, onSubmit: vi.fn(), onNavigate: vi.fn() },
    }).onTogglePassword();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showPassword: false }));
  });

  it("resets the whole form when the second factor is cancelled", () => {
    const onChange = vi.fn();
    buildIxAuthLoginProps({
      resourceBasePath: "",
      state: { ...base, mfaChallenge: "challenge", mfaCode: "111111" },
      selfSignupEnabled: false,
      handlers: { onChange, onSubmit: vi.fn(), onNavigate: vi.fn() },
    }).onCancelMfa();
    expect(onChange).toHaveBeenCalledWith(createEmptyIxAuthFormState());
  });

  it("passes the submit handler straight through", () => {
    const onSubmit = vi.fn();
    buildIxAuthLoginProps({
      resourceBasePath: "",
      state: base,
      selfSignupEnabled: false,
      handlers: { onChange: vi.fn(), onSubmit, onNavigate: vi.fn() },
    }).onSubmit();
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
