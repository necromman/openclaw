/**
 * Fork brand constants (single source of truth).
 *
 * Every user-visible product name, tagline and outbound link in this fork is
 * derived from this file. Change the values here and the Control UI, the CLI
 * banner, the PWA manifest, the system prompt persona and the generated icons
 * all follow. Nothing else should hardcode a product name.
 *
 * Internal identifiers are deliberately NOT derived from this file: the npm
 * package name (`openclaw`), the CLI binary name, the config directory
 * (`~/.openclaw`), config keys, environment variables, plugin ids, database
 * schema names, API routes and CSS class names stay on the upstream spelling so
 * that rebasing onto upstream keeps working.
 */

/** Full product name shown to users. */
export const BRAND_NAME = "Chris Agent";

/** Compact form for tab titles, PWA short_name and tight chrome. */
export const BRAND_SHORT_NAME = "Chris";

/** One-line product description shown on the About page and in onboarding. */
export const BRAND_TAGLINE = "Your personal AI assistant, running on your own devices.";

/**
 * Decorative emoji in front of the CLI banner title. Empty string means the
 * banner shows the product name alone, which is what this fork wants.
 */
export const BRAND_BANNER_EMOJI = "";

/** CLI banner subtitle. Kept short enough for an 80 column terminal. */
export const BRAND_CLI_TAGLINE = "All your chats, one agent.";

/**
 * Outbound links. An empty string means "this fork has no such destination" and
 * the surface that would render it hides the link instead.
 */
export const BRAND_LINKS = {
  website: "",
  docs: "https://github.com/necromman/openclaw/blob/chris/main/FORK.md",
  github: "https://github.com/necromman/openclaw",
  changelog: "https://github.com/necromman/openclaw/commits/chris/main",
  discord: "",
  x: "",
  /** Skill/plugin hub. Functionality is unchanged; only the label is neutral. */
  skillHub: "https://clawhub.ai/plugins",
} as const;

/** Neutral label for the upstream "ClawHub" marketplace. */
export const BRAND_SKILL_HUB_NAME = "Skill Hub";

/** Neutral label for the upstream "OpenClaw Cloud" hosted offering. */
export const BRAND_CLOUD_NAME = "Cloud";

/**
 * Legal attribution. The upstream code is MIT licensed, so this notice stays
 * verbatim on the About page no matter what the brand above says.
 */
export const BRAND_UPSTREAM_LICENSE_NOTICE = "© 2026 OpenClaw Foundation. MIT License.";

/**
 * Fork feature flags. These hide a surface without removing its code, so an
 * upstream rebase keeps applying cleanly and flipping a value brings the
 * surface back. Set a flag to true to restore it.
 */
export const BRAND_FEATURES = {
  /** Companion "Get the apps" page and every link into it. */
  appsPage: false,
} as const;

/** Values injected into every i18n interpolation so `{brand}` works anywhere. */
export const BRAND_PLACEHOLDERS: Readonly<Record<string, string>> = Object.freeze({
  brand: BRAND_NAME,
  brandShort: BRAND_SHORT_NAME,
  brandSkillHub: BRAND_SKILL_HUB_NAME,
  brandCloud: BRAND_CLOUD_NAME,
});
