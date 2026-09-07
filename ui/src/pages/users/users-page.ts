// The user-management screen.
//
// It answers the question an administrator actually arrives with: who has an account,
// what may they reach, and how do I change it. The identity server has a console of its
// own, but reaching it means signing in a second time, so everything an administrator
// does day to day lives here and the console stays as an advanced escape hatch.
//
// No permission decision is made in this file. The Gateway refuses these routes for
// anyone but a superadmin or admin; the page only decides what is worth drawing, and
// says so plainly when the answer is nothing.
import "../../styles/users.css";
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { subtitleForRoute, titleForRoute } from "../../app-navigation.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { renderSettingsRow, renderSettingsSection } from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import {
  fetchIxAuthDepartments,
  type IxAuthDepartmentOption,
} from "../../features/ix-auth/ix-auth-admin-api.ts";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import {
  probeIxAuthSession,
  readIxAuthSessionSnapshot,
  type IxAuthSessionState,
} from "../../features/ix-auth/ix-auth-session-api.ts";
import {
  deleteIxAuthUser,
  fetchIxAuthUserDetail,
  fetchIxAuthUsers,
  isIxAuthUsersFailure,
  replaceIxAuthUserDepartments,
  replaceIxAuthUserRoles,
  runIxAuthUserAction,
  updateIxAuthUser,
  type IxAuthManagedUser,
  type IxAuthUserActionName,
  type IxAuthUserDetail,
} from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { renderUserDetailPanel } from "./user-detail-panel.ts";
import { renderUsersTable } from "./users-table.ts";
import "./ix-auth-invite-section.ts";
import "./users-import-panel.ts";

registerIxAuthEnglish();

/** Accounts per page. One screenful for a company of the size this fork serves. */
const IX_AUTH_USERS_PAGE_SIZE = 25;

/** Filter choices, in the order an administrator scans them. */
const IX_AUTH_STATUS_FILTERS: readonly string[] = Object.freeze([
  "ACTIVE",
  "PENDING",
  "PENDING_APPROVAL",
  "LOCKED",
  "DISABLED",
]);

const IX_AUTH_ROLE_FILTERS: readonly string[] = Object.freeze([
  "SUPERADMIN",
  "ADMIN",
  "EXECUTIVE",
  "MEMBER",
]);

export class UsersPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  @state() private session: IxAuthSessionState | undefined = readIxAuthSessionSnapshot();
  @state() private users: IxAuthManagedUser[] = [];
  @state() private total = 0;
  @state() private pageIndex = 0;
  @state() private departmentFilterApplied = false;
  @state() private departments: IxAuthDepartmentOption[] = [];
  @state() private query = "";
  @state() private statusFilter = "";
  @state() private roleFilter = "";
  @state() private departmentFilter = "";
  @state() private loading = false;
  @state() private busy = false;
  @state() private errorKey: string | undefined;
  @state() private notice: string | undefined;
  @state() private showInvite = false;
  @state() private showImport = false;
  @state() private selected: IxAuthUserDetail | undefined;
  @state() private displayNameDraft = "";
  @state() private selectedRole = "";
  @state() private selectedDepartments: string[] = [];
  @state() private deleteArmed = false;

  private get basePath(): string {
    return this.context?.basePath ?? "";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private canManage(): boolean {
    return this.session?.adminConsoleUrl !== undefined;
  }

  private async load(): Promise<void> {
    this.session ??= await probeIxAuthSession(this.basePath);
    if (!this.canManage()) {
      // A second probe would not change the answer, and the page says why below.
      return;
    }
    const departments = await fetchIxAuthDepartments(this.basePath);
    if (Array.isArray(departments)) {
      this.departments = departments;
    }
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.loading = true;
    const page = await fetchIxAuthUsers({
      basePath: this.basePath,
      query: this.query.trim() || undefined,
      status: this.statusFilter || undefined,
      role: this.roleFilter || undefined,
      department: this.departmentFilter || undefined,
      page: this.pageIndex,
      size: IX_AUTH_USERS_PAGE_SIZE,
    });
    this.loading = false;
    if (isIxAuthUsersFailure(page)) {
      this.errorKey = page.errorKey;
      return;
    }
    this.errorKey = undefined;
    this.users = page.users;
    this.total = page.total;
    this.departmentFilterApplied = page.departmentFilterApplied;
  }

  /** Re-read the open account so the panel shows what the server now holds. */
  private async selectUser(userId: string): Promise<void> {
    this.deleteArmed = false;
    this.notice = undefined;
    const detail = await fetchIxAuthUserDetail({ basePath: this.basePath, userId });
    if (isIxAuthUsersFailure(detail)) {
      this.errorKey = detail.errorKey;
      return;
    }
    this.selected = detail;
    this.displayNameDraft = detail.user.displayName;
    this.selectedRole = detail.user.roles[0] ?? "MEMBER";
    this.selectedDepartments = [...detail.user.departments];
  }

  /** Run one mutation, then refresh both the row and the list behind it. */
  private async mutate(run: () => Promise<unknown>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.errorKey = undefined;
    const result = await run();
    this.busy = false;
    if (isIxAuthUsersFailure(result)) {
      this.errorKey = result.errorKey;
      return;
    }
    const userId = this.selected?.user.id;
    await this.reload();
    if (userId) {
      await this.selectUser(userId);
    }
  }

  private async runAction(action: IxAuthUserActionName): Promise<void> {
    const user = this.selected?.user;
    if (!user) {
      return;
    }
    await this.mutate(async () => {
      const result = await runIxAuthUserAction({
        basePath: this.basePath,
        userId: user.id,
        action,
      });
      if (!isIxAuthUsersFailure(result)) {
        this.notice = this.describeAction(action, user.email, result);
      }
      return result;
    });
  }

  private describeAction(
    action: IxAuthUserActionName,
    email: string,
    result: { inviteLink?: string; revoked?: number },
  ): string | undefined {
    if (action === "password-reset") {
      return t("ixAuth.users.passwordResetSent", { email });
    }
    if (action === "invite") {
      return result.inviteLink ?? t("ixAuth.invites.mailed", { email });
    }
    if (action === "sessions") {
      return t("ixAuth.users.revokedSessions", { count: String(result.revoked ?? 0) });
    }
    return undefined;
  }

  private renderFilterSelect(params: {
    label: string;
    value: string;
    anyLabel: string;
    options: readonly { value: string; label: string }[];
    onChange: (value: string) => void;
  }): TemplateResult {
    return html`
      <label class="users-toolbar__field">
        <span class="users-toolbar__label">${params.label}</span>
        <select
          class="settings-select"
          .value=${params.value}
          @change=${(event: Event) => {
            // SAFETY: this listener is bound to the select element on this line.
            params.onChange((event.target as HTMLSelectElement).value);
          }}
        >
          <option value="">${params.anyLabel}</option>
          ${params.options.map(
            (option) => html`<option
              value=${option.value}
              ?selected=${option.value === params.value}
            >
              ${option.label}
            </option>`,
          )}
        </select>
      </label>
    `;
  }

  /** Every filter change restarts at the first page: page 3 of a new query is nowhere. */
  private applyFilter(patch: {
    query?: string;
    statusFilter?: string;
    roleFilter?: string;
    departmentFilter?: string;
  }): void {
    this.query = patch.query ?? this.query;
    this.statusFilter = patch.statusFilter ?? this.statusFilter;
    this.roleFilter = patch.roleFilter ?? this.roleFilter;
    this.departmentFilter = patch.departmentFilter ?? this.departmentFilter;
    this.pageIndex = 0;
    void this.reload();
  }

  private renderToolbar(): TemplateResult {
    return html`
      <div class="users-toolbar">
        <label class="users-toolbar__field users-toolbar__field--grow">
          <span class="users-toolbar__label">${t("ixAuth.users.searchLabel")}</span>
          <input
            class="settings-input"
            type="search"
            placeholder=${t("ixAuth.users.searchPlaceholder")}
            .value=${this.query}
            @change=${(event: Event) => {
              // SAFETY: this listener is bound to the input element on this line.
              this.applyFilter({ query: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
        ${this.renderFilterSelect({
          label: t("ixAuth.users.statusLabel"),
          value: this.statusFilter,
          anyLabel: t("ixAuth.users.anyStatus"),
          options: IX_AUTH_STATUS_FILTERS.map((value) => ({
            value,
            label: t(`ixAuth.users.status.${value}`),
          })),
          onChange: (value) => this.applyFilter({ statusFilter: value }),
        })}
        ${this.renderFilterSelect({
          label: t("ixAuth.users.roleLabel"),
          value: this.roleFilter,
          anyLabel: t("ixAuth.users.anyRole"),
          options: IX_AUTH_ROLE_FILTERS.map((value) => ({ value, label: ixAuthRoleLabel(value) })),
          onChange: (value) => this.applyFilter({ roleFilter: value }),
        })}
        ${this.renderFilterSelect({
          label: t("ixAuth.users.departmentLabel"),
          value: this.departmentFilter,
          anyLabel: t("ixAuth.users.anyDepartment"),
          options: this.departments.map((item) => ({ value: item.code, label: item.name })),
          onChange: (value) => this.applyFilter({ departmentFilter: value }),
        })}
        <div class="users-toolbar__actions">
          <button class="btn" @click=${() => void this.reload()}>
            ${t("ixAuth.users.refresh")}
          </button>
          <button
            class="btn"
            aria-pressed=${this.showInvite ? "true" : "false"}
            @click=${() => {
              this.showInvite = !this.showInvite;
            }}
          >
            ${t("ixAuth.users.inviteToggle")}
          </button>
          <button
            class="btn"
            aria-pressed=${this.showImport ? "true" : "false"}
            @click=${() => {
              this.showImport = !this.showImport;
            }}
          >
            ${t("ixAuth.users.importToggle")}
          </button>
          ${
            // The console runs its own permission model and its own sign-in. It stays
            // available to the account that owns the deployment, and nobody else needs it.
            this.session?.user?.isSuperAdmin && this.session.adminConsoleUrl
              ? html`<a
                  class="btn"
                  href=${this.session.adminConsoleUrl}
                  target=${EXTERNAL_LINK_TARGET}
                  rel=${buildExternalLinkRel()}
                  >${t("ixAuth.users.consoleLink")}</a
                >`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private renderPager(): TemplateResult {
    const shown = this.pageIndex * IX_AUTH_USERS_PAGE_SIZE + this.users.length;
    return html`
      <div class="users-pager">
        <button
          class="btn"
          ?disabled=${this.pageIndex === 0 || this.loading}
          @click=${() => {
            this.pageIndex -= 1;
            void this.reload();
          }}
        >
          ${t("ixAuth.users.previousPage")}
        </button>
        <button
          class="btn"
          ?disabled=${shown >= this.total || this.loading}
          @click=${() => {
            this.pageIndex += 1;
            void this.reload();
          }}
        >
          ${t("ixAuth.users.nextPage")}
        </button>
        <span
          >${t("ixAuth.users.countLabel", { shown: String(shown), total: String(this.total) })}</span
        >
        ${
          this.departmentFilterApplied
            ? html`<span>${t("ixAuth.users.departmentFilterNote")}</span>`
            : nothing
        }
      </div>
    `;
  }

  private renderDetail(): unknown {
    const detail = this.selected;
    if (!detail) {
      return nothing;
    }
    return renderUserDetailPanel({
      user: detail.user,
      emailVerified: detail.emailVerified,
      mfaEnabled: detail.mfaEnabled,
      sessionCount: detail.sessionCount,
      departments: this.departments,
      displayNameDraft: this.displayNameDraft,
      selectedRole: this.selectedRole,
      selectedDepartments: this.selectedDepartments,
      busy: this.busy,
      canGrantSuperAdmin: this.session?.user?.isSuperAdmin === true,
      canDelete: this.session?.user?.isSuperAdmin === true,
      deleteArmed: this.deleteArmed,
      notice: this.notice,
      onDisplayNameInput: (value) => {
        this.displayNameDraft = value;
      },
      onSaveDisplayName: () =>
        void this.mutate(() =>
          updateIxAuthUser({
            basePath: this.basePath,
            userId: detail.user.id,
            displayName: this.displayNameDraft.trim(),
          }),
        ),
      onRoleChange: (role) => {
        this.selectedRole = role;
        void this.mutate(() =>
          replaceIxAuthUserRoles({
            basePath: this.basePath,
            userId: detail.user.id,
            roles: [role],
          }),
        );
      },
      onDepartmentToggle: (code, checked) => {
        const remaining = this.selectedDepartments.filter((item) => item !== code);
        this.selectedDepartments = checked ? [...remaining, code] : remaining;
      },
      onSaveDepartments: () =>
        void this.mutate(() =>
          replaceIxAuthUserDepartments({
            basePath: this.basePath,
            userId: detail.user.id,
            departments: this.selectedDepartments,
          }),
        ),
      onToggleStatus: () =>
        void this.mutate(() =>
          updateIxAuthUser({
            basePath: this.basePath,
            userId: detail.user.id,
            status: detail.user.status === "DISABLED" ? "ACTIVE" : "DISABLED",
          }),
        ),
      onAction: (action) => void this.runAction(action),
      onArmDelete: (armed) => {
        this.deleteArmed = armed;
      },
      onDelete: () => {
        this.deleteArmed = false;
        void this.mutate(async () => {
          const result = await deleteIxAuthUser({
            basePath: this.basePath,
            userId: detail.user.id,
          });
          if (!isIxAuthUsersFailure(result)) {
            this.selected = undefined;
          }
          return result;
        });
      },
    });
  }

  override render() {
    const header = html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("users")}</div>
          <div class="page-subtitle">${subtitleForRoute("users")}</div>
        </div>
      </section>
    `;
    if (!this.canManage()) {
      return html`
        ${header}
        ${renderSettingsWorkspace([
          renderSettingsSection({ title: t("ixAuth.users.title") }, [
            renderSettingsRow({ title: t("ixAuth.users.forbidden") }),
          ]),
        ])}
      `;
    }
    return html`
      ${header}
      ${renderSettingsWorkspace([
        renderSettingsSection(
          { title: t("ixAuth.users.title"), description: t("ixAuth.users.description") },
          [
            renderSettingsRow({ title: "", stacked: true, control: this.renderToolbar() }),
            this.errorKey
              ? renderSettingsRow({
                  title: "",
                  control: html`<div class="callout danger" role="alert">
                    ${t(`ixAuth.error.${this.errorKey}`)}
                  </div>`,
                })
              : nothing,
            renderSettingsRow({
              title: "",
              stacked: true,
              control: renderUsersTable({
                users: this.users,
                loading: this.loading,
                selectedId: this.selected?.user.id,
                onSelect: (userId) => void this.selectUser(userId),
              }),
            }),
            renderSettingsRow({ title: "", stacked: true, control: this.renderPager() }),
          ],
        ),
        this.renderDetail(),
        this.showInvite
          ? html`<openclaw-ix-auth-invites
              section="invite"
              .basePath=${this.basePath}
              .canManage=${true}
              .canGrantSuperAdmin=${this.session?.user?.isSuperAdmin === true}
            ></openclaw-ix-auth-invites>`
          : nothing,
        this.showImport
          ? html`<openclaw-ix-auth-users-import
              .basePath=${this.basePath}
              .onImported=${() => void this.reload()}
            ></openclaw-ix-auth-users-import>`
          : nothing,
        html`<openclaw-ix-auth-invites
          section="approvals"
          .basePath=${this.basePath}
          .canManage=${true}
        ></openclaw-ix-auth-invites>`,
      ])}
    `;
  }
}

if (!customElements.get("openclaw-users-page")) {
  customElements.define("openclaw-users-page", UsersPage);
}
