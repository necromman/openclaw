// Control UI component renders a Gateway-converted document preview.
import { css, html, nothing, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import { OpenClawLitElement } from "../../lit/openclaw-element.ts";
import { renderPanelLoadingSkeleton } from "../panel-loading-skeleton.ts";

/**
 * Decodes gateway base64 into raw bytes. Malformed input yields an empty array
 * so a hostile or truncated payload renders the unavailable state instead of
 * throwing through the Lit render pass.
 */
export function base64ToBytes(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array(0);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}

class OpenClawDocumentPreview extends OpenClawLitElement {
  @property() name = "";
  @property() format: "pdf" | "html" | "" = "";
  @property() contentEncoding: "base64" | "utf8" | "" = "";
  @property({ attribute: false }) content = "";
  @property() sourceFormat = "";
  @property() converter = "";
  /** Gateway `documentError`, plus the client-side `hangul` notice. Empty when fine. */
  @property() errorCode = "";
  @property({ type: Boolean }) loading = false;

  // The PDF frame reads a blob URL built from bytes this element decoded, so the
  // previous URL is revoked on every content change and on teardown.
  private objectUrl: string | null = null;

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex: 0 0 auto;
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--border);
      background: var(--bg-elevated);
    }

    .name {
      min-width: 0;
      font-family: var(--mono);
      font-size: 12.5px;
      color: var(--text-strong);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .converted {
      flex: 0 0 auto;
      font-size: 11.5px;
      color: var(--muted);
    }

    .spacer {
      flex: 1;
    }

    .frame {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: var(--bg);
    }

    .doc-frame {
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--bg);
    }

    .state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: var(--space-6);
      text-align: center;
    }

    .state-title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-strong);
    }

    .state-message {
      margin: 0;
      max-width: 42ch;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text);
    }

    .state-hint {
      margin: 0;
      font-family: var(--mono);
      font-size: 11.5px;
      color: var(--muted);
    }
  `;

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("content") || changed.has("format") || changed.has("contentEncoding")) {
      this.refreshObjectUrl();
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    // Reconnection skips willUpdate, so a revoked frame source is rebuilt here.
    if (this.format === "pdf" && !this.objectUrl) {
      this.refreshObjectUrl();
      this.requestUpdate();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.releaseObjectUrl();
  }

  private releaseObjectUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private refreshObjectUrl() {
    this.releaseObjectUrl();
    if (this.format !== "pdf" || this.contentEncoding !== "base64") {
      return;
    }
    const bytes = base64ToBytes(this.content);
    if (bytes.length === 0) {
      return;
    }
    this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }

  private stateMessage(): string {
    switch (this.errorCode) {
      case "too-large":
        return t("documentPreview.errorTooLarge");
      case "converter-unavailable":
        return t("documentPreview.errorConverterUnavailable");
      case "conversion-failed":
        return t("documentPreview.errorConversionFailed");
      case "hangul":
        return t("documentPreview.hangulNotice");
      default:
        return t("documentPreview.errorUnsupportedFormat");
    }
  }

  private renderState() {
    return html`
      <div class="state" role="status">
        <p class="state-title">${t("documentPreview.unavailableTitle")}</p>
        <p class="state-message">${this.stateMessage()}</p>
        ${this.sourceFormat ? html`<p class="state-hint">${this.sourceFormat}</p>` : nothing}
      </div>
    `;
  }

  private renderBody() {
    if (this.loading) {
      return renderPanelLoadingSkeleton("review", t("documentPreview.loading"));
    }
    if (this.errorCode) {
      return this.renderState();
    }
    if (this.format === "pdf") {
      // No sandbox attribute: the browser's built-in PDF viewer needs the frame
      // unsandboxed, and the blob holds bytes this element decoded itself.
      return this.objectUrl
        ? html`<iframe class="doc-frame" src=${this.objectUrl} title=${this.name}></iframe>`
        : this.renderState();
    }
    if (this.format === "html" && this.content) {
      // The Gateway escapes this document before sending it; the empty sandbox
      // removes scripts, forms, popups, and same-origin access on top of that.
      return html`<iframe
        class="doc-frame"
        sandbox=""
        .srcdoc=${this.content}
        title=${this.name}
      ></iframe>`;
    }
    return this.renderState();
  }

  override render() {
    return html`
      <div class="toolbar" role="group" aria-label=${t("documentPreview.toolbarLabel")}>
        <span class="name" title=${this.name}>${this.name}</span>
        ${
          this.converter
            ? html`<span class="converted">${t("documentPreview.convertedBy")}</span>`
            : nothing
        }
        <span class="spacer"></span>
        <slot name="actions"></slot>
      </div>
      <div class="frame">${this.renderBody()}</div>
    `;
  }
}

if (!customElements.get("openclaw-document-preview")) {
  customElements.define("openclaw-document-preview", OpenClawDocumentPreview);
}

declare global {
  interface HTMLElementTagNameMap {
    "openclaw-document-preview": OpenClawDocumentPreview;
  }
}
