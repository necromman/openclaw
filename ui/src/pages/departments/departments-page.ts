// The department screen.
//
// Three questions in one place, in the order an operator asks them: which departments
// exist, who is in them, and which agent (and which folder) each department reaches. They
// share a screen because they are one decision: a department that nobody is in and no
// agent serves is not yet a department.
//
// No permission decision is made in this file. The Gateway refuses every route and method
// behind it for anyone but a system administrator; the page only decides what is worth
// drawing, and says so plainly when the answer is nothing.
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
  fetchDepartmentAgents,
  fetchDepartmentFolders,
  saveDepartmentAgentAccess,
} from "./departments-gateway.ts";
import {
  renderDepartmentCreateForm,
  renderDepartmentRenameForm,
  renderDepartmentsTable,
  renderOrphanDepartments,
} from "./departments-table.ts";

registerIxAuthEnglish();

/** Accounts fetched per member or search listing. One screenful for one department. */
const DEPARTMENT_MEMBER_PAGE_SIZE = 100;

/**
 * One failure test for both clients on this page.
 *
 * It matches on `kind: "failed"` rather than on the presence of `kind`, because the user
 * routes answer success as `{ kind: "ok" }` and a presence test would read every
 * successful membership change as an error with no message.
 */
function isFailure(value: unknown): value is { kind: "failed"; errorKey: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    // SAFETY: the null and typeof guard directly above proves this is an object.
    (value as { kind?: unknown }).kind === "failed"
  );
}

export class DepartmentsPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;

  @state() private directory: IxAuthDepartmentDirectory | undefined;
  @state() private agents: DepartmentAgent[] = [];
  @state() private selectedSlug: string | undefined;
  @state() private selectedAgentId: string | undefined;
  @state() private members: IxAuthManagedUser[] = [];
  @state() private searchQuery = "";
  @state() private searchResults: IxAuthManagedUser[] = [];
  @state() private searched = false;
  @state() private createSlug = "";
  @state() private createName = "";
  @state() private renameDraft = "";
  @state() private folders: DepartmentsFoldersListResult | undefined;
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
    if (isFailure(directory)) {
      this.errorKey = directory.errorKey;
      return;
    }
    this.errorKey = undefined;
    this.directory = directory;
    if (this.selectedSlug) {
      await this.loadMembers();
    }
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
    const department = this.selectedDepartment();
    if (!department) {
      this.members = [];
      return;
    }
    const page = await fetchIxAuthUsers({
      basePath: this.basePath,
      department: department.code,
      size: DEPARTMENT_MEMBER_PAGE_SIZE,
    });
    if (isIxAuthUsersFailure(page)) {
      this.errorKey = page.errorKey;
      return;
    }
    this.members = page.users;
  }

  private async selectDepartment(slug: string): Promise<void> {
    this.selectedSlug = slug;
    this.notice = undefined;
    this.searched = false;
    this.searchResults = [];
    this.renameDraft = this.selectedDepartment()?.name ?? "";
    await this.loadMembers();
  }

  /**
   * Run one mutation, then refresh what it could have changed.
   *
   * Two failure shapes arrive here. The HTTP clients answer with a failure object, and
   * the Gateway methods reject; both end as one message rather than as a silent no-op,
   * because a button that does nothing and says nothing is the worst outcome on a screen
   * that changes who can reach what.
   */
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
    this.busy = false;
    if (isFailure(result)) {
      this.errorKey = result.errorKey;
      return;
    }
    await this.loadDirectory();
    await this.loadAgents();
  }

  private async createDepartment(): Promise<void> {
    await this.mutate(async () => {
      const created = await createIxAuthDepartment({
        basePath: this.basePath,
        slug: this.createSlug.trim(),
        name: this.createName.trim(),
      });
      if (!isFailure(created)) {
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
      if (!isFailure(renamed)) {
        this.notice = t("ixAuth.departments.renamed");
      }
      return renamed;
    });
  }

  private async searchAccounts(): Promise<void> {
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
    this.searched = true;
    if (isIxAuthUsersFailure(page)) {
      this.errorKey = page.errorKey;
      this.searchResults = [];
      return;
    }
    this.searchResults = page.users;
  }

  /** Add or remove one code from one account's whole department set. */
  private async changeMembership(user: IxAuthManagedUser, join: boolean): Promise<void> {
    const department = this.selectedDepartment();
    if (!department) {
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
        this.notice = t(
          join ? "ixAuth.departments.memberAdded" : "ixAuth.departments.memberRemoved",
          { email: user.email, name: department.name },
        );
        await this.loadMembers();
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
    if (!agent) {
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
    if (!client) {
      return;
    }
    try {
      const listing = await fetchDepartmentFolders({ client, path });
      this.folders = listing;
      this.accessDraft = {
        ...this.accessDraft,
        workspaceIsShared: this.isSharedWorkspace(this.accessDraft.workspace, listing),
      };
    } catch {
      this.folders = undefined;
    }
  }

  private isSharedWorkspace(
    workspace: string,
    listing: DepartmentsFoldersListResult | undefined,
  ): boolean {
    const root = listing?.root;
    return Boolean(root && workspace.length > 0 && workspace.startsWith(root));
  }

  private async saveAccess(): Promise<void> {
    const client = this.client;
    const agentId = this.selectedAgentId;
    if (!client || !agentId) {
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
            ...(this.selectedSlug ? { selectedSlug: this.selectedSlug } : {}),
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
            query: this.searchQuery,
            results: this.searchResults,
            searched: this.searched,
            busy: this.busy,
            onQueryInput: (value) => {
              this.searchQuery = value;
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
                busy: this.busy,
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
                  control: html`<div class="departments-notice" role="status">
                    ${this.notice}
                  </div>`,
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
