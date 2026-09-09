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
  expandProviderWildcards,
  hasExpandableWildcard,
  pruneFallbacks,
  selectableModelRefs,
  setProviderAllowed,
  toggleAllowedModel,
  type ModelAuthSourceProvider,
  type ModelCatalogProviderGroup,
  type ModelCatalogRow,
  type ModelCatalogSourceEntry,
} from "./model-catalog-policy.ts";
import { renderModelCatalogProviderSection } from "./model-catalog-providers.ts";

registerIxAuthEnglish();

/** How many times the screen asks for a catalog before accepting an empty one. */
const CATALOG_LOAD_ATTEMPTS = 3;
/** Gap between those attempts. Long enough for a provider resolve, short enough to sit through. */
const CATALOG_RETRY_DELAY_MS = 1_000;

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
  /** True once a saved `provider/*` was expanded into the models behind it. */
  @state() private wildcardExpanded = false;

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
      void this.loadCatalogWithRetry();
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
    this.expandStoredWildcards();
  }

  /**
   * Read the whole catalog and the credential health.
   *
   * The full view is asked for on purpose: an allowlist that hides a model must still be
   * able to offer it back, and a screen that could only see what is already allowed could
   * never widen anything.
   *
   * Answers whether a catalog arrived, so the caller can ask again.
   */
  private async loadCatalog(): Promise<boolean> {
    const client = this.client;
    if (!client || !this.connected || !canManageIxAuthUsers()) {
      return false;
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
    this.expandStoredWildcards();
    return this.catalog.length > 0;
  }

  /**
   * Ask again for a little while when the catalog comes back empty.
   *
   * The Gateway answers `models.list` before its providers have finished resolving, which
   * on a machine that has just restarted is the first thing this screen meets: the socket
   * says connected, the call succeeds, and the answer is an empty catalog. Without a
   * second attempt that empty answer is final for the life of the page, and the screen
   * shows only the models the policy already names, which reads as "this deployment has
   * two models" rather than "ask again in a second".
   *
   * Three tries a second apart, then stop. A catalog that is genuinely empty is a
   * different problem and saying so once is enough.
   */
  private async loadCatalogWithRetry(): Promise<void> {
    for (let attempt = 0; attempt < CATALOG_LOAD_ATTEMPTS; attempt += 1) {
      if (await this.loadCatalog()) {
        return;
      }
      if (!this.connected) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, CATALOG_RETRY_DELAY_MS));
    }
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

  /**
   * Write a new allowlist and let the fallback chain follow it.
   *
   * A fallback that is no longer offered is dropped here rather than reported: the chain
   * is an order, and a person who switches a model off can see the order lose one place.
   * The primary is left alone on purpose, because the screen refuses to save while it is
   * hidden and a replacement has to be chosen by somebody.
   */
  private applyAllow(allow: string[]): void {
    this.patchDraft({
      allow,
      fallbacks: pruneFallbacks({ allow, fallbacks: this.draft.fallbacks }),
    });
  }

  /**
   * Turn a saved `provider/*` into the models it stood for.
   *
   * Older saves and hand-edited configurations still carry one. The screen shows those
   * models switched on, and because the draft now names them, the next save replaces the
   * wildcard with the list. That is the point: a wildcard in the configuration makes the
   * chat model picker probe the whole provider the first time it opens, about fifteen
   * seconds on the delivery (DEPLOY.md 3.4).
   *
   * Called after both loads because either can finish first, and it does nothing once
   * there is no wildcard left with a catalog behind it.
   */
  private expandStoredWildcards(): void {
    const groups = this.groups;
    if (!hasExpandableWildcard(groups)) {
      return;
    }
    this.wildcardExpanded = true;
    this.draft = {
      ...this.draft,
      allow: expandProviderWildcards({ allow: this.draft.allow, groups }),
    };
  }

  private toggleModel(model: ModelCatalogRow): void {
    this.applyAllow(toggleAllowedModel(this.draft.allow, model.ref));
  }

  private toggleProvider(group: ModelCatalogProviderGroup, allowed: boolean): void {
    this.applyAllow(setProviderAllowed({ allow: this.draft.allow, group, allowed }));
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
    // Whatever was stored is now an explicit list, so the expansion notice has nothing
    // left to warn about.
    this.wildcardExpanded = false;
    this.noticeKey = result.persisted ? "saved" : "savedNotPersisted";
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
        this.wildcardExpanded
          ? renderSettingsRow({
              title: "",
              control: html`<div class="callout" role="status">
                ${t("ixAuth.models.wildcardExpanded")}
              </div>`,
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
          ...this.groups.map((group) =>
            renderModelCatalogProviderSection({
              group,
              callbacks: {
                busy: this.busy,
                onToggleModel: (model) => this.toggleModel(model),
                onToggleProvider: (target, allowed) => this.toggleProvider(target, allowed),
              },
            }),
          ),
        ]),
      )}
    `;
  }
}

if (!customElements.get("openclaw-model-catalog-page")) {
  customElements.define("openclaw-model-catalog-page", ModelCatalogPage);
}
