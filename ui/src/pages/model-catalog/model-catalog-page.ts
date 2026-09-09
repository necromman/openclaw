// The model screen an administrator gets.
//
// Settings > Models (the upstream provider screen) writes the configuration through
// `config.set`, which needs `operator.admin`, so on this delivery only a system
// administrator can open it. Choosing which model answers is not a system-administration
// job though: it is the same running-the-company job as accounts and departments, and it
// was the one part of that job that still meant editing a JSON file on the NAS.
//
// This screen does that one job and nothing else. It reads the catalog and the credential
// health with the ordinary methods an administrator already holds `operator.read` for,
// and it writes through `/auth/admin/models`, which accepts four named fields and
// refuses everything else. Adding a credential is deliberately absent: this screen
// reports what is authenticated and says where to go when nothing is.
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
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
import { canManageIxAuthUsers } from "../../features/ix-auth/ix-auth-admin-access.ts";
import {
  fetchIxAuthModelPolicy,
  isIxAuthModelsFailure,
  saveIxAuthModelPolicy,
  type IxAuthModelPolicy,
} from "../../features/ix-auth/ix-auth-models-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import {
  allowlistCovers,
  buildProviderGroups,
  selectableModelRefs,
  toggleAllowedModel,
  toggleProviderAll,
  type ModelAuthSourceProvider,
  type ModelCatalogProviderGroup,
  type ModelCatalogSourceEntry,
} from "./model-catalog-policy.ts";

registerIxAuthEnglish();

const EMPTY_POLICY: IxAuthModelPolicy = {
  primary: "",
  fallbacks: [],
  allow: [],
  utilityModel: "",
};

export class ModelCatalogPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;

  /** What the Gateway last confirmed. The baseline the save button compares against. */
  @state() private saved: IxAuthModelPolicy = EMPTY_POLICY;
  /** What the screen is holding, unsaved. */
  @state() private draft: IxAuthModelPolicy = EMPTY_POLICY;
  @state() private catalog: ModelCatalogSourceEntry[] = [];
  @state() private auth: ModelAuthSourceProvider[] = [];
  @state() private loading = false;
  @state() private busy = false;
  @state() private errorKey: string | undefined;
  @state() private noticeKey: string | undefined;

  private client: GatewayBrowserClient | null = null;
  private stopGateway: (() => void) | undefined;
  private connected = false;
  private catalogRequested = false;

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
    void this.loadPolicy();
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
    if (this.connected && (clientChanged || !this.catalogRequested)) {
      this.catalogRequested = true;
      void this.loadCatalog();
    }
  }

  private async loadPolicy(): Promise<void> {
    if (!canManageIxAuthUsers()) {
      return;
    }
    this.loading = true;
    const policy = await fetchIxAuthModelPolicy(this.basePath);
    this.loading = false;
    if (isIxAuthModelsFailure(policy)) {
      this.errorKey = policy.errorKey;
      return;
    }
    this.errorKey = undefined;
    const next: IxAuthModelPolicy = {
      primary: policy.primary,
      fallbacks: [...policy.fallbacks],
      allow: [...policy.allow],
      utilityModel: policy.utilityModel,
    };
    this.saved = next;
    this.draft = { ...next, fallbacks: [...next.fallbacks], allow: [...next.allow] };
  }

  /**
   * Read the whole catalog and the credential health.
   *
   * The full view is asked for on purpose: an allowlist that hides a model must still be
   * able to offer it back, and a screen that could only see what is already allowed could
   * never widen anything.
   */
  private async loadCatalog(): Promise<void> {
    const client = this.client;
    if (!client || !this.connected || !canManageIxAuthUsers()) {
      return;
    }
    // `models.list` resolves its catalog per agent and refuses the call outright when no
    // agent can be named, which on an explicit-ownership roster is what an omitted
    // `agentId` means. Asking the roster first is what keeps the screen from showing an
    // empty catalog that looks like "this provider answers nothing".
    let agentId: string | undefined;
    try {
      const roster = await client.request<{ agents?: { id?: string }[] }>("agents.list", {});
      agentId = roster.agents?.find((agent) => typeof agent.id === "string")?.id;
    } catch {
      agentId = undefined;
    }
    // Settled rather than all: the catalog and the credential health answer different
    // questions, and one of them failing must not blank the other.
    const [models, auth] = await Promise.allSettled([
      client.request<{ models?: ModelCatalogSourceEntry[] }>("models.list", {
        view: "all",
        ...(agentId ? { agentId } : {}),
      }),
      client.request<{ providers?: ModelAuthSourceProvider[] }>("models.authStatus", {}),
    ]);
    this.catalog = models.status === "fulfilled" ? (models.value.models ?? []) : [];
    this.auth = auth.status === "fulfilled" ? (auth.value.providers ?? []) : [];
  }

  private get groups(): ModelCatalogProviderGroup[] {
    return buildProviderGroups({
      catalog: this.catalog,
      auth: this.auth,
      allow: this.draft.allow,
      pinned: [this.draft.primary, ...this.draft.fallbacks].filter((ref) => ref.length > 0),
    });
  }

  private get dirty(): boolean {
    return JSON.stringify(this.draft) !== JSON.stringify(this.saved);
  }

  private patchDraft(patch: Partial<IxAuthModelPolicy>): void {
    this.draft = { ...this.draft, ...patch };
    this.noticeKey = undefined;
  }

  private async save(): Promise<void> {
    this.busy = true;
    const result = await saveIxAuthModelPolicy({ basePath: this.basePath, policy: this.draft });
    this.busy = false;
    if (isIxAuthModelsFailure(result)) {
      this.errorKey = result.errorKey;
      return;
    }
    this.errorKey = undefined;
    const stored: IxAuthModelPolicy = {
      primary: result.primary,
      fallbacks: [...result.fallbacks],
      allow: [...result.allow],
      utilityModel: result.utilityModel,
    };
    this.saved = stored;
    this.draft = { ...stored, fallbacks: [...stored.fallbacks], allow: [...stored.allow] };
    this.noticeKey = result.persisted ? "saved" : "savedNotPersisted";
  }

  private renderModelRow(group: ModelCatalogProviderGroup): TemplateResult {
    if (group.models.length === 0) {
      return renderSettingsRow({ title: t("ixAuth.models.noModels") });
    }
    return renderSettingsRow({
      title: t("ixAuth.models.allowedModels"),
      description: t("ixAuth.models.allowedModelsHelp"),
      stacked: true,
      control: html`
        <div class="model-catalog-models">
          ${group.models.map(
            (model) => html`
              <label class="model-catalog-model">
                <input
                  type="checkbox"
                  .checked=${group.allowAll || model.allowed}
                  ?disabled=${group.allowAll || this.busy}
                  @change=${() => this.patchDraft({ allow: toggleAllowedModel(this.draft.allow, model.ref) })}
                />
                <span>${model.name}</span>
                <code>${model.ref}</code>
              </label>
            `,
          )}
        </div>
      `,
    });
  }

  private renderProviderSection(group: ModelCatalogProviderGroup): TemplateResult {
    return renderSettingsSection(
      {
        title: group.displayName,
        description: group.authenticated
          ? t("ixAuth.models.authenticated")
          : t("ixAuth.models.notAuthenticated"),
      },
      [
        renderSettingsRow({
          title: t("ixAuth.models.allowAll"),
          description: t("ixAuth.models.allowAllHelp"),
          control: html`
            <input
              type="checkbox"
              .checked=${group.allowAll}
              ?disabled=${this.busy}
              @change=${() =>
                this.patchDraft({ allow: toggleProviderAll(this.draft.allow, group.provider) })}
            />
          `,
        }),
        this.renderModelRow(group),
      ],
    );
  }

  private renderDefaultsSection(): TemplateResult {
    const selectable = selectableModelRefs({ groups: this.groups, allow: this.draft.allow });
    const options = (current: string) =>
      [...new Set([current, ...selectable])].filter((ref) => ref.length > 0);
    return renderSettingsSection(
      {
        title: t("ixAuth.models.defaultsTitle"),
        description: t("ixAuth.models.defaultsHelp"),
      },
      [
        renderSettingsRow({
          title: t("ixAuth.models.primary"),
          control: html`
            <select
              ?disabled=${this.busy}
              @change=${(event: Event) =>
                this.patchDraft({ primary: (event.target as HTMLSelectElement).value })}
            >
              <option value="" ?selected=${this.draft.primary === ""}>
                ${t("ixAuth.models.unset")}
              </option>
              ${options(this.draft.primary).map(
                (ref) =>
                  html`<option value=${ref} ?selected=${ref === this.draft.primary}>
                    ${ref}
                  </option>`,
              )}
            </select>
          `,
        }),
        renderSettingsRow({
          title: t("ixAuth.models.fallbacks"),
          description: t("ixAuth.models.fallbacksHelp"),
          stacked: true,
          control: html`
            <div class="model-catalog-fallbacks">
              ${this.draft.fallbacks.map(
                (ref) => html`
                  <span class="model-catalog-chip">
                    <code>${ref}</code>
                    <button
                      type="button"
                      ?disabled=${this.busy}
                      @click=${() =>
                        this.patchDraft({
                          fallbacks: this.draft.fallbacks.filter((entry) => entry !== ref),
                        })}
                    >
                      ${t("ixAuth.models.remove")}
                    </button>
                  </span>
                `,
              )}
              <select
                ?disabled=${this.busy}
                .value=${""}
                @change=${(event: Event) => {
                  const select = event.target as HTMLSelectElement;
                  const ref = select.value;
                  select.value = "";
                  if (ref && !this.draft.fallbacks.includes(ref)) {
                    this.patchDraft({ fallbacks: [...this.draft.fallbacks, ref] });
                  }
                }}
              >
                <option value="">${t("ixAuth.models.addFallback")}</option>
                ${selectable
                  .filter(
                    (ref) => ref !== this.draft.primary && !this.draft.fallbacks.includes(ref),
                  )
                  .map((ref) => html`<option value=${ref}>${ref}</option>`)}
              </select>
            </div>
          `,
        }),
      ],
    );
  }

  private renderStatusSection(): TemplateResult {
    const hiddenPrimary =
      this.draft.primary.length > 0 && !allowlistCovers(this.draft.allow, this.draft.primary);
    return renderSettingsSection(
      {
        title: t("ixAuth.models.title"),
        description:
          this.draft.allow.length === 0
            ? t("ixAuth.models.unrestricted")
            : t("ixAuth.models.restricted", { count: String(this.draft.allow.length) }),
      },
      [
        this.errorKey
          ? renderSettingsRow({
              title: "",
              control: html`<div class="callout danger" role="alert">
                ${t(`ixAuth.error.${this.errorKey}`)}
              </div>`,
            })
          : nothing,
        this.noticeKey
          ? renderSettingsRow({
              title: "",
              control: html`<div role="status">${t(`ixAuth.models.${this.noticeKey}`)}</div>`,
            })
          : nothing,
        hiddenPrimary
          ? renderSettingsRow({
              title: "",
              control: html`<div class="callout danger" role="alert">
                ${t("ixAuth.models.primaryHidden")}
              </div>`,
            })
          : nothing,
        renderSettingsRow({
          title: t("ixAuth.models.saveTitle"),
          description: t("ixAuth.models.saveHelp"),
          control: html`
            <button
              type="button"
              class="primary"
              ?disabled=${this.busy || this.loading || !this.dirty || hiddenPrimary}
              @click=${() => void this.save()}
            >
              ${t("ixAuth.models.save")}
            </button>
          `,
        }),
      ],
    );
  }

  override render() {
    const header = html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("model-catalog")}</div>
          <div class="page-subtitle">${subtitleForRoute("model-catalog")}</div>
        </div>
      </section>
    `;
    if (!canManageIxAuthUsers()) {
      return html`
        ${header}
        ${renderSettingsWorkspace(
          renderSettingsPage([
            renderSettingsSection({ title: t("ixAuth.models.title") }, [
              renderSettingsRow({ title: t("ixAuth.models.forbidden") }),
            ]),
          ]),
        )}
      `;
    }
    return html`
      ${header}
      ${renderSettingsWorkspace(
        renderSettingsPage([
          this.renderStatusSection(),
          this.renderDefaultsSection(),
          ...this.groups.map((group) => this.renderProviderSection(group)),
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-model-catalog-page")) {
  customElements.define("openclaw-model-catalog-page", ModelCatalogPage);
}
