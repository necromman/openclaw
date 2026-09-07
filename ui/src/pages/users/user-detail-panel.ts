// The panel that edits one account.
//
// Kept apart from the page element so the list and the editor can be read on their own;
// the page owns every piece of state and passes it in, so this file makes no decisions
// of its own beyond what to draw.
import { html, nothing, type TemplateResult } from "lit";
import {
  renderSettingsRow,
  renderSettingsSection,
  renderSettingsValue,
} from "../../components/settings-ui.ts";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import type {
  IxAuthManagedUser,
  IxAuthUserActionName,
} from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";

/**
 * Roles this screen offers, least privileged first.
 *
 * `MODERATOR` is missing on purpose, exactly as on the invitation form: the Gateway still
 * accepts it so an existing account keeps working, but nobody staffing a company picks
 * it. An account that already holds it keeps it in the list so opening this panel cannot
 * silently propose a demotion.
 */
const IX_AUTH_ASSIGNABLE_ROLES: readonly string[] = Object.freeze(["MEMBER", "EXECUTIVE", "ADMIN"]);

const IX_AUTH_SUPER_ADMIN_ROLE = "SUPERADMIN";

/** The roles one administrator may hand to one account. */
export function assignableRolesFor(params: {
  canGrantSuperAdmin: boolean;
  currentRoles: readonly string[];
}): string[] {
  const roles = [...IX_AUTH_ASSIGNABLE_ROLES];
  for (const held of params.currentRoles) {
    if (!roles.includes(held) && held !== IX_AUTH_SUPER_ADMIN_ROLE) {
      roles.push(held);
    }
  }
  if (params.canGrantSuperAdmin || params.currentRoles.includes(IX_AUTH_SUPER_ADMIN_ROLE)) {
    roles.push(IX_AUTH_SUPER_ADMIN_ROLE);
  }
  return roles;
}

export type UserDetailPanelProps = {
  user: IxAuthManagedUser;
  emailVerified: boolean;
  mfaEnabled: boolean;
  sessionCount: number;
  departments: readonly { code: string; name: string }[];
  /** Draft display name, held by the page so typing survives a re-render. */
  displayNameDraft: string;
  selectedRole: string;
  selectedDepartments: readonly string[];
  busy: boolean;
  canGrantSuperAdmin: boolean;
  canDelete: boolean;
  deleteArmed: boolean;
  notice?: TemplateResult | string;
  onDisplayNameInput: (value: string) => void;
  onSaveDisplayName: () => void;
  onRoleChange: (role: string) => void;
  onDepartmentToggle: (code: string, checked: boolean) => void;
  onSaveDepartments: () => void;
  onToggleStatus: () => void;
  onAction: (action: IxAuthUserActionName) => void;
  onArmDelete: (armed: boolean) => void;
  onDelete: () => void;
};

function statusLabel(status: string): string {
  return t(`ixAuth.users.status.${status}`);
}

function renderIdentityRows(props: UserDetailPanelProps): unknown[] {
  const { user } = props;
  return [
    renderSettingsRow({
      title: user.email,
      description: [
        statusLabel(user.status),
        props.emailVerified ? undefined : t("ixAuth.users.emailUnverified"),
        props.mfaEnabled ? t("ixAuth.users.mfaOn") : t("ixAuth.users.mfaOff"),
        t("ixAuth.users.sessionCount", { count: String(props.sessionCount) }),
      ]
        .filter((part) => part !== undefined)
        .join(" · "),
      control: renderSettingsValue(
        user.gatewayRole ? ixAuthRoleLabel(user.gatewayRole) : user.roles.join(", "),
      ),
    }),
    renderSettingsRow({
      title: t("ixAuth.users.displayNameLabel"),
      control: html`
        <span class="users-actions">
          <input
            class="settings-input"
            .value=${props.displayNameDraft}
            ?disabled=${props.busy}
            @input=${(event: Event) => {
              // SAFETY: this listener is bound to the input element on this line.
              props.onDisplayNameInput((event.target as HTMLInputElement).value);
            }}
          />
          <button
            class="btn"
            ?disabled=${props.busy || props.displayNameDraft.trim() === user.displayName}
            @click=${() => props.onSaveDisplayName()}
          >
            ${t("ixAuth.users.save")}
          </button>
        </span>
      `,
    }),
  ];
}

function renderRoleRow(props: UserDetailPanelProps): TemplateResult {
  const options = assignableRolesFor({
    canGrantSuperAdmin: props.canGrantSuperAdmin,
    currentRoles: props.user.roles,
  });
  return renderSettingsRow({
    title: t("ixAuth.users.roleLabel"),
    description: t("ixAuth.users.rolesHelp"),
    control: html`
      <select
        class="settings-select"
        ?disabled=${props.busy || props.user.self}
        @change=${(event: Event) => {
          // SAFETY: this listener is bound to the select element on this line.
          props.onRoleChange((event.target as HTMLSelectElement).value);
        }}
      >
        ${options.map(
          (code) => html`<option value=${code} ?selected=${code === props.selectedRole}>
            ${ixAuthRoleLabel(code)}
          </option>`,
        )}
      </select>
    `,
  });
}

function renderDepartmentRow(props: UserDetailPanelProps): TemplateResult {
  return renderSettingsRow({
    title: t("ixAuth.users.departmentLabel"),
    description: t("ixAuth.users.departmentsHelp"),
    stacked: true,
    control:
      props.departments.length === 0
        ? html`<span class="muted">${t("ixAuth.invites.departmentsEmpty")}</span>`
        : html`
            <div class="ix-auth-department-list">
              ${props.departments.map(
                (item) => html`
                  <label>
                    <input
                      type="checkbox"
                      ?disabled=${props.busy || props.user.self}
                      .checked=${props.selectedDepartments.includes(item.code)}
                      @change=${(event: Event) => {
                        // SAFETY: bound to the checkbox on this template line.
                        props.onDepartmentToggle(
                          item.code,
                          (event.target as HTMLInputElement).checked,
                        );
                      }}
                    />
                    <span>${item.name}</span>
                  </label>
                `,
              )}
            </div>
            <button
              class="btn"
              ?disabled=${props.busy || props.user.self}
              @click=${() => props.onSaveDepartments()}
            >
              ${t("ixAuth.users.save")}
            </button>
          `,
  });
}

function renderActionRows(props: UserDetailPanelProps): unknown[] {
  const { user } = props;
  return [
    renderSettingsRow({
      title: t("ixAuth.users.actionsTitle"),
      description: t("ixAuth.users.passwordResetHelp"),
      stacked: true,
      control: html`
        <div class="users-actions">
          <button
            class="btn"
            ?disabled=${props.busy}
            @click=${() => props.onAction("password-reset")}
          >
            ${t("ixAuth.users.passwordReset")}
          </button>
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onAction("invite")}>
            ${t("ixAuth.users.resendInvite")}
          </button>
          <button
            class="btn"
            ?disabled=${props.busy || !user.locked}
            @click=${() => props.onAction("unlock")}
          >
            ${t("ixAuth.users.unlock")}
          </button>
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onAction("mfa-reset")}>
            ${t("ixAuth.users.mfaReset")}
          </button>
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onAction("sessions")}>
            ${t("ixAuth.users.revokeSessions")}
          </button>
          <button
            class="btn"
            ?disabled=${props.busy || user.self}
            @click=${() => props.onToggleStatus()}
          >
            ${user.status === "DISABLED" ? t("ixAuth.users.activate") : t("ixAuth.users.deactivate")}
          </button>
        </div>
      `,
    }),
    props.canDelete && !user.self
      ? renderSettingsRow({
          title: t("ixAuth.users.delete"),
          description: t("ixAuth.users.deleteHelp"),
          stacked: true,
          control: props.deleteArmed
            ? html`
                <div class="users-actions">
                  <span>${t("ixAuth.users.deleteConfirm", { email: user.email })}</span>
                  <button
                    class="btn danger"
                    ?disabled=${props.busy}
                    @click=${() => props.onDelete()}
                  >
                    ${t("ixAuth.users.deleteConfirmButton")}
                  </button>
                  <button class="btn" @click=${() => props.onArmDelete(false)}>
                    ${t("ixAuth.users.cancel")}
                  </button>
                </div>
              `
            : html`<button
                class="btn"
                ?disabled=${props.busy}
                @click=${() => props.onArmDelete(true)}
              >
                ${t("ixAuth.users.delete")}
              </button>`,
        })
      : nothing,
    props.notice
      ? renderSettingsRow({
          title: "",
          control: html`<div class="callout" role="status">${props.notice}</div>`,
        })
      : nothing,
  ];
}

/** Draw the whole detail panel for one account. */
export function renderUserDetailPanel(props: UserDetailPanelProps): TemplateResult {
  return renderSettingsSection({ title: t("ixAuth.users.detailTitle") }, [
    ...renderIdentityRows(props),
    renderRoleRow(props),
    renderDepartmentRow(props),
    ...renderActionRows(props),
  ]);
}
