import { html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { pathForRoute } from "../../app-route-paths.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { readIxAuthCsrfToken, readIxAuthSessionSnapshot } from "./ix-auth-session-api.ts";

registerIxAuthEnglish();

class ImpersonationBanner extends OpenClawLightDomElement {
  @property({ type: String }) basePath = "";
  @state() private busy = false;
  @state() private failed = false;
  private shell: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | undefined;

  override connectedCallback() {
    super.connectedCallback();
    this.shell = this.closest<HTMLElement>(".shell");
    if (this.shell) {
      this.resizeObserver = new ResizeObserver(() => {
        this.shell?.style.setProperty(
          "--impersonation-banner-height",
          `${this.getBoundingClientRect().height}px`,
        );
      });
      this.resizeObserver.observe(this);
    }
  }

  override disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.shell?.style.removeProperty("--impersonation-banner-height");
    this.shell = null;
    super.disconnectedCallback();
  }

  private async stop(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.failed = false;
    try {
      const csrf = readIxAuthCsrfToken();
      const response = await fetch(
        `${this.basePath.replace(/\/+$/u, "")}/auth/impersonation/stop`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { accept: "application/json", ...(csrf ? { "x-openclaw-csrf": csrf } : {}) },
        },
      );
      if (response.status === 401) {
        globalThis.location.assign(`${this.basePath.replace(/\/+$/u, "")}/`);
        return;
      }
      if (!response.ok) {
        throw new Error("Impersonation stop failed");
      }
      globalThis.location.assign(pathForRoute("users", this.basePath));
    } catch {
      this.failed = true;
      this.busy = false;
    }
  }

  override render() {
    const session = readIxAuthSessionSnapshot();
    const user = session?.user;
    if (!user?.impersonatedBy && !session?.impersonationRestoreAvailable) {
      return nothing;
    }
    return html`<aside
      class="ix-auth-impersonation-banner"
      aria-label=${t("ixAuth.impersonation.title")}
    >
      <div>
        <strong
          >${
            user?.impersonatedBy
              ? t("ixAuth.impersonation.banner", { name: user.displayName, email: user.email })
              : t("ixAuth.impersonation.expired")
          }</strong
        >
        <p>${t("ixAuth.impersonation.securityHelp")}</p>
        ${this.failed ? html`<p role="alert">${t("ixAuth.impersonation.stopFailed")}</p>` : nothing}
      </div>
      <button class="btn" ?disabled=${this.busy} @click=${() => void this.stop()}>
        ${t(this.busy ? "ixAuth.impersonation.returning" : "ixAuth.impersonation.stop")}
      </button>
    </aside>`;
  }
}

if (!customElements.get("openclaw-impersonation-banner")) {
  customElements.define("openclaw-impersonation-banner", ImpersonationBanner);
}
