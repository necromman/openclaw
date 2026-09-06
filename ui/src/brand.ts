// Control UI brand module re-exports the fork-wide brand constants.
// The canonical definitions live in ../../src/brand.ts so that the CLI, the
// gateway and this browser bundle can never drift apart. Change values there.
export {
  BRAND_CLI_TAGLINE,
  BRAND_CLOUD_NAME,
  BRAND_LINKS,
  BRAND_NAME,
  BRAND_PLACEHOLDERS,
  BRAND_SHORT_NAME,
  BRAND_SKILL_HUB_NAME,
  BRAND_TAGLINE,
  BRAND_UPSTREAM_LICENSE_NOTICE,
} from "../../src/brand.ts";
