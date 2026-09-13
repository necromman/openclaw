import "../../components/modal-dialog.ts";
import { html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { IxAuthDepartmentOption } from "../../features/ix-auth/ix-auth-admin-api.ts";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import type { FolderSubjectRow } from "../folders/folder-rule-panel.ts";

class DepartmentFoldersButton extends OpenClawLightDomElement {
  @property({ attribute: false }) department: IxAuthDepartmentOption | undefined;
  @property({ type: Boolean }) busy = false;
  @state() private subject: FolderSubjectRow | undefined;
  @state() private loading = false;
  @state() private failed = false;
  @state() private saving = false;
  @state() private dirty = false;
  @state() private confirming = false;

  private async open(): Promise<void> {
    const department = this.department;
    if (this.busy || this.loading || !department?.slug) return;
    this.loading = true;
    this.failed = false;
    try {
      await import("../folders/folders-page.ts");
      if (this.isConnected) {
        this.subject = { kind: "department", id: department.slug, label: department.name };
      }
    } catch {
      this.failed = true;
    } finally {
      this.loading = false;
    }
  }

  private close(discard = false): void {
    if (this.saving) return;
    if (this.dirty && !discard) {
      this.confirming = true;
      return;
    }
    this.subject = undefined;
    this.dirty = false;
    this.confirming = false;
  }

  override render() {
    return html`
      <button class="btn" ?disabled=${this.busy || this.loading} @click=${() => void this.open()}>
        ${t(this.loading ? "ixAuth.departments.loading" : "ixAuth.departments.folderPermissions")}
      </button>
      ${this.failed ? html`<span role="alert">${t("ixAuth.folders.error.loadFailed")}</span>` : nothing}
      ${
        this.subject
          ? html`
              <openclaw-modal-dialog
                class="mobile-edge-to-edge"
                .label=${t("ixAuth.departments.folderPermissionsTitle", { name: this.subject.label })}
                style="--openclaw-modal-width: 1100px;"
                @modal-cancel=${(event: Event) => {
                  event.preventDefault();
                  this.close();
                }}
              >
                <section class="admin-detail-dialog">
                  <header class="admin-detail-dialog__header">
                    <h2>
                      ${t("ixAuth.departments.folderPermissionsTitle", { name: this.subject.label })}
                    </h2>
                    <button class="btn" ?disabled=${this.saving} @click=${() => this.close()}>
                      ${t("ixAuth.users.close")}
                    </button>
                  </header>
                  <div class="admin-detail-dialog__body">
                    <openclaw-folders-page
                      .embedded=${true}
                      .fixedSubject=${this.subject}
                      @folders-busy-change=${(
                        event: CustomEvent<{ busy: boolean; dirty: boolean }>,
                      ) => {
                        this.saving = event.detail.busy;
                        this.dirty = event.detail.dirty;
                      }}
                    ></openclaw-folders-page>
                  </div>
                  ${
                    this.confirming
                      ? html`<footer class="admin-detail-dialog__footer" role="alert">
                          <p>${t("ixAuth.users.discardChanges")}</p>
                          <button
                            class="btn"
                            ?disabled=${this.saving}
                            @click=${() => this.close(true)}
                          >
                            ${t("ixAuth.users.discard")}
                          </button>
                          <button
                            class="btn"
                            @click=${() => {
                              this.confirming = false;
                            }}
                          >
                            ${t("ixAuth.users.keepEditing")}
                          </button>
                        </footer>`
                      : nothing
                  }
                </section>
              </openclaw-modal-dialog>
            `
          : nothing
      }
    `;
  }
}

if (!customElements.get("openclaw-department-folders-button")) {
  customElements.define("openclaw-department-folders-button", DepartmentFoldersButton);
}
