// The activity ledger screen.
//
// It answers the question the delivery contract puts in writing: who asked what, and
// which materials did they see. One table, filtered by person, kind and date, with the
// full record behind each row and a CSV button for the times a spreadsheet is the answer.
//
// No permission decision is made in this file. The Gateway refuses the query for anyone
// but a superadmin or admin, and narrows an administrator's page to their own
// departments; the page only decides what is worth drawing.
import "../../styles/audit.css";
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import type {
  AuditUserActivityEvent,
  AuditUserActivityListResult,
} from "../../../../packages/gateway-protocol/src/schema/audit-user-activity.js";
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
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import {
  AUDIT_ACTIVITY_KIND_OPTIONS,
  auditExportSearch,
  auditFilterQuery,
  auditKindLabel,
  auditRowPerson,
  auditRowRole,
  auditRowSummary,
  EMPTY_AUDIT_ACTIVITY_FILTERS,
  type AuditActivityFilters,
} from "./audit-rows.ts";

registerIxAuthEnglish();

/** Rows per page. One screenful before the operator decides to keep reading. */
const AUDIT_PAGE_SIZE = 50;

export class AuditPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  context!: ApplicationContext<RouteId>;

  @state() private events: AuditUserActivityEvent[] = [];
  @state() private filters: AuditActivityFilters = { ...EMPTY_AUDIT_ACTIVITY_FILTERS };
  @state() private loading = false;
  @state() private connected = false;
  @state() private forbidden = false;
  @state() private failed = false;
  @state() private expanded: number | null = null;
  @state() private cursors: string[] = [];

  private client: GatewayBrowserClient | null = null;
  private stopGateway: (() => void) | undefined;
  private generation = 0;

  private get basePath(): string {
    return this.context?.basePath ?? "";
  }

  override connectedCallback() {
    // The host supplies a shellless loading fallback. Remove that unowned
    // light-DOM markup before Lit claims the root.
    this.replaceChildren();
    super.connectedCallback();
    this.stopGateway = this.context.gateway.subscribe((snapshot) =>
      this.applyGatewaySnapshot(snapshot),
    );
    this.applyGatewaySnapshot(this.context.gateway.snapshot);
  }

  override disconnectedCallback() {
    this.stopGateway?.();
    this.stopGateway = undefined;
    this.generation += 1;
    this.client = null;
    this.connected = false;
    super.disconnectedCallback();
  }

  private applyGatewaySnapshot(snapshot: ApplicationGatewaySnapshot) {
    const clientChanged = snapshot.client !== this.client;
    this.client = snapshot.client;
    this.connected = snapshot.phase === "connected";
    if (this.connected && (clientChanged || this.events.length === 0)) {
      void this.load();
    }
  }

  private async load(cursor?: string) {
    const client = this.client;
    if (!client || !this.connected) {
      return;
    }
    const generation = ++this.generation;
    this.loading = true;
    this.failed = false;
    try {
      const result = await client.request<AuditUserActivityListResult>("audit.userActivity.list", {
        limit: AUDIT_PAGE_SIZE,
        ...auditFilterQuery(this.filters),
        ...(cursor ? { cursor } : {}),
      });
      if (generation !== this.generation) {
        return;
      }
      this.forbidden = false;
      this.events = result.events;
      this.expanded = null;
      this.cursors = result.nextCursor ? [result.nextCursor] : [];
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      // The Gateway answers FORBIDDEN for an account that may read nothing. Anything
      // else is a fault, and saying so is better than an empty table that looks like
      // "nobody did anything".
      this.forbidden = String(error).includes("FORBIDDEN");
      this.failed = !this.forbidden;
      this.events = [];
    } finally {
      if (generation === this.generation) {
        this.loading = false;
      }
    }
  }

  private updateFilter(patch: Partial<AuditActivityFilters>) {
    this.filters = { ...this.filters, ...patch };
    void this.load();
  }

  private renderToolbar(): TemplateResult {
    return html`
      <div class="audit-toolbar">
        <label class="audit-toolbar__field audit-toolbar__field--grow">
          <span class="audit-toolbar__label">${t("ixAuth.audit.filterPerson")}</span>
          <input
            type="search"
            .value=${this.filters.person}
            placeholder=${t("ixAuth.audit.filterPersonPlaceholder")}
            @change=${(event: Event) =>
              // SAFETY: the listener is bound to this input element.
              this.updateFilter({ person: (event.target as HTMLInputElement).value })}
          />
        </label>
        <label class="audit-toolbar__field">
          <span class="audit-toolbar__label">${t("ixAuth.audit.filterKind")}</span>
          <select
            .value=${this.filters.kind}
            @change=${(event: Event) =>
              this.updateFilter({
                // SAFETY: bound to this select, whose options are the kind union plus "".
                kind: (event.target as HTMLSelectElement).value as AuditActivityFilters["kind"],
              })}
          >
            <option value="">${t("ixAuth.audit.filterKindAll")}</option>
            ${AUDIT_ACTIVITY_KIND_OPTIONS.map(
              (kind) => html`<option value=${kind}>${auditKindLabel(kind)}</option>`,
            )}
          </select>
        </label>
        <label class="audit-toolbar__field">
          <span class="audit-toolbar__label">${t("ixAuth.audit.filterSince")}</span>
          <input
            type="date"
            .value=${this.filters.since}
            @change=${(event: Event) =>
              // SAFETY: the listener is bound to this input element.
              this.updateFilter({ since: (event.target as HTMLInputElement).value })}
          />
        </label>
        <label class="audit-toolbar__field">
          <span class="audit-toolbar__label">${t("ixAuth.audit.filterUntil")}</span>
          <input
            type="date"
            .value=${this.filters.until}
            @change=${(event: Event) =>
              // SAFETY: the listener is bound to this input element.
              this.updateFilter({ until: (event.target as HTMLInputElement).value })}
          />
        </label>
        <div class="audit-toolbar__actions">
          <a
            class="button"
            href=${`${this.basePath}/auth/admin/audit/export.csv${auditExportSearch(this.filters)}`}
            download
            >${t("ixAuth.audit.export")}</a
          >
        </div>
      </div>
    `;
  }

  private renderRow(event: AuditUserActivityEvent): TemplateResult {
    const open = this.expanded === event.sequence;
    return html`
      <tr>
        <td>${new Date(event.at).toLocaleString()}</td>
        <td>${auditRowPerson(event)}</td>
        <td>${auditRowRole(event)}</td>
        <td>${event.departments.join(", ") || "-"}</td>
        <td>${auditKindLabel(event.kind)}</td>
        <td class="audit-table__summary">
          <button
            class="audit-table__expand"
            aria-expanded=${open ? "true" : "false"}
            @click=${() => {
              this.expanded = open ? null : event.sequence;
            }}
          >
            ${auditRowSummary(event) || t("ixAuth.audit.noSummary")}
          </button>
          ${
            open
              ? html`<pre class="audit-detail">${JSON.stringify(event.detail, null, 2)}</pre>`
              : nothing
          }
        </td>
        <td>${event.sessionKey ?? "-"}</td>
      </tr>
    `;
  }

  private renderTable(): TemplateResult {
    if (this.events.length === 0) {
      return html`<div class="audit-pager">
        ${this.loading ? t("ixAuth.audit.loading") : t("ixAuth.audit.empty")}
      </div>`;
    }
    return html`
      <div class="audit-table-scroll">
        <table class="audit-table">
          <thead>
            <tr>
              <th>${t("ixAuth.audit.columnTime")}</th>
              <th>${t("ixAuth.audit.columnPerson")}</th>
              <th>${t("ixAuth.audit.columnRole")}</th>
              <th>${t("ixAuth.audit.columnDepartments")}</th>
              <th>${t("ixAuth.audit.columnKind")}</th>
              <th>${t("ixAuth.audit.columnSummary")}</th>
              <th>${t("ixAuth.audit.columnSession")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.events.map((event) => this.renderRow(event))}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderPager(): TemplateResult | typeof nothing {
    const next = this.cursors[0];
    if (!next) {
      return nothing;
    }
    return html`<div class="audit-pager">
      <button class="button" ?disabled=${this.loading} @click=${() => void this.load(next)}>
        ${t("ixAuth.audit.more")}
      </button>
    </div>`;
  }

  override render() {
    const header = html`
      <section class="content-header">
        <div>
          <div class="page-title">${titleForRoute("audit")}</div>
          <div class="page-subtitle">${subtitleForRoute("audit")}</div>
        </div>
      </section>
    `;
    if (!canManageIxAuthUsers() || this.forbidden) {
      return html`
        ${header}
        ${renderSettingsWorkspace(
          renderSettingsPage([
            renderSettingsSection({ title: t("ixAuth.audit.title") }, [
              renderSettingsRow({ title: t("ixAuth.audit.forbidden") }),
            ]),
          ]),
        )}
      `;
    }
    return html`
      ${header}
      ${renderSettingsWorkspace(
        renderSettingsPage([
          renderSettingsSection(
            { title: t("ixAuth.audit.title"), description: t("ixAuth.audit.description") },
            [
              renderSettingsRow({ title: "", stacked: true, control: this.renderToolbar() }),
              this.failed
                ? renderSettingsRow({ title: t("ixAuth.audit.failed") })
                : renderSettingsRow({ title: "", stacked: true, control: this.renderTable() }),
              renderSettingsRow({ title: "", stacked: true, control: this.renderPager() }),
            ],
          ),
        ]),
      )}
    `;
  }
}

export const auditPageComponent = {
  header: true,
  render: () => html`<openclaw-audit-page></openclaw-audit-page>`,
};

if (!customElements.get("openclaw-audit-page")) {
  customElements.define("openclaw-audit-page", AuditPage);
}
