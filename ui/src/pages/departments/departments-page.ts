import "../../styles/departments.css";
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import type {
  DepartmentAgent,
  DepartmentsFoldersListResult,
} from "../../../../packages/gateway-protocol/src/schema/departments.js";
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
import { canManageIxAuthDepartments } from "../../features/ix-auth/ix-auth-admin-access.ts";
import {
  createIxAuthDepartment,
  deleteIxAuthDepartment,
  fetchIxAuthDepartmentDirectory,
  renameIxAuthDepartment,
  type IxAuthDepartmentDirectory,
  type IxAuthDepartmentOption,
} from "../../features/ix-auth/ix-auth-admin-api.ts";
import {
  fetchIxAuthUsers,
  isIxAuthUsersFailure,
  replaceIxAuthUserDepartments,
  type IxAuthManagedUser,
} from "../../features/ix-auth/ix-auth-users-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { renderDepartmentAccessPanel } from "./department-access-panel.ts";
import { renderDepartmentAgentsTable } from "./department-agents-panel.ts";
import { renderDepartmentMembersPanel } from "./department-members-panel.ts";
import {
  bindDepartmentAgent,
  clearDepartmentAgentAccess,
  fetchDepartmentAgents,
  fetchDepartmentFolders,
  saveDepartmentAgentAccess,
} from "./departments-gateway.ts";
import {
  renderDepartmentCreateForm,
  renderDepartmentDeleteForm,
  renderDepartmentRenameForm,
  renderDepartmentsTable,
  renderOrphanDepartments,
} from "./departments-table.ts";

registerIxAuthEnglish();

const DEPARTMENT_MEMBER_PAGE_SIZE = 100;

export class DepartmentsPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;

  @state() private directory: IxAuthDepartmentDirectory | undefined;
  @state() private agents: DepartmentAgent[] = [];
  @state() private selectedSlug: string | undefined;
  @state() private selectedAgentId: string | undefined;
  @state() private members: IxAuthManagedUser[] = [];
  @state() private membersTotal = 0;
  @state() private membersLoading = false;
  @state() private membersFailed = false;
  @state() private searchQuery = "";
  @state() private searchResults: IxAuthManagedUser[] = [];
  @state() private searched = false;
  @state() private createSlug = "";
  @state() private createName = "";
  @state() private renameDraft = "";
  @state() private deleteArmedSlug: string | undefined;
  @state() private folders: DepartmentsFoldersListResult | undefined;
  @state() private foldersFailed = false;
  @state() private accessDraft = {
    workspace: "",
    workspaceIsShared: false,
    readonlyTools: false,
    readonlySessions: false,
    indexText: "",
  };
  @state() private loading = false;
  @state() private busy = false;
  @state() private errorKey: string | undefined;
  @state() private notice: string | undefined;

  private client: GatewayBrowserClient | null = null;
  private stopGateway: (() => void) | undefined;
  private connected = false;
  private membersGeneration = 0;
  private searchGeneration = 0;
  private foldersGeneration = 0;

  private get basePath(): string {
    return this.context?.basePath ?? "";
  }

  override connectedCallback() {
    // The host supplies a shellless loading fallback. Remove that unowned light-DOM
    // markup before Lit claims the root.
    this.replaceChildren();
    super.connectedCallback();
    this.stopGateway = this.context.gateway.subscribe((snapshot) =>
      this.applyGatewaySnapshot(snapshot),
    );
    this.applyGatewaySnapshot(this.context.gateway.snapshot);
    void this.loadDirectory();
  }

  override disconnectedCallback() {
    this.stopGateway?.();
    this.stopGateway = undefined;
    this.client = null;
    this.connected = false;
    this.membersGeneration += 1;
    this.searchGeneration += 1;
    this.foldersGeneration += 1;
    super.disconnectedCallback();
  }

  private applyGatewaySnapshot(snapshot: ApplicationGatewaySnapshot) {
    const clientChanged = snapshot.client !== this.client;
    this.client = snapshot.client;
    this.connected = snapshot.phase === "connected";
    if (this.connected && (clientChanged || this.agents.length === 0)) {
      void this.loadAgents();
    }
  }

  private async loadDirectory(): Promise<void> {
    if (!canManageIxAuthDepartments()) {
      return;
    }
    this.loading = true;
    const directory = await fetchIxAuthDepartmentDirectory(this.basePath);
    this.loading = false;
    if (isIxAuthUsersFailure(directory)) {
      this.errorKey = directory.errorKey;
      return;
    }
    this.errorKey = undefined;
    this.directory = directory;
  }

  private async loadAgents(): Promise<void> {
    const client = this.client;
    if (!client || !this.connected || !canManageIxAuthDepartments()) {
      return;
    }
    try {
      const result = await fetchDepartmentAgents(client);
      this.agents = result.agents;
    } catch {
      // The agent list is decoration for the department table; the failure is reported
      // by the section that could not be drawn rather than by taking the page down.
      this.agents = [];
    }
  }

  private selectedDepartment(): IxAuthDepartmentOption | undefined {
    return this.directory?.departments.find(
      (department) => (department.slug ?? department.code) === this.selectedSlug,
    );
  }

  private async loadMembers(): Promise<void> {
    const generation = ++this.membersGeneration;
    const department = this.selectedDepartment();
    this.members = [];
    this.membersTotal = 0;
    this.membersFailed = false;
    this.membersLoading = Boolean(department);
    if (!department) {
      return;
    }
    const page = await fetchIxAuthUsers({
      basePath: this.basePath,
      department: department.code,
      size: DEPARTMENT_MEMBER_PAGE_SIZE,
    });
    if (generation !== this.membersGeneration) {
      return;
    }
    this.membersLoading = false;
    if (isIxAuthUsersFailure(page)) {
      this.membersFailed = true;
      return;
    }
    this.members = page.users;
    this.membersTotal = page.total;
  }

  private async selectDepartment(slug: string): Promise<void> {
    if (this.busy) {
      return;
    }
    this.searchGeneration += 1;
    this.selectedSlug = slug;
    this.notice = undefined;
    this.deleteArmedSlug = undefined;
    this.searched = false;
    this.searchResults = [];
    this.renameDraft = this.selectedDepartment()?.name ?? "";
    await this.loadMembers();
  }

  private async mutate(run: () => Promise<unknown>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.errorKey = undefined;
    let result: unknown;
    try {
      result = await run();
    } catch (error) {
      this.busy = false;
      this.errorKey = String(error).includes("FORBIDDEN")
        ? "adminForbidden"
        : "departmentsRejected";
      return;
    }
    if (isIxAuthUsersFailure(result)) {
      this.busy = false;
      this.errorKey = result.errorKey;
      return;
    }
    await this.loadDirectory();
    await this.loadMembers();
    await this.loadAgents();
    this.busy = false;
  }

  private async createDepartment(): Promise<void> {
    await this.mutate(async () => {
      const created = await createIxAuthDepartment({
        basePath: this.basePath,
        slug: this.createSlug.trim(),
        name: this.createName.trim(),
      });
      if (!isIxAuthUsersFailure(created)) {
        this.notice = t("ixAuth.departments.created", { code: created.code });
        this.createSlug = "";
        this.createName = "";
      }
      return created;
    });
  }

  private async renameDepartment(): Promise<void> {
    const slug = this.selectedSlug;
    if (!slug) {
      return;
    }
    await this.mutate(async () => {
      const renamed = await renameIxAuthDepartment({
        basePath: this.basePath,
        slug,
        name: this.renameDraft.trim(),
      });
      if (!isIxAuthUsersFailure(renamed)) {
        this.notice = t("ixAuth.departments.renamed");
      }
      return renamed;
    });
  }

  private async deleteDepartment(): Promise<void> {
    const slug = this.selectedSlug;
    const client = this.client;
    if (!slug) {
      return;
    }
    await this.mutate(async () => {
      const removed = await deleteIxAuthDepartment({ basePath: this.basePath, slug });
      if (isIxAuthUsersFailure(removed)) {
        return removed;
      }
      if (client) {
        await clearDepartmentAgentAccess({ client, agentIds: removed.unboundAgents });
      }
      this.notice = t("ixAuth.departments.deleted", {
        agents: removed.unboundAgents.join(", ") || t("ixAuth.departments.none"),
      });
      this.selectedSlug = undefined;
      this.deleteArmedSlug = undefined;
      this.members = [];
      this.selectedAgentId = undefined;
      return removed;
    });
  }

  private async searchAccounts(): Promise<void> {
    if (this.busy || this.membersLoading || this.membersFailed) {
      return;
    }
    const generation = ++this.searchGeneration;
    const query = this.searchQuery.trim();
    if (query.length === 0) {
      this.searchResults = [];
      this.searched = false;
      return;
    }
    const page = await fetchIxAuthUsers({
      basePath: this.basePath,
      query,
      size: DEPARTMENT_MEMBER_PAGE_SIZE,
    });
    if (generation !== this.searchGeneration) {
      return;
    }
    this.searched = true;
    if (isIxAuthUsersFailure(page)) {
      this.errorKey = page.errorKey;
      this.searchResults = [];
      return;
    }
    this.searchResults = page.users;
  }

  private async changeMembership(user: IxAuthManagedUser, join: boolean): Promise<void> {
    const department = this.selectedDepartment();
    if (!department || this.membersLoading || this.membersFailed) {
      return;
    }
    const remaining = user.departments.filter((code) => code !== department.code);
    await this.mutate(async () => {
      const result = await replaceIxAuthUserDepartments({
        basePath: this.basePath,
        userId: user.id,
        departments: join ? [...remaining, department.code] : remaining,
      });
      if (!isIxAuthUsersFailure(result)) {
        // A 200 with failures named in it is a partial change, and is said so: the
        // person may still be in, or still be out of, the department just clicked.
        this.notice = result.departmentFailed
          ? t("ixAuth.departments.memberChangeIncomplete", {
              email: user.email,
              codes: result.failedDepartments.join(", "),
            })
          : t(join ? "ixAuth.departments.memberAdded" : "ixAuth.departments.memberRemoved", {
              email: user.email,
              name: department.name,
            });
        this.searchGeneration += 1;
        this.searchResults = [];
        this.searched = false;
      }
      return result;
    });
  }

  private async bindAgent(agentId: string, department: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    await this.mutate(async () => {
      await bindDepartmentAgent({ client, agentId, department });
      this.notice = department
        ? t("ixAuth.departments.bound", { agent: agentId, department })
        : t("ixAuth.departments.unbound", { agent: agentId });
      return undefined;
    });
  }

  private async openAgent(agentId: string): Promise<void> {
    const agent = this.agents.find((entry) => entry.agentId === agentId);
    if (!agent || this.busy) {
      return;
    }
    this.selectedAgentId = agentId;
    this.notice = undefined;
    this.accessDraft = {
      workspace: agent.workspace ?? "",
      workspaceIsShared: false,
      readonlyTools: agent.toolsProfile === "readonly",
      readonlySessions: agent.permissionMode === "read-only",
      indexText: agent.indexPaths.join("\n"),
    };
    await this.openFolder("");
  }

  private async openFolder(path: string): Promise<void> {
    const client = this.client;
    if (!client || this.busy) {
      return;
    }
    const generation = ++this.foldersGeneration;
    this.folders = undefined;
    this.foldersFailed = false;
    try {
      const listing = await fetchDepartmentFolders({ client, path });
      if (generation !== this.foldersGeneration || client !== this.client) {
        return;
      }
      this.folders = listing;
      this.accessDraft = {
        ...this.accessDraft,
        workspaceIsShared: this.isSharedWorkspace(this.accessDraft.workspace, listing),
      };
    } catch {
      if (generation === this.foldersGeneration && client === this.client) {
        this.foldersFailed = true;
      }
    }
  }

  private isSharedWorkspace(
    workspace: string,
    listing: DepartmentsFoldersListResult | undefined,
  ): boolean {
    const root = listing?.root;
    return Boolean(root && (workspace === root || workspace.startsWith(`${root}/`)));
  }

  private async saveAccess(): Promise<void> {
    const client = this.client;
    const agentId = this.selectedAgentId;
    if (!client || !agentId || !this.folders) {
      return;
    }
    await this.mutate(async () => {
      const outcome = await saveDepartmentAgentAccess({
        client,
        draft: {
          agentId,
          workspace: this.accessDraft.workspace.trim(),
          workspaceIsShared: this.accessDraft.workspaceIsShared,
          readonlyTools: this.accessDraft.readonlyTools,
          readonlySessions: this.accessDraft.readonlySessions,
          indexPaths: this.accessDraft.indexText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        },
      });
      this.notice =
        outcome === "restart-scheduled"
          ? t("ixAuth.departments.restartScheduled")
          : outcome === "restart-required"
            ? t("ixAuth.departments.restartRequired")
            : t("ixAuth.departments.saved");
      return undefined;
    });
  }

  private renderDepartmentsSection(): TemplateResult {
    const selected = this.selectedDepartment();
    return renderSettingsSection(
      { title: t("ixAuth.departments.title"), description: t("ixAuth.departments.description") },
      [
        renderSettingsRow({
          title: t("ixAuth.departments.whitelistTitle"),
          description: t("ixAuth.departments.whitelistBody"),
        }),
        renderSettingsRow({
          title: "",
          stacked: true,
          control: renderDepartmentsTable({
            departments: this.directory?.departments ?? [],
            loading: this.loading,
            busy: this.busy,
            ...(this.selectedSlug ? { selectedSlug: this.selectedSlug } : {}),
            ...(this.directory ? { memberCountSource: this.directory.memberCountSource } : {}),
            onSelect: (slug) => void this.selectDepartment(slug),
          }),
        }),
        renderSettingsRow({
          title: t("ixAuth.departments.createTitle"),
          stacked: true,
          control: renderDepartmentCreateForm({
            prefix: this.directory?.prefix ?? "",
            slug: this.createSlug,
            name: this.createName,
            busy: this.busy,
            onSlugInput: (value) => {
              this.createSlug = value;
            },
            onNameInput: (value) => {
              this.createName = value;
            },
            onSubmit: () => void this.createDepartment(),
          }),
        }),
        selected
          ? renderSettingsRow({
              title: t("ixAuth.departments.renameTitle"),
              stacked: true,
              control: renderDepartmentRenameForm({
                name: this.renameDraft,
                busy: this.busy,
                onNameInput: (value) => {
                  this.renameDraft = value;
                },
                onSubmit: () => void this.renameDepartment(),
              }),
            })
          : nothing,
        selected
          ? renderSettingsRow({
              title: t("ixAuth.departments.deleteTitle"),
              stacked: true,
              control: renderDepartmentDeleteForm({
                department: selected,
                armed: this.deleteArmedSlug === (selected.slug ?? selected.code),
                busy: this.busy,
                onArm: () => {
                  this.deleteArmedSlug = selected.slug ?? selected.code;
                },
                onCancel: () => {
                  this.deleteArmedSlug = undefined;
                },
                onConfirm: () => void this.deleteDepartment(),
              }),
            })
          : nothing,
        this.directory && this.directory.orphans.length > 0
          ? renderSettingsRow({
              title: t("ixAuth.departments.orphanTitle"),
              stacked: true,
              control: renderOrphanDepartments(this.directory.orphans),
            })
          : nothing,
      ],
    );
  }

  private renderMembersSection(): TemplateResult | typeof nothing {
    const department = this.selectedDepartment();
    if (!department) {
      return nothing;
    }
    return renderSettingsSection(
      {
        title: t("ixAuth.departments.membersTitle", { name: department.name }),
        description: t("ixAuth.departments.membersDescription"),
      },
      [
        renderSettingsRow({
          title: "",
          stacked: true,
          control: renderDepartmentMembersPanel({
            members: this.members,
            total: this.membersTotal,
            query: this.searchQuery,
            results: this.searchResults,
            searched: this.searched,
            busy: this.busy,
            loading: this.membersLoading,
            failed: this.membersFailed,
            onRetry: () => void this.loadMembers(),
            onQueryInput: (value) => {
              this.searchGeneration += 1;
              this.searchQuery = value;
              this.searchResults = [];
              this.searched = false;
            },
            onSearch: () => void this.searchAccounts(),
            onAdd: (user) => void this.changeMembership(user, true),
            onRemove: (user) => void this.changeMembership(user, false),
          }),
        }),
      ],
    );
  }

  private renderAgentsSection(): TemplateResult {
    const agent = this.agents.find((entry) => entry.agentId === this.selectedAgentId);
    return renderSettingsSection(
      {
        title: t("ixAuth.departments.agentsTitle"),
        description: t("ixAuth.departments.agentsDescription"),
      },
      [
        renderSettingsRow({
          title: "",
          stacked: true,
          control: renderDepartmentAgentsTable({
            agents: this.agents,
            departments: this.directory?.departments ?? [],
            ...(this.selectedAgentId ? { selectedAgentId: this.selectedAgentId } : {}),
            busy: this.busy,
            onSelect: (agentId) => void this.openAgent(agentId),
            onBind: (agentId, department) => void this.bindAgent(agentId, department),
          }),
        }),
        agent
          ? renderSettingsRow({
              title: t("ixAuth.departments.accessTitle", {
                agent: agent.name ?? agent.agentId,
              }),
              description: t("ixAuth.departments.accessDescription"),
              stacked: true,
              control: renderDepartmentAccessPanel({
                draft: this.accessDraft,
                listing: this.folders,
                busy: this.busy || !this.folders,
                failed: this.foldersFailed,
                onRetry: () => void this.openFolder(""),
                onOpenFolder: (path) => void this.openFolder(path),
                onChooseFolder: (absolutePath) => {
                  this.accessDraft = {
                    ...this.accessDraft,
                    workspace: absolutePath,
                    workspaceIsShared: this.isSharedWorkspace(absolutePath, this.folders),
                  };
                },
                onToggleReadonlyTools: (value) => {
                  this.accessDraft = { ...this.accessDraft, readonlyTools: value };
                },
                onToggleReadonlySessions: (value) => {
                  this.accessDraft = { ...this.accessDraft, readonlySessions: value };
                },
                onIndexInput: (value) => {
                  this.accessDraft = { ...this.accessDraft, indexText: value };
                },
                onSave: () => void this.saveAccess(),
              }),
            })
          : nothing,
      ],
    );
  }

  override render() {
    const header = html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("departments")}</div>
          <div class="page-subtitle">${subtitleForRoute("departments")}</div>
        </div>
      </section>
    `;
    if (!canManageIxAuthDepartments()) {
      return html`
        ${header}
        ${renderSettingsWorkspace(
          renderSettingsPage([
            renderSettingsSection({ title: t("ixAuth.departments.title") }, [
              renderSettingsRow({ title: t("ixAuth.departments.forbidden") }),
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
                    ${t(`ixAuth.error.${this.errorKey}`)}
                  </div>`,
                }),
              ])
            : nothing,
          this.notice
            ? renderSettingsSection({}, [
                renderSettingsRow({
                  title: "",
                  control: html`<div class="departments-notice" role="status">${this.notice}</div>`,
                }),
              ])
            : nothing,
          this.renderDepartmentsSection(),
          this.renderMembersSection(),
          this.renderAgentsSection(),
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-departments-page")) {
  customElements.define("openclaw-departments-page", DepartmentsPage);
}
