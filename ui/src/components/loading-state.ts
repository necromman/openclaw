import { html } from "lit";

export function renderLoadingIndicator(status = "화면을 불러오는 중입니다.") {
  return html`<span class="fork-loading-indicator">
    <span class="fork-loading-indicator__spinner" aria-hidden="true"></span>
    <span>${status}</span>
  </span>`;
}

export function renderLoadingState() {
  return html`
    <section
      class="lazy-view-state lazy-view-state--loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      ${renderLoadingIndicator()}
    </section>
  `;
}
