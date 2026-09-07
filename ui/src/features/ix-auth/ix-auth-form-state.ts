// Form state for the identity-server pre-connection screens, kept outside the app-root
// component so the view, the reducer, and their tests do not need the full app tree.
import type { IxAuthScreen } from "./ix-auth-account-screen.ts";

export type IxAuthFormState = {
  /** Which screen the gate is showing. Chosen from the address on first render. */
  screen: IxAuthScreen;
  email: string;
  password: string;
  /** Second entry on the screens that set a password for the first time. */
  confirmPassword: string;
  /** Display name, offered only where the person is creating their own account. */
  name: string;
  showPassword: boolean;
  mfaChallenge?: string;
  mfaCode: string;
  /** Token lifted out of a mail link. Never inspected here; the Gateway relays it. */
  token?: string;
  submitting: boolean;
  errorKey?: string;
  /** Wording the identity server supplied, shown alongside a password-policy refusal. */
  errorDetail?: string;
  /** Key under `ixAuth.notice.*` shown once a screen has done its work. */
  noticeKey?: string;
  lockedUntilMs?: number;
};

export function createEmptyIxAuthFormState(): IxAuthFormState {
  return {
    screen: "sign-in",
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
    showPassword: false,
    mfaCode: "",
    submitting: false,
  };
}

/** Start one of the mail-link or signup screens with the token the address carried. */
export function createIxAuthScreenState(params: {
  screen: IxAuthScreen;
  token?: string;
}): IxAuthFormState {
  return { ...createEmptyIxAuthFormState(), screen: params.screen, token: params.token };
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
    confirmPassword: "",
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

/**
 * Everything the pre-connection views render from.
 *
 * Declared here rather than in either component so the sign-in card and the mail-link
 * screens can both read it without importing each other.
 */
export type IxAuthLoginProps = {
  resourceBasePath: string;
  screen: IxAuthScreen;
  /** False when the identity server refuses signups, which hides the signup link. */
  selfSignupEnabled: boolean;
  email: string;
  password: string;
  confirmPassword: string;
  name: string;
  showPassword: boolean;
  /** Set once the identity server asked for a second factor. */
  mfaChallenge?: string;
  mfaCode: string;
  token?: string;
  submitting: boolean;
  /** Key under `ixAuth.error.*`, or undefined when nothing failed yet. */
  errorKey?: string;
  errorDetail?: string;
  /** Key under `ixAuth.notice.*`, set once a screen has finished its work. */
  noticeKey?: string;
  /** Formatted wall-clock time an automatic lockout expires, when known. */
  lockedUntilLabel?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onTogglePassword: () => void;
  onMfaCodeChange: (value: string) => void;
  onSubmit: () => void;
  onNavigate: (screen: IxAuthScreen) => void;
  onCancelMfa: () => void;
};

/** Callbacks the sign-in view needs, supplied by whoever owns the form state. */
export type IxAuthFormHandlers = {
  onChange: (next: IxAuthFormState) => void;
  onSubmit: () => void;
  /** Move to another pre-connection screen without a page load. */
  onNavigate: (screen: IxAuthScreen) => void;
};

/**
 * Build the view's props from one form state plus the change callbacks.
 *
 * Keeps the field-by-field update logic out of the application shell, which is already
 * at its line budget and has nothing to say about how these forms work.
 */
export function buildIxAuthLoginProps(params: {
  resourceBasePath: string;
  state: IxAuthFormState;
  selfSignupEnabled: boolean;
  handlers: IxAuthFormHandlers;
}): IxAuthLoginProps {
  const { state, handlers } = params;
  const patch = (next: Partial<IxAuthFormState>) => {
    handlers.onChange({ ...state, ...next, errorKey: undefined, errorDetail: undefined });
  };
  return {
    resourceBasePath: params.resourceBasePath,
    screen: state.screen,
    selfSignupEnabled: params.selfSignupEnabled,
    email: state.email,
    password: state.password,
    confirmPassword: state.confirmPassword,
    name: state.name,
    showPassword: state.showPassword,
    mfaChallenge: state.mfaChallenge,
    mfaCode: state.mfaCode,
    token: state.token,
    submitting: state.submitting,
    errorKey: state.errorKey,
    errorDetail: state.errorDetail,
    noticeKey: state.noticeKey,
    lockedUntilLabel: formatIxAuthLockoutTime(state.lockedUntilMs),
    onEmailChange: (email: string) => patch({ email }),
    onPasswordChange: (password: string) => patch({ password }),
    onConfirmPasswordChange: (confirmPassword: string) => patch({ confirmPassword }),
    onNameChange: (name: string) => patch({ name }),
    onTogglePassword: () => patch({ showPassword: !state.showPassword }),
    onMfaCodeChange: (mfaCode: string) => patch({ mfaCode }),
    onSubmit: handlers.onSubmit,
    onNavigate: handlers.onNavigate,
    onCancelMfa: () => handlers.onChange(createEmptyIxAuthFormState()),
  };
}
