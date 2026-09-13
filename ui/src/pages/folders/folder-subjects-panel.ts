// The share drawn from one subject's side, as an editable list.
//
// The folder-first panel asks "who may see this folder" and answers it one folder at a
// time. This one asks the reverse, which is the question an administrator actually
// arrives with: somebody joined a department, or left one, and every folder they may now
// reach has to be decided in one sitting.
//
// Every row says two different things on purpose. The chip is what the Gateway answers
// for this subject today, which may come from an ancestor; the three buttons are what is
// written on this exact folder for this exact subject, and none of them is pressed when
// nothing is. Collapsing those into one control would make it impossible to tell a rule
// from its consequence, and an operator would remove an inherited grant by pressing the
// button that already looked selected.
//
// No state lives here. The page owns the target, the expanded set, the drafts and the
// per-row errors; this file turns them into markup and reports back through callbacks.
import { html, nothing, type TemplateResult } from "lit";
import type {
  FolderRulePermission,
  FolderRuleSubjectKind,
  FoldersSubjectsListResult,
  FoldersSubjectTreeResult,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import { t } from "../../i18n/index.ts";
import type { FolderRuleTab } from "./folder-rule-panel.ts";
import { folderPermissionLabel } from "./folders-tree.ts";

/** Who the whole screen is about once one has been picked. */
export type FolderSubjectTarget = {
  kind: FolderRuleSubjectKind;
  id: string;
  label: string;
  hint?: string;
};

/** One row's pending change. `permission: null` deletes the rule pinned to that folder. */
export type FolderSubjectRowDraft = {
  permission: FolderRulePermission | null;
  inherit: boolean;
  applyToDescendants: boolean;
};

/** Path to that path's listing. The root's own path is the empty string. */
type FolderSubjectLevels = ReadonlyMap<string, FoldersSubjectTreeResult>;

const FOLDER_PERMISSIONS: readonly FolderRulePermission[] = ["hidden", "read", "write"];

/**
 * How deep this will draw before it stops.
 *
 * Same belt the folder-first tree wears: a mounted share can be a symlink loop, and the
 * visited set below refuses a repeated path only when it repeats exactly.
 */
const MAX_TREE_DEPTH = 32;

/** The roles, departments or people one tab offers, narrowed by the search box. */
function folderSubjectTargets(params: {
  tab: FolderRuleTab;
  subjects: FoldersSubjectsListResult | undefined;
  userQuery: string;
}): FolderSubjectTarget[] {
  const subjects = params.subjects;
  if (!subjects) {
    return [];
  }
  if (params.tab === "department") {
    return subjects.departments.map((department) => ({
      kind: "department" as const,
      id: department.slug,
      label: department.displayName ?? department.slug,
      hint: department.slug,
    }));
  }
  if (params.tab === "role") {
    return subjects.roles.map((role) => ({
      kind: "role" as const,
      id: role,
      label: ixAuthRoleLabel(role),
    }));
  }
  const query = params.userQuery.trim().toLowerCase();
  const targets: FolderSubjectTarget[] = [];
  for (const user of subjects.users) {
    const label = user.displayName ?? user.email ?? user.profileId;
    if (
      query.length > 0 &&
      !label.toLowerCase().includes(query) &&
      !(user.email ?? "").toLowerCase().includes(query)
    ) {
      continue;
    }
    const target: FolderSubjectTarget = { kind: "user", id: user.profileId, label };
    // The address is a second line only when it is not already the name on the first.
    if (user.email !== undefined && user.email !== label) {
      target.hint = user.email;
    }
    targets.push(target);
  }
  return targets;
}

function renderTabs(params: {
  tab: FolderRuleTab;
  busy: boolean;
  onTab: (tab: FolderRuleTab) => void;
}): TemplateResult {
  const tabs: readonly (readonly [FolderRuleTab, string])[] = [
    ["department", "ixAuth.folders.tabDepartments"],
    ["role", "ixAuth.folders.tabRoles"],
    ["user", "ixAuth.folders.tabPeople"],
  ];
  return html`
    <div class="folders-tabs" role="tablist">
      ${tabs.map(([tab, key]) => {
        const active = tab === params.tab;
        return html`<button
          type="button"
          role="tab"
          class=${active ? "folders-tab folders-tab--active" : "folders-tab"}
          aria-selected=${active ? "true" : "false"}
          ?disabled=${params.busy}
          @click=${() => params.onTab(tab)}
        >
          ${t(key)}
        </button>`;
      })}
    </div>
  `;
}

function renderTargetList(params: {
  targets: readonly FolderSubjectTarget[];
  target: FolderSubjectTarget | undefined;
  busy: boolean;
  onTarget: (target: FolderSubjectTarget) => void;
}): TemplateResult {
  if (params.targets.length === 0) {
    return html`<p class="muted">${t("ixAuth.folders.subjectsEmpty")}</p>`;
  }
  return html`
    <ul class="folders-bysubject__targets">
      ${params.targets.map((candidate) => {
        const active = params.target?.kind === candidate.kind && params.target.id === candidate.id;
        return html`<li>
          <button
            type="button"
            class=${
              active
                ? "folders-bysubject__target folders-bysubject__target--active"
                : "folders-bysubject__target"
            }
            aria-pressed=${active ? "true" : "false"}
            ?disabled=${params.busy}
            @click=${() => params.onTarget(candidate)}
          >
            <span class="folders-bysubject__target-name">${candidate.label}</span>
            ${
              candidate.hint
                ? html`<span class="folders-bysubject__target-hint">${candidate.hint}</span>`
                : nothing
            }
          </button>
        </li>`;
      })}
    </ul>
  `;
}

/** The sentence under one row: where today's verdict comes from, or why a save failed. */
function rowNote(params: {
  effective: FolderRulePermission;
  inheritedFrom: string | undefined;
  hasOwnRule: boolean;
  error: string | undefined;
}): string {
  if (params.error !== undefined) {
    return t("ixAuth.folders.rowError", { message: params.error });
  }
  if (params.inheritedFrom !== undefined) {
    return t("ixAuth.folders.rowInherited", {
      path: params.inheritedFrom.length > 0 ? params.inheritedFrom : t("ixAuth.folders.rootLabel"),
    });
  }
  if (params.hasOwnRule) {
    return t("ixAuth.folders.rowOwn");
  }
  return params.effective === "hidden" ? t("ixAuth.folders.rowDefault") : "";
}

function renderRowControls(params: {
  path: string;
  current: FolderRulePermission | null;
  inherit: boolean;
  removable: boolean;
  busy: boolean;
  onPermission: (path: string, permission: FolderRulePermission) => void;
  onInherit: (path: string, value: boolean) => void;
  onRemove: (path: string) => void;
}): TemplateResult {
  return html`
    <div class="folders-bysubject__controls">
      <div class="folders-perm" role="group" aria-label=${t("ixAuth.folders.permissionLabel")}>
        ${FOLDER_PERMISSIONS.map((permission) => {
          const active = permission === params.current;
          return html`<button
            type="button"
            class=${
              active ? "folders-perm__button folders-perm__button--active" : "folders-perm__button"
            }
            aria-pressed=${active ? "true" : "false"}
            ?disabled=${params.busy}
            @click=${() => params.onPermission(params.path, permission)}
          >
            ${folderPermissionLabel(permission)}
          </button>`;
        })}
      </div>
      <label class="folders-subject__inherit">
        <input
          type="checkbox"
          .checked=${params.inherit}
          ?disabled=${params.busy || params.current === null}
          @change=${(event: Event) =>
            // SAFETY: the listener is bound to this checkbox element.
            params.onInherit(params.path, (event.target as HTMLInputElement).checked)}
        />
        <span>${t("ixAuth.folders.rowBelow")}</span>
      </label>
      ${
        params.removable
          ? html`<button
              type="button"
              class="btn"
              ?disabled=${params.busy}
              @click=${() => params.onRemove(params.path)}
            >
              ${t("ixAuth.folders.rowRemove")}
            </button>`
          : nothing
      }
    </div>
  `;
}

/** The dirty bar: what is unsaved, and the two ways out of it. */
function renderDirtyBar(params: {
  count: number;
  busy: boolean;
  onSave: () => void;
  onRevert: () => void;
}): TemplateResult | typeof nothing {
  if (params.count === 0) {
    return nothing;
  }
  return html`
    <div class="folders-bysubject__dirty" role="status">
      <span>${t("ixAuth.folders.dirtyCount", { count: String(params.count) })}</span>
      <button type="button" class="btn" ?disabled=${params.busy} @click=${params.onSave}>
        ${t("ixAuth.folders.dirtySave")}
      </button>
      <button type="button" class="btn" ?disabled=${params.busy} @click=${params.onRevert}>
        ${t("ixAuth.folders.dirtyRevert")}
      </button>
    </div>
  `;
}

export type FolderSubjectTreeParams = {
  levels: FolderSubjectLevels;
  expanded: ReadonlySet<string>;
  drafts: ReadonlyMap<string, FolderSubjectRowDraft>;
  rowErrors: ReadonlyMap<string, string>;
  loading: boolean;
  busy: boolean;
  onToggle: (path: string) => void;
  onPermission: (path: string, permission: FolderRulePermission) => void;
  onInherit: (path: string, value: boolean) => void;
  onRemove: (path: string) => void;
};

function renderFolderRows(params: FolderSubjectTreeParams): TemplateResult {
  const root = params.levels.get("");
  if (!root) {
    return html`<p class="muted">
      ${params.loading ? t("ixAuth.folders.loading") : t("ixAuth.folders.treeEmpty")}
    </p>`;
  }
  if (!root.available) {
    return html`<p class="muted">${t("ixAuth.folders.unavailable")}</p>`;
  }

  const renderLevel = (path: string, depth: number, visited: ReadonlySet<string>): unknown => {
    if (depth > MAX_TREE_DEPTH) {
      return nothing;
    }
    const level = params.levels.get(path);
    if (!level) {
      return nothing;
    }
    if (level.entries.length === 0) {
      return html`<p class="folders-tree__empty muted">${t("ixAuth.folders.folderEmpty")}</p>`;
    }
    return html`
      <ul class="folders-bysubject__list">
        ${level.entries.map((entry) => {
          const draft = params.drafts.get(entry.path);
          const own = entry.ownRule;
          const current = draft ? draft.permission : (own?.permission ?? null);
          const inherit = draft ? draft.inherit : (own?.inherit ?? true);
          const expanded = params.expanded.has(entry.path);
          const alreadyOpen = visited.has(entry.path);
          // The snapshot knows whether a folder holds subfolders; a live listing does
          // not, and an absent answer has to draw the expander or a branch is unreachable.
          const expandable = !alreadyOpen && entry.hasChildren !== false;
          const note = rowNote({
            effective: entry.effective,
            inheritedFrom: entry.inheritedFrom,
            hasOwnRule: own !== undefined,
            error: params.rowErrors.get(entry.path),
          });
          return html`<li class="folders-bysubject__node">
            <div
              class=${
                draft
                  ? "folders-bysubject__row folders-bysubject__row--changed"
                  : "folders-bysubject__row"
              }
            >
              ${
                expandable
                  ? html`<button
                      type="button"
                      class="folders-tree__toggle"
                      aria-expanded=${expanded ? "true" : "false"}
                      aria-label=${
                        expanded ? t("ixAuth.folders.collapse") : t("ixAuth.folders.expand")
                      }
                      ?disabled=${params.busy}
                      @click=${() => params.onToggle(entry.path)}
                    >
                      ${expanded ? "▾" : "▸"}
                    </button>`
                  : html`<span
                      class="folders-tree__toggle folders-tree__toggle--leaf"
                      aria-hidden="true"
                      >·</span
                    >`
              }
              <span class="folders-bysubject__name" title=${entry.absolutePath}>${entry.name}</span>
              <span class="folders-tree__chip">${folderPermissionLabel(entry.effective)}</span>
              ${
                draft
                  ? html`<span class="folders-bysubject__changed"
                      >${t("ixAuth.folders.rowChanged")}</span
                    >`
                  : nothing
              }
              ${renderRowControls({
                path: entry.path,
                current,
                inherit,
                removable: own !== undefined || current !== null,
                busy: params.busy,
                onPermission: params.onPermission,
                onInherit: params.onInherit,
                onRemove: params.onRemove,
              })}
            </div>
            ${note.length > 0 ? html`<p class="folders-bysubject__note">${note}</p>` : nothing}
            ${
              expanded && expandable
                ? renderLevel(entry.path, depth + 1, new Set([...visited, entry.path]))
                : nothing
            }
          </li>`;
        })}
      </ul>
    `;
  };

  return html`<div class="folders-bysubject__tree">${renderLevel("", 0, new Set([""]))}</div>`;
}

/** The whole subject-first editor: pick a subject on the left, rule its folders on the right. */
export function renderFolderSubjectsPanel(
  params: FolderSubjectTreeParams & {
    subjects: FoldersSubjectsListResult | undefined;
    tab: FolderRuleTab;
    userQuery: string;
    target: FolderSubjectTarget | undefined;
    superAdminTarget: boolean;
    onTab: (tab: FolderRuleTab) => void;
    onUserQuery: (value: string) => void;
    onTarget: (target: FolderSubjectTarget) => void;
    onSave: () => void;
    onRevert: () => void;
  },
): TemplateResult {
  const targets = folderSubjectTargets({
    tab: params.tab,
    subjects: params.subjects,
    userQuery: params.userQuery,
  });
  return html`
    <div class="folders-bysubject">
      <div class="folders-bysubject__picker">
        <h3 class="folders-layout__heading">${t("ixAuth.folders.bySubjectPick")}</h3>
        ${renderTabs({ tab: params.tab, busy: params.busy, onTab: params.onTab })}
        ${
          params.tab === "user"
            ? html`<label class="folders-search">
                <span class="folders-search__label">${t("ixAuth.folders.userSearchLabel")}</span>
                <input
                  class="settings-input"
                  type="search"
                  .value=${params.userQuery}
                  placeholder=${t("ixAuth.folders.userSearchPlaceholder")}
                  ?disabled=${params.busy}
                  @input=${(event: Event) =>
                    // SAFETY: the listener is bound to this input element.
                    params.onUserQuery((event.target as HTMLInputElement).value)}
                />
              </label>`
            : nothing
        }
        ${renderTargetList({
          targets,
          target: params.target,
          busy: params.busy,
          onTarget: params.onTarget,
        })}
        <p class="folders-preview__hint">${t("ixAuth.folders.bySubjectPickHint")}</p>
      </div>
      <div class="folders-bysubject__folders">
        ${
          params.target
            ? html`
                <h3 class="folders-layout__heading">
                  ${t("ixAuth.folders.bySubjectFolders", { name: params.target.label })}
                </h3>
                <p class="folders-preview__hint">${t("ixAuth.folders.bySubjectLegend")}</p>
                ${
                  params.superAdminTarget
                    ? html`<p class="folders-panel__warning">
                        ${t("ixAuth.folders.bySubjectSuperadmin")}
                      </p>`
                    : nothing
                }
                ${renderDirtyBar({
                  count: params.drafts.size,
                  busy: params.busy,
                  onSave: params.onSave,
                  onRevert: params.onRevert,
                })}
                ${renderFolderRows(params)}
              `
            : html`<p class="muted">${t("ixAuth.folders.bySubjectEmpty")}</p>`
        }
      </div>
    </div>
  `;
}
