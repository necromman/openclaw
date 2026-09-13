// The chrome around the account list: the filter selects and the pager.
//
// Split out of the page so the page keeps its state and its writes and nothing else. The
// count is stated rather than left to the buttons: a directory read narrowed by
// department reports its own total, and "12 of 340" is the only thing that tells an
// administrator the filter took.
import { html, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";

export function renderUsersPager(params: {
  /** Accounts drawn on this page. */
  shown: number;
  total: number;
  pageIndex: number;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}): TemplateResult {
  return html`
    <div class="users-pager">
      <button
        class="btn"
        ?disabled=${params.pageIndex === 0 || params.busy}
        @click=${() => params.onPrevious()}
      >
        ${t("ixAuth.users.previousPage")}
      </button>
      <button
        class="btn"
        ?disabled=${params.shown >= params.total || params.busy}
        @click=${() => params.onNext()}
      >
        ${t("ixAuth.users.nextPage")}
      </button>
      <span
        >${t("ixAuth.users.countLabel", {
          shown: String(params.shown),
          total: String(params.total),
        })}</span
      >
    </div>
  `;
}

/** One "any X" filter select over the account list. */
export function renderUsersFilterSelect(params: {
  label: string;
  value: string;
  anyLabel: string;
  busy: boolean;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}): TemplateResult {
  return html`
    <label class="users-toolbar__field">
      <span class="users-toolbar__label">${params.label}</span>
      <select
        class="settings-select"
        .value=${params.value}
        ?disabled=${params.busy}
        @change=${(event: Event) => {
          // SAFETY: this listener is bound to the select element on this line.
          params.onChange((event.target as HTMLSelectElement).value);
        }}
      >
        <option value="">${params.anyLabel}</option>
        ${params.options.map(
          (option) => html`<option value=${option.value} ?selected=${option.value === params.value}>
            ${option.label}
          </option>`,
        )}
      </select>
    </label>
  `;
}
