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

/** Callbacks the sign-in view needs, supplied by whoever owns the form state. */
export type IxAuthFormHandlers = {
  onChange: (next: IxAuthFormState) => void;
  onSubmit: () => void;
};

/**
 * Build the sign-in view's props from one form state plus a change callback.
 *
 * Keeps the field-by-field update logic out of the application shell, which is already
 * at its line budget and has nothing to say about how this form works.
 */
export function buildIxAuthLoginProps(params: {
  resourceBasePath: string;
  state: IxAuthFormState;
  handlers: IxAuthFormHandlers;
}) {
  const { state, handlers } = params;
  const patch = (next: Partial<IxAuthFormState>) => {
    handlers.onChange({ ...state, ...next, errorKey: undefined });
  };
  return {
    resourceBasePath: params.resourceBasePath,
    email: state.email,
    password: state.password,
    showPassword: state.showPassword,
    mfaChallenge: state.mfaChallenge,
    mfaCode: state.mfaCode,
    submitting: state.submitting,
    errorKey: state.errorKey,
    lockedUntilLabel: formatIxAuthLockoutTime(state.lockedUntilMs),
    onEmailChange: (email: string) => patch({ email }),
    onPasswordChange: (password: string) => patch({ password }),
    onTogglePassword: () => patch({ showPassword: !state.showPassword }),
    onMfaCodeChange: (mfaCode: string) => patch({ mfaCode }),
    onSubmit: handlers.onSubmit,
    onCancelMfa: () => handlers.onChange(createEmptyIxAuthFormState()),
  };
}
