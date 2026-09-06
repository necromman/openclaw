// Sign-in form state for the identity-server login screen, kept outside the app-root
// component so the view, the reducer, and their tests do not need the full app tree.

export type IxAuthFormState = {
  email: string;
  password: string;
  showPassword: boolean;
  mfaChallenge?: string;
  mfaCode: string;
  submitting: boolean;
  errorKey?: string;
  lockedUntilMs?: number;
};

export function createEmptyIxAuthFormState(): IxAuthFormState {
  return { email: "", password: "", showPassword: false, mfaCode: "", submitting: false };
}

/**
 * Clear every secret the form holds while keeping the typed email.
 *
 * Called after a submit resolves so a password never lingers in component state longer
 * than the request that used it.
 */
export function clearIxAuthFormSecrets(state: IxAuthFormState): IxAuthFormState {
  return {
    ...state,
    password: "",
    mfaCode: "",
    showPassword: false,
    submitting: false,
  };
}

/** Format an automatic lockout expiry for display, or undefined when unknown. */
export function formatIxAuthLockoutTime(
  lockedUntilMs: number | undefined,
  locale?: string,
): string | undefined {
  if (lockedUntilMs === undefined || !Number.isFinite(lockedUntilMs)) {
    return undefined;
  }
  try {
    return new Date(lockedUntilMs).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return undefined;
  }
}
