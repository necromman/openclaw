// Guards the one place the brand name has to be duplicated.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "./brand.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("fork brand constants", () => {
  it("keeps the launcher's inlined product name in sync with BRAND_NAME", () => {
    // openclaw.mjs runs before the module graph loads, so it cannot import
    // brand.ts. It carries a literal instead; this test is the seam.
    const launcher = fs.readFileSync(path.join(repoRoot, "openclaw.mjs"), "utf8");
    const match = launcher.match(/const brand = "([^"]+)";/u);
    expect(match?.[1]).toBe(BRAND_NAME);
  });

  it("never leaves the product name empty", () => {
    expect(BRAND_NAME.trim().length).toBeGreaterThan(0);
  });
});
