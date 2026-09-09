// Rules that no longer point at anything.
//
// A folder has no id. Renaming one on the NAS leaves its rules behind, naming a path
// that will never be asked about again, and the folder itself comes back under the
// default, which is hidden. Deleting a department or a person does the same from the
// other side. Neither can be repaired by the server: it cannot tell a rename from a
// deletion, and guessing would re-point a rule somebody wrote to close a folder.
//
// So this is a list and one destructive button, and the button asks twice. Removing a
// rule is the one act on this screen that can widen access, and it does so silently:
// nothing on the tree changes until somebody notices a folder is readable again.
import { html, nothing, type TemplateResult } from "lit";
import type { FolderOrphanRule } from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import { t } from "../../i18n/index.ts";
import { folderPermissionLabel } from "./folders-tree.ts";

/** What the page hands this panel. */
export type FolderOrphansPanelProps = {
  orphans: readonly FolderOrphanRule[];
  ruleCount: number;
  available: boolean;
  loading: boolean;
  busy: boolean;
  /** True once the operator has pressed the button and been asked to confirm. */
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onClear: () => void;
};

function subjectLabel(orphan: FolderOrphanRule): string {
  if (orphan.subjectKind === "role") {
    return ixAuthRoleLabel(orphan.subjectId);
  }
  return orphan.subjectId;
}

function orphanRow(orphan: FolderOrphanRule): TemplateResult {
  return html`
    <li class="folders-orphans__row">
      <div class="folders-orphans__path" title=${orphan.absolutePath}>
        ${orphan.folderPath.length > 0 ? orphan.folderPath : t("ixAuth.folders.rootLabel")}
      </div>
      <div class="folders-orphans__subject">
        ${subjectLabel(orphan)} - ${folderPermissionLabel(orphan.permission)}
      </div>
      <div class="folders-orphans__reason">
        ${
          orphan.reason === "missing-folder"
            ? t("ixAuth.folders.orphanMissingFolder")
            : t("ixAuth.folders.orphanMissingSubject")
        }
      </div>
    </li>
  `;
}

/** The orphan list, with a two-step removal. */
export function renderFolderOrphansPanel(props: FolderOrphansPanelProps): TemplateResult {
  if (!props.available) {
    return html`<p class="folders-orphans__empty">${t("ixAuth.folders.unavailable")}</p>`;
  }
  if (props.loading) {
    return html`<p class="folders-orphans__empty">${t("ixAuth.folders.loading")}</p>`;
  }
  if (props.orphans.length === 0) {
    return html`<p class="folders-orphans__empty">
      ${t("ixAuth.folders.orphanNone", { count: String(props.ruleCount) })}
    </p>`;
  }
  return html`
    <div class="folders-orphans">
      <p class="folders-orphans__summary">
        ${t("ixAuth.folders.orphanSummary", {
          count: String(props.orphans.length),
          total: String(props.ruleCount),
        })}
      </p>
      <ul class="folders-orphans__list">
        ${props.orphans.map((orphan) => orphanRow(orphan))}
      </ul>
      ${
        props.confirming
          ? html`
              <div class="folders-orphans__confirm">
                <span
                  >${t("ixAuth.folders.orphanConfirm", {
                    count: String(props.orphans.length),
                  })}</span
                >
                <button
                  type="button"
                  class="danger"
                  ?disabled=${props.busy}
                  @click=${() => props.onClear()}
                >
                  ${t("ixAuth.folders.orphanConfirmYes")}
                </button>
                <button type="button" ?disabled=${props.busy} @click=${() => props.onCancel()}>
                  ${t("ixAuth.folders.orphanConfirmNo")}
                </button>
              </div>
            `
          : html`
              <button type="button" ?disabled=${props.busy} @click=${() => props.onConfirm()}>
                ${t("ixAuth.folders.orphanClear")}
              </button>
            `
      }
      ${props.busy ? html`<span class="folders-orphans__busy">${t("ixAuth.folders.loading")}</span>` : nothing}
    </div>
  `;
}
