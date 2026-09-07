// Invitation and signup-approval controls for administrators.
//
// Both live on the user-management screen, each drawn on its own: inviting is something
// an administrator reaches for deliberately, so it opens from a button, while the
// approval queue is standing work and sits in the page. Nothing here is a permission
// check: the Gateway refuses these routes for anyone but a superadmin or admin, and this
// element only decides whether it is worth rendering.
import { html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { renderSettingsRow, renderSettingsSection } from "../../components/settings-ui.ts";
import {
  decideIxAuthSignup,
  fetchIxAuthDepartments,
  fetchIxAuthInviteLinks,
  fetchIxAuthPendingSignups,
  forgetIxAuthInvite,
  issueIxAuthInvite,
  type IxAuthDepartmentOption,
  type IxAuthInviteLink,
  type IxAuthPendingSignup,
} from "../../features/ix-auth/ix-auth-admin-api.ts";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomContentsElement } from "../../lit/openclaw-element.ts";

registerIxAuthEnglish();

/**
 * Roles an invitation offers, least privileged first.
 *
 * `MODERATOR` is missing on purpose: the Gateway still accepts it so an existing account
 * or a hand-written config keeps working, but nobody staffing a company picks it, and a
 * choice nobody should make does not belong in a list of four.
 */
const IX_AUTH_INVITE_ROLES: readonly string[] = Object.freeze(["MEMBER", "EXECUTIVE", "ADMIN"]);

/**
 * The role whose invitation covers the whole company.
 *
 * Checking every box for it is a starting point, not a rule: the administrator can clear
 * any of them, and the Gateway fills the list itself when none is left rather than
 * trusting whatever the form posts.
 */
const IX_AUTH_ALL_DEPARTMENT_ROLE = "EXECUTIVE";

/** Only a super administrator may hand out their own rank. */
const IX_AUTH_SUPER_ADMIN_INVITE_ROLE = "SUPERADMIN";

function isAdminFailure(value: unknown): value is { kind: "failed"; errorKey: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  // SAFETY: the guard above proves this is a plain object.
  return (value as { kind?: unknown }).kind === "failed";
}

class IxAuthInvites extends OpenClawLightDomContentsElement {
  @property({ attribute: false }) basePath = "";
  /** True only for a session the Gateway already reported carries an admin role. */
  @property({ attribute: false }) canManage = false;
  /**
   * True for a super-admin session. The Gateway refuses the promotion either way; this
   * only keeps an offer off the screen that would always be answered with 403.
   */
  @property({ attribute: false }) canGrantSuperAdmin = false;
  /**
   * Which half to draw. The two halves share one element because they share the
   * department list and the reload that keeps both honest after an invitation lands.
   */
  @property() section: "invite" | "approvals" | "both" = "both";

  @state() private departments: IxAuthDepartmentOption[] = [];
  @state() private invites: IxAuthInviteLink[] = [];
  @state() private pending: IxAuthPendingSignup[] = [];
  @state() private email = "";
  @state() private name = "";
  @state() private inviteRole = "MEMBER";
  @state() private selectedDepartments: string[] = [];
  @state() private busy = false;
  @state() private errorKey: string | undefined;
  @state() private mailedTo: string | undefined;
  @state() private copiedLink: string | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.canManage) {
      void this.reload();
    }
  }

  override updated(changed: Map<string, unknown>): void {
    // The connection page learns the role from an asynchronous probe, so this element is
    // usually rendered once before it is allowed to load anything.
    if (changed.has("canManage") && this.canManage) {
      void this.reload();
    }
  }

  private async reload(): Promise<void> {
    const [departments, invites, pending] = await Promise.all([
      fetchIxAuthDepartments(this.basePath),
      fetchIxAuthInviteLinks(this.basePath),
      fetchIxAuthPendingSignups(this.basePath),
    ]);
    if (!isAdminFailure(departments)) {
      this.departments = departments;
    }
    if (!isAdminFailure(invites)) {
      this.invites = invites;
    }
    if (!isAdminFailure(pending)) {
      this.pending = pending;
    }
  }

  /** Roles to offer this administrator, widest rank last. */
  private inviteRoleOptions(): readonly string[] {
    return this.canGrantSuperAdmin
      ? [...IX_AUTH_INVITE_ROLES, IX_AUTH_SUPER_ADMIN_INVITE_ROLE]
      : IX_AUTH_INVITE_ROLES;
  }

  private selectRole(role: string): void {
    this.inviteRole = role;
    // Switching to the company-wide role fills the list in; switching away leaves the
    // administrator's own choice alone, because they may have meant it.
    if (role === IX_AUTH_ALL_DEPARTMENT_ROLE) {
      this.selectedDepartments = this.departments.map((item) => item.code);
    }
  }

  private toggleDepartment(code: string, checked: boolean): void {
    const remaining = this.selectedDepartments.filter((item) => item !== code);
    this.selectedDepartments = checked ? [...remaining, code] : remaining;
  }

  private async invite(): Promise<void> {
    const email = this.email.trim();
    if (!email || this.busy) {
      return;
    }
    this.busy = true;
    this.errorKey = undefined;
    this.mailedTo = undefined;
    const result = await issueIxAuthInvite({
      basePath: this.basePath,
      email,
      name: this.name.trim() || undefined,
      role: this.inviteRole,
      departments: this.selectedDepartments,
    });
    this.busy = false;
    if (isAdminFailure(result)) {
      this.errorKey = result.errorKey;
      return;
    }
    this.email = "";
    this.name = "";
    if (result.departmentFailed) {
      this.errorKey = "departmentFailed";
    }
    await this.reload();
    // Decided after the reload rather than from the response alone: a webhook that lands
    // just after the request would otherwise be reported as a mail that was sent.
    const held = this.invites.some((invite) => invite.email === result.email.toLowerCase());
    if (!result.inviteLink && !held) {
      this.mailedTo = result.email;
    }
  }

  private async forget(email: string): Promise<void> {
    await forgetIxAuthInvite({ basePath: this.basePath, email });
    await this.reload();
  }

  private async decide(userId: string, decision: "approve" | "reject"): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    const result = await decideIxAuthSignup({
      basePath: this.basePath,
      userId,
      decision,
      departments: decision === "approve" ? this.selectedDepartments : [],
    });
    this.busy = false;
    if (isAdminFailure(result)) {
      this.errorKey = result.errorKey;
      return;
    }
    await this.reload();
  }

  private async copyLinkToClipboard(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      this.copiedLink = link;
    } catch {
      // Clipboard access can be refused. The link is on screen and selectable anyway.
      this.copiedLink = undefined;
    }
  }

  private renderTextField(params: {
    value: string;
    type?: string;
    onInput: (value: string) => void;
  }): TemplateResult {
    return html`
      <input
        class="settings-input"
        type=${params.type ?? "text"}
        autocapitalize="none"
        spellcheck="false"
        .value=${params.value}
        ?disabled=${this.busy}
        @input=${(e: Event) => {
          // SAFETY: this listener is bound to the input element on this template line.
          params.onInput((e.target as HTMLInputElement).value);
        }}
      />
    `;
  }

  private renderRoleSelect(): TemplateResult {
    return html`
      <select
        class="settings-select"
        ?disabled=${this.busy}
        @change=${(e: Event) => {
          // SAFETY: this listener is bound to the select element on this template line.
          this.selectRole((e.target as HTMLSelectElement).value);
        }}
      >
        ${this.inviteRoleOptions().map(
          (code) =>
            html`<option value=${code} ?selected=${code === this.inviteRole}>
              ${ixAuthRoleLabel(code)}
            </option>`,
        )}
      </select>
    `;
  }

  private renderDepartmentChecklist(): TemplateResult {
    if (this.departments.length === 0) {
      return html`<span class="muted">${t("ixAuth.invites.departmentsEmpty")}</span>`;
    }
    return html`
      <div class="ix-auth-department-list">
        ${this.departments.map(
          (item) => html`
            <label>
              <input
                type="checkbox"
                ?disabled=${this.busy}
                .checked=${this.selectedDepartments.includes(item.code)}
                @change=${(e: Event) => {
                  // SAFETY: bound to the checkbox on this template line.
                  this.toggleDepartment(item.code, (e.target as HTMLInputElement).checked);
                }}
              />
              <span>${item.name}</span>
            </label>
          `,
        )}
      </div>
    `;
  }

  private renderInviteLinks(): TemplateResult {
    if (this.invites.length === 0) {
      return html`<span class="muted">${t("ixAuth.invites.empty")}</span>`;
    }
    return html`
      <ul class="ix-auth-invite-list">
        ${this.invites.map(
          (invite) => html`
            <li>
              <strong>${invite.email}</strong>
              <code class="ix-auth-invite-link">${invite.link}</code>
              <span>
                <button
                  class="btn"
                  @click=${() => {
                    void this.copyLinkToClipboard(invite.link);
                  }}
                >
                  ${
                    this.copiedLink === invite.link
                      ? t("ixAuth.invites.copied")
                      : t("ixAuth.invites.copyLink")
                  }
                </button>
                <button
                  class="btn"
                  @click=${() => {
                    void this.forget(invite.email);
                  }}
                >
                  ${t("ixAuth.invites.forget")}
                </button>
              </span>
            </li>
          `,
        )}
      </ul>
    `;
  }

  private renderApprovals(): TemplateResult {
    if (this.pending.length === 0) {
      return html`<span class="muted">${t("ixAuth.approvals.empty")}</span>`;
    }
    return html`
      <ul class="ix-auth-invite-list">
        ${this.pending.map(
          (item) => html`
            <li>
              <strong>${item.email}</strong>
              ${
                item.emailVerified
                  ? nothing
                  : html`<span class="muted">${t("ixAuth.approvals.unverified")}</span>`
              }
              <span>
                <button
                  class="btn primary"
                  ?disabled=${this.busy}
                  @click=${() => {
                    void this.decide(item.userId, "approve");
                  }}
                >
                  ${t("ixAuth.approvals.approve")}
                </button>
                <button
                  class="btn"
                  ?disabled=${this.busy}
                  @click=${() => {
                    void this.decide(item.userId, "reject");
                  }}
                >
                  ${t("ixAuth.approvals.reject")}
                </button>
              </span>
            </li>
          `,
        )}
      </ul>
    `;
  }

  private renderInviteRows(): unknown[] {
    return [
      renderSettingsRow({
        title: t("ixAuth.invites.emailLabel"),
        control: this.renderTextField({
          value: this.email,
          type: "email",
          onInput: (value) => {
            this.email = value;
          },
        }),
      }),
      renderSettingsRow({
        title: t("ixAuth.invites.nameLabel"),
        control: this.renderTextField({
          value: this.name,
          onInput: (value) => {
            this.name = value;
          },
        }),
      }),
      renderSettingsRow({
        title: t("ixAuth.invites.roleLabel"),
        control: this.renderRoleSelect(),
      }),
      renderSettingsRow({
        title: t("ixAuth.invites.departmentsLabel"),
        description:
          this.inviteRole === IX_AUTH_ALL_DEPARTMENT_ROLE
            ? t("ixAuth.invites.departmentsExecutiveHint")
            : undefined,
        stacked: true,
        control: this.renderDepartmentChecklist(),
      }),
      renderSettingsRow({
        title: "",
        control: html`<button
          class="btn primary"
          ?disabled=${this.busy || !this.email.trim()}
          @click=${() => {
            void this.invite();
          }}
        >
          ${this.busy ? t("ixAuth.invites.submitting") : t("ixAuth.invites.submit")}
        </button>`,
      }),
      this.mailedTo
        ? renderSettingsRow({ title: t("ixAuth.invites.mailed", { email: this.mailedTo }) })
        : nothing,
      this.errorKey
        ? renderSettingsRow({
            title: "",
            control: html`<div class="callout danger" role="alert">
              ${
                this.errorKey === "departmentFailed"
                  ? t("ixAuth.invites.departmentFailed")
                  : t(`ixAuth.error.${this.errorKey}`)
              }
            </div>`,
          })
        : nothing,
      renderSettingsRow({
        title: t("ixAuth.invites.linkTitle"),
        description: t("ixAuth.invites.linkHelp"),
        stacked: true,
        control: this.renderInviteLinks(),
      }),
    ];
  }

  override render() {
    if (!this.canManage) {
      return nothing;
    }
    const invites =
      this.section === "approvals"
        ? nothing
        : renderSettingsSection(
            { title: t("ixAuth.invites.title"), description: t("ixAuth.invites.description") },
            this.renderInviteRows(),
          );
    const approvals =
      this.section === "invite"
        ? nothing
        : renderSettingsSection(
            { title: t("ixAuth.approvals.title"), description: t("ixAuth.approvals.description") },
            [renderSettingsRow({ title: "", stacked: true, control: this.renderApprovals() })],
          );
    return html`${invites}${approvals}`;
  }
}

if (!customElements.get("openclaw-ix-auth-invites")) {
  customElements.define("openclaw-ix-auth-invites", IxAuthInvites);
}
