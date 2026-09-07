/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { IxAuthManagedUser } from "../../features/ix-auth/ix-auth-users-api.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
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

describe("detail panel", () => {
  function panelProps(overrides?: Partial<Parameters<typeof renderUserDetailPanel>[0]>) {
    return {
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
      deleteArmed: false,
      onDisplayNameInput: () => {},
      onSaveDisplayName: () => {},
      onRoleChange: () => {},
      onDepartmentToggle: () => {},
      onSaveDepartments: () => {},
      onToggleStatus: () => {},
      onAction: () => {},
      onArmDelete: () => {},
      onDelete: () => {},
      ...overrides,
    };
  }

  it("asks for confirmation before deleting rather than deleting on the first click", () => {
    const armed: boolean[] = [];
    const host = draw(
      renderUserDetailPanel(
        panelProps({
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
    const host = draw(renderUserDetailPanel(panelProps({ deleteArmed: true })));
    expect(host.textContent).toContain("Yes, delete");
    expect(host.textContent).toContain("member@example.test");
  });

  it("offers no delete to an ordinary administrator", () => {
    const host = draw(renderUserDetailPanel(panelProps({ canDelete: false })));
    expect(host.textContent).not.toContain("Delete the account");
  });

  it("locks role and department edits on the caller's own account", () => {
    const host = draw(renderUserDetailPanel(panelProps({ user: managedUser({ self: true }) })));
    expect(host.querySelector("select")?.disabled).toBe(true);
    for (const checkbox of host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
      expect(checkbox.disabled).toBe(true);
    }
  });

  it("only offers the lockout clearance when there is a lockout", () => {
    const open = draw(renderUserDetailPanel(panelProps()));
    const unlock = [...open.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Clear the lockout",
    );
    expect(unlock?.disabled).toBe(true);
    document.body.replaceChildren();
    const locked = draw(
      renderUserDetailPanel(panelProps({ user: managedUser({ locked: true, status: "LOCKED" }) })),
    );
    const enabled = [...locked.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Clear the lockout",
    );
    expect(enabled?.disabled).toBe(false);
  });
});
