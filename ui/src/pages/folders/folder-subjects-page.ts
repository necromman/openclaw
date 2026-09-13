// Folder access, edited from the subject's side.
//
// Sibling of folders-page.ts rather than a mode inside it. The two screens share the
// rule table and nothing else: this one loads nothing until a subject is named, keeps a
// page of edits in hand before anything is written, and sends them in one call. Folding
// that into the folder-first page would have meant two lifecycles and two dirty models
// in one element.
//
// Drafts are keyed by folder path and hold what would be written, including the decision
// to remove a rule (`permission: null`). A row with no draft is a row nobody touched, so
// the dirty count is the map's size and "discard" is one assignment.
import "../../styles/folders.css";
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import type {
  FolderRulePermission,
  FoldersRulesSetManyItem,
  FoldersSubjectsListResult,
  FoldersSubjectTreeResult,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { subtitleForRoute, titleForRoute } from "../../app-navigation.ts";
import type { RouteId } from "../../app-route-paths.ts";
import {
  applicationContext,
  type ApplicationContext,
  type ApplicationGatewaySnapshot,
} from "../../app/context.ts";
import { showConfirmDialog } from "../../components/confirm-dialog.ts";
import {
  renderSettingsPage,
  renderSettingsRow,
  renderSettingsSection,
} from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { canManageIxAuthUsers } from "../../features/ix-auth/ix-auth-admin-access.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import type { FolderRuleTab } from "./folder-rule-panel.ts";
import {
  renderFolderSubjectsPanel,
  type FolderSubjectRowDraft,
  type FolderSubjectTarget,
} from "./folder-subjects-panel.ts";
import {
  fetchFolderSubjectTree,
  fetchFolderSubjects,
  setFolderRulesForSubject,
} from "./folders-gateway.ts";

registerIxAuthEnglish();

/** The one role the server always answers `write` for, whatever is written about it. */
const SUPER_ADMIN_ROLE = "superadmin";

export class FolderSubjectsPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;

  @state() private subjects: FoldersSubjectsListResult | undefined;
  @state() private tab: FolderRuleTab = "department";
  @state() private userQuery = "";
  @state() private target: FolderSubjectTarget | undefined;
  @state() private levels: ReadonlyMap<string, FoldersSubjectTreeResult> = new Map();
  @state() private expanded: ReadonlySet<string> = new Set();
  @state() private drafts: ReadonlyMap<string, FolderSubjectRowDraft> = new Map();
  @state() private rowErrors: ReadonlyMap<string, string> = new Map();
  @state() private loading = false;
  @state() private busy = false;
  @state() private errorKey: string | undefined;
  @state() private notice: string | undefined;

  private client: GatewayBrowserClient | null = null;
  private stopGateway: (() => void) | undefined;
  private connected = false;
  private started = false;
  private generation = 0;

  override connectedCallback() {
    // The host supplies a shellless loading fallback. Remove that unowned light-DOM
    // markup before Lit claims the root.
    this.replaceChildren();
    super.connectedCallback();
    this.stopGateway = this.context.gateway.subscribe((snapshot) =>
      this.applyGatewaySnapshot(snapshot),
    );
    this.applyGatewaySnapshot(this.context.gateway.snapshot);
  }

  override disconnectedCallback() {
    this.stopGateway?.();
    this.stopGateway = undefined;
    this.client = null;
    this.generation += 1;
    this.connected = false;
    this.started = false;
    super.disconnectedCallback();
  }

  private applyGatewaySnapshot(snapshot: ApplicationGatewaySnapshot) {
    const clientChanged = snapshot.client !== this.client;
    this.client = snapshot.client;
    this.connected = snapshot.phase === "connected";
    if (this.connected && (clientChanged || !this.started)) {
      this.started = true;
      void this.loadSubjects();
    }
  }

  private async loadSubjects(): Promise<void> {
    const client = this.client;
    if (!client || !canManageIxAuthUsers()) {
      return;
    }
    const generation = ++this.generation;
    this.loading = true;
    try {
      const subjects = await fetchFolderSubjects(client);
      if (generation !== this.generation || client !== this.client) {
        return;
      }
      this.subjects = subjects;
      this.errorKey = undefined;
    } catch {
      if (generation === this.generation && client === this.client) {
        this.errorKey = "loadFailed";
      }
    }
    this.loading = false;
  }

  /** Load one level for the current target. The root level replaces the whole map. */
  private async loadLevel(path: string): Promise<void> {
    const client = this.client;
    const target = this.target;
    if (!client || !target) {
      return;
    }
    const generation = this.generation;
    this.loading = true;
    try {
      const level = await fetchFolderSubjectTree({
        client,
        subjectKind: target.kind,
        subjectId: target.id,
        path,
      });
      if (generation !== this.generation || client !== this.client) {
        return;
      }
      this.levels = new Map([...this.levels, [path, level]]);
      this.errorKey = undefined;
    } catch {
      if (generation === this.generation && client === this.client) {
        this.errorKey = "loadFailed";
      }
    }
    this.loading = false;
  }

  /**
   * Switch the screen to another subject.
   *
   * Unsaved edits belong to the subject they were made for, so moving away has to ask
   * rather than carry them across: applying one department's page to another is the one
   * mistake this screen could make that nobody would notice afterwards.
   */
  private async chooseTarget(target: FolderSubjectTarget): Promise<void> {
    if (this.target?.kind === target.kind && this.target.id === target.id) {
      return;
    }
    if (this.drafts.size > 0) {
      const discard = await showConfirmDialog({
        message: t("ixAuth.folders.switchConfirm"),
        confirmLabel: t("ixAuth.folders.switchConfirmYes"),
        cancelLabel: t("ixAuth.folders.switchConfirmNo"),
      });
      if (!discard) {
        return;
      }
    }
    this.generation += 1;
    this.target = target;
    this.levels = new Map();
    this.expanded = new Set();
    this.drafts = new Map();
    this.rowErrors = new Map();
    this.notice = undefined;
    await this.loadLevel("");
  }

  private toggle(path: string): void {
    const expanded = new Set(this.expanded);
    if (expanded.has(path)) {
      expanded.delete(path);
      this.expanded = expanded;
      return;
    }
    expanded.add(path);
    this.expanded = expanded;
    if (!this.levels.has(path)) {
      void this.loadLevel(path);
    }
  }

  /** The row's saved state, so a draft can carry `inherit` forward from what is stored. */
  private storedRow(
    path: string,
  ): { permission: FolderRulePermission; inherit: boolean } | undefined {
    for (const level of this.levels.values()) {
      const entry = level.entries.find((candidate) => candidate.path === path);
      if (entry?.ownRule) {
        return entry.ownRule;
      }
    }
    return undefined;
  }

  private setDraft(path: string, draft: FolderSubjectRowDraft): void {
    const stored = this.storedRow(path);
    const drafts = new Map(this.drafts);
    // A row edited back to exactly what is stored is not a change, and leaving it in the
    // map would send a pointless write and inflate the count the operator is reading.
    const unchanged =
      !draft.applyToDescendants &&
      (stored === undefined
        ? draft.permission === null
        : draft.permission === stored.permission && draft.inherit === stored.inherit);
    if (unchanged) {
      drafts.delete(path);
    } else {
      drafts.set(path, draft);
    }
    this.drafts = drafts;
    if (this.rowErrors.has(path)) {
      const errors = new Map(this.rowErrors);
      errors.delete(path);
      this.rowErrors = errors;
    }
  }

  private draftFor(path: string): FolderSubjectRowDraft {
    const existing = this.drafts.get(path);
    if (existing) {
      return existing;
    }
    const stored = this.storedRow(path);
    return {
      permission: stored?.permission ?? null,
      inherit: stored?.inherit ?? true,
      applyToDescendants: false,
    };
  }

  private revert(): void {
    this.drafts = new Map();
    this.rowErrors = new Map();
    this.notice = undefined;
  }

  /**
   * Send the page of edits as one call.
   *
   * The answer carries one row per folder. Failures are marked against their rows and
   * their drafts are kept, so a retry re-sends exactly what did not land; everything that
   * did land is dropped from the draft map and re-read from the server.
   */
  private async save(): Promise<void> {
    const client = this.client;
    const target = this.target;
    if (!client || !target || this.drafts.size === 0) {
      return;
    }
    const items: FoldersRulesSetManyItem[] = [];
    for (const [path, draft] of this.drafts) {
      const item: FoldersRulesSetManyItem = { path, permission: draft.permission };
      // A removal carries no inherit flag: there is nothing left to inherit from.
      if (draft.permission !== null) {
        item.inherit = draft.inherit;
      }
      if (draft.applyToDescendants) {
        item.applyToDescendants = true;
      }
      items.push(item);
    }
    this.busy = true;
    this.notice = undefined;
    try {
      const result = await setFolderRulesForSubject({
        client,
        subjectKind: target.kind,
        subjectId: target.id,
        items,
      });
      const drafts = new Map(this.drafts);
      const errors = new Map<string, string>();
      for (const row of result.results) {
        if (row.ok) {
          drafts.delete(row.path);
        } else {
          errors.set(row.path, row.error ?? t("ixAuth.folders.error.rejected"));
        }
      }
      this.drafts = drafts;
      this.rowErrors = errors;
      const saved = result.results.length - errors.size;
      this.notice =
        errors.size === 0
          ? t("ixAuth.folders.saveDone", { count: String(saved) })
          : t("ixAuth.folders.savePartial", {
              count: String(saved),
              failed: String(errors.size),
            });
      this.errorKey = undefined;
    } catch {
      this.errorKey = "rejected";
    }
    this.busy = false;
    await this.reloadLoadedLevels();
  }

  /** Re-read every level already on screen, so the chips show what the server now says. */
  private async reloadLoadedLevels(): Promise<void> {
    const paths = [...this.levels.keys()];
    for (const path of paths) {
      await this.loadLevel(path);
    }
  }

  private renderPanel(): TemplateResult {
    return renderFolderSubjectsPanel({
      subjects: this.subjects,
      tab: this.tab,
      userQuery: this.userQuery,
      target: this.target,
      superAdminTarget: this.target?.kind === "role" && this.target.id === SUPER_ADMIN_ROLE,
      levels: this.levels,
      expanded: this.expanded,
      drafts: this.drafts,
      rowErrors: this.rowErrors,
      loading: this.loading,
      busy: this.busy,
      onTab: (tab) => {
        this.tab = tab;
      },
      onUserQuery: (value) => {
        this.userQuery = value;
      },
      onTarget: (target) => void this.chooseTarget(target),
      onToggle: (path) => this.toggle(path),
      onPermission: (path, permission) => {
        this.setDraft(path, { ...this.draftFor(path), permission });
      },
      onInherit: (path, inherit) => {
        this.setDraft(path, { ...this.draftFor(path), inherit });
      },
      onRemove: (path) => {
        this.setDraft(path, { ...this.draftFor(path), permission: null });
      },
      onSave: () => void this.save(),
      onRevert: () => this.revert(),
    });
  }

  override render() {
    const error = this.errorKey
      ? html`<div class="callout danger" role="alert">
          ${t(`ixAuth.folders.error.${this.errorKey}`)}
        </div>`
      : nothing;
    const content = !canManageIxAuthUsers()
      ? html`<p class="callout danger">${t("ixAuth.folders.forbidden")}</p>`
      : this.renderPanel();
    return html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("folders")}</div>
          <div class="page-subtitle">${subtitleForRoute("folders")}</div>
        </div>
      </section>
      ${renderSettingsWorkspace(
        renderSettingsPage([
          renderSettingsSection(
            {
              title: t("ixAuth.folders.bySubjectTitle"),
              description: t("ixAuth.folders.bySubjectDescription"),
            },
            [
              error !== nothing ? renderSettingsRow({ title: "", control: error }) : nothing,
              this.notice
                ? renderSettingsRow({
                    title: "",
                    control: html`<p class="folders-notice" role="status">${this.notice}</p>`,
                  })
                : nothing,
              renderSettingsRow({ title: "", stacked: true, control: content }),
            ],
          ),
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-folder-subjects-page")) {
  customElements.define("openclaw-folder-subjects-page", FolderSubjectsPage);
}
