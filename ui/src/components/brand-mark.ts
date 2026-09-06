// Neutral fork brand mark. Pure inline SVG geometry - no upstream artwork, no
// external image. Kept in lockstep with ui/public/favicon.svg so the tab icon,
// the PWA icon and every in-app mark are the same shape.
import { svg, type TemplateResult } from "lit";

export type BrandMarkOptions = {
  /** Rendered pixel size of the square mark. Defaults to 96. */
  size?: number;
  /** Accessible label. Omit for a decorative mark. */
  title?: string;
};

export function renderBrandMark(options: BrandMarkOptions = {}): TemplateResult {
  const size = options.size ?? 96;
  const label = options.title;
  return svg`
    <svg
      class="brand-mark"
      viewBox="0 0 120 120"
      width=${size}
      height=${size}
      role=${label ? "img" : "presentation"}
      aria-label=${label ?? ""}
      aria-hidden=${label ? "false" : "true"}
      focusable="false"
    >
      <defs>
        <linearGradient id="brand-mark-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3f4a5a" />
          <stop offset="100%" stop-color="#1b2029" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="112" height="112" rx="5" ry="5" fill="url(#brand-mark-plate)" />
      <circle cx="60" cy="60" r="40" fill="none" stroke="#5d6b7f" stroke-width="3" opacity="0.55" />
      <path
        d="M80 40 A28 28 0 1 0 80 80"
        fill="none"
        stroke="#e8edf4"
        stroke-width="11"
        stroke-linecap="round"
      />
      <circle cx="84" cy="60" r="7" fill="#8fb4d9" />
    </svg>
  `;
}
