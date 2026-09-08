// One agent's allowed folder, its read-only settings, and its index folders.
//
// The folder picker only ever shows what the Gateway offered. It cannot type a path of
// its own, and the field below it is filled by choosing a row rather than by hand: an
// operator who cannot name a folder that is not on the list cannot accidentally hand an
// agent one. The server refuses an off-root path regardless, and both are true on purpose.
import { html, nothing, type TemplateResult } from "lit";
import type { DepartmentsFoldersListResult } from "../../../../packages/gateway-protocol/src/schema/departments.js";
import { t } from "../../i18n/index.ts";

export type DepartmentAccessDraftView = {
  workspace: string;
  workspaceIsShared: boolean;
  readonlyTools: boolean;
  readonlySessions: boolean;
  indexText: string;
};

function renderToggle(params: {
  label: string;
  hint: string;
  checked: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}): TemplateResult {
  return html`
    <label class="departments-toggle">
      <input
        type="checkbox"
        .checked=${params.checked}
        ?disabled=${params.busy}
        @change=${(event: Event) =>
          // SAFETY: the listener is bound to this checkbox element.
          params.onChange((event.target as HTMLInputElement).checked)}
      />
      <span>
        <span class="departments-toggle__label">${params.label}</span>
        <span class="departments-toggle__hint">${params.hint}</span>
      </span>
    </label>
  `;
}

function renderBrowser(params: {
  listing: DepartmentsFoldersListResult | undefined;
  busy: boolean;
  onOpen: (path: string) => void;
  onChoose: (absolutePath: string) => void;
}): TemplateResult {
  const listing = params.listing;
  if (!listing) {
    return html`<p class="muted">${t("ixAuth.departments.loading")}</p>`;
  }
  if (!listing.available) {
    return html`<p class="muted">${t("ixAuth.departments.browseUnavailable")}</p>`;
  }
  return html`
    <div class="departments-browser">
      <p class="departments-browser__root">
        ${t("ixAuth.departments.browseRoot", { root: listing.root })}
      </p>
      ${
        listing.parent === undefined
          ? nothing
          : html`<button
              class="btn"
              ?disabled=${params.busy}
              @click=${() => params.onOpen(listing.parent ?? "")}
            >
              ${t("ixAuth.departments.browseUp")}
            </button>`
      }
      ${
        listing.entries.length === 0
          ? html`<p class="muted">${t("ixAuth.departments.browseEmpty")}</p>`
          : html`<ul class="departments-browser__list">
              ${listing.entries.map(
                (entry) => html`<li class="departments-browser__item">
                  <button
                    class="departments-browser__open"
                    ?disabled=${params.busy}
                    @click=${() => params.onOpen(entry.path)}
                  >
                    ${entry.name}
                  </button>
                  <button
                    class="btn"
                    ?disabled=${params.busy}
                    @click=${() => params.onChoose(entry.absolutePath)}
                  >
                    ${t("ixAuth.departments.browseChoose")}
                  </button>
                </li>`,
              )}
            </ul>`
      }
    </div>
  `;
}

/** The access editor for one agent. */
export function renderDepartmentAccessPanel(params: {
  draft: DepartmentAccessDraftView;
  listing: DepartmentsFoldersListResult | undefined;
  busy: boolean;
  notice?: string;
  onOpenFolder: (path: string) => void;
  onChooseFolder: (absolutePath: string) => void;
  onToggleReadonlyTools: (value: boolean) => void;
  onToggleReadonlySessions: (value: boolean) => void;
  onIndexInput: (value: string) => void;
  onSave: () => void;
}): TemplateResult {
  return html`
    <div class="departments-access">
      <label class="departments-form__field departments-form__field--grow">
        <span class="departments-form__label">${t("ixAuth.departments.workspaceLabel")}</span>
        <input
          class="settings-input"
          readonly
          .value=${params.draft.workspace}
          placeholder=${t("ixAuth.departments.workspacePlaceholder")}
        />
      </label>
      ${
        params.draft.workspaceIsShared
          ? html`<p class="departments-form__hint">
              ${t("ixAuth.departments.workspaceBootstrapNote")}
            </p>`
          : nothing
      }
      ${renderBrowser({
        listing: params.listing,
        busy: params.busy,
        onOpen: params.onOpenFolder,
        onChoose: params.onChooseFolder,
      })}
      ${renderToggle({
        label: t("ixAuth.departments.readonlyLabel"),
        hint: t("ixAuth.departments.readonlyHint"),
        checked: params.draft.readonlyTools,
        busy: params.busy,
        onChange: params.onToggleReadonlyTools,
      })}
      ${renderToggle({
        label: t("ixAuth.departments.permissionLabel"),
        hint: t("ixAuth.departments.permissionHint"),
        checked: params.draft.readonlySessions,
        busy: params.busy,
        onChange: params.onToggleReadonlySessions,
      })}
      <label class="departments-form__field departments-form__field--grow">
        <span class="departments-form__label">${t("ixAuth.departments.indexLabel")}</span>
        <textarea
          class="settings-input"
          rows="3"
          .value=${params.draft.indexText}
          placeholder=${t("ixAuth.departments.indexPlaceholder")}
          @input=${(event: Event) =>
            // SAFETY: the listener is bound to this textarea element.
            params.onIndexInput((event.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      <p class="departments-form__hint">${t("ixAuth.departments.indexHint")}</p>
      <div class="departments-access__actions">
        <button class="btn" ?disabled=${params.busy} @click=${() => params.onSave()}>
          ${t("ixAuth.departments.save")}
        </button>
        ${params.notice ? html`<span class="departments-notice">${params.notice}</span>` : nothing}
      </div>
    </div>
  `;
}
