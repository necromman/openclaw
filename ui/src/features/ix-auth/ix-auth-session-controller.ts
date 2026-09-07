// Owns the identity-server session and sign-in form for the application shell.
//
// A controller rather than shell fields, so the sign-in rules live next to the rest of
// this feature and the shell keeps only the render decision.
import type { ReactiveControllerHost } from "lit";
import { createEmptyIxAuthFormState, type IxAuthFormState } from "./ix-auth-form-state.ts";
import { probeIxAuthSession, type IxAuthSessionState } from "./ix-auth-session-api.ts";
import { findIxAuthSubmitBlocker, runIxAuthSignInStep } from "./ix-auth-sign-in-step.ts";

export class IxAuthSessionController {
  /** Undefined until the session probe answers. Distinct from "answered: signed out". */
  session: IxAuthSessionState | undefined;
  form: IxAuthFormState = createEmptyIxAuthFormState();

  constructor(private readonly host: ReactiveControllerHost) {}

  /** Replace the form state and schedule a render. */
  updateForm(next: IxAuthFormState): void {
    this.form = next;
    this.host.requestUpdate();
  }

  /** Ask the Gateway whether this browser already holds a session. */
  async probe(basePath: string): Promise<void> {
    const session = await probeIxAuthSession(basePath);
    this.session = session;
    if (!session.authenticated) {
      this.form = createEmptyIxAuthFormState();
    }
    this.host.requestUpdate();
  }

  /**
   * Submit the current credential step.
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
    this.updateForm({ ...this.form, submitting: true, errorKey: undefined });
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
    };
    this.host.requestUpdate();
    void this.probe(basePath);
    return true;
  }
}
