// The department table and the two forms that change it.
//
// A table because the question is columnar: which department, how many people, which
// agents. The group code stays visible next to the name because the code is what the
// boundary reads, and an operator debugging "why can this person not see that agent"
// needs the code, not the label somebody typed over it.
import { html, nothing, type TemplateResult } from "lit";
import type {
  IxAuthDepartmentOption,
  IxAuthOrphanDepartment,
} from "../../features/ix-auth/ix-auth-admin-api.ts";
import { t } from "../../i18n/index.ts";
import { isDepartmentSlug } from "./department-slug.ts";

function renderAgents(agents: readonly string[]): TemplateResult {
  return agents.length === 0
    ? html`<span class="muted">${t("ixAuth.departments.none")}</span>`
    : html`${agents.join(", ")}`;
}

function renderRow(params: {
  department: IxAuthDepartmentOption;
  selected: boolean;
  busy?: boolean;
  onSelect: (slug: string) => void;
  onFolders?: (slug: string) => void;
}): TemplateResult {
  const { department } = params;
  const slug = department.slug ?? department.code;
  return html`
    <tr class="departments-table__row" aria-selected=${params.selected ? "true" : "false"}>
      <td>
        <button
          class="departments-table__select"
          data-department-slug=${slug}
          ?disabled=${params.busy}
          @click=${() => params.onSelect(slug)}
        >
          ${department.name}
        </button>
      </td>
      <td><code>${department.code}</code></td>
      <td>${department.memberCount ?? 0}</td>
      <td>${renderAgents(department.agents ?? [])}</td>
      <td>
        ${
          department.slug && params.onFolders
            ? html`<button
                class="btn"
                ?disabled=${params.busy}
                @click=${() => params.onFolders?.(slug)}
              >
                ${t("ixAuth.departments.folderPermissions")}
              </button>`
            : nothing
        }
      </td>
    </tr>
  `;
}

/** Draw the department table, or the one sentence that replaces it. */
export function renderDepartmentsTable(params: {
  departments: readonly IxAuthDepartmentOption[];
  loading: boolean;
  busy?: boolean;
  selectedSlug?: string;
  /**
   * Where the member counts came from. Counts that only know who has signed in are not
   * head counts, and shown as such they would invite deleting a department that is not
   * empty; the note under the table says so when that is all the Gateway could give.
   */
  memberCountSource?: "identity" | "projection";
  onSelect: (slug: string) => void;
  onFolders?: (slug: string) => void;
}): TemplateResult {
  if (params.departments.length === 0) {
    return html`<span class="muted"
      >${params.loading ? t("ixAuth.departments.loading") : t("ixAuth.departments.empty")}</span
    >`;
  }
  return html`
    <div class="departments-table-scroll">
      <table class="departments-table">
        <thead>
          <tr>
            <th>${t("ixAuth.departments.nameColumn")}</th>
            <th>${t("ixAuth.departments.codeColumn")}</th>
            <th>${t("ixAuth.departments.membersColumn")}</th>
            <th>${t("ixAuth.departments.agentsColumn")}</th>
            <th>${t("ixAuth.departments.folderPermissions")}</th>
          </tr>
        </thead>
        <tbody>
          ${params.departments.map((department) =>
            renderRow({
              department,
              selected: (department.slug ?? department.code) === params.selectedSlug,
              busy: params.busy ?? false,
              onSelect: params.onSelect,
              ...(params.onFolders ? { onFolders: params.onFolders } : {}),
            }),
          )}
        </tbody>
      </table>
    </div>
    ${
      params.memberCountSource === "projection"
        ? html`<div class="callout" role="note">
            ${t("ixAuth.departments.memberCountProjected")}
          </div>`
        : nothing
    }
  `;
}

/** Departments the fork still records that the identity server no longer lists. */
export function renderOrphanDepartments(
  orphans: readonly IxAuthOrphanDepartment[],
): TemplateResult | typeof nothing {
  if (orphans.length === 0) {
    return nothing;
  }
  return html`
    <div class="departments-orphans">
      <p class="departments-orphans__note">${t("ixAuth.departments.orphanBody")}</p>
      <ul class="departments-orphans__list">
        ${orphans.map(
          (orphan) => html`<li>
            <code>${orphan.slug}</code> ${orphan.name} ${orphan.memberCount}
            ${renderAgents(orphan.agents)}
          </li>`,
        )}
      </ul>
    </div>
  `;
}

/**
 * The create form. The person types a name; the short code is written for them.
 *
 * The code decides who is in the department, so it is not hidden: the group code it will
 * produce is spelled out under the name field, and one link opens the field to override
 * it. Only after that override does the code stop following the name, because a code
 * somebody chose on purpose is not the screen's to overwrite on the next keystroke.
 */
export function renderDepartmentCreateForm(params: {
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
        <span class="departments-form__label">${t("ixAuth.departments.createName")}</span>
        <input
          class="settings-input"
          data-department-create-name
          .value=${params.name}
          placeholder=${t("ixAuth.departments.createNamePlaceholder")}
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
        ${t("ixAuth.departments.createSubmit")}
      </button>
      <p class="departments-form__hint" data-department-code-preview>
        ${t("ixAuth.departments.createCodePreview", {
          code: `${params.prefix}${slug || t("ixAuth.departments.createSlugPlaceholder")}`,
        })}
      </p>
      <button
        class="departments-form__disclosure"
        type="button"
        aria-expanded=${params.slugOpened ? "true" : "false"}
        @click=${() => params.onSlugToggle()}
      >
        ${t(
          params.slugOpened
            ? "ixAuth.departments.createSlugHide"
            : "ixAuth.departments.createSlugOverride",
        )}
      </button>
      ${
        params.slugOpened
          ? html`
              <label class="departments-form__field departments-form__field--grow">
                <span class="departments-form__label">${t("ixAuth.departments.createSlug")}</span>
                <input
                  class="settings-input"
                  data-department-create-slug
                  .value=${params.slug}
                  placeholder=${t("ixAuth.departments.createSlugPlaceholder")}
                  @input=${(event: Event) =>
                    // SAFETY: the listener is bound to this input element.
                    params.onSlugInput((event.target as HTMLInputElement).value)}
                />
              </label>
              <p class="departments-form__hint">
                ${t("ixAuth.departments.createSlugHint", {
                  prefix: params.prefix,
                  slug: slug || t("ixAuth.departments.createSlugPlaceholder"),
                })}
              </p>
            `
          : nothing
      }
      ${
        slug.length > 0 && !slugValid
          ? html`<p class="departments-form__hint departments-form__hint--error" role="alert">
              ${t("ixAuth.departments.createSlugInvalid")}
            </p>`
          : nothing
      }
    </div>
  `;
}

/**
 * The delete control.
 *
 * Two steps, not a browser confirm dialog: the first click states what will happen in the
 * words of this screen, and the second is the decision. A department is where an access
 * boundary is drawn, so the count of people still in it is shown next to the button
 * rather than discovered as a server error.
 */
export function renderDepartmentDeleteForm(params: {
  department: IxAuthDepartmentOption;
  armed: boolean;
  busy: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}): TemplateResult {
  const memberCount = params.department.memberCount ?? 0;
  const agents = params.department.agents ?? [];
  const blocked = memberCount > 0;
  return html`
    <div class="departments-form">
      ${
        params.armed
          ? html`
              <p class="departments-form__hint">
                ${t("ixAuth.departments.deleteConfirm", { name: params.department.name })}
              </p>
              <button
                class="btn danger"
                ?disabled=${params.busy}
                @click=${() => params.onConfirm()}
              >
                ${t("ixAuth.departments.deleteConfirmSubmit")}
              </button>
              <button class="btn" ?disabled=${params.busy} @click=${() => params.onCancel()}>
                ${t("ixAuth.departments.deleteCancel")}
              </button>
            `
          : html`
              <button
                class="btn danger"
                ?disabled=${params.busy || blocked}
                @click=${() => params.onArm()}
              >
                ${t("ixAuth.departments.deleteSubmit")}
              </button>
            `
      }
      <p class="departments-form__hint">
        ${
          blocked
            ? t("ixAuth.departments.deleteBlocked", { count: String(memberCount) })
            : agents.length > 0
              ? t("ixAuth.departments.deleteAgentsHint", { agents: agents.join(", ") })
              : t("ixAuth.departments.deleteHint")
        }
      </p>
    </div>
  `;
}

/** The rename form. Only the display name moves; the code is left alone on purpose. */
export function renderDepartmentRenameForm(params: {
  name: string;
  busy: boolean;
  onNameInput: (value: string) => void;
  onSubmit: () => void;
}): TemplateResult {
  return html`
    <div class="departments-form">
      <label class="departments-form__field departments-form__field--grow">
        <span class="departments-form__label">${t("ixAuth.departments.nameColumn")}</span>
        <input
          class="settings-input"
          .value=${params.name}
          @input=${(event: Event) =>
            // SAFETY: the listener is bound to this input element.
            params.onNameInput((event.target as HTMLInputElement).value)}
        />
      </label>
      <button
        class="btn"
        ?disabled=${params.busy || params.name.trim().length === 0}
        @click=${() => params.onSubmit()}
      >
        ${t("ixAuth.departments.renameSubmit")}
      </button>
      <p class="departments-form__hint">${t("ixAuth.departments.renameHint")}</p>
    </div>
  `;
}
