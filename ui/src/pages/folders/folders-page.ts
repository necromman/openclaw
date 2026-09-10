// Who may see which shared folder.
//
// One screen, two halves, one question. The left half is the share as the Gateway
// reports it, one level at a time; the right half is the rules pinned to whichever
// folder is selected. They are on the same screen because a rule is meaningless without
// the folder it lands on, and a folder is meaningless without the verdict it carries.
//
// The preview selector is the part that makes the screen trustworthy. Rules that hide a
// folder are easy to write and hard to believe, so an operator can reload the tree
// through one subject's eyes and see the hiding actually happen rather than take the
// rule's word for it.
//
// No permission decision is made in this file. The Gateway refuses every method behind it
// for an account that is not an administrator; the page only declines to ask when the
// session already says the answer would be no.
import "../../styles/folders.css";
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
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

/** How often the screen asks whether the walk it started has finished. */
const SCAN_POLL_MS = 3000;

/**
 * How many times it asks before it stops asking.
 *
 * Five minutes at the interval above. A walk of the delivered share was measured in
 * seconds, so a poll that runs out means something is wrong and the operator should press
 * refresh again rather than watch a spinner forever.
 */
const SCAN_POLL_LIMIT = 100;

/** The parent of one share-relative path. The root's parent is the root itself. */
function parentFolderPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "" : path.slice(0, cut);
}

export class FoldersPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;

  /** Path to that path's listing. Replaced wholesale on every change so Lit redraws. */
  @state() private tree: ReadonlyMap<string, FoldersTreeListResult> = new Map();
  @state() private expanded: ReadonlySet<string> = new Set();
  @state() private selectedPath = "";
  @state() private rules: FoldersRulesListResult | undefined;
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

  /** The first read: the share root, the subjects a rule may name, and the root's rules. */
  private async load(): Promise<void> {
    const client = this.client;
    if (!client || !canManageIxAuthUsers()) {
      return;
    }
    this.loading = true;
    try {
      const [root, subjects] = await Promise.all([
        fetchFolderTree({
          client,
          path: "",
          ...(this.preview ? { previewSubjectKind: this.preview.kind } : {}),
          ...(this.preview ? { previewSubjectId: this.preview.id } : {}),
        }),
        fetchFolderSubjects(client),
      ]);
      this.tree = new Map([["", root]]);
      this.expanded = new Set();
      this.subjects = subjects;
      this.errorKey = undefined;
    } catch {
      this.errorKey = "loadFailed";
    }
    this.loading = false;
    await this.loadRules(this.selectedPath);
    await this.loadOrphans();
  }

  /**
   * Read the rules that point at nothing.
   *
   * Kept separate from the tree read: it walks every rule rather than one level, and a
   * failure here must not stop the screen the operator came for from drawing.
   */
  private async loadOrphans(): Promise<void> {
    const client = this.client;
    if (!client || !canManageIxAuthUsers()) {
      return;
    }
    this.orphansLoading = true;
    try {
      this.orphans = await fetchFolderOrphans(client);
    } catch {
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

  /** Read one level of the share into the map, leaving the rest untouched. */
  private async loadLevel(path: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const level = await fetchFolderTree({
        client,
        path,
        ...(this.preview ? { previewSubjectKind: this.preview.kind } : {}),
        ...(this.preview ? { previewSubjectId: this.preview.id } : {}),
      });
      this.tree = new Map([...this.tree, [path, level]]);
    } catch {
      this.errorKey = "loadFailed";
    }
  }

  /**
   * Ask the Gateway to walk this branch again, then watch for it to finish.
   *
   * The branch is whatever folder is selected, so an operator who just moved files into
   * one folder pays for that folder rather than for the whole share. With nothing
   * selected the branch is the root, which is the full walk.
   */
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

  /** Read the root level again; while the walk runs that is the only thing that moves. */
  private async pollScan(): Promise<void> {
    const client = this.client;
    if (!client || !this.connected || this.pollsLeft <= 0) {
      this.scanning = false;
      return;
    }
    this.pollsLeft -= 1;
    try {
      const root = await fetchFolderTree({
        client,
        path: "",
        ...(this.preview ? { previewSubjectKind: this.preview.kind } : {}),
        ...(this.preview ? { previewSubjectId: this.preview.id } : {}),
      });
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

  /** Redraw every level the operator has open, now that the snapshot moved under them. */
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
    try {
      this.rules = await fetchFolderRules({ client, path });
      this.errorKey = undefined;
    } catch {
      this.rules = undefined;
      this.errorKey = "loadFailed";
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
    this.selectedPath = path;
    this.drafts = new Map();
    this.notice = undefined;
    this.userQuery = "";
    void this.loadRules(path);
  }

  private choosePreview(preview: FolderPreview | undefined): void {
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

  /** Run one write, then read back what it could have changed. */
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
    this.busy = false;
    await this.loadRules(this.selectedPath);
    await this.refreshLevels();
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

  /**
   * Redraw the chips a write could have moved.
   *
   * The row for the selected folder lives in its parent's listing, and the rows below it
   * live in its own, so both are read again. Levels elsewhere in the tree are left alone:
   * a rule pinned here cannot change a sibling branch, and refetching the whole tree
   * would undo the point of loading it lazily.
   */
  private async refreshLevels(): Promise<void> {
    const parent = parentFolderPath(this.selectedPath);
    for (const path of new Set([parent, this.selectedPath])) {
      if (this.tree.has(path)) {
        await this.loadLevel(path);
      }
    }
  }

  private async saveRule(kind: FolderRuleSubjectKind, id: string): Promise<void> {
    const client = this.client;
    if (!client) {
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
      this.drafts = new Map();
    });
  }

  private async removeRule(kind: FolderRuleSubjectKind, id: string): Promise<void> {
    const client = this.client;
    if (!client) {
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
      this.drafts = new Map();
    });
  }

  /** When the stored folder list was written, and the button that rewrites it. */
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
        ${renderFoldersTree({
          levels: this.tree,
          expanded: this.expanded,
          selectedPath: this.selectedPath,
          loading: this.loading,
          busy: this.busy,
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
    const header = html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("folders")}</div>
          <div class="page-subtitle">${subtitleForRoute("folders")}</div>
        </div>
      </section>
    `;
    if (!canManageIxAuthUsers()) {
      return html`
        ${header}
        ${renderSettingsWorkspace(
          renderSettingsPage([
            renderSettingsSection({ title: t("ixAuth.folders.title") }, [
              renderSettingsRow({ title: t("ixAuth.folders.forbidden") }),
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
                    ${t(`ixAuth.folders.error.${this.errorKey}`)}
                  </div>`,
                }),
              ])
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
              renderSettingsRow({
                title: "",
                stacked: true,
                control: html`<div class="folders-layout">
                  ${this.renderTreeColumn()} ${this.renderPanelColumn()}
                </div>`,
              }),
            ],
          ),
          this.renderOrphansSection(),
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-folders-page")) {
  customElements.define("openclaw-folders-page", FoldersPage);
}
