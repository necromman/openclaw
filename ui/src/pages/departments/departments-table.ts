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

function renderAgents(agents: readonly string[]): TemplateResult {
  return agents.length === 0
    ? html`<span class="muted">${t("ixAuth.departments.none")}</span>`
    : html`${agents.join(", ")}`;
}

function renderRow(params: {
  department: IxAuthDepartmentOption;
  selected: boolean;
  onSelect: (slug: string) => void;
}): TemplateResult {
  const { department } = params;
  const slug = department.slug ?? department.code;
  return html`
    <tr class="departments-table__row" aria-selected=${params.selected ? "true" : "false"}>
      <td>
        <button class="departments-table__select" @click=${() => params.onSelect(slug)}>
          ${department.name}
        </button>
      </td>
      <td><code>${department.code}</code></td>
      <td>${department.memberCount ?? 0}</td>
      <td>${renderAgents(department.agents ?? [])}</td>
    </tr>
  `;
}

/** Draw the department table, or the one sentence that replaces it. */
export function renderDepartmentsTable(params: {
  departments: readonly IxAuthDepartmentOption[];
  loading: boolean;
  selectedSlug?: string;
  onSelect: (slug: string) => void;
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
          </tr>
        </thead>
        <tbody>
          ${params.departments.map((department) =>
            renderRow({
              department,
              selected: (department.slug ?? department.code) === params.selectedSlug,
              onSelect: params.onSelect,
            }),
          )}
        </tbody>
      </table>
    </div>
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

/** The create form. Slug and name are both required; the Gateway mints the code. */
export function renderDepartmentCreateForm(params: {
  prefix: string;
  slug: string;
  name: string;
  busy: boolean;
  onSlugInput: (value: string) => void;
  onNameInput: (value: string) => void;
  onSubmit: () => void;
}): TemplateResult {
  return html`
    <div class="departments-form">
      <label class="departments-form__field">
        <span class="departments-form__label">${t("ixAuth.departments.createSlug")}</span>
        <input
          class="settings-input"
          .value=${params.slug}
          placeholder=${t("ixAuth.departments.createSlugPlaceholder")}
          @input=${(event: Event) =>
            // SAFETY: the listener is bound to this input element.
            params.onSlugInput((event.target as HTMLInputElement).value)}
        />
      </label>
      <label class="departments-form__field departments-form__field--grow">
        <span class="departments-form__label">${t("ixAuth.departments.createName")}</span>
        <input
          class="settings-input"
          .value=${params.name}
          placeholder=${t("ixAuth.departments.createNamePlaceholder")}
          @input=${(event: Event) =>
            // SAFETY: the listener is bound to this input element.
            params.onNameInput((event.target as HTMLInputElement).value)}
        />
      </label>
      <button
        class="btn"
        ?disabled=${
          params.busy || params.slug.trim().length === 0 || params.name.trim().length === 0
        }
        @click=${() => params.onSubmit()}
      >
        ${t("ixAuth.departments.createSubmit")}
      </button>
      <p class="departments-form__hint">
        ${t("ixAuth.departments.createSlugHint", {
          prefix: params.prefix,
          slug: params.slug.trim() || t("ixAuth.departments.createSlugPlaceholder"),
        })}
      </p>
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
              <button class="btn danger" ?disabled=${params.busy} @click=${() => params.onConfirm()}>
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
