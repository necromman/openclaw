// Which pre-connection screen a visitor is on.
//
// The identity server mails links that point at this application, at the paths below
// (its `mail.reset-path`, `verify-path`, and `invite-path` defaults). Nobody following
// one of those links has a session yet, so the screen is chosen from the address rather
// than from the router, which only runs once a connection exists.

/** Screens the pre-connection gate can show. */
export type IxAuthScreen =
  | "sign-in"
  | "signup"
  | "forgot-password"
  | "reset-password"
  | "verify-email"
  | "accept-invite";

const IX_AUTH_SCREEN_PATHS: ReadonlyMap<string, IxAuthScreen> = new Map<string, IxAuthScreen>([
  ["/signup", "signup"],
  ["/forgot-password", "forgot-password"],
  ["/reset-password", "reset-password"],
  ["/verify-email", "verify-email"],
  ["/accept-invite", "accept-invite"],
]);

/** Paths whose screens are useless without a token from the link. */
const IX_AUTH_TOKEN_SCREENS: ReadonlySet<IxAuthScreen> = new Set<IxAuthScreen>([
  "reset-password",
  "verify-email",
  "accept-invite",
]);

/** True when this screen cannot be shown without the token from the mail link. */
export function ixAuthScreenNeedsToken(screen: IxAuthScreen): boolean {
  return IX_AUTH_TOKEN_SCREENS.has(screen);
}

function stripBasePath(pathname: string, basePath: string): string {
  const base = basePath.replace(/\/+$/u, "");
  if (base.length > 0 && pathname.startsWith(base)) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}

/**
 * Resolve the screen and any token carried in the address.
 *
 * An unknown path is the sign-in screen, not an error: this gate stands in front of the
 * whole application, so every deep link a signed-out person opens arrives here.
 */
export function resolveIxAuthScreenFromLocation(params: {
  pathname: string;
  search: string;
  basePath: string;
}): { screen: IxAuthScreen; token?: string } {
  const path = stripBasePath(params.pathname, params.basePath).replace(/\/+$/u, "") || "/";
  const screen = IX_AUTH_SCREEN_PATHS.get(path);
  if (!screen) {
    return { screen: "sign-in" };
  }
  let token: string | undefined;
  try {
    token = new URLSearchParams(params.search).get("token") ?? undefined;
  } catch {
    // A malformed query string is treated as no token, which lands on the same "ask for
    // a new link" message a stale token produces.
    token = undefined;
  }
  return { screen, token: token && token.length > 0 ? token : undefined };
}
