// The directory table.
//
// A genuine table, because the question it answers is "who is in which row of which
// column": scanning a list of cards for the one deactivated account is exactly the work
// a table saves. It scrolls inside its own box so a long department list never widens
// the page.
import { html, nothing, type TemplateResult } from "lit";
import type { IxAuthDepartmentOption } from "../../features/ix-auth/ix-auth-admin-api.ts";
import { ixAuthDepartmentLabels } from "../../features/ix-auth/ix-auth-department-labels.ts";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import type { IxAuthManagedUser } from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";

/** Statuses drawn as a warning rather than as ordinary text. */
const IX_AUTH_ALARMING_STATUSES: ReadonlySet<string> = new Set(["DISABLED", "LOCKED"]);

function formatMoment(value: string | undefined): string {
  if (!value) {
    return t("ixAuth.users.neverSignedIn");
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * The departments cell: names to read, codes one hover away.
 *
 * The code is what a CSV import and an audit row speak, so it stays reachable; it just
 * stops being the thing an administrator has to decode while scanning the column. A code
 * the directory did not list prints itself, which is how a membership in a renamed or
 * removed group stays visible instead of reading as "no departments".
 */
function renderDepartments(
  codes: readonly string[],
  departments: readonly IxAuthDepartmentOption[],
): TemplateResult {
  if (codes.length === 0) {
    return html`${t("ixAuth.users.noDepartments")}`;
  }
  return html`${ixAuthDepartmentLabels(codes, departments).map(
    (label, index) =>
      html`${index > 0 ? ", " : nothing}<span title=${label.code}>${label.name}</span>`,
  )}`;
}

function renderRow(params: {
  user: IxAuthManagedUser;
  departments: readonly IxAuthDepartmentOption[];
  selected: boolean;
  onSelect: (userId: string) => void;
}): TemplateResult {
  const { user } = params;
  return html`
    <tr class="users-table__row" aria-selected=${params.selected ? "true" : "false"}>
      <td>
        <button class="users-table__select" @click=${() => params.onSelect(user.id)}>
          <span class="users-table__name">
            <span>
              ${user.displayName}
              ${user.self ? html`<span class="muted">(${t("ixAuth.users.selfMarker")})</span>` : nothing}
            </span>
          </span>
        </button>
      </td>
      <td class="users-table__email">${user.email}</td>
      <td>${user.gatewayRole ? ixAuthRoleLabel(user.gatewayRole) : user.roles.join(", ")}</td>
      <td>${renderDepartments(user.departments, params.departments)}</td>
      <td>
        <span
          class=${
            IX_AUTH_ALARMING_STATUSES.has(user.status)
              ? "users-status users-status--disabled"
              : "users-status"
          }
          >${t(`ixAuth.users.status.${user.status}`)}</span
        >
      </td>
      <td>${formatMoment(user.lastLoginAt)}</td>
    </tr>
  `;
}

/** Draw the directory, or the one sentence that replaces it. */
export function renderUsersTable(params: {
  users: readonly IxAuthManagedUser[];
  /** The directory the Gateway answered with. Empty until it arrives, or if it failed. */
  departments?: readonly IxAuthDepartmentOption[];
  loading: boolean;
  selectedId?: string;
  onSelect: (userId: string) => void;
}): TemplateResult {
  if (params.users.length === 0) {
    return html`<span class="muted"
      >${params.loading ? t("ixAuth.users.loading") : t("ixAuth.users.empty")}</span
    >`;
  }
  return html`
    <div class="users-table-scroll">
      <table class="users-table">
        <thead>
          <tr>
            <th>${t("ixAuth.users.columnName")}</th>
            <th>${t("ixAuth.users.columnEmail")}</th>
            <th>${t("ixAuth.users.columnRole")}</th>
            <th>${t("ixAuth.users.columnDepartments")}</th>
            <th>${t("ixAuth.users.columnStatus")}</th>
            <th>${t("ixAuth.users.columnLastLogin")}</th>
          </tr>
        </thead>
        <tbody>
          ${params.users.map((user) =>
            renderRow({
              user,
              departments: params.departments ?? [],
              selected: user.id === params.selectedId,
              onSelect: params.onSelect,
            }),
          )}
        </tbody>
      </table>
    </div>
  `;
}
