/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FoldersSubjectsListResult,
  FoldersSubjectTreeResult,
  FolderSubjectTreeEntry,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import type { FolderRuleTab } from "./folder-rule-panel.ts";
import {
  renderFolderSubjectsPanel,
  type FolderSubjectRowDraft,
  type FolderSubjectTarget,
} from "./folder-subjects-panel.ts";

// The folder words live in the lazily loaded identity catalog, exactly as the page loads it.
registerIxAuthEnglish();

function draw(template: unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  // SAFETY: every caller passes a Lit template produced by the module under test.
  render(template as Parameters<typeof render>[0], host);
  return host;
}

function subjects(): FoldersSubjectsListResult {
  return {
    roles: ["superadmin", "member"],
    titles: [{ slug: "team-lead", displayName: "Team lead" }],
    departments: [
      { slug: "rnd", displayName: "Research" },
      { slug: "sales", displayName: "Sales" },
    ],
    users: [{ profileId: "u-1", email: "kim@example.test", displayName: "Kim" }],
  };
}

function entry(overrides: Partial<FolderSubjectTreeEntry> = {}): FolderSubjectTreeEntry {
  return {
    name: "reports",
    path: "reports",
    absolutePath: "/mnt/share/reports",
    effective: "hidden",
    ownRuleCount: 0,
    hasChildren: false,
    ...overrides,
  };
}

function level(entries: FolderSubjectTreeEntry[]): FoldersSubjectTreeResult {
  return {
    root: "/mnt/share",
    available: true,
    path: "",
    entries,
    source: "index",
  };
}

const TARGET: FolderSubjectTarget = { kind: "department", id: "rnd", label: "Research" };

type PanelOverrides = {
  tab?: FolderRuleTab;
  target?: FolderSubjectTarget | undefined;
  entries?: FolderSubjectTreeEntry[];
  drafts?: ReadonlyMap<string, FolderSubjectRowDraft>;
  rowErrors?: ReadonlyMap<string, string>;
  superAdminTarget?: boolean;
  onTarget?: (target: FolderSubjectTarget) => void;
  onPermission?: (path: string, permission: string) => void;
  onRemove?: (path: string) => void;
  onSave?: () => void;
  onRevert?: () => void;
};

function panel(overrides: PanelOverrides = {}) {
  const target = "target" in overrides ? overrides.target : TARGET;
  return renderFolderSubjectsPanel({
    subjects: subjects(),
    tab: overrides.tab ?? "department",
    userQuery: "",
    target,
    superAdminTarget: overrides.superAdminTarget ?? false,
    levels: target ? new Map([["", level(overrides.entries ?? [entry()])]]) : new Map(),
    expanded: new Set(),
    drafts: overrides.drafts ?? new Map(),
    rowErrors: overrides.rowErrors ?? new Map(),
    loading: false,
    busy: false,
    onTab: () => undefined,
    onUserQuery: () => undefined,
    onTarget: overrides.onTarget ?? (() => undefined),
    onToggle: () => undefined,
    onPermission: overrides.onPermission ?? (() => undefined),
    onInherit: () => undefined,
    onRemove: overrides.onRemove ?? (() => undefined),
    onSave: overrides.onSave ?? (() => undefined),
    onRevert: overrides.onRevert ?? (() => undefined),
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("folder subjects panel", () => {
  it("loads nothing until a subject is picked", () => {
    const host = draw(panel({ target: undefined }));
    expect(host.textContent).toContain(t("ixAuth.folders.bySubjectEmpty"));
    expect(host.querySelectorAll(".folders-bysubject__row")).toHaveLength(0);
  });

  it("offers every department and reports the one that was clicked", () => {
    const onTarget = vi.fn();
    const host = draw(panel({ onTarget }));
    const names = host.querySelectorAll(".folders-bysubject__target-name");
    expect(Array.from(names, (node) => node.textContent?.trim())).toEqual(["Research", "Sales"]);
    host.querySelectorAll<HTMLButtonElement>(".folders-bysubject__target")[1]?.click();
    expect(onTarget).toHaveBeenCalledWith(expect.objectContaining({ id: "sales" }));
  });

  it("offers a job-title tab beside the department one, and its titles", () => {
    const tabs = draw(panel()).querySelectorAll<HTMLButtonElement>(".folders-tab");
    expect(Array.from(tabs, (node) => node.textContent?.trim())).toEqual([
      t("ixAuth.folders.tabDepartments"),
      t("ixAuth.folders.tabTitles"),
      t("ixAuth.folders.tabRoles"),
      t("ixAuth.folders.tabPeople"),
    ]);
    const onTarget = vi.fn();
    const host = draw(panel({ tab: "title", onTarget }));
    const names = host.querySelectorAll(".folders-bysubject__target-name");
    expect(Array.from(names, (node) => node.textContent?.trim())).toEqual(["Team lead"]);
    host.querySelectorAll<HTMLButtonElement>(".folders-bysubject__target")[0]?.click();
    expect(onTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "title", id: "team-lead" }),
    );
  });

  it("draws a hidden folder and says no rule reaches it", () => {
    const host = draw(panel());
    expect(host.querySelectorAll(".folders-bysubject__row")).toHaveLength(1);
    expect(host.querySelector(".folders-tree__chip")?.textContent?.trim()).toBe(
      t("ixAuth.folders.permission.hidden"),
    );
    expect(host.querySelector(".folders-bysubject__note")?.textContent).toContain(
      t("ixAuth.folders.rowDefault"),
    );
    // Nothing is written on this folder, so no permission button is pressed.
    expect(host.querySelectorAll(".folders-perm__button--active")).toHaveLength(0);
  });

  it("names the ancestor an inherited verdict came from", () => {
    const host = draw(
      panel({
        entries: [entry({ effective: "read", inheritedFrom: "reports/2026" })],
      }),
    );
    const note = host.querySelector(".folders-bysubject__note")?.textContent ?? "";
    expect(note).toContain("reports/2026");
    expect(note).not.toContain(t("ixAuth.folders.rowDefault"));
  });

  it("shows a stored rule as the row's pressed button and offers to remove it", () => {
    const onRemove = vi.fn();
    const host = draw(
      panel({
        entries: [
          entry({
            effective: "write",
            ownRule: { permission: "write", inherit: true },
            ownRuleCount: 1,
          }),
        ],
        onRemove,
      }),
    );
    expect(host.querySelector(".folders-perm__button--active")?.textContent?.trim()).toBe(
      t("ixAuth.folders.permission.write"),
    );
    expect(host.querySelector(".folders-bysubject__note")?.textContent).toContain(
      t("ixAuth.folders.rowOwn"),
    );
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    buttons.find((node) => node.textContent?.trim() === t("ixAuth.folders.rowRemove"))?.click();
    expect(onRemove).toHaveBeenCalledWith("reports");
  });

  it("reports the permission a row was set to", () => {
    const onPermission = vi.fn();
    const host = draw(panel({ onPermission }));
    host.querySelectorAll<HTMLButtonElement>(".folders-perm__button")[1]?.click();
    expect(onPermission).toHaveBeenCalledWith("reports", "read");
  });

  it("counts unsaved rows and offers both ways out of them", () => {
    const onSave = vi.fn();
    const onRevert = vi.fn();
    const drafts = new Map<string, FolderSubjectRowDraft>([
      ["reports", { permission: "read", inherit: true, applyToDescendants: false }],
      ["archive", { permission: null, inherit: true, applyToDescendants: false }],
    ]);
    const host = draw(panel({ drafts, onSave, onRevert }));
    const bar = host.querySelector(".folders-bysubject__dirty");
    expect(bar?.textContent).toContain(t("ixAuth.folders.dirtyCount", { count: "2" }));
    expect(host.querySelectorAll(".folders-bysubject__row--changed")).toHaveLength(1);
    const buttons = Array.from(bar?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    buttons.find((node) => node.textContent?.trim() === t("ixAuth.folders.dirtySave"))?.click();
    buttons.find((node) => node.textContent?.trim() === t("ixAuth.folders.dirtyRevert"))?.click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onRevert).toHaveBeenCalledOnce();
  });

  it("marks the row a save was refused on with the server's reason", () => {
    const host = draw(
      panel({ rowErrors: new Map([["reports", "path is outside the shared folder root"]]) }),
    );
    expect(host.querySelector(".folders-bysubject__note")?.textContent).toContain(
      "path is outside the shared folder root",
    );
  });

  it("warns that rules do not change what the system administrator reaches", () => {
    const host = draw(panel({ superAdminTarget: true }));
    expect(host.textContent).toContain(t("ixAuth.folders.bySubjectSuperadmin"));
  });

  it("hides the dirty bar when nothing is unsaved", () => {
    const host = draw(panel());
    expect(host.querySelector(".folders-bysubject__dirty")).toBeNull();
  });
});
