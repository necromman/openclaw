// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IxAuthSessionController } from "./ix-auth-session-controller.ts";

const probeIxAuthSession = vi.hoisted(() => vi.fn());
const submitIxAuthLogin = vi.hoisted(() => vi.fn());
const submitIxAuthMfaCode = vi.hoisted(() => vi.fn());
const submitIxAuthLogout = vi.hoisted(() => vi.fn());
const readIxAuthCsrfToken = vi.hoisted(() => vi.fn());

vi.mock("./ix-auth-session-api.ts", () => ({
  probeIxAuthSession,
  submitIxAuthLogin,
  submitIxAuthMfaCode,
  submitIxAuthLogout,
  readIxAuthCsrfToken,
}));

function createHost() {
  return { requestUpdate: vi.fn(), addController: vi.fn(), removeController: vi.fn(), updateComplete: Promise.resolve(true) };
}

const USER = {
  profileId: "p1",
  email: "person@example.com",
  displayName: "Person",
  roles: ["MEMBER"],
  groups: [],
};

describe("IxAuthSessionController", () => {
  let host: ReturnType<typeof createHost>;
  let controller: IxAuthSessionController;

  beforeEach(() => {
    host = createHost();
    controller = new IxAuthSessionController(host);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts with an unanswered probe, which is not the same as signed out", () => {
    expect(controller.session).toBeUndefined();
    expect(controller.form.submitting).toBe(false);
  });

  it("records the probed session and re-renders", async () => {
    probeIxAuthSession.mockResolvedValue({ authenticated: true, authMode: "ix-auth", user: USER });
    await controller.probe("");
    expect(controller.session?.user?.email).toBe("person@example.com");
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it("resets the form when the probe reports nobody signed in", async () => {
    controller.updateForm({ ...controller.form, email: "typed@example.com", password: "x" });
    probeIxAuthSession.mockResolvedValue({ authenticated: false });
    await controller.probe("");
    expect(controller.form.email).toBe("");
    expect(controller.form.password).toBe("");
  });

  it("refuses to submit an empty form and says why", async () => {
    expect(await controller.submit("")).toBe(false);
    expect(controller.form.errorKey).toBe("missingFields");
    expect(submitIxAuthLogin).not.toHaveBeenCalled();
  });

  it("reports success and clears the password", async () => {
    controller.updateForm({ ...controller.form, email: "person@example.com", password: "pw" });
    submitIxAuthLogin.mockResolvedValue({ kind: "authenticated", user: USER, csrfToken: "c" });
    probeIxAuthSession.mockResolvedValue({ authenticated: true, authMode: "ix-auth", user: USER });
    expect(await controller.submit("")).toBe(true);
    expect(controller.session?.authenticated).toBe(true);
    expect(controller.form.password).toBe("");
  });

  it("moves to the second factor without reporting a session", async () => {
    controller.updateForm({ ...controller.form, email: "person@example.com", password: "pw" });
    submitIxAuthLogin.mockResolvedValue({ kind: "mfa-required", challenge: "ch" });
    expect(await controller.submit("")).toBe(false);
    expect(controller.form.mfaChallenge).toBe("ch");
    expect(controller.form.password).toBe("");
    expect(controller.session).toBeUndefined();
  });

  it("submits the code once a challenge is pending", async () => {
    controller.updateForm({ ...controller.form, mfaChallenge: "ch", mfaCode: "123456" });
    submitIxAuthMfaCode.mockResolvedValue({ kind: "authenticated", user: USER, csrfToken: "c" });
    probeIxAuthSession.mockResolvedValue({ authenticated: true, authMode: "ix-auth", user: USER });
    expect(await controller.submit("")).toBe(true);
    expect(submitIxAuthMfaCode).toHaveBeenCalledWith(
      expect.objectContaining({ challenge: "ch", code: "123456" }),
    );
    expect(submitIxAuthLogin).not.toHaveBeenCalled();
  });

  it("surfaces a failure key and keeps the user on the form", async () => {
    controller.updateForm({ ...controller.form, email: "person@example.com", password: "pw" });
    submitIxAuthLogin.mockResolvedValue({ kind: "failed", errorKey: "accountLocked", lockedUntilMs: 42 });
    expect(await controller.submit("")).toBe(false);
    expect(controller.form.errorKey).toBe("accountLocked");
    expect(controller.form.lockedUntilMs).toBe(42);
    expect(controller.session).toBeUndefined();
  });

  it("ignores a second submit while one is in flight", async () => {
    controller.updateForm({ ...controller.form, email: "person@example.com", password: "pw", submitting: true });
    expect(await controller.submit("")).toBe(false);
    expect(submitIxAuthLogin).not.toHaveBeenCalled();
  });
});
