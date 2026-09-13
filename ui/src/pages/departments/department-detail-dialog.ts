import "../../components/modal-dialog.ts";
import "../folders/folders-page.ts";
import { html, nothing } from "lit";
import type { IxAuthDepartmentOption } from "../../features/ix-auth/ix-auth-admin-api.ts";
import { t } from "../../i18n/index.ts";
import { renderDepartmentDeleteForm, renderDepartmentRenameForm } from "./departments-table.ts";

export type DepartmentDetailTab = "general" | "members" | "folders" | "agents";

export function renderDepartmentDetailDialog(params: {
  department: IxAuthDepartmentOption;
  tab: DepartmentDetailTab;
  busy: boolean;
  foldersOpened: boolean;
  discardArmed: boolean;
  deleteArmed: boolean;
  renameDraft: string;
  errorKey?: string;
  notice?: string;
  members: unknown;
  agents: unknown;
  onTab: (tab: DepartmentDetailTab) => void;
  onClose: (discard?: boolean) => void;
  onKeepEditing: () => void;
  onRenameInput: (name: string) => void;
  onRename: () => void;
  onDeleteArm: () => void;
  onDeleteCancel: () => void;
  onDelete: () => void;
  onFolderState: (state: { busy: boolean; dirty: boolean }) => void;
}) {
  return html`<openclaw-modal-dialog
    class="mobile-edge-to-edge"
    label=${t("ixAuth.departments.detailDialog")}
    style="--openclaw-modal-width: 1080px;"
    @modal-cancel=${(event: Event) => {
      event.preventDefault();
      params.onClose();
    }}
    @folders-busy-change=${(event: CustomEvent<{ busy: boolean; dirty: boolean }>) => params.onFolderState(event.detail)}
  >
    <section class="admin-detail-dialog">
      <header class="admin-detail-dialog__header">
        <div>
          <h2>${params.department.name}</h2>
          <p>${params.department.code}</p>
        </div>
        <button class="btn" autofocus ?disabled=${params.busy} @click=${() => params.onClose()}>
          ${t("ixAuth.users.close")}
        </button>
      </header>
      <nav class="admin-detail-tabs" aria-label=${t("ixAuth.departments.detailDialog")}>
        ${(["general", "members", "folders", "agents"] as const).map(
          (tab) => html`<button
            class="btn"
            aria-pressed=${params.tab === tab}
            ?disabled=${params.busy || (tab === "folders" && !params.department.slug)}
            @click=${() => params.onTab(tab)}
          >
            ${t(`ixAuth.departments.detailTabs.${tab}`)}
          </button>`,
        )}
      </nav>
      <div class="admin-detail-dialog__body">
        ${params.errorKey ? html`<div class="callout danger" role="alert">${t(`ixAuth.error.${params.errorKey}`)}</div>` : nothing}
        ${params.notice ? html`<p class="departments-notice" role="status">${params.notice}</p>` : nothing}
        <div ?hidden=${params.tab !== "general"}>
          <h3>${t("ixAuth.departments.renameTitle")}</h3>
          ${renderDepartmentRenameForm({
            name: params.renameDraft,
            busy: params.busy,
            onNameInput: params.onRenameInput,
            onSubmit: params.onRename,
          })}
          <h3>${t("ixAuth.departments.deleteTitle")}</h3>
          ${renderDepartmentDeleteForm({
            department: params.department,
            busy: params.busy,
            armed: params.deleteArmed,
            onArm: params.onDeleteArm,
            onCancel: params.onDeleteCancel,
            onConfirm: params.onDelete,
          })}
        </div>
        <div ?hidden=${params.tab !== "members"}>${params.members}</div>
        <div ?hidden=${params.tab !== "folders"}>
          ${
            params.foldersOpened && params.department.slug
              ? html`<openclaw-folders-page
                  .embedded=${true}
                  .fixedSubject=${{ kind: "department", id: params.department.slug, label: params.department.name }}
                ></openclaw-folders-page>`
              : nothing
          }
        </div>
        <div ?hidden=${params.tab !== "agents"}>${params.agents}</div>
      </div>
      ${
        params.discardArmed
          ? html`<footer class="admin-detail-dialog__footer" role="alert">
              <p>${t("ixAuth.users.discardChanges")}</p>
              <button class="btn" ?disabled=${params.busy} @click=${() => params.onClose(true)}>
                ${t("ixAuth.users.discard")}
              </button>
              <button class="btn" @click=${params.onKeepEditing}>
                ${t("ixAuth.users.keepEditing")}
              </button>
            </footer>`
          : nothing
      }
    </section>
  </openclaw-modal-dialog>`;
}
