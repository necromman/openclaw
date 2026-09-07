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
import { probeIxAuthSession, type IxAuthSessionState } from "./ix-auth-session-api.ts";
import { findIxAuthSubmitBlocker, runIxAuthSignInStep } from "./ix-auth-sign-in-step.ts";

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
  async probe(basePath: string): Promise<void> {
    const session = await probeIxAuthSession(basePath);
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
    return true;
  }
}
