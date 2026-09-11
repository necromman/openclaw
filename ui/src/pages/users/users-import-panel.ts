// Bringing a staff list in from a spreadsheet.
//
// The file is read in the browser and posted as text: the Gateway parses it, because it
// is the side that knows which departments exist and which roles this administrator may
// hand out. Showing the first rows before the run is the whole point of the screen. A
// column shifted by one is invisible in a CSV and obvious in a preview.
import { html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { renderSettingsRow, renderSettingsSection } from "../../components/settings-ui.ts";
import {
  importIxAuthUsers,
  isIxAuthUsersFailure,
  type IxAuthImportSummary,
} from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomContentsElement } from "../../lit/openclaw-element.ts";

registerIxAuthEnglish();

/** Rows the Gateway accepts in one file. Kept in step with its own limit. */
const IX_AUTH_IMPORT_ROW_LIMIT = 500;

/** Rows shown before running, enough to see a shifted column. */
const IX_AUTH_IMPORT_PREVIEW_ROWS = 5;

/** A file larger than this is not a staff list. Refused before it is read. */
const IX_AUTH_IMPORT_MAX_BYTES = 200 * 1024;

class IxAuthUsersImport extends OpenClawLightDomContentsElement {
  @property({ attribute: false }) basePath = "";
  /** Raised after a run so the directory behind this panel reloads. */
  @property({ attribute: false }) onImported: () => void = () => {};

  @state() private fileName = "";
  @state() private csv = "";
  @state() private busy = false;
  @state() private errorKey: string | undefined;
  @state() private summary: IxAuthImportSummary | undefined;

  private async readFile(file: File | undefined): Promise<void> {
    this.errorKey = undefined;
    this.summary = undefined;
    if (!file) {
      this.fileName = "";
      this.csv = "";
      return;
    }
    if (file.size > IX_AUTH_IMPORT_MAX_BYTES) {
      this.errorKey = "usersTooManyRows";
      return;
    }
    this.fileName = file.name;
    this.csv = await file.text();
  }

  private previewLines(): string[] {
    return this.csv
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .slice(0, IX_AUTH_IMPORT_PREVIEW_ROWS + 1);
  }

  private async run(): Promise<void> {
    if (!this.csv || this.busy) {
      return;
    }
    this.busy = true;
    this.errorKey = undefined;
    const result = await importIxAuthUsers({ basePath: this.basePath, csv: this.csv });
    this.busy = false;
    if (isIxAuthUsersFailure(result)) {
      this.errorKey = result.errorKey;
      return;
    }
    this.summary = result;
    this.onImported();
  }

  private renderSummary(summary: IxAuthImportSummary): TemplateResult {
    const failures = summary.results.filter((row) => row.status !== "CREATED");
    // Created, but not placed where the file said: reported per line, so the
    // administrator can finish each person by hand instead of guessing from a count.
    const partial = summary.results.filter(
      (row) => row.status === "CREATED" && (row.departments?.failed.length ?? 0) > 0,
    );
    return html`
      <div>
        <p>
          ${t("ixAuth.users.importResult", {
            created: String(summary.created),
            failed: String(summary.failed),
          })}
        </p>
        ${
          summary.departmentFailures > 0
            ? html`<p>
                ${t("ixAuth.users.importDepartmentFailures", {
                  count: String(summary.departmentFailures),
                })}
              </p>`
            : nothing
        }
        <ul class="users-import__results">
          ${failures.map(
            (row) => html`<li>
              ${t("ixAuth.users.importRowFailed", {
                line: String(row.line),
                error: row.error ?? row.status,
              })}
            </li>`,
          )}
          ${partial.map(
            (row) => html`<li>
              ${t("ixAuth.users.importRowDepartmentsFailed", {
                line: String(row.line),
                email: row.email ?? "",
                codes: (row.departments?.failed ?? []).join(", "),
              })}
            </li>`,
          )}
        </ul>
      </div>
    `;
  }

  override render() {
    const preview = this.previewLines();
    return renderSettingsSection(
      {
        title: t("ixAuth.users.importTitle"),
        description: t("ixAuth.users.importHelp", { limit: String(IX_AUTH_IMPORT_ROW_LIMIT) }),
      },
      [
        renderSettingsRow({
          title: t("ixAuth.users.importFileLabel"),
          control: html`
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              ?disabled=${this.busy}
              @change=${(event: Event) => {
                // SAFETY: this listener is bound to the file input on this line.
                void this.readFile((event.target as HTMLInputElement).files?.[0]);
              }}
            />
          `,
        }),
        preview.length > 0
          ? renderSettingsRow({
              title: t("ixAuth.users.importPreviewTitle"),
              description: this.fileName,
              stacked: true,
              control: html`<div class="users-import__preview">${preview.join("\n")}</div>`,
            })
          : nothing,
        renderSettingsRow({
          title: "",
          control: html`<button
            class="btn primary"
            ?disabled=${this.busy || this.csv.length === 0}
            @click=${() => {
              void this.run();
            }}
          >
            ${this.busy ? t("ixAuth.users.importRunning") : t("ixAuth.users.importRun")}
          </button>`,
        }),
        this.errorKey
          ? renderSettingsRow({
              title: "",
              control: html`<div class="callout danger" role="alert">
                ${t(`ixAuth.error.${this.errorKey}`)}
              </div>`,
            })
          : nothing,
        this.summary
          ? renderSettingsRow({
              title: "",
              stacked: true,
              control: this.renderSummary(this.summary),
            })
          : nothing,
      ],
    );
  }
}

if (!customElements.get("openclaw-ix-auth-users-import")) {
  customElements.define("openclaw-ix-auth-users-import", IxAuthUsersImport);
}
