import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

// Copy for the account sign-in screen shown when the Gateway delegates identity to an
// identity server. It loads with the lazy login view, like en-login.ts.
const enIxAuth = {
  ixAuth: {
    title: "Sign in",
    subtitle: "Use your work account.",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    submit: "Sign in",
    submitting: "Signing in",
    signOut: "Sign out",
    signedInAs: "Signed in as {email}",
    manageUsers: "Manage users",
    impersonating: "Viewing as this user. Administrator: {admin}",
    totp: {
      title: "Two-step verification",
      subtitle: "Enter the six-digit code from your authenticator app.",
      code: "Verification code",
      submit: "Verify",
      back: "Back to sign in",
    },
    error: {
      // One message for a wrong password and for an unknown account, so the form
      // never reveals which addresses exist.
      invalidCredentials: "The email or password is incorrect.",
      invalidCode: "That code is not valid.",
      missingFields: "Enter your email and password.",
      accountLocked: "This account is locked. Contact an administrator.",
      accountLockedUntil: "Too many attempts. Try again after {time}.",
      accountDisabled: "This account is disabled.",
      accountPendingApproval: "This account is waiting for administrator approval.",
      accountPending: "Accept the invitation email before signing in.",
      rateLimited: "Too many attempts. Wait a moment and try again.",
      identityUnavailable: "The identity server is unavailable. Try again shortly.",
      network: "Could not reach the Gateway. Check your connection and try again.",
      unknown: "Sign-in failed. Try again.",
    },
  },
} satisfies TranslationMap;

export const registerIxAuthEnglish = Object.assign(
  () => {
    Object.assign(en.ixAuth, enIxAuth.ixAuth);
  },
  { catalog: enIxAuth },
);
