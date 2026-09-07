// Holds the invitation links the identity server hands to the Gateway.
//
// The identity server always sends the mail itself. When the deployment has no SMTP
// server it is configured with `mail.transport: WEBHOOK` pointing back at the Gateway, so
// the link that would have been mailed arrives here instead and an administrator can copy
// it out of the invitation screen. With SMTP configured the mail goes out normally and
// nothing is captured, which is exactly the difference the two operating modes should
// have.
//
// Only invitations are kept. Password-reset and magic-link mails carry the same kind of
// one-time token but nobody needs to read those from a screen, and a link that logs the
// holder in must not sit in a process that a person can query.

/** Invitation links live no longer than the identity server's own invite token. */
const IX_AUTH_INVITE_LINK_TTL_MS = 72 * 60 * 60 * 1000;

/** Upper bound on retained links, so a mail storm cannot grow this map without end. */
const IX_AUTH_INVITE_LINK_MAX_ENTRIES = 200;

/**
 * How long an invitation request waits for the identity server's webhook.
 *
 * The webhook lands while the identity server is still answering the create-user call, so
 * the wait almost always ends early. It is short because on an SMTP deployment no webhook
 * ever arrives, and the whole window would then be added to every invitation.
 */
export const IX_AUTH_INVITE_LINK_WAIT_MS = 800;

type InviteLinkEntry = { link: string; capturedAtMs: number };

const linksByEmail = new Map<string, InviteLinkEntry>();
const waitersByEmail = new Map<string, Set<(link: string) => void>>();

/** One captured invitation, as the administration screen shows it. */
export type IxAuthInviteLink = { email: string; link: string; capturedAtMs: number };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function prune(nowMs: number): void {
  for (const [email, entry] of linksByEmail) {
    if (entry.capturedAtMs + IX_AUTH_INVITE_LINK_TTL_MS <= nowMs) {
      linksByEmail.delete(email);
    }
  }
  while (linksByEmail.size > IX_AUTH_INVITE_LINK_MAX_ENTRIES) {
    // Insertion order is capture order, so the oldest entry is the first key.
    const oldest = linksByEmail.keys().next();
    if (oldest.done) {
      return;
    }
    linksByEmail.delete(oldest.value);
  }
}

/**
 * Record the link the identity server produced for one address.
 *
 * A fresh invitation invalidates the previous token on the identity server, so the newest
 * link replaces the old one here too rather than accumulating dead links.
 */
export function captureIxAuthInviteLink(params: {
  email: string;
  link: string;
  nowMs: number;
}): void {
  const email = normalizeEmail(params.email);
  if (!email || !params.link) {
    return;
  }
  linksByEmail.delete(email);
  linksByEmail.set(email, { link: params.link, capturedAtMs: params.nowMs });
  prune(params.nowMs);
  const waiters = waitersByEmail.get(email);
  if (waiters) {
    waitersByEmail.delete(email);
    for (const resolve of waiters) {
      resolve(params.link);
    }
  }
}

/** Read the newest link for one address, or undefined when none was captured. */
export function readIxAuthInviteLink(params: { email: string; nowMs: number }): string | undefined {
  const entry = linksByEmail.get(normalizeEmail(params.email));
  if (!entry || entry.capturedAtMs + IX_AUTH_INVITE_LINK_TTL_MS <= params.nowMs) {
    return undefined;
  }
  return entry.link;
}

/** Every link still held, newest first, for the administration screen. */
export function listIxAuthInviteLinks(nowMs: number): IxAuthInviteLink[] {
  prune(nowMs);
  const entries: IxAuthInviteLink[] = [];
  for (const [email, entry] of linksByEmail) {
    entries.push({ email, link: entry.link, capturedAtMs: entry.capturedAtMs });
  }
  return entries.toReversed();
}

/** Forget one address, used after an administrator has passed the link on. */
export function forgetIxAuthInviteLink(email: string): boolean {
  return linksByEmail.delete(normalizeEmail(email));
}

/**
 * Wait briefly for a link to arrive.
 *
 * The identity server posts its webhook while it is still answering the create-user call,
 * but the two responses race. Waiting a moment lets the invitation screen show the link
 * immediately instead of telling an administrator to come back and look for it.
 */
export async function waitForIxAuthInviteLink(params: {
  email: string;
  nowMs: number;
  timeoutMs?: number;
}): Promise<string | undefined> {
  const existing = readIxAuthInviteLink(params);
  if (existing) {
    return existing;
  }
  const email = normalizeEmail(params.email);
  if (!email) {
    return undefined;
  }
  return await new Promise<string | undefined>((resolve) => {
    const waiters = waitersByEmail.get(email) ?? new Set<(link: string) => void>();
    const settle = (link: string | undefined) => {
      clearTimeout(timer);
      waiters.delete(onCaptured);
      if (waiters.size === 0) {
        waitersByEmail.delete(email);
      }
      resolve(link);
    };
    const onCaptured = (link: string) => settle(link);
    const timer = setTimeout(
      () => settle(undefined),
      params.timeoutMs ?? IX_AUTH_INVITE_LINK_WAIT_MS,
    );
    // A pending invitation must never hold the process open on its own.
    timer.unref?.();
    waiters.add(onCaptured);
    waitersByEmail.set(email, waiters);
  });
}

/** Drop every captured link. Used by tests and by a configuration reload. */
export function resetIxAuthInviteLinks(): void {
  linksByEmail.clear();
  // Pending waiters are released rather than abandoned, so a reset cannot leave a request
  // hanging until its own timeout.
  const pending = [...waitersByEmail.values()];
  waitersByEmail.clear();
  for (const waiters of pending) {
    for (const resolve of waiters) {
      resolve("");
    }
  }
}
