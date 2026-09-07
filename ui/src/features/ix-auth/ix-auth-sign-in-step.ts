// One sign-in submission, expressed as a state transition.
//
// Kept out of the application shell so the form's rules (what clears, what carries over,
// when a session exists) can be read and tested without the whole app tree.
import {
  clearIxAuthFormSecrets,
  type IxAuthFormState,
} from "./ix-auth-form-state.ts";
import {
  submitIxAuthLogin,
  submitIxAuthMfaCode,
  type IxAuthSessionUser,
} from "./ix-auth-session-api.ts";

export type IxAuthSignInStep = {
  nextState: IxAuthFormState;
  /** Present only when the submission produced a live session. */
  user?: IxAuthSessionUser;
};

/**
 * Submit the credential step the form is currently on.
 *
 * The caller has already marked the state as submitting. Every outcome clears the
 * password and any code, so a secret never survives the request that used it.
 */
export async function runIxAuthSignInStep(params: {
  basePath: string;
  state: IxAuthFormState;
}): Promise<IxAuthSignInStep> {
  const { state } = params;
  const result = state.mfaChallenge
    ? await submitIxAuthMfaCode({
        basePath: params.basePath,
        challenge: state.mfaChallenge,
        code: state.mfaCode.trim(),
      })
    : await submitIxAuthLogin({
        basePath: params.basePath,
        email: state.email.trim(),
        password: state.password,
      });

  if (result.kind === "authenticated") {
    return {
      nextState: clearIxAuthFormSecrets({ ...state, mfaChallenge: undefined }),
      user: result.user,
    };
  }
  if (result.kind === "mfa-required") {
    // Keep the email so the second step still shows who is signing in.
    return {
      nextState: { ...clearIxAuthFormSecrets(state), mfaChallenge: result.challenge },
    };
  }
  return {
    nextState: {
      ...clearIxAuthFormSecrets(state),
      errorKey: result.errorKey,
      lockedUntilMs: result.lockedUntilMs,
    },
  };
}

/** True when the form cannot be submitted yet, with the message key explaining why. */
export function findIxAuthSubmitBlocker(state: IxAuthFormState): string | undefined {
  if (state.mfaChallenge) {
    return state.mfaCode.trim() ? undefined : "invalidCode";
  }
  return state.email.trim() && state.password ? undefined : "missingFields";
}
