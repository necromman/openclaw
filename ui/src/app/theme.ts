// Control UI module implements theme behavior.
// The pure value contract (names, modes, parsing, resolution) lives in
// theme-boot.ts so the startup paint path can share it without pulling in
// anything that touches the document.
import { inferControlUiPublicAssetPath } from "./public-assets.ts";
import {
  resolveBootTheme,
  type BootThemePresentation,
  type ThemeMode,
  type ThemeName,
} from "./theme-boot.ts";

export { parseThemeSelection } from "./theme-boot.ts";
export type { ResolvedTheme, ThemeMode, ThemeName } from "./theme-boot.ts";

function prefersLightScheme(): boolean {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Everything the document needs stamped, resolved against the live system preference. */
export function resolveThemePresentation(theme: ThemeName, mode: ThemeMode): BootThemePresentation {
  return resolveBootTheme(theme, mode, prefersLightScheme());
}

/** Resolve a stored selection against the live system preference. */
export function resolveTheme(theme: ThemeName, mode: ThemeMode) {
  return resolveThemePresentation(theme, mode).resolvedTheme;
}

/** Publish theme colors only after their stylesheet is available. */
export function syncThemePaletteStylesheet(theme: ThemeName, ready: () => void): void {
  if (typeof document === "undefined" || theme === "claw" || theme === "custom") {
    ready();
    return;
  }
  // Retain the six built-in families once visited. Their exclusive selectors
  // leave the previous theme intact during loading and make repeat switches synchronous.
  const id = `openclaw-theme-palette-${theme}`;
  const existing = document.getElementById(id);
  if (existing instanceof HTMLLinkElement && existing.sheet) {
    ready();
    return;
  }
  const link = existing instanceof HTMLLinkElement ? existing : document.createElement("link");
  const finish = (event: Event) => {
    link.removeEventListener("load", finish);
    link.removeEventListener("error", finish);
    if (event.type === "error") {
      // Failed assets must not strand startup; normal CSS defaults stay readable.
      // Remove the failed link so a later selection can retry rather than wait forever.
      console.error(`Theme palette failed to load; reload to retry: ${link.href}`);
      link.remove();
    }
    ready();
  };
  link.addEventListener("load", finish);
  link.addEventListener("error", finish);
  if (!existing) {
    link.id = id;
    link.rel = "stylesheet";
    link.href = inferControlUiPublicAssetPath(`themes/${theme}.css`);
    document.head.append(link);
  }
}
