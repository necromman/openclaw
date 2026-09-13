/* @vitest-environment jsdom */
import "./impersonation-banner.ts";
import { afterEach, expect, it, vi } from "vitest";
import { probeIxAuthSession } from "./ix-auth-session-api.ts";

afterEach(() => {
  document.body.replaceChildren();
  document.cookie = "openclaw-session-csrf=; Max-Age=0; path=/";
  vi.unstubAllGlobals();
});

it.each([200, 401])(
  "restores an expired target session, handling stop status %s",
  async (status) => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authMode: "ix-auth",
            authenticated: false,
            impersonationRestoreAvailable: true,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status }));
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "openclaw-session-csrf=csrf-test; path=/";
    await probeIxAuthSession("/gateway");
    const banner = document.createElement("openclaw-impersonation-banner");
    banner.setAttribute("basepath", "/gateway");
    document.body.append(banner);
    await vi.waitFor(() => expect(banner.textContent).toContain("This user's session has ended"));
    banner.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith(status === 200 ? "/gateway/settings/users" : "/gateway/"),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/gateway/auth/impersonation/stop",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "x-openclaw-csrf": "csrf-test" }),
      }),
    );
  },
);

it("shows a failed return and keeps the button available for retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authMode: "ix-auth",
            authenticated: true,
            user: {
              profileId: "target",
              email: "target@example.test",
              impersonatedBy: "admin@example.test",
            },
          }),
        ),
      )
      .mockRejectedValueOnce(new Error("network")),
  );
  await probeIxAuthSession("");
  const banner = document.createElement("openclaw-impersonation-banner");
  document.body.append(banner);
  await vi.waitFor(() => expect(banner.querySelector("button")).not.toBeNull());
  banner.querySelector<HTMLButtonElement>("button")!.click();
  await vi.waitFor(() =>
    expect(banner.querySelector('[role="alert"]')?.textContent).toContain("Try again"),
  );
  expect(banner.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
});
