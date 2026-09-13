import "../../styles/folders.css";
import { consume } from "@lit/context";
import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import type {
  FolderRuleSubjectKind,
  FoldersRulesListResult,
  FoldersRulesOrphansResult,
  FoldersSubjectsListResult,
  FoldersTreeListResult,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { subtitleForRoute, titleForRoute } from "../../app-navigation.ts";
import type { RouteId } from "../../app-route-paths.ts";
import {
  applicationContext,
  type ApplicationContext,
  type ApplicationGatewaySnapshot,
} from "../../app/context.ts";
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
import { renderFolderOrphansPanel } from "./folder-orphans-panel.ts";
import {
  folderSubjectKey,
  renderFolderRulePanel,
  type FolderRuleDraft,
  type FolderRuleTab,
  type FolderSubjectRow,
} from "./folder-rule-panel.ts";
import {
  clearFolderOrphans,
  clearFolderRule,
  fetchFolderOrphans,
  fetchFolderRules,
  fetchFolderSubjects,
  fetchFolderTree,
  refreshFolderTree,
  setFolderRule,
} from "./folders-gateway.ts";
import { renderFoldersTree } from "./folders-tree.ts";

registerIxAuthEnglish();

type FolderPreview = { kind: FolderRuleSubjectKind; id: string };

const SCAN_POLL_MS = 3000;

const SCAN_POLL_LIMIT = 100;

function parentFolderPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "" : path.slice(0, cut);
}

export class FoldersPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;
  @property({ type: Boolean }) embedded = false;
  @property({ attribute: false }) fixedSubject: FolderSubjectRow | undefined;

  @state() private tree: ReadonlyMap<string, FoldersTreeListResult> = new Map();
  @state() private expanded: ReadonlySet<string> = new Set();
  @state() private selectedPath = "";
  @state() private rules: FoldersRulesListResult | undefined;
  @state() private rulesLoading = false;
  @state() private subjects: FoldersSubjectsListResult | undefined;
  @state() private drafts: ReadonlyMap<string, FolderRuleDraft> = new Map();
  @state() private preview: FolderPreview | undefined;
  @state() private tab: FolderRuleTab = "department";
  @state() private userQuery = "";
  @state() private applyToDescendants = false;
  @state() private orphans: FoldersRulesOrphansResult | undefined;
  @state() private orphansLoading = false;
  @state() private orphansConfirming = false;
  @state() private loading = false;
  @state() private busy = false;
  @state() private scanning = false;
  @state() private errorKey: string | undefined;
  @state() private notice: string | undefined;

  private client: GatewayBrowserClient | null = null;
  private stopGateway: (() => void) | undefined;
  private connected = false;
  private started = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pollsLeft = 0;
  private loadGeneration = 0;
  private rulesGeneration = 0;

  override willUpdate(changed: PropertyValues) {
    const previous = changed.get("fixedSubject") as FolderSubjectRow | undefined;
    if (
      this.hasUpdated &&
      changed.has("fixedSubject") &&
      (previous?.kind !== this.fixedSubject?.kind || previous?.id !== this.fixedSubject?.id)
    ) {
      this.loadGeneration += 1;
      this.rulesGeneration += 1;
      this.selectedPath = "";
      this.rules = undefined;
      this.drafts = new Map();
      this.applyToDescendants = false;
      this.preview = undefined;
      this.tree = new Map();
      this.expanded = new Set();
      this.notice = undefined;
      this.errorKey = undefined;
      if (this.connected) void this.load();
    }
  }

  override updated(changed: PropertyValues) {
    if (changed.has("busy") || changed.has("drafts")) {
      this.dispatchEvent(
        new CustomEvent("folders-busy-change", {
          bubbles: true,
          composed: true,
          detail: { busy: this.busy, dirty: this.drafts.size > 0 },
        }),
      );
    }
  }

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
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.stopGateway?.();
    this.stopGateway = undefined;
    this.client = null;
    this.loadGeneration += 1;
    this.rulesGeneration += 1;
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
      void this.load();
    }
  }

  private async load(): Promise<void> {
    const client = this.client;
    if (!client || !canManageIxAuthUsers()) {
      return;
    }
    this.loading = true;
    const generation = ++this.loadGeneration;
    try {
      const [root, subjects] = await Promise.all([
        fetchFolderTree({
          client,
          path: "",
          ...(this.preview ? { previewSubjectKind: this.preview.kind } : {}),
          ...(this.preview ? { previewSubjectId: this.preview.id } : {}),
        }),
        this.fixedSubject ? Promise.resolve(undefined) : fetchFolderSubjects(client),
      ]);
      if (generation !== this.loadGeneration || client !== this.client) {
        return;
      }
      this.tree = new Map([["", root]]);
      this.expanded = new Set();
      this.subjects = subjects;
      this.errorKey = undefined;
    } catch {
      if (generation !== this.loadGeneration || client !== this.client) {
        return;
      }
      this.errorKey = "loadFailed";
    }
    this.loading = false;
    await this.loadRules(this.selectedPath);
    if (!this.embedded && !this.fixedSubject) await this.loadOrphans();
  }

  private async loadOrphans(): Promise<void> {
    const client = this.client;
    if (!client || !canManageIxAuthUsers()) {
      return;
    }
    this.orphansLoading = true;
    const generation = this.loadGeneration;
    try {
      const orphans = await fetchFolderOrphans(client);
      if (generation !== this.loadGeneration || client !== this.client) {
        return;
      }
      this.orphans = orphans;
    } catch {
      if (generation !== this.loadGeneration || client !== this.client) {
        return;
      }
      this.orphans = undefined;
    }
    this.orphansLoading = false;
    this.orphansConfirming = false;
  }

  private async removeOrphans(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    await this.mutate(async () => {
      const result = await clearFolderOrphans({ client });
      this.notice = t("ixAuth.folders.cleared", { count: String(result.removed) });
    });
    await this.loadOrphans();
  }

  private async loadLevel(path: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    const generation = this.loadGeneration;
    try {
      const level = await fetchFolderTree({
        client,
        path,
        ...(this.preview ? { previewSubjectKind: this.preview.kind } : {}),
        ...(this.preview ? { previewSubjectId: this.preview.id } : {}),
      });
      if (generation !== this.loadGeneration || client !== this.client) {
        return;
      }
      this.tree = new Map([...this.tree, [path, level]]);
    } catch {
      if (generation === this.loadGeneration && client === this.client) {
        this.errorKey = "loadFailed";
      }
    }
  }

  private async startRefresh(): Promise<void> {
    const client = this.client;
    if (!client || this.scanning) {
      return;
    }
    this.notice = undefined;
    try {
      const result = await refreshFolderTree({ client, path: this.selectedPath });
      this.scanning = true;
      this.notice = result.started
        ? t("ixAuth.folders.refreshStarted")
        : t("ixAuth.folders.refreshRunning");
      this.pollsLeft = SCAN_POLL_LIMIT;
      this.schedulePoll();
    } catch {
      this.errorKey = "rejected";
    }
  }

  private schedulePoll(): void {
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollScan();
    }, SCAN_POLL_MS);
  }

  private async pollScan(): Promise<void> {
    const client = this.client;
    if (!client || !this.connected || this.pollsLeft <= 0) {
      this.scanning = false;
      return;
    }
    this.pollsLeft -= 1;
    const generation = this.loadGeneration;
    try {
      const root = await fetchFolderTree({
        client,
        path: "",
        ...(this.preview ? { previewSubjectKind: this.preview.kind } : {}),
        ...(this.preview ? { previewSubjectId: this.preview.id } : {}),
      });
      if (generation !== this.loadGeneration || client !== this.client) {
        this.schedulePoll();
        return;
      }
      this.tree = new Map([...this.tree, ["", root]]);
      if (root.scan?.running) {
        this.schedulePoll();
        return;
      }
    } catch {
      this.errorKey = "loadFailed";
    }
    this.scanning = false;
    await this.reloadOpenLevels();
  }

  private async reloadOpenLevels(): Promise<void> {
    // The snapshot is taken before the loop: loadLevel writes back into the same map.
    const openPaths = [...this.tree.keys()];
    for (const path of openPaths) {
      await this.loadLevel(path);
    }
  }

  private async loadRules(path: string): Promise<void> {
    const client = this.client;
    if (!client || !canManageIxAuthUsers()) {
      return;
    }
    const generation = ++this.rulesGeneration;
    this.rules = undefined;
    this.rulesLoading = true;
    try {
      const rules = await fetchFolderRules({ client, path });
      if (generation === this.rulesGeneration && client === this.client) {
        this.rules = rules;
      }
    } catch {
      // The editor presents its own retry state, without hiding tree or orphan errors.
    } finally {
      if (generation === this.rulesGeneration && client === this.client) {
        this.rulesLoading = false;
      }
    }
  }

  private toggle(path: string): void {
    const next = new Set(this.expanded);
    if (next.has(path)) {
      next.delete(path);
      this.expanded = next;
      return;
    }
    next.add(path);
    this.expanded = next;
    if (!this.tree.has(path)) {
      void this.loadLevel(path);
    }
  }

  private select(path: string): void {
    if (this.busy) {
      return;
    }
    this.selectedPath = path;
    this.drafts = new Map();
    this.notice = undefined;
    this.userQuery = "";
    this.applyToDescendants = false;
    void this.loadRules(path);
  }

  private choosePreview(preview: FolderPreview | undefined): void {
    if (this.busy) {
      return;
    }
    this.preview = preview;
    // A preview changes what every already-open level would report, so the tree is read
    // again from the root rather than left as a mix of two viewpoints.
    this.tree = new Map();
    this.expanded = new Set();
    void this.load();
  }

  private draftFor(kind: FolderRuleSubjectKind, id: string): FolderRuleDraft {
    const key = folderSubjectKey(kind, id);
    const draft = this.drafts.get(key);
    if (draft) {
      return draft;
    }
    const own = this.rules?.rules.find(
      (rule) => rule.subjectKind === kind && rule.subjectId === id,
    );
    return own
      ? { permission: own.permission, inherit: own.inherit }
      : { permission: "hidden", inherit: true };
  }

  private setDraft(kind: FolderRuleSubjectKind, id: string, draft: FolderRuleDraft): void {
    this.drafts = new Map([...this.drafts, [folderSubjectKey(kind, id), draft]]);
  }

  private async mutate(run: () => Promise<void>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.errorKey = undefined;
    try {
      await run();
    } catch (error) {
      this.busy = false;
      this.errorKey = String(error).includes("FORBIDDEN") ? "forbidden" : "rejected";
      return;
    }
    await this.loadRules(this.selectedPath);
    await this.refreshLevels();
    this.busy = false;
  }

  private renderOrphansSection(): TemplateResult {
    return renderSettingsSection(
      {
        title: t("ixAuth.folders.orphanTitle"),
        description: t("ixAuth.folders.orphanBody"),
      },
      [
        renderSettingsRow({
          title: "",
          stacked: true,
          control: renderFolderOrphansPanel({
            orphans: this.orphans?.orphans ?? [],
            ruleCount: this.orphans?.ruleCount ?? 0,
            available: this.orphans?.available ?? true,
            loading: this.orphansLoading,
            failed: !this.orphans && !this.orphansLoading,
            onRetry: () => void this.loadOrphans(),
            busy: this.busy,
            confirming: this.orphansConfirming,
            onConfirm: () => {
              this.orphansConfirming = true;
            },
            onCancel: () => {
              this.orphansConfirming = false;
            },
            onClear: () => void this.removeOrphans(),
          }),
        }),
      ],
    );
  }

  private async refreshLevels(): Promise<void> {
    const parent = parentFolderPath(this.selectedPath);
    for (const path of [...this.tree.keys()]) {
      if (
        path === parent ||
        path === this.selectedPath ||
        this.selectedPath === "" ||
        path.startsWith(`${this.selectedPath}/`)
      ) {
        await this.loadLevel(path);
      }
    }
  }

  private async saveRule(kind: FolderRuleSubjectKind, id: string): Promise<void> {
    const client = this.client;
    if (!client || !this.connected || this.rules?.path !== this.selectedPath) {
      return;
    }
    const draft = this.draftFor(kind, id);
    await this.mutate(async () => {
      const result = await setFolderRule({
        client,
        path: this.selectedPath,
        subjectKind: kind,
        subjectId: id,
        permission: draft.permission,
        inherit: draft.inherit,
        applyToDescendants: this.applyToDescendants,
      });
      this.notice =
        result.removedDescendants > 0
          ? t("ixAuth.folders.savedWithDescendants", {
              count: String(result.removedDescendants),
            })
          : t("ixAuth.folders.saved");
      const drafts = new Map(this.drafts);
      drafts.delete(folderSubjectKey(kind, id));
      this.drafts = drafts;
    });
  }

  private async removeRule(kind: FolderRuleSubjectKind, id: string): Promise<void> {
    const client = this.client;
    if (!client || !this.connected || this.rules?.path !== this.selectedPath) {
      return;
    }
    await this.mutate(async () => {
      const result = await clearFolderRule({
        client,
        path: this.selectedPath,
        subjectKind: kind,
        subjectId: id,
      });
      this.notice = t("ixAuth.folders.cleared", { count: String(result.removed) });
      const drafts = new Map(this.drafts);
      drafts.delete(folderSubjectKey(kind, id));
      this.drafts = drafts;
    });
  }

  private renderIndexLine(): TemplateResult {
    const root = this.tree.get("");
    const scan = root?.scan;
    const stamp = scan?.finishedAt
      ? {
          time: new Date(scan.finishedAt).toLocaleString(),
          count: String(scan.folderCount ?? 0),
          path: scan.branchPath,
        }
      : undefined;
    // A branch refresh counted only that branch. Saying "4 folders" without saying which
    // branch reads as the whole share having shrunk overnight.
    const status =
      this.scanning || scan?.running
        ? t("ixAuth.folders.indexRunning")
        : stamp
          ? stamp.path
            ? t("ixAuth.folders.indexAtBranch", stamp)
            : t("ixAuth.folders.indexAt", stamp)
          : t("ixAuth.folders.indexNever");
    return html`
      <div class="folders-index">
        <span class="folders-index__status muted">${status}</span>
        <button
          type="button"
          class="folders-index__refresh"
          ?disabled=${this.busy || this.scanning || !(root?.manage ?? false)}
          title=${
            this.selectedPath.length === 0
              ? t("ixAuth.folders.refreshTitleRoot")
              : t("ixAuth.folders.refreshTitleBranch", { path: this.selectedPath })
          }
          @click=${() => void this.startRefresh()}
        >
          ${t("ixAuth.folders.refresh")}
        </button>
      </div>
    `;
  }

  private renderTreeColumn(): TemplateResult {
    return html`
      <div class="folders-layout__tree">
        <h3 class="folders-layout__heading">${t("ixAuth.folders.treeTitle")}</h3>
        ${this.renderIndexLine()}
        ${this.fixedSubject ? html`<p class="folders-preview__hint">${t("ixAuth.folders.subjectTreeHint")}</p>` : nothing}
        ${renderFoldersTree({
          levels: this.tree,
          expanded: this.expanded,
          selectedPath: this.selectedPath,
          loading: this.loading,
          busy: this.busy,
          showPermissions: !this.fixedSubject,
          onSelect: (path) => this.select(path),
          onToggle: (path) => this.toggle(path),
        })}
      </div>
    `;
  }

  private renderPanelColumn(): TemplateResult {
    const root = this.tree.get("");
    return html`
      <div class="folders-layout__panel">
        <h3 class="folders-layout__heading">${t("ixAuth.folders.rulesTitle")}</h3>
        ${renderFolderRulePanel({
          root: root?.root ?? this.rules?.root ?? "",
          path: this.selectedPath,
          manage: root?.manage ?? false,
          rules: this.rules,
          rulesLoading: this.rulesLoading,
          ...(this.fixedSubject ? { fixedSubject: this.fixedSubject } : {}),
          onRetry: () => void this.loadRules(this.selectedPath),
          subjects: this.subjects,
          tab: this.tab,
          drafts: this.drafts,
          userQuery: this.userQuery,
          applyToDescendants: this.applyToDescendants,
          preview: this.preview,
          busy: this.busy,
          ...(this.notice ? { notice: this.notice } : {}),
          onTab: (tab) => {
            this.tab = tab;
          },
          onPermission: (kind, id, permission) => {
            this.setDraft(kind, id, { ...this.draftFor(kind, id), permission });
          },
          onInherit: (kind, id, inherit) => {
            this.setDraft(kind, id, { ...this.draftFor(kind, id), inherit });
          },
          onSave: (kind, id) => void this.saveRule(kind, id),
          onClear: (kind, id) => void this.removeRule(kind, id),
          onUserQuery: (value) => {
            this.userQuery = value;
          },
          onApplyToDescendants: (value) => {
            this.applyToDescendants = value;
          },
          onPreview: (preview) => this.choosePreview(preview),
        })}
      </div>
    `;
  }

  override render() {
    const error =
      this.errorKey && canManageIxAuthUsers()
        ? html`<div class="callout danger" role="alert">
            ${t(`ixAuth.folders.error.${this.errorKey}`)}
            <button
              type="button"
              class="btn"
              ?disabled=${this.busy || this.loading}
              @click=${() => void this.load()}
            >
              ${t("ixAuth.folders.retry")}
            </button>
          </div>`
        : nothing;
    const content = !canManageIxAuthUsers()
      ? html`<p class="callout danger">${t("ixAuth.folders.forbidden")}</p>`
      : html`<div class="folders-layout">
          ${this.renderTreeColumn()} ${this.renderPanelColumn()}
        </div>`;
    if (this.embedded) {
      return html`<div class="folders-embedded">${error}${content}</div>`;
    }
    return html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("folders")}</div>
          <div class="page-subtitle">${subtitleForRoute("folders")}</div>
        </div>
      </section>
      ${renderSettingsWorkspace(
        renderSettingsPage([
          error !== nothing
            ? renderSettingsSection({}, [renderSettingsRow({ title: "", control: error })])
            : nothing,
          renderSettingsSection(
            {
              title: t("ixAuth.folders.title"),
              description: t("ixAuth.folders.description"),
            },
            [
              renderSettingsRow({
                title: t("ixAuth.folders.whitelistTitle"),
                description: t("ixAuth.folders.whitelistBody"),
              }),
              renderSettingsRow({ title: "", stacked: true, control: content }),
            ],
          ),
          canManageIxAuthUsers() && !this.fixedSubject ? this.renderOrphansSection() : nothing,
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-folders-page")) {
  customElements.define("openclaw-folders-page", FoldersPage);
}
