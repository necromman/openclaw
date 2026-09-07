import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

// Copy for the account screens shown when the Gateway delegates identity to an identity
// server. It loads with the lazy sign-in view, like en-login.ts.
const enIxAuth = {
  ixAuth: {
    title: "Sign in",
    subtitle: "Use your work account.",
    email: "Email",
    emailPlaceholder: "you@example.com",
    name: "Display name",
    password: "Password",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    submit: "Sign in",
    submitting: "Signing in",
    signOut: "Sign out",
    signedInAs: "Signed in as {email}",
    manageUsers: "Manage users",
    impersonating: "Viewing as this user. Administrator: {admin}",
    // Shown in place of a signup link where the identity server refuses signups, so
    // nobody hunts for a form that does not exist.
    inviteOnly: "An invitation is needed to join.",
    link: {
      signIn: "Back to sign in",
      signup: "Create an account",
      forgot: "Forgot your password",
    },
    signup: {
      title: "Create an account",
      subtitle: "Enter your work address. An administrator approves new accounts.",
      submit: "Request an account",
    },
    forgot: {
      title: "Forgot your password",
      subtitle: "Enter your address and we will send a reset link.",
      submit: "Send the link",
    },
    reset: {
      title: "Choose a new password",
      subtitle: "This link works once. Signing in elsewhere ends those sessions.",
      submit: "Set the password",
    },
    verify: {
      title: "Confirm your address",
      subtitle: "Confirm the address you signed up with.",
      submit: "Confirm",
    },
    invite: {
      title: "Accept the invitation",
      subtitle: "Choose a password. Your account becomes active right away.",
      submit: "Set the password",
    },
    notice: {
      signupRequested:
        "Request received. Confirm your address from the email, then wait for an administrator to approve the account.",
      resetRequested: "If that address has an account, a reset link is on its way.",
      passwordReset: "Password changed. Sign in with the new one.",
      emailVerified: "Address confirmed. An administrator approves the account next.",
      inviteAccepted: "Account is ready. Sign in with your new password.",
    },
    totp: {
      title: "Two-step verification",
      subtitle: "Enter the six-digit code from your authenticator app.",
      code: "Verification code",
      submit: "Verify",
      back: "Back to sign in",
    },
    invites: {
      title: "Invitations",
      description: "Create an account and send its one-time link.",
      emailLabel: "Email",
      nameLabel: "Display name",
      roleLabel: "Role",
      departmentLabel: "Department",
      departmentNone: "No department",
      submit: "Invite",
      submitting: "Inviting",
      linkTitle: "Invitation link",
      linkHelp: "There is no mail server, so pass this link on yourself. It expires in 72 hours.",
      copyLink: "Copy link",
      copied: "Copied",
      mailed: "Invitation sent to {email}.",
      forget: "Remove",
      departmentFailed: "The account was created, but the department was not applied.",
      empty: "No invitation links are waiting.",
    },
    approvals: {
      title: "Signup approvals",
      description: "Accounts waiting for a decision.",
      approve: "Approve",
      reject: "Reject",
      empty: "Nothing is waiting.",
      unverified: "Address not confirmed",
      decided: "Done.",
    },
    error: {
      // One message for a wrong password and for an unknown account, so the form
      // never reveals which addresses exist.
      invalidCredentials: "The email or password is incorrect.",
      invalidCode: "That code is not valid.",
      missingFields: "Enter your email and password.",
      missingEmail: "Enter your email.",
      missingToken: "This link is incomplete. Ask for a new one.",
      passwordMismatch: "The two passwords do not match.",
      invalidToken: "This link is no longer valid. Ask for a new one.",
      passwordRejected: "That password was refused.",
      termsRequired: "The required terms have to be accepted.",
      signupDisabled: "Signing up is not open. Ask an administrator for an invitation.",
      signupRejected: "That address cannot be used here.",
      adminForbidden: "Your account cannot manage users.",
      adminUnauthenticated: "Sign in again and retry.",
      adminConflict: "Someone already handled this.",
      adminRejected: "The identity server refused the request.",
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
