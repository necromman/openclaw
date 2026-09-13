import { html, nothing } from "lit";
import type { IxAuthManagedUser } from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";
import "../../components/modal-dialog.ts";

type DetailTab = "account" | "access" | "folders";

export function renderUserDetailDialog(params: {
  user?: IxAuthManagedUser;
  busy: boolean;
  tab: DetailTab;
  errorKey?: string;
  folderBlocked: boolean;
  discardArmed: boolean;
  account: unknown;
  access: unknown;
  folders: unknown;
  onClose: (discard?: boolean) => void;
  onKeepEditing: () => void;
  onRetry: () => void;
  onTab: (tab: DetailTab) => void;
  onFolderState: (state: { busy: boolean; dirty: boolean }) => void;
}) {
  return html`<openclaw-modal-dialog
    class="mobile-edge-to-edge"
    label=${t("ixAuth.users.detailDialog")}
    style="--openclaw-modal-width: 1080px;"
    @modal-cancel=${(event: Event) => {
      event.preventDefault();
      params.onClose();
    }}
    @folders-busy-change=${(event: CustomEvent<{ busy: boolean; dirty: boolean }>) => params.onFolderState(event.detail)}
  >
    <div class="admin-detail-dialog">
      <header class="admin-detail-dialog__header">
        <div>
          <h2>${params.user?.displayName || t("ixAuth.users.detailDialog")}</h2>
          <p>${params.user?.email ?? t("common.loading")}</p>
        </div>
        <button class="btn" autofocus ?disabled=${params.busy} @click=${() => params.onClose()}>
          ${t("ixAuth.users.close")}
        </button>
      </header>
      <nav class="admin-detail-tabs" aria-label=${t("ixAuth.users.detailDialog")}>
        ${(["account", "access", "folders"] as const).map(
          (tab) => html`<button
            class="btn"
            aria-pressed=${params.tab === tab}
            ?disabled=${params.busy || !params.user || (tab === "folders" && params.folderBlocked)}
            @click=${() => params.onTab(tab)}
          >
            ${t(`ixAuth.users.${tab}Tab`)}
          </button>`,
        )}
      </nav>
      <div class="admin-detail-dialog__body">
        ${
          params.errorKey
            ? html`<div class="callout danger" role="alert">
                ${t(`ixAuth.error.${params.errorKey}`)}
                ${!params.user ? html`<button class="btn" @click=${params.onRetry}>${t("ixAuth.folders.retry")}</button>` : nothing}
              </div>`
            : nothing
        }
        <div ?hidden=${params.tab !== "account"}>${params.account}</div>
        <div ?hidden=${params.tab !== "access"}>${params.access}</div>
        <div ?hidden=${params.tab !== "folders"}>${params.folders}</div>
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
    </div>
  </openclaw-modal-dialog>`;
}
