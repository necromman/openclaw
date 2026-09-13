/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IxAuthManagedUser } from "../../features/ix-auth/ix-auth-users-api.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { hasUnsavedUserDetails, reconcileUserDetailDrafts } from "./user-detail-drafts.ts";
import { assignableRolesFor, renderUserDetailPanel } from "./user-detail-panel.ts";
import { renderUsersTable } from "./users-table.ts";

registerIxAuthEnglish();

function managedUser(overrides?: Partial<IxAuthManagedUser>): IxAuthManagedUser {
  return {
    id: "2087",
    email: "member@example.test",
    displayName: "Member Person",
    status: "ACTIVE",
    roles: ["MEMBER"],
    gatewayRole: "member",
    isSuperAdmin: false,
    departments: ["dept-rnd"],
    lastLoginAt: undefined,
    createdAt: "2026-09-01T00:00:00Z",
    locked: false,
    failedCount: 0,
    self: false,
    ...overrides,
  };
}

function draw(template: unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  // SAFETY: every caller passes a Lit template produced by the module under test.
  render(template as Parameters<typeof render>[0], host);
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("users table", () => {
  it("shows a row per account with its Korean-facing role label", () => {
    const host = draw(
      renderUsersTable({
        users: [managedUser(), managedUser({ id: "3001", gatewayRole: "executive" })],
        loading: false,
        onSelect: () => {},
      }),
    );
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.textContent).toContain("Staff");
    expect(host.textContent).toContain("Executive");
    expect(host.textContent).toContain("Never");
  });

  it("names an account with no role instead of leaving the cell blank", () => {
    const host = draw(
      renderUsersTable({
        users: [managedUser({ roles: [], gatewayRole: undefined })],
        loading: false,
        onSelect: () => {},
      }),
    );
    const cells = host.querySelectorAll("tbody tr td");
    expect(cells[2]?.textContent?.trim()).toBe("Unassigned");
  });

  it("shows a department by name and keeps its code in the title", () => {
    const host = draw(
      renderUsersTable({
        users: [managedUser({ departments: ["dept-rnd", "dept-qa"] })],
        departments: [
          { code: "dept-rnd", name: "연구개발" },
          { code: "dept-qa", name: "품질보증" },
        ],
        loading: false,
        onSelect: () => {},
      }),
    );
    const cells = [...host.querySelectorAll<HTMLElement>("tbody td")];
    const departmentCell = cells[3];
    expect(departmentCell?.textContent).toContain("연구개발");
    expect(departmentCell?.textContent).toContain("품질보증");
    expect(departmentCell?.textContent).not.toContain("dept-rnd");
    expect(
      [...(departmentCell?.querySelectorAll("span[title]") ?? [])].map((span) =>
        span.getAttribute("title"),
      ),
    ).toEqual(["dept-rnd", "dept-qa"]);
  });

  it("keeps a code the directory does not name, and says so when there is none", () => {
    const host = draw(
      renderUsersTable({
        users: [
          managedUser({ departments: ["dept-legal"] }),
          managedUser({ id: "3002", departments: [] }),
        ],
        departments: [{ code: "dept-rnd", name: "연구개발" }],
        loading: false,
        onSelect: () => {},
      }),
    );
    const cells = [...host.querySelectorAll<HTMLElement>("tbody tr")].map(
      (row) => row.children[3] as HTMLElement | undefined,
    );
    expect(cells[0]?.textContent).toContain("dept-legal");
    expect(cells[0]?.querySelector("span[title]")?.getAttribute("title")).toBe("dept-legal");
    expect(cells[1]?.textContent).toContain("None");
  });

  it("falls back to the codes while the directory has not arrived", () => {
    const host = draw(
      renderUsersTable({
        users: [managedUser({ departments: ["dept-rnd"] })],
        loading: false,
        onSelect: () => {},
      }),
    );
    expect(host.textContent).toContain("dept-rnd");
  });

  it("marks the signed-in administrator's own row", () => {
    const host = draw(
      renderUsersTable({
        users: [managedUser({ self: true })],
        loading: false,
        onSelect: () => {},
      }),
    );
    expect(host.textContent).toContain("You");
  });

  it("says nothing matched rather than drawing an empty table", () => {
    const host = draw(renderUsersTable({ users: [], loading: false, onSelect: () => {} }));
    expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).toContain("No accounts match");
  });
});

describe("assignable roles", () => {
  it("withholds the super-admin rank from an ordinary administrator", () => {
    expect(assignableRolesFor({ canGrantSuperAdmin: false, currentRoles: ["MEMBER"] })).toEqual([
      "MEMBER",
      "EXECUTIVE",
      "ADMIN",
    ]);
  });

  it("offers the super-admin rank to a super administrator", () => {
    expect(assignableRolesFor({ canGrantSuperAdmin: true, currentRoles: ["MEMBER"] })).toContain(
      "SUPERADMIN",
    );
  });

  it("keeps a rank the account already holds, so opening the panel proposes nothing", () => {
    expect(
      assignableRolesFor({ canGrantSuperAdmin: false, currentRoles: ["MODERATOR"] }),
    ).toContain("MODERATOR");
    expect(
      assignableRolesFor({ canGrantSuperAdmin: false, currentRoles: ["SUPERADMIN"] }),
    ).toContain("SUPERADMIN");
  });
});

describe("detail draft refresh", () => {
  const draft = {
    displayNameDraft: "Unsaved name",
    selectedRole: "EXECUTIVE",
    selectedDepartments: ["dept-qa"],
  };

  it("keeps other edits and the discard warning after saving a role", () => {
    const next = managedUser({ roles: ["EXECUTIVE"] });
    const merged = reconcileUserDetailDrafts({
      previous: managedUser(),
      next,
      draft,
      savedField: "role",
    });
    expect(merged).toEqual(draft);
    expect(hasUnsavedUserDetails(next, merged)).toBe(true);
  });

  it("retains the requested departments after a partial save for a retry", () => {
    const next = managedUser({ departments: ["dept-rnd", "dept-qa"] });
    const merged = reconcileUserDetailDrafts({ previous: managedUser(), next, draft });
    expect(merged.selectedDepartments).toEqual(["dept-qa"]);
    expect(hasUnsavedUserDetails(next, merged)).toBe(true);
    const saved = reconcileUserDetailDrafts({
      previous: next,
      next,
      draft,
      savedField: "departments",
    });
    expect(saved.selectedDepartments).toEqual(next.departments);
    expect(saved.displayNameDraft).toBe("Unsaved name");
  });

  it("resets every draft for a new account and refreshes untouched fields", () => {
    const next = managedUser({ id: "3001", displayName: "Other user", departments: [] });
    const merged = reconcileUserDetailDrafts({ previous: managedUser(), next, draft });
    expect(merged).toEqual({
      displayNameDraft: "Other user",
      selectedRole: "MEMBER",
      selectedDepartments: [],
    });
    expect(hasUnsavedUserDetails(next, merged)).toBe(false);
    const refreshed = reconcileUserDetailDrafts({
      previous: next,
      next: { ...next, displayName: "Renamed" },
      draft: merged,
    });
    expect(refreshed.displayNameDraft).toBe("Renamed");
  });
});

describe("detail panel", () => {
  function panelProps(overrides?: Partial<Parameters<typeof renderUserDetailPanel>[0]>) {
    return {
      section: "access" as const,
      user: managedUser(),
      emailVerified: true,
      mfaEnabled: false,
      sessionCount: 2,
      departments: [
        { code: "dept-rnd", name: "R&D" },
        { code: "dept-qa", name: "QA" },
      ],
      displayNameDraft: "Member Person",
      selectedRole: "MEMBER",
      selectedDepartments: ["dept-rnd"],
      busy: false,
      canGrantSuperAdmin: true,
      canDelete: true,
      protectedTarget: false,
      deleteArmed: false,
      onDisplayNameInput: () => {},
      onSaveDisplayName: () => {},
      onRoleChange: () => {},
      onSaveRole: () => {},
      onDepartmentToggle: () => {},
      onSaveDepartments: () => {},
      onToggleStatus: () => {},
      onAction: () => {},
      onArmDelete: () => {},
      onDelete: () => {},
      ...overrides,
    };
  }

  it("requires an explicit save after selecting a different role", () => {
    const onSaveRole = vi.fn();
    const onRoleChange = vi.fn();
    const props = panelProps({ onRoleChange, onSaveRole });
    const host = draw(renderUserDetailPanel(props));
    const saveButton = () =>
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Save role",
      );
    expect(saveButton()?.disabled).toBe(true);
    const select = host.querySelector("select")!;
    select.value = "EXECUTIVE";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onRoleChange).toHaveBeenCalledWith("EXECUTIVE");
    expect(onSaveRole).not.toHaveBeenCalled();
    render(renderUserDetailPanel({ ...props, selectedRole: "EXECUTIVE" }), host);
    expect(saveButton()?.disabled).toBe(false);
    saveButton()?.click();
    expect(onSaveRole).toHaveBeenCalledOnce();
  });

  it("asks for confirmation before deleting rather than deleting on the first click", () => {
    const armed: boolean[] = [];
    const host = draw(
      renderUserDetailPanel(
        panelProps({
          section: "account",
          onArmDelete: (value) => armed.push(value),
        }),
      ),
    );
    const deleteButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Delete the account",
    );
    expect(deleteButton).toBeDefined();
    deleteButton?.click();
    expect(armed).toEqual([true]);
    expect(host.textContent).not.toContain("Yes, delete");
  });

  it("shows the second step once armed", () => {
    const host = draw(renderUserDetailPanel(panelProps({ section: "account", deleteArmed: true })));
    expect(host.textContent).toContain("Yes, delete");
    expect(host.textContent).toContain("member@example.test");
  });

  it("offers no delete to an ordinary administrator", () => {
    const host = draw(renderUserDetailPanel(panelProps({ section: "account", canDelete: false })));
    expect(host.textContent).not.toContain("Delete the account");
  });

  it("locks role and department edits on the caller's own account", () => {
    const host = draw(renderUserDetailPanel(panelProps({ user: managedUser({ self: true }) })));
    expect(host.querySelector("select")?.disabled).toBe(true);
    expect(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Save role",
      )?.disabled,
    ).toBe(true);
    for (const checkbox of host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
      expect(checkbox.disabled).toBe(true);
    }
  });

  it("locks every change on a system administrator the reader does not outrank", () => {
    const host = draw(
      html`${renderUserDetailPanel(panelProps({ protectedTarget: true }))}${renderUserDetailPanel(panelProps({ section: "account", protectedTarget: true }))}`,
    );
    expect(host.textContent).toContain("This is a system administrator account.");
    expect(host.querySelector("select")?.disabled).toBe(true);
    for (const checkbox of host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
      expect(checkbox.disabled).toBe(true);
    }
    for (const label of [
      "Save role",
      "Deactivate",
      "Reset two-step verification",
      "Sign this person out",
    ]) {
      const button = [...host.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      expect(button?.disabled).toBe(true);
    }
  });

  it("only offers the lockout clearance when there is a lockout", () => {
    const open = draw(renderUserDetailPanel(panelProps({ section: "account" })));
    const unlock = [...open.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Clear the lockout",
    );
    expect(unlock?.disabled).toBe(true);
    document.body.replaceChildren();
    const locked = draw(
      renderUserDetailPanel(
        panelProps({ section: "account", user: managedUser({ locked: true, status: "LOCKED" }) }),
      ),
    );
    const enabled = [...locked.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Clear the lockout",
    );
    expect(enabled?.disabled).toBe(false);
  });
});
