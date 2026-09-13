import { html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import type { IxAuthDepartmentOption } from "../../features/ix-auth/ix-auth-admin-api.ts";
import {
  IX_AUTH_LABELLED_GATEWAY_ROLES,
  ixAuthRoleLabel,
} from "../../features/ix-auth/ix-auth-role-labels.ts";
import {
  prepareIxAuthUserFolderSubject,
  isIxAuthUsersFailure,
  type IxAuthManagedUser,
} from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import "../folders/folders-page.ts";

class UserFolderPermissions extends OpenClawLightDomElement {
  @property({ attribute: false }) user!: IxAuthManagedUser;
  @property({ attribute: false }) departments: readonly IxAuthDepartmentOption[] = [];
  @property() basePath = "";
  @state() private profileId: string | undefined;
  @state() private errorKey: string | undefined;
  @state() private targetKey = "user";
  @state() private busy = false;
  @state() private dirty = false;
  @state() private pendingTarget: string | undefined;
  private generation = 0;

  protected override updated(changed: PropertyValues<this>) {
    if (changed.has("user") && changed.get("user")?.id !== this.user.id) {
      void this.loadSubject();
    }
  }

  override disconnectedCallback() {
    this.generation += 1;
    super.disconnectedCallback();
  }

  private async loadSubject() {
    const generation = ++this.generation;
    this.profileId = undefined;
    this.errorKey = undefined;
    this.targetKey = "user";
    const result = await prepareIxAuthUserFolderSubject({
      basePath: this.basePath,
      userId: this.user.id,
    });
    if (generation !== this.generation) {
      return;
    }
    if (isIxAuthUsersFailure(result)) {
      this.errorKey = result.errorKey;
    } else {
      this.profileId = result.profileId;
    }
  }

  override render() {
    if (!this.profileId) {
      return html`<div role="status">
        <p>${this.errorKey ? t(`ixAuth.error.${this.errorKey}`) : t("common.loading")}</p>
        ${this.errorKey ? html`<button class="btn" @click=${() => void this.loadSubject()}>${t("ixAuth.folders.retry")}</button>` : nothing}
      </div>`;
    }
    const targets = [
      {
        key: "user",
        kind: "user" as const,
        id: this.profileId,
        label: this.user.displayName || this.user.email,
      },
      ...this.departments.flatMap((department) =>
        department.slug
          ? [
              {
                key: `department:${department.slug}`,
                kind: "department" as const,
                id: department.slug,
                label: department.name,
              },
            ]
          : [],
      ),
      ...IX_AUTH_LABELLED_GATEWAY_ROLES.map((role) => ({
        key: `role:${role}`,
        kind: "role" as const,
        id: role,
        label: ixAuthRoleLabel(role),
      })),
    ];
    const subject = targets.find((target) => target.key === this.targetKey) ?? targets[0]!;
    return html`
      <div class="user-folder-target">
        <label>
          <span>${t("ixAuth.users.folderTarget")}</span>
          <select
            class="settings-select"
            .value=${subject.key}
            ?disabled=${this.busy}
            @change=${(event: Event) => {
              // SAFETY: this listener belongs to the select above.
              const select = event.target as HTMLSelectElement;
              if (this.dirty) {
                this.pendingTarget = select.value;
                select.value = subject.key;
              } else {
                this.targetKey = select.value;
              }
            }}
          >
            ${targets.map(
              (target) => html`<option value=${target.key}>
                ${t(`ixAuth.users.folderTargetKinds.${target.kind}`, { name: target.label })}
              </option>`,
            )}
          </select>
        </label>
        <p class="muted">
          ${t(subject.kind === "user" ? "ixAuth.users.personalFolderHelp" : "ixAuth.users.sharedFolderHelp")}
        </p>
        ${
          this.pendingTarget
            ? html`<div class="callout" role="alert">
                <p>${t("ixAuth.users.discardChanges")}</p>
                <button
                  class="btn"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.targetKey = this.pendingTarget!;
                    this.pendingTarget = undefined;
                  }}
                >
                  ${t("ixAuth.users.discard")}
                </button>
                <button
                  class="btn"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.pendingTarget = undefined;
                  }}
                >
                  ${t("ixAuth.users.keepEditing")}
                </button>
              </div>`
            : nothing
        }
      </div>
      <openclaw-folders-page
        .embedded=${true}
        .fixedSubject=${subject}
        @folders-busy-change=${(event: CustomEvent<{ busy: boolean; dirty: boolean }>) => {
          this.busy = event.detail.busy;
          this.dirty = event.detail.dirty;
        }}
      ></openclaw-folders-page>
    `;
  }
}

if (!customElements.get("openclaw-user-folder-permissions")) {
  customElements.define("openclaw-user-folder-permissions", UserFolderPermissions);
}
