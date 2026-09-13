import { nothing } from "lit";
import type {
  DepartmentAgent,
  DepartmentsFoldersListResult,
} from "../../../../packages/gateway-protocol/src/schema/departments.js";
import { renderSettingsRow, renderSettingsSection } from "../../components/settings-ui.ts";
import type { IxAuthDepartmentOption } from "../../features/ix-auth/ix-auth-admin-api.ts";
import { t } from "../../i18n/index.ts";
import {
  renderDepartmentAccessPanel,
  type DepartmentAccessDraftView,
} from "./department-access-panel.ts";
import { renderDepartmentAgentsTable } from "./department-agents-panel.ts";

export function isSharedDepartmentWorkspace(
  workspace: string,
  listing: DepartmentsFoldersListResult | undefined,
): boolean {
  const root = listing?.root;
  return Boolean(root && (workspace === root || workspace.startsWith(`${root}/`)));
}

export function isDepartmentAgentDraftDirty(
  agent: DepartmentAgent | undefined,
  draft: DepartmentAccessDraftView,
): boolean {
  return Boolean(
    agent &&
    (draft.workspace.trim() !== (agent.workspace ?? "") ||
      draft.readonlyTools !== (agent.toolsProfile === "readonly") ||
      draft.readonlySessions !== (agent.permissionMode === "read-only") ||
      draft.indexText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n") !== agent.indexPaths.join("\n")),
  );
}

export function renderDepartmentAgentManagement(params: {
  agents: readonly DepartmentAgent[];
  departments: readonly IxAuthDepartmentOption[];
  selectedAgentId?: string;
  draft: DepartmentAccessDraftView;
  listing: DepartmentsFoldersListResult | undefined;
  busy: boolean;
  failed: boolean;
  onSelect: (agentId: string) => void;
  onBind: (agentId: string, department: string) => void;
  onOpenFolder: (path: string) => void;
  onChooseFolder: (path: string) => void;
  onToggleReadonlyTools: (value: boolean) => void;
  onToggleReadonlySessions: (value: boolean) => void;
  onIndexInput: (value: string) => void;
  onSave: () => void;
}) {
  const agent = params.agents.find((entry) => entry.agentId === params.selectedAgentId);
  const dirty = isDepartmentAgentDraftDirty(agent, params.draft);
  return renderSettingsSection(
    {
      title: t("ixAuth.departments.agentsTitle"),
      description: dirty
        ? `${t("ixAuth.departments.agentsDescription")} ${t("ixAuth.departments.agentDraftHint")}`
        : t("ixAuth.departments.agentsDescription"),
    },
    [
      renderSettingsRow({
        title: "",
        stacked: true,
        control: renderDepartmentAgentsTable({ ...params, busy: params.busy || dirty }),
      }),
      agent
        ? renderSettingsRow({
            title: t("ixAuth.departments.accessTitle", { agent: agent.name ?? agent.agentId }),
            description: t("ixAuth.departments.accessDescription"),
            stacked: true,
            control: renderDepartmentAccessPanel({
              ...params,
              busy: params.busy || !params.listing,
              onRetry: () => params.onOpenFolder(""),
            }),
          })
        : nothing,
    ],
  );
}
