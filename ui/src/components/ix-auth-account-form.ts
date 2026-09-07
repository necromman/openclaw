// The pre-connection screens that are not the sign-in card: signing up, following an
// invitation, verifying an address, and recovering a password.
//
// They share the sign-in card's shell, so this module contributes only the fields, the
// copy, and the links between screens.
import { html, nothing, type TemplateResult } from "lit";
import type { IxAuthScreen } from "../features/ix-auth/ix-auth-account-screen.ts";
import type { IxAuthLoginProps } from "../features/ix-auth/ix-auth-form-state.ts";
import { t } from "../i18n/index.ts";
import { renderIxAuthSecretField, renderIxAuthTextField } from "./ix-auth-form-fields.ts";

/** Copy keys for one screen. The sign-in card keeps its own, older keys. */
export type IxAuthScreenCopy = { title: string; subtitle: string; submit: string };

const IX_AUTH_SCREEN_COPY_KEYS: Readonly<Record<string, string>> = Object.freeze({
  signup: "signup",
  "forgot-password": "forgot",
  "reset-password": "reset",
  "verify-email": "verify",
  "accept-invite": "invite",
});

/** Title, subtitle, and button label for one screen. */
export function resolveIxAuthScreenCopy(screen: IxAuthScreen): IxAuthScreenCopy {
  const group = IX_AUTH_SCREEN_COPY_KEYS[screen] ?? "signup";
  return {
    title: t(`ixAuth.${group}.title`),
    subtitle: t(`ixAuth.${group}.subtitle`),
    submit: t(`ixAuth.${group}.submit`),
  };
}

function renderNewPasswordFields(props: IxAuthLoginProps): TemplateResult {
  return html`
    ${renderIxAuthSecretField({
      label: t("ixAuth.newPassword"),
      value: props.password,
      visible: props.showPassword,
      disabled: props.submitting,
      autocomplete: "new-password",
      onInput: props.onPasswordChange,
      onToggleVisible: props.onTogglePassword,
      onEnter: props.onSubmit,
    })}
    ${renderIxAuthSecretField({
      label: t("ixAuth.confirmPassword"),
      value: props.confirmPassword,
      visible: props.showPassword,
      disabled: props.submitting,
      autocomplete: "new-password",
      onInput: props.onConfirmPasswordChange,
      onToggleVisible: props.onTogglePassword,
      onEnter: props.onSubmit,
    })}
  `;
}

function renderEmailField(props: IxAuthLoginProps): TemplateResult {
  return renderIxAuthTextField({
    label: t("ixAuth.email"),
    value: props.email,
    disabled: props.submitting,
    type: "email",
    inputMode: "email",
    autocomplete: "username",
    placeholder: t("ixAuth.emailPlaceholder"),
    onInput: props.onEmailChange,
    onEnter: props.onSubmit,
  });
}

function renderNameField(props: IxAuthLoginProps): TemplateResult {
  return renderIxAuthTextField({
    label: t("ixAuth.name"),
    value: props.name,
    disabled: props.submitting,
    autocomplete: "name",
    onInput: props.onNameChange,
    onEnter: props.onSubmit,
  });
}

/**
 * Fields for one screen.
 *
 * A screen whose token is missing renders no fields at all. Offering a password box that
 * cannot lead anywhere would let someone fill it in and then be told the link was the
 * problem all along.
 */
export function renderIxAuthAccountFields(
  props: IxAuthLoginProps,
): TemplateResult | typeof nothing {
  if (props.screen === "signup") {
    return html`${renderEmailField(props)} ${renderNameField(props)}
    ${renderNewPasswordFields(props)}`;
  }
  if (props.screen === "forgot-password") {
    return renderEmailField(props);
  }
  if (!props.token) {
    return nothing;
  }
  if (props.screen === "verify-email") {
    return nothing;
  }
  if (props.screen === "accept-invite") {
    return html`${renderNameField(props)} ${renderNewPasswordFields(props)}`;
  }
  return renderNewPasswordFields(props);
}

/** Links out of one screen. Every screen can reach the sign-in card again. */
export function renderIxAuthScreenLinks(props: IxAuthLoginProps): TemplateResult {
  return html`
    <div class="login-gate__sub">
      <button
        type="button"
        class="btn"
        ?disabled=${props.submitting}
        @click=${() => {
          props.onNavigate("sign-in");
        }}
      >
        ${t("ixAuth.link.signIn")}
      </button>
    </div>
  `;
}

/**
 * Links shown under the sign-in card.
 *
 * The signup link appears only where the identity server accepts signups; everywhere
 * else the card states that an invitation is the way in, so nobody hunts for a form that
 * does not exist.
 */
export function renderIxAuthSignInLinks(props: IxAuthLoginProps): TemplateResult {
  return html`
    <div class="login-gate__sub">
      <button
        type="button"
        class="btn"
        ?disabled=${props.submitting}
        @click=${() => {
          props.onNavigate("forgot-password");
        }}
      >
        ${t("ixAuth.link.forgot")}
      </button>
      ${
        props.selfSignupEnabled
          ? html`<button
              type="button"
              class="btn"
              ?disabled=${props.submitting}
              @click=${() => {
                props.onNavigate("signup");
              }}
            >
              ${t("ixAuth.link.signup")}
            </button>`
          : html`<span>${t("ixAuth.inviteOnly")}</span>`
      }
    </div>
  `;
}
