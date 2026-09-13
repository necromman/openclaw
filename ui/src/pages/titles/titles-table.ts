// The job-title table and the three forms that change it.
//
// A table because the question is columnar: which title, what code, how many people hold
// it. The group code stays visible next to the name for the same reason it does on the
// department screen: the code is what the token carries, and an operator asking "why does
// this folder rule not apply" needs the code, not the label somebody typed over it.
import { html, nothing, type TemplateResult } from "lit";
import type {
  IxAuthOrphanTitle,
  IxAuthTitleOption,
} from "../../features/ix-auth/ix-auth-admin-api.ts";
import { t } from "../../i18n/index.ts";
import { isDepartmentSlug } from "../departments/department-slug.ts";

/** Draw the title table, or the one sentence that replaces it. */
export function renderTitlesTable(params: {
  titles: readonly IxAuthTitleOption[];
  loading: boolean;
  busy: boolean;
  selectedSlug?: string;
  /** Where the member counts came from, so a projection count is never read as a head count. */
  memberCountSource?: "identity" | "projection";
  onSelect: (slug: string) => void;
}): TemplateResult {
  if (params.titles.length === 0) {
    return html`<span class="muted"
      >${params.loading ? t("ixAuth.titles.loading") : t("ixAuth.titles.empty")}</span
    >`;
  }
  return html`
    <div class="departments-table-scroll">
      <table class="departments-table">
        <thead>
          <tr>
            <th>${t("ixAuth.titles.nameColumn")}</th>
            <th>${t("ixAuth.titles.codeColumn")}</th>
            <th>${t("ixAuth.titles.membersColumn")}</th>
          </tr>
        </thead>
        <tbody>
          ${params.titles.map((title) => {
            const slug = title.slug ?? title.code;
            return html`<tr
              class="departments-table__row"
              aria-selected=${slug === params.selectedSlug ? "true" : "false"}
            >
              <td>
                <button
                  class="departments-table__select"
                  data-title-slug=${slug}
                  ?disabled=${params.busy}
                  @click=${() => params.onSelect(slug)}
                >
                  ${title.name}
                </button>
              </td>
              <td><code>${title.code}</code></td>
              <td>${title.memberCount ?? 0}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
    ${
      params.memberCountSource === "projection"
        ? html`<div class="callout" role="note">${t("ixAuth.titles.memberCountProjected")}</div>`
        : nothing
    }
  `;
}

/** Titles the fork still records that the identity server no longer lists. */
export function renderOrphanTitles(
  orphans: readonly IxAuthOrphanTitle[],
): TemplateResult | typeof nothing {
  if (orphans.length === 0) {
    return nothing;
  }
  return html`
    <div class="departments-orphans">
      <p class="departments-orphans__note">${t("ixAuth.titles.orphanBody")}</p>
      <ul class="departments-orphans__list">
        ${orphans.map(
          (orphan) =>
            html`<li><code>${orphan.slug}</code> ${orphan.name} ${orphan.memberCount}</li>`,
        )}
      </ul>
    </div>
  `;
}

/**
 * The create form. The person types a name; the short code is written for them.
 *
 * The code decides who holds the title, so it is spelled out under the name field and one
 * link opens it for editing. After that override the code stops following the name: a
 * code somebody chose on purpose is not the screen's to overwrite on the next keystroke.
 */
export function renderTitleCreateForm(params: {
  prefix: string;
  slug: string;
  name: string;
  busy: boolean;
  slugOpened: boolean;
  onSlugInput: (value: string) => void;
  onSlugToggle: () => void;
  onNameInput: (value: string) => void;
  onSubmit: () => void;
}): TemplateResult {
  const slug = params.slug.trim();
  const name = params.name.trim();
  const slugValid = isDepartmentSlug(slug);
  return html`
    <div class="departments-form">
      <label class="departments-form__field departments-form__field--grow">
        <span class="departments-form__label">${t("ixAuth.titles.createName")}</span>
        <input
          class="settings-input"
          data-title-create-name
          .value=${params.name}
          placeholder=${t("ixAuth.titles.createNamePlaceholder")}
          @input=${(event: Event) =>
            // SAFETY: the listener is bound to this input element.
            params.onNameInput((event.target as HTMLInputElement).value)}
        />
      </label>
      <button
        class="btn"
        ?disabled=${params.busy || name.length === 0 || !slugValid}
        @click=${() => params.onSubmit()}
      >
        ${t("ixAuth.titles.createSubmit")}
      </button>
      <p class="departments-form__hint" data-title-code-preview>
        ${t("ixAuth.titles.createCodePreview", {
          code: `${params.prefix}${slug || t("ixAuth.titles.createSlugPlaceholder")}`,
        })}
      </p>
      <button
        class="departments-form__disclosure"
        type="button"
        aria-expanded=${params.slugOpened ? "true" : "false"}
        @click=${() => params.onSlugToggle()}
      >
        ${t(
          params.slugOpened ? "ixAuth.titles.createSlugHide" : "ixAuth.titles.createSlugOverride",
        )}
      </button>
      ${
        params.slugOpened
          ? html`
              <label class="departments-form__field departments-form__field--grow">
                <span class="departments-form__label">${t("ixAuth.titles.createSlug")}</span>
                <input
                  class="settings-input"
                  data-title-create-slug
                  .value=${params.slug}
                  placeholder=${t("ixAuth.titles.createSlugPlaceholder")}
                  @input=${(event: Event) =>
                    // SAFETY: the listener is bound to this input element.
                    params.onSlugInput((event.target as HTMLInputElement).value)}
                />
              </label>
            `
          : nothing
      }
      ${
        slug.length > 0 && !slugValid
          ? html`<p class="departments-form__hint departments-form__hint--error" role="alert">
              ${t("ixAuth.titles.createSlugInvalid")}
            </p>`
          : nothing
      }
    </div>
  `;
}

/**
 * Rename and delete, for the title the table has selected.
 *
 * Delete takes two clicks rather than a browser confirm: the first states what will
 * happen in the words of this screen and the second is the decision. The number of people
 * still holding the title sits next to the button, because that is what the Gateway will
 * refuse on.
 */
export function renderTitleEditForm(params: {
  title: IxAuthTitleOption;
  nameDraft: string;
  deleteArmed: boolean;
  busy: boolean;
  onNameInput: (value: string) => void;
  onRename: () => void;
  onDeleteArm: () => void;
  onDeleteCancel: () => void;
  onDelete: () => void;
}): TemplateResult {
  const memberCount = params.title.memberCount ?? 0;
  const blocked = memberCount > 0;
  return html`
    <div class="departments-form">
      <label class="departments-form__field departments-form__field--grow">
        <span class="departments-form__label">${t("ixAuth.titles.nameColumn")}</span>
        <input
          class="settings-input"
          data-title-rename
          .value=${params.nameDraft}
          @input=${(event: Event) =>
            // SAFETY: the listener is bound to this input element.
            params.onNameInput((event.target as HTMLInputElement).value)}
        />
      </label>
      <button
        class="btn"
        ?disabled=${params.busy || params.nameDraft.trim().length === 0}
        @click=${() => params.onRename()}
      >
        ${t("ixAuth.titles.renameSubmit")}
      </button>
      <p class="departments-form__hint">${t("ixAuth.titles.renameHint")}</p>
      ${
        params.deleteArmed
          ? html`
              <p class="departments-form__hint">
                ${t("ixAuth.titles.deleteConfirm", { name: params.title.name })}
              </p>
              <button class="btn danger" ?disabled=${params.busy} @click=${() => params.onDelete()}>
                ${t("ixAuth.titles.deleteConfirmSubmit")}
              </button>
              <button class="btn" ?disabled=${params.busy} @click=${() => params.onDeleteCancel()}>
                ${t("ixAuth.titles.deleteCancel")}
              </button>
            `
          : html`<button
              class="btn danger"
              ?disabled=${params.busy || blocked}
              @click=${() => params.onDeleteArm()}
            >
              ${t("ixAuth.titles.deleteSubmit")}
            </button>`
      }
      <p class="departments-form__hint">
        ${
          blocked
            ? t("ixAuth.titles.deleteBlocked", { count: String(memberCount) })
            : t("ixAuth.titles.deleteHint")
        }
      </p>
    </div>
  `;
}
