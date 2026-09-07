// Control UI pre-connection screens for identity-server mode. They replace the Gateway
// URL and token form entirely: in this mode a person signs in, follows an invitation, or
// recovers a password, and the connection details are not theirs to configure.
import { html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { normalizeBasePath } from "../app-route-paths.ts";
import { controlUiPublicAssetPath } from "../app/public-assets.ts";
import { BRAND_NAME } from "../brand.ts";
import { ixAuthScreenNeedsToken } from "../features/ix-auth/ix-auth-account-screen.ts";
import type { IxAuthLoginProps } from "../features/ix-auth/ix-auth-form-state.ts";
import { t } from "../i18n/index.ts";
import { registerIxAuthEnglish } from "../i18n/locales/en-ix-auth.ts";
import "../lib/toast.ts";
import { OpenClawLightDomContentsElement } from "../lit/openclaw-element.ts";
import {
  renderIxAuthAccountFields,
  renderIxAuthScreenLinks,
  renderIxAuthSignInLinks,
  resolveIxAuthScreenCopy,
} from "./ix-auth-account-form.ts";
import { renderIxAuthSecretField, renderIxAuthTextField } from "./ix-auth-form-fields.ts";

registerIxAuthEnglish();

export type { IxAuthLoginProps };

function resolveErrorMessage(props: IxAuthLoginProps): string | undefined {
  if (!props.errorKey) {
    return undefined;
  }
  if (props.errorKey === "accountLocked" && props.lockedUntilLabel) {
    return t("ixAuth.error.accountLockedUntil", { time: props.lockedUntilLabel });
  }
  // A password-policy refusal is the one case where the identity server knows something
  // this screen does not: the configured rules. Its wording is appended, not replaced.
  const base = t(`ixAuth.error.${props.errorKey}`);
  return props.errorDetail ? `${base} ${props.errorDetail}` : base;
}

function renderIxAuthCredentialFields(props: IxAuthLoginProps) {
  return html`
    ${renderIxAuthTextField({
      label: t("ixAuth.email"),
      value: props.email,
      disabled: props.submitting,
      type: "email",
      inputMode: "email",
      autocomplete: "username",
      placeholder: t("ixAuth.emailPlaceholder"),
      onInput: props.onEmailChange,
      onEnter: props.onSubmit,
    })}
    ${renderIxAuthSecretField({
      label: t("ixAuth.password"),
      value: props.password,
      visible: props.showPassword,
      disabled: props.submitting,
      autocomplete: "current-password",
      onInput: props.onPasswordChange,
      onToggleVisible: props.onTogglePassword,
      onEnter: props.onSubmit,
    })}
  `;
}

function renderIxAuthMfaField(props: IxAuthLoginProps) {
  return html`
    <div class="login-gate__sub">${t("ixAuth.totp.subtitle")}</div>
    <label class="field">
      <span>${t("ixAuth.totp.code")}</span>
      <input
        inputmode="numeric"
        autocomplete="one-time-code"
        spellcheck="false"
        enterkeyhint="go"
        maxlength="8"
        .value=${props.mfaCode}
        ?disabled=${props.submitting}
        @input=${(e: Event) => {
          // SAFETY: this listener is bound to the input element on this template line.
          props.onMfaCodeChange((e.target as HTMLInputElement).value);
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            props.onSubmit();
          }
        }}
      />
    </label>
  `;
}

/** Heading and button label for whichever screen is showing. */
function resolveScreenCopy(props: IxAuthLoginProps): {
  subtitle: string;
  submit: string;
} {
  if (props.screen !== "sign-in") {
    const copy = resolveIxAuthScreenCopy(props.screen);
    return { subtitle: copy.subtitle, submit: copy.submit };
  }
  if (props.mfaChallenge) {
    return { subtitle: t("ixAuth.totp.title"), submit: t("ixAuth.totp.submit") };
  }
  return { subtitle: t("ixAuth.subtitle"), submit: t("ixAuth.submit") };
}

/**
 * True when the submit button has nothing left to do.
 *
 * A finished token screen keeps its notice on screen and drops the button: the token is
 * spent, so a second press could only fail.
 */
function isScreenFinished(props: IxAuthLoginProps): boolean {
  return props.noticeKey !== undefined && props.screen !== "sign-in";
}

function renderScreenBody(props: IxAuthLoginProps): TemplateResult | typeof nothing {
  if (props.screen === "sign-in") {
    return props.mfaChallenge ? renderIxAuthMfaField(props) : renderIxAuthCredentialFields(props);
  }
  if (ixAuthScreenNeedsToken(props.screen) && !props.token) {
    return html`<div class="callout danger" role="alert">${t("ixAuth.error.missingToken")}</div>`;
  }
  return renderIxAuthAccountFields(props);
}

export function renderIxAuthLogin(props: IxAuthLoginProps) {
  const resourceBasePath = normalizeBasePath(props.resourceBasePath);
  const faviconSrc = controlUiPublicAssetPath("favicon.svg", resourceBasePath);
  const errorMessage = resolveErrorMessage(props);
  const copy = resolveScreenCopy(props);
  const finished = isScreenFinished(props);
  const hasToken = !ixAuthScreenNeedsToken(props.screen) || Boolean(props.token);

  return html`
    <div class="login-gate">
      <openclaw-toast-host></openclaw-toast-host>
      <div class="login-gate__card">
        <div class="login-gate__header">
          <img class="login-gate__logo" src=${faviconSrc} alt=${BRAND_NAME} />
          <div class="login-gate__title">${BRAND_NAME}</div>
          <div class="login-gate__sub">${copy.subtitle}</div>
        </div>
        <div class="login-gate__form">
          ${finished ? nothing : renderScreenBody(props)}
          ${
            props.noticeKey
              ? html`<div class="callout" role="status">
                  ${t(`ixAuth.notice.${props.noticeKey}`)}
                </div>`
              : nothing
          }
          ${
            errorMessage
              ? html`<div class="callout danger" role="alert">${errorMessage}</div>`
              : nothing
          }
          ${
            finished || !hasToken
              ? nothing
              : html`<button
                  type="button"
                  class="btn primary login-gate__connect"
                  ?disabled=${props.submitting}
                  @click=${() => {
                    props.onSubmit();
                  }}
                >
                  ${props.submitting ? t("ixAuth.submitting") : copy.submit}
                </button>`
          }
          ${
            props.screen === "sign-in" && props.mfaChallenge
              ? html`<button
                  type="button"
                  class="btn"
                  ?disabled=${props.submitting}
                  @click=${() => {
                    props.onCancelMfa();
                  }}
                >
                  ${t("ixAuth.totp.back")}
                </button>`
              : nothing
          }
          ${
            props.screen === "sign-in"
              ? props.mfaChallenge
                ? nothing
                : renderIxAuthSignInLinks(props)
              : renderIxAuthScreenLinks(props)
          }
        </div>
      </div>
    </div>
  `;
}

class IxAuthLogin extends OpenClawLightDomContentsElement {
  @property({ attribute: false }) props?: IxAuthLoginProps;

  override render() {
    return this.props ? renderIxAuthLogin(this.props) : nothing;
  }
}

if (!customElements.get("openclaw-ix-auth-login")) {
  customElements.define("openclaw-ix-auth-login", IxAuthLogin);
}
