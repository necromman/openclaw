// One submission on the pre-connection gate, expressed as a state transition.
//
// Kept out of the application shell so the rules of these forms (what clears, what
// carries over, when a session exists) can be read and tested without the whole app tree.
import type { IxAuthAccountResult } from "./ix-auth-account-api.ts";
import { clearIxAuthFormSecrets, type IxAuthFormState } from "./ix-auth-form-state.ts";
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

/** Notice shown after each account screen finishes its one job. */
const IX_AUTH_SCREEN_NOTICES: Readonly<Record<string, string>> = Object.freeze({
  signup: "signupRequested",
  "forgot-password": "resetRequested",
  "reset-password": "passwordReset",
  "verify-email": "emailVerified",
  "accept-invite": "inviteAccepted",
});

/**
 * Submit one of the account screens.
 *
 * The client is loaded on demand: signing in is the common path and never reaches these
 * routes, so keeping them out of the startup bundle costs nothing to the person who is
 * only signing in.
 */
async function runAccountScreen(params: {
  basePath: string;
  state: IxAuthFormState;
}): Promise<IxAuthAccountResult> {
  const { state } = params;
  const token = state.token ?? "";
  const {
    submitIxAuthEmailVerify,
    submitIxAuthInviteAccept,
    submitIxAuthPasswordForgot,
    submitIxAuthPasswordReset,
    submitIxAuthSignup,
  } = await import("./ix-auth-account-api.ts");
  switch (state.screen) {
    case "signup":
      return await submitIxAuthSignup({
        basePath: params.basePath,
        email: state.email.trim(),
        password: state.password,
        name: state.name.trim() || undefined,
      });
    case "forgot-password":
      return await submitIxAuthPasswordForgot({
        basePath: params.basePath,
        email: state.email.trim(),
      });
    case "reset-password":
      return await submitIxAuthPasswordReset({
        basePath: params.basePath,
        token,
        newPassword: state.password,
      });
    case "verify-email":
      return await submitIxAuthEmailVerify({ basePath: params.basePath, token });
    default:
      return await submitIxAuthInviteAccept({
        basePath: params.basePath,
        token,
        password: state.password,
        name: state.name.trim() || undefined,
      });
  }
}

/**
 * Submit whichever step the form is currently on.
 *
 * The caller has already marked the state as submitting. Every outcome clears the
 * password and any code, so a secret never survives the request that used it.
 */
export async function runIxAuthSignInStep(params: {
  basePath: string;
  state: IxAuthFormState;
}): Promise<IxAuthSignInStep> {
  const { state } = params;
  if (state.screen !== "sign-in") {
    const result = await runAccountScreen(params);
    if (result.kind === "accepted") {
      return {
        nextState: {
          ...clearIxAuthFormSecrets(state),
          noticeKey: IX_AUTH_SCREEN_NOTICES[state.screen],
          // The token is one-time on the identity server, so keeping it would only offer
          // a second submission that is certain to fail.
          token: undefined,
        },
      };
    }
    return {
      nextState: {
        ...clearIxAuthFormSecrets(state),
        errorKey: result.errorKey,
        errorDetail: result.message,
      },
    };
  }

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
  switch (state.screen) {
    case "sign-in":
      if (state.mfaChallenge) {
        return state.mfaCode.trim() ? undefined : "invalidCode";
      }
      return state.email.trim() && state.password ? undefined : "missingFields";
    case "forgot-password":
      return state.email.trim() ? undefined : "missingEmail";
    case "verify-email":
      return state.token ? undefined : "missingToken";
    case "signup":
      if (!state.email.trim() || !state.password) {
        return "missingFields";
      }
      return state.password === state.confirmPassword ? undefined : "passwordMismatch";
    default:
      if (!state.token) {
        return "missingToken";
      }
      if (!state.password) {
        return "missingFields";
      }
      return state.password === state.confirmPassword ? undefined : "passwordMismatch";
  }
}
