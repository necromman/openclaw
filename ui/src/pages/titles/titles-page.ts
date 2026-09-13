// The job-title screen: add a title, rename one, delete an empty one.
//
// Titles are the second classification over the identity server's groups. They rank
// nobody - the five permission roles are untouched - and they bind no agent. What they do
// is give the folder-rule plane a subject between the role and the department, so a
// company can say "every team lead reads this folder" without naming people one by one.
//
// Who holds a title is set on the account, next to its departments, because that is where
// somebody staffing the company is already looking. This screen owns the list itself.
import "../../styles/departments.css";
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { subtitleForRoute, titleForRoute } from "../../app-navigation.ts";
import type { RouteId } from "../../app-route-paths.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import {
  renderSettingsPage,
  renderSettingsRow,
  renderSettingsSection,
} from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { canManageIxAuthTitles } from "../../features/ix-auth/ix-auth-admin-access.ts";
import {
  createIxAuthTitle,
  deleteIxAuthTitle,
  fetchIxAuthTitleDirectory,
  renameIxAuthTitle,
  type IxAuthTitleDirectory,
  type IxAuthTitleOption,
} from "../../features/ix-auth/ix-auth-admin-api.ts";
import { isIxAuthUsersFailure } from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { autoDepartmentSlug } from "../departments/department-slug.ts";
import {
  renderOrphanTitles,
  renderTitleCreateForm,
  renderTitleEditForm,
  renderTitlesTable,
} from "./titles-table.ts";

registerIxAuthEnglish();

export class TitlesPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;

  @state() private directory: IxAuthTitleDirectory | undefined;
  @state() private selectedSlug: string | undefined;
  @state() private createSlug = "";
  @state() private createName = "";
  // The code follows the name until somebody types a code of their own.
  @state() private createSlugDirty = false;
  @state() private createSlugOpened = false;
  @state() private renameDraft = "";
  @state() private deleteArmed = false;
  @state() private loading = false;
  @state() private busy = false;
  @state() private errorKey: string | undefined;
  @state() private notice: string | undefined;

  private get basePath(): string {
    return this.context?.basePath ?? "";
  }

  override connectedCallback() {
    // The host supplies a shellless loading fallback. Remove that unowned light-DOM
    // markup before Lit claims the root.
    this.replaceChildren();
    super.connectedCallback();
    void this.loadDirectory();
  }

  private async loadDirectory(): Promise<void> {
    if (!canManageIxAuthTitles()) {
      return;
    }
    this.loading = true;
    const directory = await fetchIxAuthTitleDirectory(this.basePath);
    this.loading = false;
    if (isIxAuthUsersFailure(directory)) {
      this.errorKey = directory.errorKey;
      return;
    }
    this.errorKey = undefined;
    this.directory = directory;
  }

  private selectedTitle(): IxAuthTitleOption | undefined {
    return this.directory?.titles.find((title) => (title.slug ?? title.code) === this.selectedSlug);
  }

  /** Every short code the directory already knows, live ones and orphans alike. */
  private takenSlugs(): string[] {
    const directory = this.directory;
    if (!directory) {
      return [];
    }
    return [
      ...directory.titles.map((title) => title.slug ?? title.code),
      ...directory.orphans.map((orphan) => orphan.slug),
    ];
  }

  private async mutate(run: () => Promise<unknown>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.errorKey = undefined;
    let result: unknown;
    try {
      result = await run();
    } catch (error) {
      this.busy = false;
      this.errorKey = String(error).includes("FORBIDDEN") ? "adminForbidden" : "titlesRejected";
      return;
    }
    if (isIxAuthUsersFailure(result)) {
      this.busy = false;
      this.errorKey = result.errorKey;
      return;
    }
    await this.loadDirectory();
    this.busy = false;
  }

  private async createTitle(): Promise<void> {
    await this.mutate(async () => {
      const created = await createIxAuthTitle({
        basePath: this.basePath,
        slug: this.createSlug.trim(),
        name: this.createName.trim(),
      });
      if (!isIxAuthUsersFailure(created)) {
        this.notice = t("ixAuth.titles.created", { code: created.code });
        this.createSlug = "";
        this.createName = "";
        this.createSlugDirty = false;
        this.createSlugOpened = false;
      }
      return created;
    });
  }

  private async renameTitle(): Promise<void> {
    const slug = this.selectedSlug;
    if (!slug) {
      return;
    }
    await this.mutate(async () => {
      const renamed = await renameIxAuthTitle({
        basePath: this.basePath,
        slug,
        name: this.renameDraft.trim(),
      });
      if (!isIxAuthUsersFailure(renamed)) {
        this.notice = t("ixAuth.titles.renamed");
        this.renameDraft = renamed.name;
      }
      return renamed;
    });
  }

  private async deleteTitle(): Promise<void> {
    const slug = this.selectedSlug;
    if (!slug) {
      return;
    }
    await this.mutate(async () => {
      const removed = await deleteIxAuthTitle({ basePath: this.basePath, slug });
      if (!isIxAuthUsersFailure(removed)) {
        this.notice = t("ixAuth.titles.deleted", { slug: removed.slug });
        this.selectedSlug = undefined;
        this.deleteArmed = false;
      }
      return removed;
    });
  }

  private selectTitle(slug: string): void {
    if (this.busy) {
      return;
    }
    this.selectedSlug = this.selectedSlug === slug ? undefined : slug;
    this.deleteArmed = false;
    this.notice = undefined;
    this.renameDraft = this.selectedTitle()?.name ?? "";
  }

  private renderTitlesSection(): TemplateResult {
    const selected = this.selectedTitle();
    return renderSettingsSection(
      { title: t("ixAuth.titles.title"), description: t("ixAuth.titles.description") },
      [
        renderSettingsRow({
          title: t("ixAuth.titles.scopeTitle"),
          description: t("ixAuth.titles.scopeBody"),
        }),
        renderSettingsRow({
          title: "",
          stacked: true,
          control: renderTitlesTable({
            titles: this.directory?.titles ?? [],
            loading: this.loading,
            busy: this.busy,
            ...(this.selectedSlug ? { selectedSlug: this.selectedSlug } : {}),
            ...(this.directory ? { memberCountSource: this.directory.memberCountSource } : {}),
            onSelect: (slug) => this.selectTitle(slug),
          }),
        }),
        selected
          ? renderSettingsRow({
              title: t("ixAuth.titles.editTitle", { name: selected.name }),
              stacked: true,
              control: renderTitleEditForm({
                title: selected,
                nameDraft: this.renameDraft,
                deleteArmed: this.deleteArmed,
                busy: this.busy,
                onNameInput: (value) => {
                  this.renameDraft = value;
                },
                onRename: () => void this.renameTitle(),
                onDeleteArm: () => {
                  this.deleteArmed = true;
                },
                onDeleteCancel: () => {
                  this.deleteArmed = false;
                },
                onDelete: () => void this.deleteTitle(),
              }),
            })
          : nothing,
        renderSettingsRow({
          title: t("ixAuth.titles.createTitle"),
          stacked: true,
          control: renderTitleCreateForm({
            prefix: this.directory?.prefix ?? "",
            slug: this.createSlug,
            name: this.createName,
            busy: this.busy,
            slugOpened: this.createSlugOpened,
            onSlugInput: (value) => {
              this.createSlug = value;
              this.createSlugDirty = true;
            },
            onSlugToggle: () => {
              this.createSlugOpened = !this.createSlugOpened;
            },
            onNameInput: (value) => {
              this.createName = value;
              if (!this.createSlugDirty) {
                this.createSlug = autoDepartmentSlug(value, this.takenSlugs());
              }
            },
            onSubmit: () => void this.createTitle(),
          }),
        }),
        this.directory && this.directory.orphans.length > 0
          ? renderSettingsRow({
              title: t("ixAuth.titles.orphanTitle"),
              stacked: true,
              control: renderOrphanTitles(this.directory.orphans),
            })
          : nothing,
      ],
    );
  }

  override render() {
    const header = html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("titles")}</div>
          <div class="page-subtitle">${subtitleForRoute("titles")}</div>
        </div>
      </section>
    `;
    if (!canManageIxAuthTitles()) {
      return html`
        ${header}
        ${renderSettingsWorkspace(
          renderSettingsPage([
            renderSettingsSection({ title: t("ixAuth.titles.title") }, [
              renderSettingsRow({ title: t("ixAuth.titles.forbidden") }),
            ]),
          ]),
        )}
      `;
    }
    return html`
      ${header}
      ${renderSettingsWorkspace(
        renderSettingsPage([
          this.errorKey
            ? renderSettingsSection({}, [
                renderSettingsRow({
                  title: "",
                  control: html`<div class="callout danger" role="alert">
                    ${t(`ixAuth.error.${this.errorKey}`)}
                  </div>`,
                }),
              ])
            : nothing,
          this.notice
            ? renderSettingsSection({}, [
                renderSettingsRow({
                  title: "",
                  control: html`<div class="departments-notice" role="status">${this.notice}</div>`,
                }),
              ])
            : nothing,
          this.renderTitlesSection(),
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-titles-page")) {
  customElements.define("openclaw-titles-page", TitlesPage);
}
