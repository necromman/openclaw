// Field templates shared by every identity-server form.
//
// The sign-in card and the mail-link screens are the same card with different fields, so
// the field markup lives in one place. A second copy would drift, and these inputs carry
// the autocomplete and keyboard hints that make a password manager work.
import { html, type TemplateResult } from "lit";
import { t } from "../i18n/index.ts";
import { icons } from "./icons.ts";

export type IxAuthTextFieldProps = {
  label: string;
  value: string;
  disabled: boolean;
  onInput: (value: string) => void;
  onEnter: () => void;
  type?: "text" | "email";
  autocomplete?: string;
  placeholder?: string;
  inputMode?: "email" | "text";
};

/** One labelled single-line field. */
export function renderIxAuthTextField(props: IxAuthTextFieldProps): TemplateResult {
  return html`
    <label class="field">
      <span>${props.label}</span>
      <input
        type=${props.type ?? "text"}
        inputmode=${props.inputMode ?? "text"}
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        autocomplete=${props.autocomplete ?? "off"}
        enterkeyhint="next"
        .value=${props.value}
        placeholder=${props.placeholder ?? ""}
        ?disabled=${props.disabled}
        @input=${(e: Event) => {
          // SAFETY: this listener is bound to the input element on this template line.
          props.onInput((e.target as HTMLInputElement).value);
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            props.onEnter();
          }
        }}
      />
    </label>
  `;
}

export type IxAuthSecretFieldProps = {
  label: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  autocomplete: string;
  onInput: (value: string) => void;
  onToggleVisible: () => void;
  onEnter: () => void;
};

/** One password field with the reveal toggle the sign-in card already uses. */
export function renderIxAuthSecretField(props: IxAuthSecretFieldProps): TemplateResult {
  const toggleLabel = props.visible ? t("ixAuth.hidePassword") : t("ixAuth.showPassword");
  return html`
    <label class="field">
      <span>${props.label}</span>
      <span class="settings-secret">
        <input
          type=${props.visible ? "text" : "password"}
          autocomplete=${props.autocomplete}
          spellcheck="false"
          enterkeyhint="go"
          .value=${props.value}
          ?disabled=${props.disabled}
          @input=${(e: Event) => {
            // SAFETY: this listener is bound to the input element on this template line.
            props.onInput((e.target as HTMLInputElement).value);
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              props.onEnter();
            }
          }}
        />
        <openclaw-tooltip .content=${toggleLabel}>
          <button
            type="button"
            class="settings-secret__toggle"
            aria-label=${toggleLabel}
            @click=${() => {
              props.onToggleVisible();
            }}
          >
            ${props.visible ? icons.eyeOff : icons.eye}
          </button>
        </openclaw-tooltip>
      </span>
    </label>
  `;
}
