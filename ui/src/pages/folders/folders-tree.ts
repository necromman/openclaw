// The share, one level at a time.
//
// The real share holds tens of thousands of folders, so this never asks for more than the
// level a person opened: the page keeps a map of path to that path's listing, and this
// function draws whatever is already in it. A folder nobody expanded is a row and nothing
// more, which is the whole reason the screen stays usable on the delivered share.
//
// Nothing here decides anything. The permission on a row is the verdict the Gateway
// already reached, drawn faintly when it was inherited rather than set on that folder, so
// an operator can tell a rule from its consequence at a glance.
import { html, nothing, type TemplateResult } from "lit";
import type {
  FolderRulePermission,
  FoldersTreeListResult,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import { t } from "../../i18n/index.ts";

/** Path to the listing of that path's children. The root's own path is the empty string. */
export type FolderTreeLevels = ReadonlyMap<string, FoldersTreeListResult>;

/**
 * How deep this will draw before it stops.
 *
 * A mounted share can be a symlink loop, and the visited set below already refuses a path
 * twice; this is the second belt for a loop that never repeats a path exactly.
 */
const MAX_TREE_DEPTH = 32;

export function folderPermissionLabel(permission: FolderRulePermission): string {
  return t(`ixAuth.folders.permission.${permission}`);
}

function renderChip(entry: {
  permission: FolderRulePermission;
  inherited: boolean;
  sourcePath?: string;
}): TemplateResult {
  const label = folderPermissionLabel(entry.permission);
  const className = entry.inherited
    ? "folders-tree__chip folders-tree__chip--inherited"
    : "folders-tree__chip";
  const title = entry.inherited
    ? t("ixAuth.folders.chipInheritedTitle", {
        path: entry.sourcePath ?? t("ixAuth.folders.rootLabel"),
      })
    : t("ixAuth.folders.chipOwnTitle");
  return html`<span class=${className} title=${title}
    >${entry.inherited ? t("ixAuth.folders.chipInherited", { permission: label }) : label}</span
  >`;
}

function renderRow(params: {
  path: string;
  name: string;
  selected: boolean;
  expandable: boolean;
  expanded: boolean;
  chip: TemplateResult | typeof nothing;
  ownRuleCount: number;
  busy: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}): TemplateResult {
  return html`
    <div
      class=${params.selected ? "folders-tree__row folders-tree__row--selected" : "folders-tree__row"}
      aria-selected=${params.selected ? "true" : "false"}
    >
      ${
        params.expandable
          ? html`<button
              type="button"
              class="folders-tree__toggle"
              aria-expanded=${params.expanded ? "true" : "false"}
              aria-label=${
                params.expanded ? t("ixAuth.folders.collapse") : t("ixAuth.folders.expand")
              }
              ?disabled=${params.busy}
              @click=${() => params.onToggle(params.path)}
            >
              ${params.expanded ? "▾" : "▸"}
            </button>`
          : html`<span class="folders-tree__toggle folders-tree__toggle--leaf" aria-hidden="true"
              >·</span
            >`
      }
      <button
        type="button"
        class="folders-tree__name"
        ?disabled=${params.busy}
        @click=${() => params.onSelect(params.path)}
      >
        ${params.name}
      </button>
      ${
        params.ownRuleCount > 0
          ? html`<span
              class="folders-tree__count"
              title=${t("ixAuth.folders.ownRules", { count: String(params.ownRuleCount) })}
              >${params.ownRuleCount}</span
            >`
          : nothing
      }
      ${params.chip}
    </div>
  `;
}

/**
 * The tree, drawn from what has already been fetched.
 *
 * `visited` is threaded through the recursion rather than kept in module state so two
 * trees on one page never share it, and so a path that appears under two parents is
 * refused only within the branch that already holds it.
 */
export function renderFoldersTree(params: {
  levels: FolderTreeLevels;
  expanded: ReadonlySet<string>;
  selectedPath: string;
  loading: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}): TemplateResult {
  const rootLevel = params.levels.get("");
  if (!rootLevel) {
    return html`<p class="muted">
      ${params.loading ? t("ixAuth.folders.loading") : t("ixAuth.folders.treeEmpty")}
    </p>`;
  }
  if (!rootLevel.available) {
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
      <ul class="folders-tree__list">
        ${level.entries.map((entry) => {
          const expanded = params.expanded.has(entry.path);
          const alreadyOpen = visited.has(entry.path);
          return html`<li class="folders-tree__node">
            ${renderRow({
              path: entry.path,
              name: entry.name,
              selected: entry.path === params.selectedPath,
              expandable: !alreadyOpen,
              expanded,
              chip: renderChip(entry),
              ownRuleCount: entry.ownRuleCount,
              busy: params.busy,
              onSelect: params.onSelect,
              onToggle: params.onToggle,
            })}
            ${
              expanded && !alreadyOpen
                ? renderLevel(entry.path, depth + 1, new Set([...visited, entry.path]))
                : nothing
            }
          </li>`;
        })}
      </ul>
    `;
  };

  return html`
    <div class="folders-tree">
      ${renderRow({
        path: "",
        name: rootLevel.root,
        selected: params.selectedPath === "",
        expandable: false,
        expanded: true,
        chip: nothing,
        ownRuleCount: 0,
        busy: params.busy,
        onSelect: params.onSelect,
        onToggle: params.onToggle,
      })}
      ${renderLevel("", 0, new Set([""]))}
    </div>
  `;
}
