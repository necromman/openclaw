// Control UI module implements the first-paint theme contract.
//
// Dependency-free on purpose. The startup `<script>` at the top of
// `ui/index.html` cannot import anything: it has to run before the module
// bundle so the very first frame is already painted in the persisted theme, so
// it duplicates the logic below by hand. `theme-boot.test.ts` evaluates that
// inline script and asserts it agrees with this module for every stored value,
// so the two cannot drift apart. Any change here must be mirrored there.
export type ThemeName =
  | "claw"
  | "knot"
  | "dash"
  | "absolutely"
  | "tide"
  | "beacon"
  | "phosphor"
  | "crt"
  | "manuscript"
  | "rose"
  | "miami"
  | "custom";
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme =
  | "dark"
  | "light"
  | "openknot"
  | "openknot-light"
  | "dash"
  | "dash-light"
  | "absolutely"
  | "absolutely-light"
  | "tide"
  | "tide-light"
  | "beacon"
  | "beacon-light"
  | "phosphor"
  | "phosphor-light"
  | "crt"
  | "crt-light"
  | "manuscript"
  | "manuscript-light"
  | "rose"
  | "rose-light"
  | "miami"
  | "miami-light"
  | "custom"
  | "custom-light";

const VALID_THEME_NAMES: ReadonlySet<string> = new Set<ThemeName>([
  "claw",
  "knot",
  "dash",
  "absolutely",
  "tide",
  "beacon",
  "phosphor",
  "crt",
  "manuscript",
  "rose",
  "miami",
  "custom",
]);

const VALID_THEME_MODES: ReadonlySet<string> = new Set<ThemeMode>(["system", "light", "dark"]);

function isThemeName(value: string): value is ThemeName {
  return VALID_THEME_NAMES.has(value);
}

function isThemeMode(value: string): value is ThemeMode {
  return VALID_THEME_MODES.has(value);
}

/** Normalize the raw stored values, falling back to the shipped defaults. */
export function parseThemeSelection(
  themeRaw: unknown,
  modeRaw: unknown,
): { theme: ThemeName; mode: ThemeMode } {
  const theme = typeof themeRaw === "string" ? themeRaw : "";
  const mode = typeof modeRaw === "string" ? modeRaw : "";

  const normalizedTheme = isThemeName(theme) ? theme : "claw";
  const normalizedMode = isThemeMode(mode) ? mode : "system";

  return { theme: normalizedTheme, mode: normalizedMode };
}

/** Map a theme family and an already-resolved light/dark mode to its palette name. */
function resolveThemeForMode(theme: ThemeName, mode: "light" | "dark"): ResolvedTheme {
  if (theme === "claw") {
    return mode === "light" ? "light" : "dark";
  }
  const family = theme === "knot" ? "openknot" : theme;
  return mode === "light" ? `${family}-light` : family;
}

function resolvedModeForTheme(resolvedTheme: string): "light" | "dark" {
  return resolvedTheme.endsWith("light") ? "light" : "dark";
}

/** Web Awesome ships light tokens on bare `:root`; the class is what selects dark. */
function waClassForMode(mode: "light" | "dark"): "wa-light" | "wa-dark" {
  return mode === "light" ? "wa-light" : "wa-dark";
}

export type BootThemePresentation = {
  /** Value for `documentElement.dataset.theme`. */
  resolvedTheme: ResolvedTheme;
  /** Value for `dataset.themeMode`, `dataset.themeResolved` and `style.colorScheme`. */
  resolvedMode: "light" | "dark";
  /** Web Awesome palette class. Its token layer defaults to light on `:root`. */
  waClass: "wa-light" | "wa-dark";
  /** Theme family whose palette stylesheet has to be present before first paint. */
  paletteTheme: ThemeName;
};

/**
 * Turn the raw stored `theme`/`themeMode` values into everything first paint has
 * to stamp on `<html>`. Pure: the caller supplies the system preference so the
 * result is identical in the browser, in the inline script and under test.
 */
export function resolveBootTheme(
  themeRaw: unknown,
  modeRaw: unknown,
  prefersLight: boolean,
): BootThemePresentation {
  const { theme, mode } = parseThemeSelection(themeRaw, modeRaw);
  const explicitMode = mode === "system" ? (prefersLight ? "light" : "dark") : mode;
  const resolvedTheme = resolveThemeForMode(theme, explicitMode);
  const resolvedMode = resolvedModeForTheme(resolvedTheme);
  return {
    resolvedTheme,
    resolvedMode,
    waClass: waClassForMode(resolvedMode),
    paletteTheme: theme,
  };
}
