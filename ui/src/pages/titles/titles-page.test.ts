/* @vitest-environment jsdom */

import { nothing, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  IxAuthOrphanTitle,
  IxAuthTitleOption,
} from "../../features/ix-auth/ix-auth-admin-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import {
  renderOrphanTitles,
  renderTitleCreateForm,
  renderTitleEditForm,
  renderTitlesTable,
} from "./titles-table.ts";

// The title words live in the lazily loaded identity catalog, as the page loads it.
registerIxAuthEnglish();

function draw(template: unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  // SAFETY: every caller passes a Lit template produced by the module under test.
  render(template as Parameters<typeof render>[0], host);
  return host;
}

function title(overrides: Partial<IxAuthTitleOption> = {}): IxAuthTitleOption {
  return {
    code: "title-team-lead",
    slug: "team-lead",
    name: "Team lead",
    memberCount: 2,
    ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("titles table", () => {
  it("says the list is empty rather than drawing an empty table", () => {
    const host = draw(
      renderTitlesTable({ titles: [], loading: false, busy: false, onSelect: () => undefined }),
    );
    expect(host.textContent).toContain(t("ixAuth.titles.empty"));
    expect(host.querySelectorAll("table")).toHaveLength(0);
  });

  it("shows the group code and the head count, and reports the row clicked", () => {
    const onSelect = vi.fn();
    const host = draw(
      renderTitlesTable({
        titles: [title(), title({ code: "title-safety", slug: "safety", name: "Safety officer" })],
        loading: false,
        busy: false,
        onSelect,
      }),
    );
    expect(host.querySelector("code")?.textContent).toBe("title-team-lead");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    host.querySelectorAll<HTMLButtonElement>(".departments-table__select")[1]?.click();
    expect(onSelect).toHaveBeenCalledWith("safety");
  });

  it("warns when the counts are only the sign-in projection", () => {
    const host = draw(
      renderTitlesTable({
        titles: [title()],
        loading: false,
        busy: false,
        memberCountSource: "projection",
        onSelect: () => undefined,
      }),
    );
    expect(host.textContent).toContain(t("ixAuth.titles.memberCountProjected"));
  });
});

describe("title create form", () => {
  it("spells out the group code the name will produce", () => {
    const host = draw(
      renderTitleCreateForm({
        prefix: "title-",
        slug: "team-lead",
        name: "Team lead",
        busy: false,
        slugOpened: false,
        onSlugInput: () => undefined,
        onSlugToggle: () => undefined,
        onNameInput: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(host.querySelector("[data-title-code-preview]")?.textContent).toContain(
      "title-team-lead",
    );
    // The code field stays closed until somebody asks to set it themselves.
    expect(host.querySelector("[data-title-create-slug]")).toBeNull();
  });

  it("refuses to submit a code the Gateway would reject", () => {
    const host = draw(
      renderTitleCreateForm({
        prefix: "title-",
        slug: "Not A Slug",
        name: "Team lead",
        busy: false,
        slugOpened: true,
        onSlugInput: () => undefined,
        onSlugToggle: () => undefined,
        onNameInput: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(host.querySelector("button.btn")?.hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain(t("ixAuth.titles.createSlugInvalid"));
  });
});

describe("title edit form", () => {
  it("blocks the delete while people still hold the title, and says how many", () => {
    const host = draw(
      renderTitleEditForm({
        title: title({ memberCount: 3 }),
        nameDraft: "Team lead",
        deleteArmed: false,
        busy: false,
        onNameInput: () => undefined,
        onRename: () => undefined,
        onDeleteArm: () => undefined,
        onDeleteCancel: () => undefined,
        onDelete: () => undefined,
      }),
    );
    expect(host.querySelector("button.danger")?.hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain(t("ixAuth.titles.deleteBlocked", { count: "3" }));
  });

  it("asks a second time before deleting an empty title", () => {
    const onDelete = vi.fn();
    const host = draw(
      renderTitleEditForm({
        title: title({ memberCount: 0 }),
        nameDraft: "Team lead",
        deleteArmed: true,
        busy: false,
        onNameInput: () => undefined,
        onRename: () => undefined,
        onDeleteArm: () => undefined,
        onDeleteCancel: () => undefined,
        onDelete,
      }),
    );
    expect(host.textContent).toContain(t("ixAuth.titles.deleteConfirm", { name: "Team lead" }));
    host.querySelector<HTMLButtonElement>("button.danger")?.click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("orphan titles", () => {
  it("draws nothing when every title still has a group", () => {
    expect(renderOrphanTitles([])).toBe(nothing);
  });

  it("names the titles the identity server no longer lists", () => {
    const orphans: IxAuthOrphanTitle[] = [
      { slug: "retired", name: "Retired role", memberCount: 0 },
    ];
    const host = draw(renderOrphanTitles(orphans));
    expect(host.textContent).toContain("retired");
    expect(host.textContent).toContain(t("ixAuth.titles.orphanBody"));
  });
});
