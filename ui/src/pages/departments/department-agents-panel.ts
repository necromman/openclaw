// The agent table: which department each agent belongs to, and what it can reach.
//
// The department cell is a select rather than a link to another screen, because binding
// is the one edit an operator makes over and over while a deployment is being set up, and
// making it a two-page trip would mean losing the row you were looking at.
//
// An agent bound to no department is shown as shared on purpose. That is a real state
// with a real meaning (everyone who signs in reaches it), not a missing value, and the
// screen that sets the fence has to name it.
import { html, type TemplateResult } from "lit";
import type { DepartmentAgent } from "../../../../packages/gateway-protocol/src/schema/departments.js";
import type { IxAuthDepartmentOption } from "../../features/ix-auth/ix-auth-admin-api.ts";
import { t } from "../../i18n/index.ts";

function renderAccessBadges(agent: DepartmentAgent): TemplateResult {
  const badges: string[] = [];
  if (agent.toolsProfile) {
    badges.push(agent.toolsProfile);
  }
  if (agent.permissionMode) {
    badges.push(agent.permissionMode);
  }
  return badges.length === 0
    ? html`<span class="muted">${t("ixAuth.departments.unset")}</span>`
    : html`${badges.map((badge) => html`<span class="departments-badge">${badge}</span>`)}`;
}

function renderRow(params: {
  agent: DepartmentAgent;
  departments: readonly IxAuthDepartmentOption[];
  selected: boolean;
  busy: boolean;
  onSelect: (agentId: string) => void;
  onBind: (agentId: string, department: string) => void;
}): TemplateResult {
  const { agent } = params;
  return html`
    <tr class="departments-table__row" aria-selected=${params.selected ? "true" : "false"}>
      <td>
        <button class="departments-table__select" @click=${() => params.onSelect(agent.agentId)}>
          ${agent.name ?? agent.agentId}
        </button>
      </td>
      <td>
        <select
          class="settings-select"
          ?disabled=${params.busy}
          .value=${agent.department ?? ""}
          @change=${(event: Event) =>
            // SAFETY: the listener is bound to this select element.
            params.onBind(agent.agentId, (event.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${!agent.department}>
            ${t("ixAuth.departments.shared")}
          </option>
          ${params.departments.map((department) => {
            const slug = department.slug ?? "";
            return html`<option value=${slug} ?selected=${slug === agent.department}>
              ${department.name}
            </option>`;
          })}
        </select>
      </td>
      <td class="departments-table__muted">
        ${agent.workspace ?? html`<span class="muted">${t("ixAuth.departments.unset")}</span>`}
      </td>
      <td>${renderAccessBadges(agent)}</td>
      <td class="departments-table__muted">
        ${
          agent.indexPaths.length === 0
            ? html`<span class="muted">${t("ixAuth.departments.none")}</span>`
            : html`${agent.indexPaths.join(", ")}`
        }
      </td>
    </tr>
  `;
}

/** Draw the agent table. */
export function renderDepartmentAgentsTable(params: {
  agents: readonly DepartmentAgent[];
  departments: readonly IxAuthDepartmentOption[];
  selectedAgentId?: string;
  busy: boolean;
  onSelect: (agentId: string) => void;
  onBind: (agentId: string, department: string) => void;
}): TemplateResult {
  return html`
    <div class="departments-table-scroll">
      <table class="departments-table">
        <thead>
          <tr>
            <th>${t("ixAuth.departments.agentColumn")}</th>
            <th>${t("ixAuth.departments.departmentColumn")}</th>
            <th>${t("ixAuth.departments.workspaceColumn")}</th>
            <th>${t("ixAuth.departments.accessColumn")}</th>
            <th>${t("ixAuth.departments.indexColumn")}</th>
          </tr>
        </thead>
        <tbody>
          ${params.agents.map((agent) =>
            renderRow({
              agent,
              departments: params.departments,
              selected: agent.agentId === params.selectedAgentId,
              busy: params.busy,
              onSelect: params.onSelect,
              onBind: params.onBind,
            }),
          )}
        </tbody>
      </table>
    </div>
  `;
}
