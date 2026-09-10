// The rules pinned to one folder, and what they add up to.
//
// Three tabs because a rule names one of three kinds of subject, and the three are not
// browsed the same way. Departments and roles are short, closed lists, so both are drawn
// whole. People are not: a company has more accounts than a screen has rows, so that tab
// starts empty and fills from a search, plus whoever already holds a rule here so an
// existing grant is never invisible.
//
// Every row says twice what it means: the three buttons are what would be written, and
// the sentence under them is what the Gateway currently answers, naming the folder the
// verdict came from. A screen that shows only the first is a screen where inheritance is
// a surprise.
//
// No state lives here. The page owns the drafts, the tab, the search text and the
// preview; this file turns them into markup and reports back through callbacks.
import { html, nothing, type TemplateResult } from "lit";
import type {
  FolderRulePermission,
  FolderRuleSubjectKind,
  FoldersRulesListResult,
  FoldersSubjectsListResult,
  FolderSubjectUser,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import { t } from "../../i18n/index.ts";
import { folderPermissionLabel } from "./folders-tree.ts";

export type FolderRuleTab = "department" | "role" | "user";

/** What one row would write if its save button were pressed. */
export type FolderRuleDraft = {
  permission: FolderRulePermission;
  inherit: boolean;
};

/** Who a rule may name, resolved into one row's worth of words. */
type FolderSubjectRow = {
  kind: FolderRuleSubjectKind;
  id: string;
  label: string;
  hint?: string;
};

const FOLDER_PERMISSIONS: readonly FolderRulePermission[] = ["hidden", "read", "write"];

const DEFAULT_DRAFT: FolderRuleDraft = { permission: "hidden", inherit: true };

/** One key for one subject, shared by the drafts map and the preview selector. */
export function folderSubjectKey(kind: FolderRuleSubjectKind, id: string): string {
  return `${kind}:${id}`;
}

/** The reverse, for a selector whose value is a key. Undefined for the administrator view. */
function parseFolderSubjectKey(
  value: string,
): { kind: FolderRuleSubjectKind; id: string } | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (id.length === 0 || (kind !== "role" && kind !== "department" && kind !== "user")) {
    return undefined;
  }
  return { kind, id };
}

/** The account rows worth drawing on the people tab: search hits, plus anyone already ruled. */
function matchFolderUsers(params: {
  users: readonly FolderSubjectUser[];
  query: string;
  ruledIds: readonly string[];
}): FolderSubjectUser[] {
  const query = params.query.trim().toLowerCase();
  const ruled = new Set(params.ruledIds);
  return params.users.filter((user) => {
    if (ruled.has(user.profileId)) {
      return true;
    }
    if (query.length === 0) {
      return false;
    }
    return (
      (user.email ?? "").toLowerCase().includes(query) ||
      (user.displayName ?? "").toLowerCase().includes(query)
    );
  });
}

/** The sentence under one row: what the Gateway answers today, and where it comes from. */
function folderEffectiveSentence(params: {
  rules: FoldersRulesListResult | undefined;
  kind: FolderRuleSubjectKind;
  id: string;
}): string {
  const match = params.rules?.effective.find(
    (entry) => entry.subjectKind === params.kind && entry.subjectId === params.id,
  );
  if (!match) {
    return t("ixAuth.folders.effectiveNone");
  }
  const permission = folderPermissionLabel(match.permission);
  if (!match.inherited) {
    return t("ixAuth.folders.effectiveHere", { permission });
  }
  return t("ixAuth.folders.effectiveInherited", {
    permission,
    path: match.sourcePath.length > 0 ? match.sourcePath : t("ixAuth.folders.rootLabel"),
  });
}

function renderPermissionChoice(params: {
  value: FolderRulePermission;
  disabled: boolean;
  onChoose: (permission: FolderRulePermission) => void;
}): TemplateResult {
  return html`
    <div class="folders-perm" role="group" aria-label=${t("ixAuth.folders.permissionLabel")}>
      ${FOLDER_PERMISSIONS.map((permission) => {
        const active = permission === params.value;
        return html`<button
          type="button"
          class=${active ? "folders-perm__button folders-perm__button--active" : "folders-perm__button"}
          aria-pressed=${active ? "true" : "false"}
          ?disabled=${params.disabled}
          @click=${() => params.onChoose(permission)}
        >
          ${folderPermissionLabel(permission)}
        </button>`;
      })}
    </div>
  `;
}

function renderSubjectRow(params: {
  subject: FolderSubjectRow;
  draft: FolderRuleDraft;
  hasOwnRule: boolean;
  effective: string;
  manage: boolean;
  busy: boolean;
  onPermission: (kind: FolderRuleSubjectKind, id: string, value: FolderRulePermission) => void;
  onInherit: (kind: FolderRuleSubjectKind, id: string, value: boolean) => void;
  onSave: (kind: FolderRuleSubjectKind, id: string) => void;
  onClear: (kind: FolderRuleSubjectKind, id: string) => void;
}): TemplateResult {
  const { kind, id } = params.subject;
  const disabled = params.busy || !params.manage;
  return html`
    <li class="folders-subject">
      <div class="folders-subject__identity">
        <span class="folders-subject__name">${params.subject.label}</span>
        ${
          params.subject.hint
            ? html`<span class="folders-subject__hint">${params.subject.hint}</span>`
            : nothing
        }
      </div>
      <div class="folders-subject__controls">
        ${renderPermissionChoice({
          value: params.draft.permission,
          disabled,
          onChoose: (permission) => params.onPermission(kind, id, permission),
        })}
        <label class="folders-subject__inherit">
          <input
            type="checkbox"
            .checked=${params.draft.inherit}
            ?disabled=${disabled}
            @change=${(event: Event) =>
              // SAFETY: the listener is bound to this checkbox element.
              params.onInherit(kind, id, (event.target as HTMLInputElement).checked)}
          />
          <span>${t("ixAuth.folders.inheritLabel")}</span>
        </label>
        <button
          type="button"
          class="btn"
          ?disabled=${disabled}
          @click=${() => params.onSave(kind, id)}
        >
          ${t("ixAuth.folders.save")}
        </button>
        ${
          params.hasOwnRule
            ? html`<button
                type="button"
                class="btn"
                ?disabled=${disabled}
                @click=${() => params.onClear(kind, id)}
              >
                ${t("ixAuth.folders.clear")}
              </button>`
            : nothing
        }
      </div>
      <p class="folders-subject__effective">${params.effective}</p>
    </li>
  `;
}

function renderTabs(params: {
  tab: FolderRuleTab;
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
          @click=${() => params.onTab(tab)}
        >
          ${t(key)}
        </button>`;
      })}
    </div>
  `;
}

function renderPreview(params: {
  subjects: FoldersSubjectsListResult | undefined;
  preview: { kind: FolderRuleSubjectKind; id: string } | undefined;
  busy: boolean;
  onPreview: (preview: { kind: FolderRuleSubjectKind; id: string } | undefined) => void;
}): TemplateResult {
  const subjects = params.subjects;
  const value = params.preview ? folderSubjectKey(params.preview.kind, params.preview.id) : "";
  return html`
    <div class="folders-preview">
      <label class="folders-preview__field">
        <span class="folders-preview__label">${t("ixAuth.folders.previewLabel")}</span>
        <select
          class="settings-input"
          .value=${value}
          ?disabled=${params.busy}
          @change=${(event: Event) =>
            params.onPreview(
              // SAFETY: the listener is bound to this select element.
              parseFolderSubjectKey((event.target as HTMLSelectElement).value),
            )}
        >
          <option value="" ?selected=${value === ""}>${t("ixAuth.folders.previewAdmin")}</option>
          ${
            subjects
              ? html`
                  <optgroup label=${t("ixAuth.folders.tabDepartments")}>
                    ${subjects.departments.map((department) => {
                      const key = folderSubjectKey("department", department.slug);
                      return html`<option value=${key} ?selected=${key === value}>
                        ${department.displayName ?? department.slug}
                      </option>`;
                    })}
                  </optgroup>
                  <optgroup label=${t("ixAuth.folders.tabRoles")}>
                    ${subjects.roles.map((role) => {
                      const key = folderSubjectKey("role", role);
                      return html`<option value=${key} ?selected=${key === value}>
                        ${ixAuthRoleLabel(role)}
                      </option>`;
                    })}
                  </optgroup>
                  <optgroup label=${t("ixAuth.folders.tabPeople")}>
                    ${subjects.users.map((user) => {
                      const key = folderSubjectKey("user", user.profileId);
                      return html`<option value=${key} ?selected=${key === value}>
                        ${user.displayName ?? user.email ?? user.profileId}
                      </option>`;
                    })}
                  </optgroup>
                `
              : nothing
          }
        </select>
      </label>
      <p class="folders-preview__hint">${t("ixAuth.folders.previewHint")}</p>
    </div>
  `;
}

function subjectRowsForTab(params: {
  tab: FolderRuleTab;
  subjects: FoldersSubjectsListResult | undefined;
  rules: FoldersRulesListResult | undefined;
  userQuery: string;
}): FolderSubjectRow[] {
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
  const ruledIds = (params.rules?.rules ?? [])
    .filter((rule) => rule.subjectKind === "user")
    .map((rule) => rule.subjectId);
  const rows: FolderSubjectRow[] = [];
  for (const user of matchFolderUsers({
    users: subjects.users,
    query: params.userQuery,
    ruledIds,
  })) {
    const label = user.displayName ?? user.email ?? user.profileId;
    const row: FolderSubjectRow = { kind: "user", id: user.profileId, label };
    // The address is a second line only when it is not already the name on the first.
    if (user.email !== undefined && user.email !== label) {
      row.hint = user.email;
    }
    rows.push(row);
  }
  return rows;
}

function renderSearch(params: {
  query: string;
  busy: boolean;
  onQuery: (value: string) => void;
}): TemplateResult {
  return html`
    <label class="folders-search">
      <span class="folders-search__label">${t("ixAuth.folders.userSearchLabel")}</span>
      <input
        class="settings-input"
        type="search"
        .value=${params.query}
        placeholder=${t("ixAuth.folders.userSearchPlaceholder")}
        ?disabled=${params.busy}
        @input=${(event: Event) =>
          // SAFETY: the listener is bound to this input element.
          params.onQuery((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

/** The editor for the selected folder. */
export function renderFolderRulePanel(params: {
  root: string;
  path: string;
  manage: boolean;
  rules: FoldersRulesListResult | undefined;
  subjects: FoldersSubjectsListResult | undefined;
  tab: FolderRuleTab;
  drafts: ReadonlyMap<string, FolderRuleDraft>;
  userQuery: string;
  applyToDescendants: boolean;
  preview: { kind: FolderRuleSubjectKind; id: string } | undefined;
  busy: boolean;
  notice?: string;
  onTab: (tab: FolderRuleTab) => void;
  onPermission: (kind: FolderRuleSubjectKind, id: string, value: FolderRulePermission) => void;
  onInherit: (kind: FolderRuleSubjectKind, id: string, value: boolean) => void;
  onSave: (kind: FolderRuleSubjectKind, id: string) => void;
  onClear: (kind: FolderRuleSubjectKind, id: string) => void;
  onUserQuery: (value: string) => void;
  onApplyToDescendants: (value: boolean) => void;
  onPreview: (preview: { kind: FolderRuleSubjectKind; id: string } | undefined) => void;
}): TemplateResult {
  const absolutePath = params.path.length > 0 ? `${params.root}/${params.path}` : params.root;
  const rows = subjectRowsForTab({
    tab: params.tab,
    subjects: params.subjects,
    rules: params.rules,
    userQuery: params.userQuery,
  });
  const ownRules = params.rules?.rules ?? [];
  return html`
    <div class="folders-panel">
      <div class="folders-panel__head">
        <p class="folders-panel__path">${absolutePath}</p>
        ${
          params.rules && !params.rules.exists
            ? html`<p class="folders-panel__warning">${t("ixAuth.folders.missingPath")}</p>`
            : nothing
        }
        ${
          params.manage
            ? nothing
            : html`<p class="folders-panel__warning">${t("ixAuth.folders.readOnly")}</p>`
        }
        ${params.notice ? html`<p class="folders-notice" role="status">${params.notice}</p>` : nothing}
      </div>
      ${renderPreview({
        subjects: params.subjects,
        preview: params.preview,
        busy: params.busy,
        onPreview: params.onPreview,
      })}
      ${renderTabs({ tab: params.tab, onTab: params.onTab })}
      ${
        params.tab === "user"
          ? renderSearch({
              query: params.userQuery,
              busy: params.busy,
              onQuery: params.onUserQuery,
            })
          : nothing
      }
      ${
        rows.length === 0
          ? html`<p class="muted">
              ${t(
                params.tab === "user"
                  ? "ixAuth.folders.userSearchEmpty"
                  : "ixAuth.folders.subjectsEmpty",
              )}
            </p>`
          : html`<ul class="folders-subjects">
              ${rows.map((subject) => {
                const key = folderSubjectKey(subject.kind, subject.id);
                const own = ownRules.find(
                  (rule) => rule.subjectKind === subject.kind && rule.subjectId === subject.id,
                );
                const fallback: FolderRuleDraft = own
                  ? { permission: own.permission, inherit: own.inherit }
                  : DEFAULT_DRAFT;
                return renderSubjectRow({
                  subject,
                  draft: params.drafts.get(key) ?? fallback,
                  hasOwnRule: own !== undefined,
                  effective: folderEffectiveSentence({
                    rules: params.rules,
                    kind: subject.kind,
                    id: subject.id,
                  }),
                  manage: params.manage,
                  busy: params.busy,
                  onPermission: params.onPermission,
                  onInherit: params.onInherit,
                  onSave: params.onSave,
                  onClear: params.onClear,
                });
              })}
            </ul>`
      }
      <label class="folders-panel__descendants">
        <input
          type="checkbox"
          .checked=${params.applyToDescendants}
          ?disabled=${params.busy || !params.manage}
          @change=${(event: Event) =>
            // SAFETY: the listener is bound to this checkbox element.
            params.onApplyToDescendants((event.target as HTMLInputElement).checked)}
        />
        <span>
          <span class="folders-panel__descendants-label"
            >${t("ixAuth.folders.applyToDescendants")}</span
          >
          <span class="folders-panel__descendants-hint"
            >${t("ixAuth.folders.applyToDescendantsHint")}</span
          >
        </span>
      </label>
    </div>
  `;
}
