/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FolderAccessRule,
  FoldersRulesListResult,
  FoldersSubjectsListResult,
} from "../../../../packages/gateway-protocol/src/schema/folder-rules.js";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { renderFolderRulePanel, type FolderRuleTab } from "./folder-rule-panel.ts";

// The folder words live in the lazily loaded identity catalog, exactly as the page loads it.
registerIxAuthEnglish();

function draw(template: unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  // SAFETY: every caller passes a Lit template produced by the module under test.
  render(template as Parameters<typeof render>[0], host);
  return host;
}

function subjects(overrides: Partial<FoldersSubjectsListResult> = {}): FoldersSubjectsListResult {
  return {
    roles: ["superadmin", "admin", "executive", "moderator", "member"],
    departments: [{ slug: "rnd", displayName: "Research" }],
    users: [
      { profileId: "u-1", email: "kim@example.test", displayName: "Kim" },
      { profileId: "u-2", email: "lee@example.test", displayName: "Lee" },
    ],
    ...overrides,
  };
}

function rulesResult(overrides: Partial<FoldersRulesListResult> = {}): FoldersRulesListResult {
  return {
    root: "/mnt/share",
    path: "reports",
    exists: true,
    rules: [],
    inherited: [],
    effective: [],
    ...overrides,
  };
}

function rule(overrides: Partial<FolderAccessRule> = {}): FolderAccessRule {
  return {
    id: "rule-1",
    folderPath: "reports",
    subjectKind: "department",
    subjectId: "rnd",
    permission: "read",
    inherit: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

type PanelOverrides = {
  tab?: FolderRuleTab;
  rules?: FoldersRulesListResult | undefined;
  userQuery?: string;
  onPermission?: (kind: string, id: string, value: string) => void;
};

function panel(overrides: PanelOverrides = {}) {
  return renderFolderRulePanel({
    root: "/mnt/share",
    path: "reports",
    manage: true,
    rules: "rules" in overrides ? overrides.rules : rulesResult(),
    subjects: subjects(),
    tab: overrides.tab ?? "department",
    drafts: new Map(),
    userQuery: overrides.userQuery ?? "",
    applyToDescendants: false,
    preview: undefined,
    busy: false,
    onTab: () => undefined,
    onPermission: overrides.onPermission ?? (() => undefined),
    onInherit: () => undefined,
    onSave: () => undefined,
    onClear: () => undefined,
    onUserQuery: () => undefined,
    onApplyToDescendants: () => undefined,
    onPreview: () => undefined,
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("folder rule panel", () => {
  it("shows the selected folder as one absolute path", () => {
    const host = draw(panel());
    expect(host.querySelector(".folders-panel__path")?.textContent?.trim()).toBe(
      "/mnt/share/reports",
    );
  });

  it("defaults a subject with no rule to hidden and says so", () => {
    const host = draw(panel());
    const active = host.querySelectorAll(".folders-perm__button--active");
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent?.trim()).toBe(t("ixAuth.folders.permission.hidden"));
    expect(host.textContent).toContain(t("ixAuth.folders.effectiveNone"));
  });

  it("names the folder an inherited verdict came from", () => {
    const host = draw(
      panel({
        rules: rulesResult({
          effective: [
            {
              subjectKind: "department",
              subjectId: "rnd",
              permission: "read",
              sourcePath: "reports/2026",
              inherited: true,
            },
          ],
        }),
      }),
    );
    const sentence = host.querySelector(".folders-subject__effective")?.textContent ?? "";
    expect(sentence).toContain("reports/2026");
    expect(sentence).toContain(t("ixAuth.folders.permission.read"));
    expect(sentence).not.toContain(t("ixAuth.folders.effectiveNone"));
  });

  it("keeps an existing rule's own permission as the row's starting value", () => {
    const host = draw(panel({ rules: rulesResult({ rules: [rule({ permission: "write" })] }) }));
    expect(host.querySelector(".folders-perm__button--active")?.textContent?.trim()).toBe(
      t("ixAuth.folders.permission.write"),
    );
    // A rule that exists here can be taken away again.
    expect(host.textContent).toContain(t("ixAuth.folders.clear"));
  });

  it("lists nobody on the people tab until something is searched for", () => {
    const host = draw(panel({ tab: "user" }));
    expect(host.querySelectorAll(".folders-subject")).toHaveLength(0);
    expect(host.textContent).toContain(t("ixAuth.folders.userSearchEmpty"));
  });

  it("lists the accounts a search matched, and nobody else", () => {
    const host = draw(panel({ tab: "user", userQuery: "kim@" }));
    const rows = host.querySelectorAll(".folders-subject__name");
    expect(Array.from(rows, (row) => row.textContent?.trim())).toEqual(["Kim"]);
  });

  it("keeps a person who already holds a rule here visible without a search", () => {
    const host = draw(
      panel({
        tab: "user",
        rules: rulesResult({
          rules: [rule({ subjectKind: "user", subjectId: "u-2", permission: "read" })],
        }),
      }),
    );
    const rows = host.querySelectorAll(".folders-subject__name");
    expect(Array.from(rows, (row) => row.textContent?.trim())).toEqual(["Lee"]);
  });

  it("reports the permission a button was pressed for", () => {
    const onPermission = vi.fn();
    const host = draw(panel({ onPermission }));
    const buttons = host.querySelectorAll<HTMLButtonElement>(".folders-perm__button");
    expect(buttons).toHaveLength(3);
    buttons[2]?.click();
    expect(onPermission).toHaveBeenCalledWith("department", "rnd", "write");
    buttons[1]?.click();
    expect(onPermission).toHaveBeenLastCalledWith("department", "rnd", "read");
  });

  it("says a folder is gone when its rules outlived it", () => {
    const host = draw(panel({ rules: rulesResult({ exists: false }) }));
    expect(host.textContent).toContain(t("ixAuth.folders.missingPath"));
  });
});
