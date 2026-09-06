// Control UI account sign-in screen shown when the Gateway delegates identity to an
// identity server. It replaces the Gateway URL and token form entirely: in this mode a
// person signs in, and the connection details are not theirs to configure.
import { html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { normalizeBasePath } from "../app-route-paths.ts";
import { controlUiPublicAssetPath } from "../app/public-assets.ts";
import { BRAND_NAME } from "../brand.ts";
import { t } from "../i18n/index.ts";
import { registerIxAuthEnglish } from "../i18n/locales/en-ix-auth.ts";
import "../lib/toast.ts";
import { OpenClawLightDomContentsElement } from "../lit/openclaw-element.ts";
import { icons } from "./icons.ts";

registerIxAuthEnglish();

export type IxAuthLoginProps = {
  resourceBasePath: string;
  email: string;
  password: string;
  showPassword: boolean;
  /** Set once the identity server asked for a second factor. */
  mfaChallenge?: string;
  mfaCode: string;
  submitting: boolean;
  /** Key under `ixAuth.error.*`, or undefined when nothing failed yet. */
  errorKey?: string;
  /** Formatted wall-clock time an automatic lockout expires, when known. */
  lockedUntilLabel?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onMfaCodeChange: (value: string) => void;
  onSubmit: () => void;
  onCancelMfa: () => void;
};

function resolveErrorMessage(props: IxAuthLoginProps): string | undefined {
  if (!props.errorKey) {
    return undefined;
  }
  if (props.errorKey === "accountLocked" && props.lockedUntilLabel) {
    return t("ixAuth.error.accountLockedUntil", { time: props.lockedUntilLabel });
  }
  return t(`ixAuth.error.${props.errorKey}`);
}

function renderIxAuthCredentialFields(props: IxAuthLoginProps) {
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      props.onSubmit();
    }
  };
  return html`
    <label class="field">
      <span>${t("ixAuth.email")}</span>
      <input
        type="email"
        inputmode="email"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        autocomplete="username"
        enterkeyhint="next"
        .value=${props.email}
        placeholder=${t("ixAuth.emailPlaceholder")}
        ?disabled=${props.submitting}
        @input=${(e: Event) => {
          props.onEmailChange((e.target as HTMLInputElement).value);
        }}
        @keydown=${submitOnEnter}
      />
    </label>
    <label class="field">
      <span>${t("ixAuth.password")}</span>
      <span class="settings-secret">
        <input
          type=${props.showPassword ? "text" : "password"}
          autocomplete="current-password"
          spellcheck="false"
          enterkeyhint="go"
          .value=${props.password}
          ?disabled=${props.submitting}
          @input=${(e: Event) => {
            props.onPasswordChange((e.target as HTMLInputElement).value);
          }}
          @keydown=${submitOnEnter}
        />
        <openclaw-tooltip
          .content=${props.showPassword ? t("ixAuth.hidePassword") : t("ixAuth.showPassword")}
        >
          <button
            type="button"
            class="settings-secret__toggle"
            aria-label=${props.showPassword ? t("ixAuth.hidePassword") : t("ixAuth.showPassword")}
            @click=${() => {
              props.onTogglePassword();
            }}
          >
            ${props.showPassword ? icons.eyeOff : icons.eye}
          </button>
        </openclaw-tooltip>
      </span>
    </label>
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

export function renderIxAuthLogin(props: IxAuthLoginProps) {
  const resourceBasePath = normalizeBasePath(props.resourceBasePath);
  const faviconSrc = controlUiPublicAssetPath("favicon.svg", resourceBasePath);
  const errorMessage = resolveErrorMessage(props);
  const inMfaStep = Boolean(props.mfaChallenge);

  return html`
    <div class="login-gate">
      <openclaw-toast-host></openclaw-toast-host>
      <div class="login-gate__card">
        <div class="login-gate__header">
          <img class="login-gate__logo" src=${faviconSrc} alt=${BRAND_NAME} />
          <div class="login-gate__title">${BRAND_NAME}</div>
          <div class="login-gate__sub">
            ${inMfaStep ? t("ixAuth.totp.title") : t("ixAuth.subtitle")}
          </div>
        </div>
        <div class="login-gate__form">
          ${inMfaStep ? renderIxAuthMfaField(props) : renderIxAuthCredentialFields(props)}
          ${
            errorMessage
              ? html`<div class="callout danger" role="alert">${errorMessage}</div>`
              : nothing
          }
          <button
            type="button"
            class="btn primary login-gate__connect"
            ?disabled=${props.submitting}
            @click=${() => {
              props.onSubmit();
            }}
          >
            ${
              props.submitting
                ? t("ixAuth.submitting")
                : inMfaStep
                  ? t("ixAuth.totp.submit")
                  : t("ixAuth.submit")
            }
          </button>
          ${
            inMfaStep
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
