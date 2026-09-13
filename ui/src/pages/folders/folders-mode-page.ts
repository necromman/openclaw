// One route, two directions through the same rule table.
//
// "By folder" asks who may see one folder; "by subject" asks which folders one person,
// department or role may reach. They are the same rows read from opposite ends, and an
// administrator arrives with one question or the other depending on what just happened:
// a folder appeared on the share, or somebody changed desks.
//
// The switch is a wrapper rather than a mode inside either page so that neither page
// carries the other's lifecycle. Only the chosen side is instantiated, so nothing is
// fetched for the side nobody is looking at.
import { html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";

registerIxAuthEnglish();

type FoldersMode = "folder" | "subject";

const FOLDER_MODES: readonly (readonly [FoldersMode, string])[] = [
  ["folder", "ixAuth.folders.modeFolderFirst"],
  ["subject", "ixAuth.folders.modeSubjectFirst"],
];

export class FoldersModePage extends OpenClawLightDomElement {
  @state() private mode: FoldersMode = "folder";

  override connectedCallback() {
    // The host supplies a shellless loading fallback. Remove that unowned light-DOM
    // markup before Lit claims the root.
    this.replaceChildren();
    super.connectedCallback();
  }

  override render() {
    return html`
      <div class="folders-mode">
        <nav
          class="admin-detail-tabs folders-mode__tabs"
          aria-label=${t("ixAuth.folders.modeSwitch")}
        >
          ${FOLDER_MODES.map(
            ([mode, key]) => html`<button
              type="button"
              class="btn"
              aria-pressed=${this.mode === mode}
              @click=${() => {
                this.mode = mode;
              }}
            >
              ${t(key)}
            </button>`,
          )}
        </nav>
        ${this.mode === "folder" ? html`<openclaw-folders-page></openclaw-folders-page>` : nothing}
        ${
          this.mode === "subject"
            ? html`<openclaw-folder-subjects-page></openclaw-folder-subjects-page>`
            : nothing
        }
      </div>
    `;
  }
}

if (!customElements.get("openclaw-folders-mode-page")) {
  customElements.define("openclaw-folders-mode-page", FoldersModePage);
}
