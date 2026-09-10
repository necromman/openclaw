// Per-person home session for the ix-auth Gateway mode.
//
// "Home" is the session the sidebar opens on, and its key is built from one configured
// word: `agent:<agent id>:<session.mainKey>`. One word for the whole deployment means one
// conversation for the whole company. On a personal install that is right - there is one
// person. On this delivery every employee opened the same thread, read each other's
// questions in it, and wrote into the middle of someone else's.
//
// The fix keeps the shape and changes the word. Everything else about the session stays
// ordinary: it is created on first use like any other session, it records the person who
// created it, and every existing visibility rule applies to it unchanged. Nothing needed
// to learn about a new kind of session.
//
// Only what a browser is told changes. The configured `session.mainKey` still governs
// every host-side path - cron, channel routing, sandbox classification, the CLI - because
// those runs have no person to ask. The old shared `agent:main:main` thread therefore
// keeps existing and keeps its contents; with `sessions.others` narrowed it is simply no
// longer anyone's landing page, and only a reader whose role admits other people's
// sessions can still open it.
import { createHash } from "node:crypto";
import { GATEWAY_OWNER_PROFILE_ID } from "../../packages/gateway-protocol/src/schema/users.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizeMainKey, parseAgentSessionKey } from "../routing/session-key.js";
import type { GatewayClient } from "./server-methods/client-types.js";

/** Caller shape this needs: the verified profile attached at handshake, or nothing. */
type HomeSessionCaller = Pick<GatewayClient, "authenticatedUserProfile"> | null | undefined;

/**
 * The main-session word to advertise to one caller.
 *
 * Falls back to the configured word whenever there is no person to separate: any auth
 * mode but ix-auth, the global session scope (which routes every agent to one stream by
 * design), the Gateway owner profile that host-minted work runs as, and any connection
 * that carried no profile at all.
 *
 * The profile id is hashed rather than pasted in. A session key travels through logs,
 * file names and URLs, and an opaque, fixed-length, lowercase-hex word cannot collide
 * with the key grammar's separators or leak an identifier into places that only needed a
 * conversation name. Sixteen hex characters is 64 bits: collision-free for any employee
 * count by many orders of magnitude.
 */
export function resolveCallerMainKey(params: {
  cfg: OpenClawConfig | undefined;
  client: HomeSessionCaller;
}): string {
  const configured = normalizeMainKey(params.cfg?.session?.mainKey);
  if (params.cfg?.gateway?.auth?.mode !== "ix-auth") {
    return configured;
  }
  if (params.cfg?.session?.scope === "global") {
    return configured;
  }
  const profileId = params.client?.authenticatedUserProfile?.profileId?.trim();
  if (!profileId || profileId === GATEWAY_OWNER_PROFILE_ID) {
    return configured;
  }
  const digest = createHash("sha256").update(profileId).digest("hex").slice(0, 16);
  return `${configured}-u${digest}`;
}

/** Person-scoped home suffix minted by `resolveCallerMainKey`: `-u` plus 16 lowercase hex. */
const PERSON_HOME_SUFFIX = /^-u[0-9a-f]{16}$/;

/**
 * Whether a session key names a home session - anyone's, not just the caller's.
 *
 * Home keys stopped being one word per deployment: every person's landing page is
 * `<configured main>-u<16 hex>`, and the pre-split shared thread still carries the bare
 * configured word. A reader who may see other people's sessions therefore meets home keys
 * that are not their own, and comparing against one caller's key would miss them. This
 * judges the shape instead, so every home session answers the same way no matter whose it
 * is or which era it was created in.
 */
export function isHomeSessionKey(params: {
  key: string | undefined | null;
  cfg?: { session?: { mainKey?: string } } | undefined;
}): boolean {
  const raw = (params.key ?? "").trim().toLowerCase();
  if (!raw) {
    return false;
  }
  const rest = parseAgentSessionKey(raw)?.rest ?? raw;
  const configured = normalizeMainKey(params.cfg?.session?.mainKey);
  if (rest === configured) {
    return true;
  }
  return rest.startsWith(configured) && PERSON_HOME_SUFFIX.test(rest.slice(configured.length));
}
