import "../../styles/users.css";
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { subtitleForRoute, titleForRoute } from "../../app-navigation.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import {
  renderSettingsPage,
  renderSettingsRow,
  renderSettingsSection,
} from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { canManageIxAuthUsers } from "../../features/ix-auth/ix-auth-admin-access.ts";
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
  type IxAuthUsersFailure,
} from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { renderUserDetailDialog } from "./user-detail-dialog.ts";
import {
  hasUnsavedUserDetails,
  reconcileUserDetailDrafts,
  type UserDetailDraftField,
} from "./user-detail-drafts.ts";
import { renderUserDetailPanel } from "./user-detail-panel.ts";
import "./ix-auth-invite-section.ts";
import "./users-import-panel.ts";
import { renderUsersTable } from "./users-table.ts";
import "./user-folder-permissions.ts";

registerIxAuthEnglish();

const IX_AUTH_USERS_PAGE_SIZE = 25;

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
  "MODERATOR",
  "MEMBER",
]);

export class UsersPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  @state() private session: IxAuthSessionState | undefined = readIxAuthSessionSnapshot();
  @state() private users: IxAuthManagedUser[] = [];
  @state() private total = 0;
  @state() private pageIndex = 0;
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
  @state() private detailUserId: string | undefined;
  @state() private detailTab: "account" | "access" | "folders" = "access";
  @state() private foldersOpened = false;
  @state() private foldersBusy = false;
  @state() private foldersDirty = false;
  @state() private discardArmed = false;
  @state() private detailLoading = false;
  @state() private displayNameDraft = "";
  @state() private selectedRole = "";
  @state() private selectedDepartments: string[] = [];
  @state() private deleteArmed = false;

  private lifecycle = 0;
  private listRequest = 0;
  private detailRequest = 0;

  private get basePath(): string {
    return this.context?.basePath ?? "";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.lifecycle += 1;
    void this.load();
  }

  override disconnectedCallback(): void {
    this.lifecycle += 1;
    this.listRequest += 1;
    this.detailRequest += 1;
    this.busy = false;
    this.detailLoading = false;
    this.selected = undefined;
    this.detailUserId = undefined;
    super.disconnectedCallback();
  }

  private async load(): Promise<void> {
    const lifecycle = this.lifecycle;
    const session = this.session ?? (await probeIxAuthSession(this.basePath));
    if (lifecycle !== this.lifecycle) {
      return;
    }
    this.session = session;
    if (!canManageIxAuthUsers()) {
      return;
    }
    const [departments] = await Promise.all([fetchIxAuthDepartments(this.basePath), this.reload()]);
    if (lifecycle !== this.lifecycle) {
      return;
    }
    if (Array.isArray(departments)) {
      this.departments = departments;
    }
  }

  private async reload(): Promise<void> {
    const request = ++this.listRequest;
    this.loading = true;
    this.users = [];
    this.total = 0;
    this.errorKey = undefined;
    const page = await fetchIxAuthUsers({
      basePath: this.basePath,
      query: this.query.trim() || undefined,
      status: this.statusFilter || undefined,
      role: this.roleFilter || undefined,
      department: this.departmentFilter || undefined,
      page: this.pageIndex,
      size: IX_AUTH_USERS_PAGE_SIZE,
    });
    if (request !== this.listRequest) {
      return;
    }
    this.loading = false;
    if (isIxAuthUsersFailure(page)) {
      this.errorKey = page.errorKey;
      return;
    }
    this.users = page.users;
    this.total = page.total;
  }

  private get detailDraft() {
    return {
      displayNameDraft: this.displayNameDraft,
      selectedRole: this.selectedRole,
      selectedDepartments: this.selectedDepartments,
    };
  }

  private async selectUser(
    userId: string,
    options?: { keepNotice?: boolean; savedField?: UserDetailDraftField },
  ): Promise<void> {
    if (this.busy && !options?.keepNotice) {
      return;
    }
    const request = ++this.detailRequest;
    const previous = options?.keepNotice ? this.selected?.user : undefined;
    this.detailUserId = userId;
    if (!options?.keepNotice) {
      this.selected = undefined;
      this.detailTab = "access";
      this.foldersOpened = false;
      this.foldersDirty = false;
      this.discardArmed = false;
    }
    this.detailLoading = true;
    this.deleteArmed = false;
    if (!options?.keepNotice) {
      this.notice = undefined;
      this.errorKey = undefined;
    }
    const detail = await fetchIxAuthUserDetail({ basePath: this.basePath, userId });
    if (request !== this.detailRequest) {
      return;
    }
    this.detailLoading = false;
    if (isIxAuthUsersFailure(detail)) {
      this.errorKey = detail.errorKey;
      return;
    }
    this.selected = detail;
    Object.assign(
      this,
      reconcileUserDetailDrafts({
        previous,
        next: detail.user,
        draft: this.detailDraft,
        savedField: options?.savedField,
      }),
    );
  }

  private async mutate<T>(
    run: () => Promise<T | IxAuthUsersFailure>,
    onSuccess?: (result: T) => UserDetailDraftField | void,
  ): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    const lifecycle = this.lifecycle;
    this.errorKey = undefined;
    try {
      const result = await run();
      if (lifecycle !== this.lifecycle) {
        return;
      }
      if (isIxAuthUsersFailure(result)) {
        this.errorKey = result.errorKey;
        return;
      }
      const savedField = onSuccess?.(result) || undefined;
      const userId = this.selected?.user.id;
      await this.reload();
      if (lifecycle === this.lifecycle && userId) {
        await this.selectUser(userId, { keepNotice: true, savedField });
      }
    } finally {
      if (lifecycle === this.lifecycle) {
        this.busy = false;
      }
    }
  }

  private async saveDepartments(userId: string): Promise<void> {
    await this.mutate(
      () =>
        replaceIxAuthUserDepartments({
          basePath: this.basePath,
          userId,
          departments: this.selectedDepartments,
        }),
      (result) => {
        this.notice = result.departmentFailed
          ? t("ixAuth.users.departmentsPartiallyApplied", {
              codes: this.describeDepartments(result.failedDepartments),
            })
          : t("ixAuth.users.departmentsSaved");
        return result.departmentFailed ? undefined : "departments";
      },
    );
  }

  private describeDepartments(codes: readonly string[]): string {
    return codes
      .map((code) => this.departments.find((item) => item.code === code)?.name ?? code)
      .join(", ");
  }

  private async runAction(action: IxAuthUserActionName): Promise<void> {
    const user = this.selected?.user;
    if (!user) {
      return;
    }
    await this.mutate(
      () => runIxAuthUserAction({ basePath: this.basePath, userId: user.id, action }),
      (result) => {
        this.notice = this.describeAction(action, user.email, result);
      },
    );
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
          ?disabled=${this.busy}
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
            ?disabled=${this.busy}
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
          <button class="btn" ?disabled=${this.busy} @click=${() => void this.reload()}>
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
    const shown =
      this.users.length === 0 ? 0 : this.pageIndex * IX_AUTH_USERS_PAGE_SIZE + this.users.length;
    return html`
      <div class="users-pager">
        <button
          class="btn"
          ?disabled=${this.pageIndex === 0 || this.loading || this.busy}
          @click=${() => {
            this.pageIndex -= 1;
            void this.reload();
          }}
        >
          ${t("ixAuth.users.previousPage")}
        </button>
        <button
          class="btn"
          ?disabled=${shown >= this.total || this.loading || this.busy}
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
      </div>
    `;
  }

  private renderDetail(section: "account" | "access"): unknown {
    if (this.detailLoading) {
      return html`<p role="status">${t("common.loading")}</p>`;
    }
    const detail = this.selected;
    if (!detail) {
      return nothing;
    }
    return renderUserDetailPanel({
      section,
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
      protectedTarget: detail.user.isSuperAdmin && this.session?.user?.isSuperAdmin !== true,
      deleteArmed: this.deleteArmed,
      notice: this.notice,
      onDisplayNameInput: (value) => {
        this.displayNameDraft = value;
      },
      onSaveDisplayName: () =>
        void this.mutate(
          () =>
            updateIxAuthUser({
              basePath: this.basePath,
              userId: detail.user.id,
              displayName: this.displayNameDraft.trim(),
            }),
          () => "name",
        ),
      onRoleChange: (role) => {
        this.selectedRole = role;
      },
      onSaveRole: () =>
        void this.mutate(
          () =>
            replaceIxAuthUserRoles({
              basePath: this.basePath,
              userId: detail.user.id,
              roles: [this.selectedRole],
            }),
          () => {
            this.notice = t("ixAuth.users.rolesSaved");
            return "role";
          },
        ),
      onDepartmentToggle: (code, checked) => {
        const remaining = this.selectedDepartments.filter((item) => item !== code);
        this.selectedDepartments = checked ? [...remaining, code] : remaining;
      },
      onSaveDepartments: () => void this.saveDepartments(detail.user.id),
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
        void this.mutate(
          () => deleteIxAuthUser({ basePath: this.basePath, userId: detail.user.id }),
          () => {
            this.selected = undefined;
            this.detailUserId = undefined;
          },
        );
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
    if (!canManageIxAuthUsers()) {
      return html`
        ${header}
        ${renderSettingsWorkspace(
          renderSettingsPage([
            renderSettingsSection({ title: t("ixAuth.users.title") }, [
              renderSettingsRow({ title: t("ixAuth.users.forbidden") }),
            ]),
          ]),
        )}
      `;
    }
    return html`
      ${header}
      ${renderSettingsWorkspace(
        renderSettingsPage([
          renderSettingsSection(
            { title: t("ixAuth.users.title"), description: t("ixAuth.users.description") },
            [
              renderSettingsRow({ title: "", stacked: true, control: this.renderToolbar() }),
              this.errorKey && !this.detailUserId
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
                  departments: this.departments,
                  loading: this.loading,
                  busy: this.busy,
                  selectedId: this.selected?.user.id,
                  onSelect: (userId) => void this.selectUser(userId),
                }),
              }),
              renderSettingsRow({ title: "", stacked: true, control: this.renderPager() }),
            ],
          ),
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
        ]),
      )}
      ${this.renderDetailDialog()}
    `;
  }

  private closeDetail(discard = false): void {
    if (this.busy || this.foldersBusy) {
      return;
    }
    const dirty = hasUnsavedUserDetails(this.selected?.user, this.detailDraft);
    if (!discard && (dirty || this.foldersDirty)) {
      this.discardArmed = true;
      return;
    }
    this.detailRequest += 1;
    this.querySelector("openclaw-modal-dialog")?.setReturnFocusTarget(
      this.querySelector<HTMLButtonElement>(
        `.users-table__select[data-user-id="${CSS.escape(this.detailUserId ?? "")}"]`,
      ),
    );
    this.detailUserId = undefined;
    this.selected = undefined;
    this.detailLoading = false;
    this.foldersOpened = false;
    this.foldersDirty = false;
    this.errorKey = undefined;
  }

  private renderDetailDialog(): unknown {
    if (!this.detailUserId) {
      return nothing;
    }
    const user = this.selected?.user;
    const busy = this.busy || this.foldersBusy;
    return renderUserDetailDialog({
      user,
      busy,
      tab: this.detailTab,
      errorKey: this.errorKey,
      folderBlocked: Boolean(user?.isSuperAdmin && !this.session?.user?.isSuperAdmin),
      discardArmed: this.discardArmed,
      account: this.renderDetail("account"),
      access: this.renderDetail("access"),
      folders:
        this.foldersOpened && user
          ? html`<openclaw-user-folder-permissions
              .user=${user}
              .departments=${this.departments}
              .basePath=${this.basePath}
            ></openclaw-user-folder-permissions>`
          : nothing,
      onClose: (discard) => this.closeDetail(discard),
      onKeepEditing: () => {
        this.discardArmed = false;
      },
      onRetry: () => void this.selectUser(this.detailUserId!, { keepNotice: true }),
      onTab: (tab) => {
        this.detailTab = tab;
        this.foldersOpened ||= tab === "folders";
      },
      onFolderState: (folderState) => {
        this.foldersBusy = folderState.busy;
        this.foldersDirty = folderState.dirty;
      },
    });
  }
}

if (!customElements.get("openclaw-users-page")) {
  customElements.define("openclaw-users-page", UsersPage);
}
