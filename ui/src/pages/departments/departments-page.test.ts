/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DepartmentAgent } from "../../../../packages/gateway-protocol/src/schema/departments.js";
import {
  canManageIxAuthDepartments,
  canManageIxAuthUsers,
  setIxAuthAdminAccess,
  setIxAuthSuperAdminAccess,
} from "../../features/ix-auth/ix-auth-admin-access.ts";
import type { IxAuthManagedUser } from "../../features/ix-auth/ix-auth-users-api.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { renderDepartmentAccessPanel } from "./department-access-panel.ts";
import { renderDepartmentAgentsTable } from "./department-agents-panel.ts";
import { renderDepartmentDetailDialog } from "./department-detail-dialog.ts";
import { renderDepartmentMembersPanel } from "./department-members-panel.ts";
import { autoDepartmentSlug } from "./department-slug.ts";
import { buildDepartmentAgentPatch } from "./departments-gateway.ts";
import {
  renderDepartmentCreateForm,
  renderDepartmentDeleteForm,
  renderDepartmentsTable,
} from "./departments-table.ts";

registerIxAuthEnglish();
vi.mock("../folders/folders-page.ts", () => ({}));

function draw(template: unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  // SAFETY: every caller passes a Lit template produced by the module under test.
  render(template as Parameters<typeof render>[0], host);
  return host;
}

function agent(overrides?: Partial<DepartmentAgent>): DepartmentAgent {
  return { agentId: "rnd-bot", name: "RND Bot", indexPaths: [], ...overrides };
}

function managedUser(overrides?: Partial<IxAuthManagedUser>): IxAuthManagedUser {
  return {
    id: "2087",
    email: "member@example.test",
    displayName: "Member Person",
    status: "ACTIVE",
    roles: ["MEMBER"],
    isSuperAdmin: false,
    departments: ["dept-rnd"],
    titles: [],
    locked: false,
    failedCount: 0,
    self: false,
    ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  setIxAuthAdminAccess(false);
  setIxAuthSuperAdminAccess(false);
});

describe("department screen access", () => {
  it("stays closed before the first session probe answers", () => {
    expect(canManageIxAuthDepartments()).toBe(false);
  });

  // Since P the department routes serve an administrator too, so the menu that guards
  // this screen asks the same question as the user screen (AUTH-IXAUTH 5-1).
  it("opens for an ordinary administrator, like the user screen", () => {
    setIxAuthAdminAccess(true);
    setIxAuthSuperAdminAccess(false);
    expect(canManageIxAuthUsers()).toBe(true);
    expect(canManageIxAuthDepartments()).toBe(true);
  });

  it("opens for a system administrator", () => {
    setIxAuthAdminAccess(true);
    setIxAuthSuperAdminAccess(true);
    expect(canManageIxAuthDepartments()).toBe(true);
  });
});

describe("department table", () => {
  it("shows the group code beside the name, with counts and bound agents", () => {
    const onFolders = vi.fn();
    const host = draw(
      renderDepartmentsTable({
        departments: [
          {
            code: "dept-rnd",
            slug: "rnd",
            name: "Research",
            memberCount: 3,
            agents: ["rnd-bot"],
          },
        ],
        loading: false,
        onSelect: () => {},
        onFolders,
      }),
    );
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.textContent).toContain("Research");
    expect(host.textContent).toContain("dept-rnd");
    expect(host.textContent).toContain("3");
    expect(host.textContent).toContain("rnd-bot");
    host.querySelector<HTMLButtonElement>("tbody .btn")?.click();
    expect(onFolders).toHaveBeenCalledWith("rnd");
  });

  it("says so when no department exists yet", () => {
    const host = draw(
      renderDepartmentsTable({ departments: [], loading: false, onSelect: () => {} }),
    );
    expect(host.textContent).toContain("No department has been created yet.");
  });
});

describe("department detail dialog", () => {
  function options(): Parameters<typeof renderDepartmentDetailDialog>[0] {
    return {
      department: { code: "dept-rnd", slug: "rnd", name: "Research" },
      tab: "folders",
      busy: false,
      foldersOpened: true,
      discardArmed: false,
      deleteArmed: false,
      renameDraft: "Research",
      members: html`<p>Members</p>`,
      agents: html`<p>Agents</p>`,
      onTab: vi.fn(),
      onClose: vi.fn(),
      onKeepEditing: vi.fn(),
      onRenameInput: vi.fn(),
      onRename: vi.fn(),
      onDeleteArm: vi.fn(),
      onDeleteCancel: vi.fn(),
      onDelete: vi.fn(),
      onFolderState: vi.fn(),
    };
  }

  it("keeps the same folder editor mounted across tabs and forwards save state", () => {
    const props = options();
    const host = draw(renderDepartmentDetailDialog(props));
    const editor = host.querySelector("openclaw-folders-page");
    expect(editor).not.toBeNull();
    render(renderDepartmentDetailDialog({ ...props, tab: "members" }), host);
    expect(host.querySelector("openclaw-folders-page")).toBe(editor);
    expect(editor?.parentElement?.hidden).toBe(true);
    editor?.dispatchEvent(
      new CustomEvent("folders-busy-change", {
        bubbles: true,
        detail: { busy: true, dirty: true },
      }),
    );
    expect(props.onFolderState).toHaveBeenCalledWith({ busy: true, dirty: true });
  });

  it("locks tabs and close while a save is pending", () => {
    const props = options();
    const host = draw(renderDepartmentDetailDialog({ ...props, busy: true }));
    const controls = host.querySelectorAll<HTMLButtonElement>(
      ".admin-detail-tabs button, .admin-detail-dialog__header button",
    );
    expect(controls).toHaveLength(5);
    for (const button of controls) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    expect(props.onTab).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("department create form", () => {
  // The screen's own rule, exercised here as the form exercises it: the code follows the
  // name until somebody opens the field and types one, and never afterwards.
  function createForm(taken: readonly string[] = []) {
    const host = document.createElement("div");
    document.body.append(host);
    const state = { name: "", slug: "", dirty: false, opened: false };
    const paint = (): void => {
      render(
        renderDepartmentCreateForm({
          prefix: "dept-",
          slug: state.slug,
          name: state.name,
          busy: false,
          slugOpened: state.opened,
          onSlugInput: (value) => {
            state.slug = value;
            state.dirty = true;
            paint();
          },
          onSlugToggle: () => {
            state.opened = !state.opened;
            paint();
          },
          onNameInput: (value) => {
            state.name = value;
            if (!state.dirty) {
              state.slug = autoDepartmentSlug(value, taken);
            }
            paint();
          },
          onSubmit: () => {},
        }),
        host,
      );
    };
    paint();
    const type = (selector: string, value: string): void => {
      const input = host.querySelector<HTMLInputElement>(selector);
      if (!input) {
        throw new Error(`no input matched ${selector}`);
      }
      input.value = value;
      input.dispatchEvent(new Event("input"));
    };
    return { host, state, type };
  }

  it("writes the short code from the name as it is typed", () => {
    const form = createForm();
    form.type("[data-department-create-name]", "연구개발");
    expect(form.state.slug).toBe("yeongugaebal");
    expect(form.host.querySelector("[data-department-code-preview]")?.textContent).toContain(
      "dept-yeongugaebal",
    );
    expect(form.host.querySelector<HTMLButtonElement>(".btn")?.hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("stops following the name once the code has been typed by hand", () => {
    const form = createForm();
    form.type("[data-department-create-name]", "품질");
    expect(form.state.slug).toBe("pumjil");
    form.host.querySelector<HTMLButtonElement>(".departments-form__disclosure")?.click();
    form.type("[data-department-create-slug]", "qa");
    form.type("[data-department-create-name]", "품질관리");
    expect(form.state.slug).toBe("qa");
    expect(form.host.querySelector("[data-department-code-preview]")?.textContent).toContain(
      "dept-qa",
    );
  });

  it("refuses to submit a hand-typed code the Gateway would reject", () => {
    const form = createForm();
    form.type("[data-department-create-name]", "Quality");
    form.host.querySelector<HTMLButtonElement>(".departments-form__disclosure")?.click();
    form.type("[data-department-create-slug]", "Quality Assurance");
    expect(form.host.querySelector<HTMLButtonElement>(".btn")?.hasAttribute("disabled")).toBe(true);
    expect(form.host.querySelector(".departments-form__hint--error")).not.toBeNull();
  });

  it("steps around a short code the directory already holds", () => {
    const form = createForm(["pumjil"]);
    form.type("[data-department-create-name]", "품질");
    expect(form.state.slug).toBe("pumjil-2");
  });
});

describe("department delete", () => {
  const department = {
    code: "dept-rnd",
    slug: "rnd",
    name: "Research",
    memberCount: 0,
    agents: ["rnd-bot"],
  };

  it("names the agents that lose their folder and asks before deleting", () => {
    let armed = false;
    const host = draw(
      renderDepartmentDeleteForm({
        department,
        armed: false,
        busy: false,
        onArm: () => {
          armed = true;
        },
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
    expect(host.textContent).toContain("rnd-bot");
    const button = host.querySelector("button");
    expect(button?.hasAttribute("disabled")).toBe(false);
    button?.click();
    expect(armed).toBe(true);
  });

  it("refuses to arm while somebody is still in the department", () => {
    const host = draw(
      renderDepartmentDeleteForm({
        department: { ...department, memberCount: 2 },
        armed: false,
        busy: false,
        onArm: () => {},
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
    expect(host.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain("2 people are still in this department");
  });

  it("only calls back on the second press", () => {
    let confirmed = 0;
    const host = draw(
      renderDepartmentDeleteForm({
        department,
        armed: true,
        busy: false,
        onArm: () => {},
        onCancel: () => {},
        onConfirm: () => {
          confirmed += 1;
        },
      }),
    );
    expect(host.textContent).toContain("Delete Research?");
    host.querySelector("button")?.click();
    expect(confirmed).toBe(1);
  });
});

describe("agent table", () => {
  it("shows an unbound agent as shared and reports the binding it is given", () => {
    const bound: string[] = [];
    const host = draw(
      renderDepartmentAgentsTable({
        agents: [agent()],
        departments: [{ code: "dept-rnd", slug: "rnd", name: "Research" }],
        busy: false,
        onSelect: () => {},
        onBind: (agentId, department) => bound.push(`${agentId}:${department}`),
      }),
    );
    const select = host.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("");
    expect(host.textContent).toContain("Shared");
    if (select) {
      select.value = "rnd";
      select.dispatchEvent(new Event("change"));
    }
    expect(bound).toEqual(["rnd-bot:rnd"]);
  });

  it("shows the access settings that are actually set", () => {
    const host = draw(
      renderDepartmentAgentsTable({
        agents: [
          agent({
            department: "rnd",
            workspace: "/mnt/nas/rnd",
            toolsProfile: "readonly",
            permissionMode: "read-only",
            indexPaths: ["/mnt/knowledge/rnd"],
          }),
        ],
        departments: [{ code: "dept-rnd", slug: "rnd", name: "Research" }],
        busy: false,
        onSelect: () => {},
        onBind: () => {},
      }),
    );
    expect(host.textContent).toContain("/mnt/nas/rnd");
    expect(host.textContent).toContain("readonly");
    expect(host.textContent).toContain("read-only");
    expect(host.textContent).toContain("/mnt/knowledge/rnd");
  });
});

describe("access panel", () => {
  it("says the shared root is not mounted rather than showing an empty picker", () => {
    const host = draw(
      renderDepartmentAccessPanel({
        draft: {
          workspace: "",
          workspaceIsShared: false,
          readonlyTools: false,
          readonlySessions: false,
          indexText: "",
        },
        listing: { root: "/mnt/nas", available: false, path: "", entries: [] },
        busy: false,
        onOpenFolder: () => {},
        onChooseFolder: () => {},
        onToggleReadonlyTools: () => {},
        onToggleReadonlySessions: () => {},
        onIndexInput: () => {},
        onSave: () => {},
      }),
    );
    expect(host.textContent).toContain("No shared folder root is mounted here");
  });

  it("offers each folder the server returned and nothing else", () => {
    const chosen: string[] = [];
    const host = draw(
      renderDepartmentAccessPanel({
        draft: {
          workspace: "/mnt/nas/rnd",
          workspaceIsShared: true,
          readonlyTools: true,
          readonlySessions: true,
          indexText: "/mnt/knowledge/rnd",
        },
        listing: {
          root: "/mnt/nas",
          available: true,
          path: "",
          entries: [{ name: "rnd", path: "rnd", absolutePath: "/mnt/nas/rnd" }],
        },
        busy: false,
        onOpenFolder: () => {},
        onChooseFolder: (absolutePath) => chosen.push(absolutePath),
        onToggleReadonlyTools: () => {},
        onToggleReadonlySessions: () => {},
        onIndexInput: () => {},
        onSave: () => {},
      }),
    );
    expect(host.querySelectorAll(".departments-browser__item")).toHaveLength(1);
    // The workspace field is filled by choosing, never by typing.
    expect(host.querySelector<HTMLInputElement>("input.settings-input")?.readOnly).toBe(true);
    host.querySelector<HTMLButtonElement>(".departments-browser__item .btn")?.click();
    expect(chosen).toEqual(["/mnt/nas/rnd"]);
  });
});

describe("members panel", () => {
  it.each(["loading", "failed"] as const)(
    "does not show an empty department while %s",
    (status) => {
      const onRetry = vi.fn();
      const host = draw(
        renderDepartmentMembersPanel({
          members: [],
          total: 0,
          query: "",
          results: [],
          searched: false,
          busy: false,
          loading: status === "loading",
          failed: status === "failed",
          onRetry,
          onQueryInput: () => {},
          onSearch: () => {},
          onAdd: () => {},
          onRemove: () => {},
        }),
      );
      expect(host.textContent).not.toContain("Nobody is in this department yet.");
      expect(host.querySelector("input")).toBeNull();
      host.querySelector<HTMLButtonElement>("button")?.click();
      expect(onRetry).toHaveBeenCalledTimes(status === "failed" ? 1 : 0);
    },
  );

  it("refuses to offer the signed-in administrator their own row", () => {
    const host = draw(
      renderDepartmentMembersPanel({
        members: [managedUser({ self: true })],
        total: 1,
        query: "",
        results: [],
        searched: false,
        busy: false,
        onQueryInput: () => {},
        onSearch: () => {},
        onAdd: () => {},
        onRemove: () => {},
      }),
    );
    expect(host.textContent).toContain("You cannot change your own departments here.");
    expect(host.querySelectorAll("tbody .btn")).toHaveLength(0);
  });
});

describe("agent access patch", () => {
  it("deletes the keys a cleared setting owns instead of pinning a default", () => {
    const patch = JSON.parse(
      buildDepartmentAgentPatch({
        agentId: "main",
        workspace: "",
        workspaceIsShared: false,
        readonlyTools: false,
        readonlySessions: false,
        indexPaths: [],
      }),
    );
    expect(patch.agents.entries.main).toEqual({
      workspace: null,
      skipBootstrap: null,
      tools: { profile: null, permissionMode: null },
      memory: { search: { extraPaths: [] } },
    });
  });

  it("switches bootstrap off for a workspace on the shared, read-only root", () => {
    const patch = JSON.parse(
      buildDepartmentAgentPatch({
        agentId: "rnd-bot",
        workspace: "/mnt/nas/rnd",
        workspaceIsShared: true,
        readonlyTools: true,
        readonlySessions: true,
        indexPaths: ["/mnt/knowledge/rnd"],
      }),
    );
    expect(patch.agents.entries["rnd-bot"]).toEqual({
      workspace: "/mnt/nas/rnd",
      skipBootstrap: true,
      tools: { profile: "readonly", permissionMode: "read-only" },
      memory: { search: { extraPaths: ["/mnt/knowledge/rnd"] } },
    });
  });
});
