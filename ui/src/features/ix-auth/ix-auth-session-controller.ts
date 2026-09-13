// Owns the identity-server session and the pre-connection forms for the application
// shell.
//
// A controller rather than shell fields, so the rules of these screens live next to the
// rest of this feature and the shell keeps only the render decision.
import type { ReactiveControllerHost } from "lit";
import {
  ixAuthScreenNeedsToken,
  resolveIxAuthScreenFromLocation,
  type IxAuthScreen,
} from "./ix-auth-account-screen.ts";
import {
  createIxAuthScreenState,
  type IxAuthFormState,
} from "./ix-auth-form-state.ts";
import {
  classifyIxAuthConnectFailure,
  decideIxAuthRecovery,
  rememberIxAuthReturnPath,
  takeIxAuthReturnPath,
} from "./ix-auth-reconnect.ts";
import { probeIxAuthSession, type IxAuthSessionState } from "./ix-auth-session-api.ts";
import { findIxAuthSubmitBlocker, runIxAuthSignInStep } from "./ix-auth-sign-in-step.ts";

/** Immediate reconnects one tab may spend before it falls back to plain backoff. */
const IX_AUTH_RECOVERY_RECONNECT_BUDGET = 3;

/** Address each screen lives at, matching the identity server's mail link paths. */
const IX_AUTH_SCREEN_ROUTES: Readonly<Record<IxAuthScreen, string>> = Object.freeze({
  "sign-in": "/",
  signup: "/signup",
  "forgot-password": "/forgot-password",
  "reset-password": "/reset-password",
  "verify-email": "/verify-email",
  "accept-invite": "/accept-invite",
});

export class IxAuthSessionController {
  /** Undefined until the session probe answers. Distinct from "answered: signed out". */
  session: IxAuthSessionState | undefined;
  /**
   * True once the Gateway has confirmed this browser is signed out.
   *
   * The shell reads it to hand the document back to the sign-in screen; without it a tab
   * that lost its session sits on "reconnecting" until somebody reloads by hand.
   */
  sessionLost = false;
  /** The refusal already acted on, so retries of the same one do not probe again. */
  private handledConnectFailure: string | null = null;
  /**
   * Immediate reconnects spent on refusals the probe called survivable.
   *
   * Bounded so a Gateway that refuses a session the probe keeps calling good cannot turn
   * into a connect-probe-connect loop. Past the budget the ordinary backoff takes over.
   */
  private recoveryReconnects = 0;
  form: IxAuthFormState;

  constructor(private readonly host: ReactiveControllerHost) {
    // Read once at construction: a person arriving on an invitation link must see that
    // screen on the first paint, before any request has answered.
    this.form = createIxAuthScreenState(
      resolveIxAuthScreenFromLocation({
        pathname: globalThis.location?.pathname ?? "/",
        search: globalThis.location?.search ?? "",
        basePath: "",
      }),
    );
  }

  /** Replace the form state and schedule a render. */
  updateForm(next: IxAuthFormState): void {
    this.form = next;
    this.host.requestUpdate();
  }

  /**
   * Move between pre-connection screens.
   *
   * The address changes with the screen so a reload stays where the person was, and
   * leaving a token screen drops the token from the address rather than leaving a spent
   * one in the history and in any copied link.
   */
  navigate(screen: IxAuthScreen, basePath: string): void {
    this.form = createIxAuthScreenState({
      screen,
      token: ixAuthScreenNeedsToken(screen) ? this.form.token : undefined,
    });
    const route = `${basePath.replace(/\/+$/u, "")}${IX_AUTH_SCREEN_ROUTES[screen]}`;
    try {
      globalThis.history?.replaceState(null, "", route);
    } catch {
      // A blocked history write only costs the address bar; the screen still changes.
    }
    this.host.requestUpdate();
  }

  /** Ask the Gateway whether this browser already holds a session. */
  async probe(basePath: string): Promise<IxAuthSessionState | undefined> {
    const session = await probeIxAuthSession(basePath);
    if (session.unavailable === true) {
      // Nobody answered, so nothing is known. Leaving the recorded answer alone keeps an
      // undefined session undefined, which the shell already renders as "still asking"
      // rather than as either login form.
      this.host.requestUpdate();
      return session;
    }
    this.session = session;
    if (!session.authenticated) {
      // Keep whichever screen the address named; a signed-out probe is the normal case
      // for someone who just followed an invitation.
      this.form = createIxAuthScreenState({
        screen: this.form.screen,
        token: this.form.token,
      });
    }
    this.host.requestUpdate();
    return session;
  }

  /**
   * Put a person back where the sign-in screen interrupted them.
   *
   * Only the address is restored; the application router reads it on the next render, so
   * no reload is needed and the freshly opened socket is kept.
   */
  private restoreReturnPath(): void {
    const target = takeIxAuthReturnPath();
    if (!target) {
      return;
    }
    try {
      globalThis.history?.replaceState(null, "", target);
    } catch {
      // A blocked history write only costs the return trip.
    }
  }

  /**
   * Decide what an open tab does after the Gateway refused its handshake.
   *
   * One refusal produces one probe, not one per retry: a roomful of tabs coming back
   * together after a redeploy must not turn a restarting Gateway into a flood.
   *
   * The reconnect supervisor retries anything it is not told to stop retrying, so a
   * session that has actually ended would be retried forever behind an "offline" badge.
   * The Gateway's own `/auth/me` is the authority on which case this is.
   */
  recoverAfterConnectFailure(params: {
    basePath: string;
    code?: string | null;
    authReason?: string | null;
    connected: boolean;
    reconnect: () => void;
  }): void {
    if (params.connected) {
      this.sessionLost = false;
      this.handledConnectFailure = null;
      this.recoveryReconnects = 0;
      return;
    }
    if (this.sessionLost || this.session?.authMode !== "ix-auth") {
      return;
    }
    const failure = classifyIxAuthConnectFailure({
      code: params.code,
      authReason: params.authReason,
    });
    // A deployment window answers `identity-unavailable`, and that is the one refusal to
    // simply wait out: the session was never judged, so the backoff keeps its turn.
    if (failure !== "unauthorized") {
      return;
    }
    const marker = `${params.code ?? ""}:${params.authReason ?? ""}`;
    if (this.handledConnectFailure === marker) {
      return;
    }
    this.handledConnectFailure = marker;
    void this.probe(params.basePath).then((probe) => {
      const action = decideIxAuthRecovery({ failure, probe });
      if (action === "show-gate") {
        // Record the address before the gate replaces it, so signing back in lands on the
        // conversation the person was reading rather than on the root route.
        rememberIxAuthReturnPath(
          `${globalThis.location?.pathname ?? "/"}${globalThis.location?.search ?? ""}`,
        );
        this.session = { ...(probe ?? {}), authMode: "ix-auth", authenticated: false };
        this.sessionLost = true;
        this.host.requestUpdate();
        return;
      }
      // Nothing was decided, or the cookie still works. Either way this refusal is spent,
      // so the next one is judged afresh.
      this.handledConnectFailure = null;
      if (action === "retry-connect" && this.recoveryReconnects < IX_AUTH_RECOVERY_RECONNECT_BUDGET) {
        this.recoveryReconnects += 1;
        params.reconnect();
      }
    });
  }

  /**
   * Submit the current screen.
   *
   * Resolves true once a session exists, which is the caller's signal to open the
   * WebSocket: the cookie is now set, so the ordinary connect path can authenticate.
   */
  async submit(basePath: string): Promise<boolean> {
    if (this.form.submitting) {
      return false;
    }
    const blocker = findIxAuthSubmitBlocker(this.form);
    if (blocker) {
      this.updateForm({ ...this.form, errorKey: blocker });
      return false;
    }
    this.sessionLost = false;
    this.recoveryReconnects = 0;
    this.updateForm({ ...this.form, submitting: true, errorKey: undefined, noticeKey: undefined });
    const step = await runIxAuthSignInStep({ basePath, state: this.form });
    this.form = step.nextState;
    if (!step.user) {
      this.host.requestUpdate();
      return false;
    }
    this.session = {
      authenticated: true,
      authMode: "ix-auth",
      user: step.user,
      // Sign-in does not return the admin console link; the probe below fills it in.
      adminConsoleUrl: this.session?.adminConsoleUrl,
      selfSignupEnabled: this.session?.selfSignupEnabled,
    };
    this.host.requestUpdate();
    void this.probe(basePath);
    this.restoreReturnPath();
    return true;
  }
}
