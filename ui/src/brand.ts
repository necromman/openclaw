// Control UI brand module re-exports the fork-wide brand constants.
// The canonical definitions live in ../../src/brand.ts so that the CLI, the
// gateway and this browser bundle can never drift apart. Change values there.
export { BRAND_FEATURES, BRAND_LINKS, BRAND_NAME, BRAND_PLACEHOLDERS } from "../../src/brand.ts";
