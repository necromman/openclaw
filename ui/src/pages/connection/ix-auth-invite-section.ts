// Invitation and signup-approval controls for administrators.
//
// It lives on the connection page beside the account block because in this mode the
// connection is the account. Nothing here is a permission check: the Gateway refuses
// these routes for anyone but a superadmin or admin, and this element only decides
// whether it is worth rendering.
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
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomContentsElement } from "../../lit/openclaw-element.ts";

registerIxAuthEnglish();

/** Roles an invitation may grant, in the order an administrator reads them. */
const IX_AUTH_INVITE_ROLES: readonly string[] = Object.freeze([
  "MEMBER",
  "MODERATOR",
  "ADMIN",
  "SUPERADMIN",
]);

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

  @state() private departments: IxAuthDepartmentOption[] = [];
  @state() private invites: IxAuthInviteLink[] = [];
  @state() private pending: IxAuthPendingSignup[] = [];
  @state() private email = "";
  @state() private name = "";
  @state() private inviteRole = "MEMBER";
  @state() private department = "";
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
      department: this.department || undefined,
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
      department: decision === "approve" ? this.department || undefined : undefined,
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
          this.inviteRole = (e.target as HTMLSelectElement).value;
        }}
      >
        ${IX_AUTH_INVITE_ROLES.map(
          (code) =>
            html`<option value=${code} ?selected=${code === this.inviteRole}>${code}</option>`,
        )}
      </select>
    `;
  }

  private renderDepartmentSelect(): TemplateResult {
    return html`
      <select
        class="settings-select"
        ?disabled=${this.busy}
        @change=${(e: Event) => {
          // SAFETY: this listener is bound to the select element on this template line.
          this.department = (e.target as HTMLSelectElement).value;
        }}
      >
        <option value="">${t("ixAuth.invites.departmentNone")}</option>
        ${this.departments.map(
          (item) =>
            html`<option value=${item.code} ?selected=${item.code === this.department}>
              ${item.name}
            </option>`,
        )}
      </select>
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
        title: t("ixAuth.invites.departmentLabel"),
        control: this.renderDepartmentSelect(),
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
    return html`
      ${renderSettingsSection(
        { title: t("ixAuth.invites.title"), description: t("ixAuth.invites.description") },
        this.renderInviteRows(),
      )}
      ${renderSettingsSection(
        { title: t("ixAuth.approvals.title"), description: t("ixAuth.approvals.description") },
        [renderSettingsRow({ title: "", stacked: true, control: this.renderApprovals() })],
      )}
    `;
  }
}

if (!customElements.get("openclaw-ix-auth-invites")) {
  customElements.define("openclaw-ix-auth-invites", IxAuthInvites);
}
