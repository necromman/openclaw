// Who is in one department, and the two buttons that change it.
//
// Both buttons call the same route the user screen already uses to replace an account's
// whole department set. Nothing new is decided here: the identity server owns membership,
// the Gateway owns the check that a code names a real department, and this panel only
// computes the set that results from adding or removing one code.
import { html, nothing, type TemplateResult } from "lit";
import type { IxAuthManagedUser } from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";

function renderMemberRow(params: {
  user: IxAuthManagedUser;
  busy: boolean;
  actionLabel: string;
  disabledReason?: string;
  onAction: (user: IxAuthManagedUser) => void;
}): TemplateResult {
  const { user } = params;
  return html`
    <tr class="departments-table__row">
      <td>${user.displayName}</td>
      <td class="departments-table__muted">${user.email}</td>
      <td>
        ${
          params.disabledReason
            ? html`<span class="muted">${params.disabledReason}</span>`
            : html`<button
                class="btn"
                ?disabled=${params.busy}
                @click=${() => params.onAction(user)}
              >
                ${params.actionLabel}
              </button>`
        }
      </td>
    </tr>
  `;
}

/** Members of one department, plus a search box that adds one more. */
export function renderDepartmentMembersPanel(params: {
  members: readonly IxAuthManagedUser[];
  /** How many people the department holds; more than `members` when the page was capped. */
  total: number;
  query: string;
  results: readonly IxAuthManagedUser[];
  searched: boolean;
  busy: boolean;
  onQueryInput: (value: string) => void;
  onSearch: () => void;
  onAdd: (user: IxAuthManagedUser) => void;
  onRemove: (user: IxAuthManagedUser) => void;
}): TemplateResult {
  const memberIds = new Set(params.members.map((member) => member.id));
  const candidates = params.results.filter((user) => !memberIds.has(user.id));
  return html`
    <div class="departments-members">
      ${
        params.total > params.members.length
          ? html`<div class="callout" role="note">
              ${t("ixAuth.departments.membersTruncated", {
                shown: String(params.members.length),
                total: String(params.total),
              })}
            </div>`
          : nothing
      }
      ${
        params.members.length === 0
          ? html`<p class="muted">${t("ixAuth.departments.membersEmpty")}</p>`
          : html`<div class="departments-table-scroll">
              <table class="departments-table">
                <tbody>
                  ${params.members.map((user) =>
                    renderMemberRow({
                      user,
                      busy: params.busy,
                      actionLabel: t("ixAuth.departments.memberRemove"),
                      ...(user.self ? { disabledReason: t("ixAuth.departments.memberSelf") } : {}),
                      onAction: params.onRemove,
                    }),
                  )}
                </tbody>
              </table>
            </div>`
      }
      <div class="departments-form">
        <label class="departments-form__field departments-form__field--grow">
          <span class="departments-form__label">${t("ixAuth.departments.memberAddLabel")}</span>
          <input
            class="settings-input"
            type="search"
            .value=${params.query}
            placeholder=${t("ixAuth.departments.memberAddPlaceholder")}
            @input=${(event: Event) =>
              // SAFETY: the listener is bound to this input element.
              params.onQueryInput((event.target as HTMLInputElement).value)}
            @change=${() => params.onSearch()}
          />
        </label>
        <button class="btn" ?disabled=${params.busy} @click=${() => params.onSearch()}>
          ${t("ixAuth.departments.memberAddSubmit")}
        </button>
      </div>
      ${
        !params.searched
          ? nothing
          : candidates.length === 0
            ? html`<p class="muted">${t("ixAuth.departments.memberSearchEmpty")}</p>`
            : html`<div class="departments-table-scroll">
                <table class="departments-table">
                  <tbody>
                    ${candidates.map((user) =>
                      renderMemberRow({
                        user,
                        busy: params.busy,
                        actionLabel: t("ixAuth.departments.memberAdd"),
                        ...(user.self
                          ? { disabledReason: t("ixAuth.departments.memberSelf") }
                          : {}),
                        onAction: params.onAdd,
                      }),
                    )}
                  </tbody>
                </table>
              </div>`
      }
    </div>
  `;
}
