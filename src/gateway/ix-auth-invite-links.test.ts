import { afterEach, describe, expect, it } from "vitest";
import {
  captureIxAuthInviteLink,
  forgetIxAuthInviteLink,
  listIxAuthInviteLinks,
  readIxAuthInviteLink,
  resetIxAuthInviteLinks,
  waitForIxAuthInviteLink,
} from "./ix-auth-invite-links.js";

const NOW = 1_800_000_000_000;
const TTL_MS = 72 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

afterEach(() => {
  resetIxAuthInviteLinks();
});

describe("captureIxAuthInviteLink", () => {
  it("reads back the link it captured", () => {
    captureIxAuthInviteLink({ email: "invitee@example.test", link: "https://x/i/one", nowMs: NOW });
    expect(readIxAuthInviteLink({ email: "invitee@example.test", nowMs: NOW })).toBe(
      "https://x/i/one",
    );
  });

  it("matches an address regardless of case or surrounding space", () => {
    captureIxAuthInviteLink({ email: "Invitee@Example.test", link: "https://x/i/one", nowMs: NOW });
    expect(readIxAuthInviteLink({ email: "  invitee@example.test ", nowMs: NOW })).toBe(
      "https://x/i/one",
    );
  });

  it("replaces the previous link for one address", () => {
    // A fresh invitation invalidates the previous token upstream, so keeping both
    // would offer an administrator a link that no longer works.
    captureIxAuthInviteLink({ email: "invitee@example.test", link: "https://x/i/one", nowMs: NOW });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://x/i/two",
      nowMs: NOW + 1_000,
    });
    expect(readIxAuthInviteLink({ email: "invitee@example.test", nowMs: NOW + 1_000 })).toBe(
      "https://x/i/two",
    );
    expect(listIxAuthInviteLinks(NOW + 1_000)).toHaveLength(1);
  });

  it("ignores a capture with no address or no link", () => {
    captureIxAuthInviteLink({ email: "   ", link: "https://x/i/one", nowMs: NOW });
    captureIxAuthInviteLink({ email: "invitee@example.test", link: "", nowMs: NOW });
    expect(listIxAuthInviteLinks(NOW)).toHaveLength(0);
  });
});

describe("invite link expiry", () => {
  it("withholds a link older than the invitation lifetime", () => {
    captureIxAuthInviteLink({ email: "invitee@example.test", link: "https://x/i/one", nowMs: NOW });
    expect(readIxAuthInviteLink({ email: "invitee@example.test", nowMs: NOW + TTL_MS - 1 })).toBe(
      "https://x/i/one",
    );
    expect(
      readIxAuthInviteLink({ email: "invitee@example.test", nowMs: NOW + TTL_MS }),
    ).toBeUndefined();
  });

  it("drops an expired entry out of the listing", () => {
    captureIxAuthInviteLink({ email: "old@example.test", link: "https://x/i/old", nowMs: NOW });
    captureIxAuthInviteLink({
      email: "new@example.test",
      link: "https://x/i/new",
      nowMs: NOW + TTL_MS,
    });
    expect(listIxAuthInviteLinks(NOW + TTL_MS)).toEqual([
      { email: "new@example.test", link: "https://x/i/new", capturedAtMs: NOW + TTL_MS },
    ]);
  });
});

describe("listIxAuthInviteLinks", () => {
  it("returns the newest capture first", () => {
    captureIxAuthInviteLink({ email: "first@example.test", link: "https://x/i/1", nowMs: NOW });
    captureIxAuthInviteLink({
      email: "second@example.test",
      link: "https://x/i/2",
      nowMs: NOW + 10,
    });
    captureIxAuthInviteLink({
      email: "third@example.test",
      link: "https://x/i/3",
      nowMs: NOW + 20,
    });
    expect(listIxAuthInviteLinks(NOW + 20).map((entry) => entry.email)).toEqual([
      "third@example.test",
      "second@example.test",
      "first@example.test",
    ]);
  });

  it("evicts the oldest entry once the cap is passed", () => {
    for (let index = 0; index < MAX_ENTRIES; index += 1) {
      captureIxAuthInviteLink({
        email: `person-${index}@example.test`,
        link: `https://x/i/${index}`,
        nowMs: NOW + index,
      });
    }
    expect(listIxAuthInviteLinks(NOW + MAX_ENTRIES)).toHaveLength(MAX_ENTRIES);
    captureIxAuthInviteLink({
      email: "one-too-many@example.test",
      link: "https://x/i/last",
      nowMs: NOW + MAX_ENTRIES,
    });
    const held = listIxAuthInviteLinks(NOW + MAX_ENTRIES);
    expect(held).toHaveLength(MAX_ENTRIES);
    expect(held[0]?.email).toBe("one-too-many@example.test");
    expect(
      readIxAuthInviteLink({ email: "person-0@example.test", nowMs: NOW + MAX_ENTRIES }),
    ).toBeUndefined();
    expect(readIxAuthInviteLink({ email: "person-1@example.test", nowMs: NOW + MAX_ENTRIES })).toBe(
      "https://x/i/1",
    );
  });
});

describe("waitForIxAuthInviteLink", () => {
  it("resolves at once when the link is already held", async () => {
    captureIxAuthInviteLink({ email: "invitee@example.test", link: "https://x/i/one", nowMs: NOW });
    await expect(
      waitForIxAuthInviteLink({ email: "invitee@example.test", nowMs: NOW, timeoutMs: 20 }),
    ).resolves.toBe("https://x/i/one");
  });

  it("resolves when the webhook arrives during the wait", async () => {
    const pending = waitForIxAuthInviteLink({
      email: "invitee@example.test",
      nowMs: Date.now(),
      timeoutMs: 50,
    });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://x/i/late",
      nowMs: Date.now(),
    });
    await expect(pending).resolves.toBe("https://x/i/late");
  });

  it("wakes every waiter for one address", async () => {
    const first = waitForIxAuthInviteLink({
      email: "invitee@example.test",
      nowMs: Date.now(),
      timeoutMs: 50,
    });
    const second = waitForIxAuthInviteLink({
      email: "invitee@example.test",
      nowMs: Date.now(),
      timeoutMs: 50,
    });
    captureIxAuthInviteLink({
      email: "invitee@example.test",
      link: "https://x/i/late",
      nowMs: Date.now(),
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      "https://x/i/late",
      "https://x/i/late",
    ]);
  });

  it("gives up rather than holding the invitation response open", async () => {
    // The mail webhook races the create-user answer; a deployment with real SMTP
    // never posts one at all, so the wait must end on its own.
    await expect(
      waitForIxAuthInviteLink({ email: "nobody@example.test", nowMs: Date.now(), timeoutMs: 20 }),
    ).resolves.toBeUndefined();
  });

  it("does not wait at all for an empty address", async () => {
    await expect(
      waitForIxAuthInviteLink({ email: "   ", nowMs: Date.now(), timeoutMs: 20 }),
    ).resolves.toBeUndefined();
  });
});

describe("forgetIxAuthInviteLink", () => {
  it("removes one address and leaves the rest", () => {
    captureIxAuthInviteLink({ email: "kept@example.test", link: "https://x/i/kept", nowMs: NOW });
    captureIxAuthInviteLink({ email: "gone@example.test", link: "https://x/i/gone", nowMs: NOW });
    expect(forgetIxAuthInviteLink("GONE@example.test")).toBe(true);
    expect(forgetIxAuthInviteLink("gone@example.test")).toBe(false);
    expect(listIxAuthInviteLinks(NOW).map((entry) => entry.email)).toEqual(["kept@example.test"]);
  });
});

describe("resetIxAuthInviteLinks", () => {
  it("clears every captured link", () => {
    captureIxAuthInviteLink({ email: "a@example.test", link: "https://x/i/a", nowMs: NOW });
    captureIxAuthInviteLink({ email: "b@example.test", link: "https://x/i/b", nowMs: NOW });
    resetIxAuthInviteLinks();
    expect(listIxAuthInviteLinks(NOW)).toEqual([]);
  });
});
