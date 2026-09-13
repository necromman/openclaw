import { describe, expect, it } from "vitest";
import { autoDepartmentSlug, isDepartmentSlug } from "./department-slug.ts";

// The longest short code the Gateway accepts; the module keeps its own copy private.
const MAX_LENGTH = 32;

describe("autoDepartmentSlug", () => {
  it("writes Hangul names with the Revised Romanization letters", () => {
    expect(autoDepartmentSlug("연구개발")).toBe("yeongugaebal");
    expect(autoDepartmentSlug("품질")).toBe("pumjil");
    expect(autoDepartmentSlug("영업")).toBe("yeongeop");
    expect(autoDepartmentSlug("경영지원")).toBe("gyeongyeongjiwon");
  });

  it("leaves everything that is not a Hangul syllable alone", () => {
    expect(autoDepartmentSlug("R&D 2팀")).toBe("r-d-2tim");
    expect(autoDepartmentSlug("Quality")).toBe("quality");
  });

  it("lowercases English names and hyphenates the gaps", () => {
    expect(autoDepartmentSlug("Research and Development")).toBe("research-and-development");
  });

  it("folds punctuation and mixed scripts into single hyphens", () => {
    expect(autoDepartmentSlug("  R&D / 품질 (2팀)!  ")).toBe("r-d-pumjil-2tim");
  });

  it("empties the field for a name nobody has typed yet", () => {
    expect(autoDepartmentSlug("")).toBe("");
    expect(autoDepartmentSlug("   ")).toBe("");
  });

  it("falls back to a generic code when nothing usable is left", () => {
    expect(autoDepartmentSlug("---")).toBe("dept");
  });

  it("truncates to the length the Gateway allows, without a trailing hyphen", () => {
    const slug = autoDepartmentSlug("abcdefghij klmnopqrst uvwxyz abcdefghij");
    expect(slug.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(isDepartmentSlug(slug)).toBe(true);
  });

  it("steps past codes already in use", () => {
    expect(autoDepartmentSlug("품질", ["pumjil"])).toBe("pumjil-2");
    expect(autoDepartmentSlug("품질", ["pumjil", "pumjil-2"])).toBe("pumjil-3");
  });

  it("keeps the counter inside the length limit when the base is already long", () => {
    const taken = ["abcdefghijklmnopqrstuvwxyzabcdef"];
    const slug = autoDepartmentSlug("abcdefghijklmnopqrstuvwxyzabcdefghij", taken);
    expect(slug.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(slug.endsWith("-2")).toBe(true);
    expect(isDepartmentSlug(slug)).toBe(true);
  });

  it("compares taken codes without caring about case or padding", () => {
    expect(autoDepartmentSlug("품질", [" PUMJIL "])).toBe("pumjil-2");
  });

  it("always answers with something the server regular expression accepts", () => {
    const names = ["연구개발", "품질", "영업", "R&D", "---", "Ünïcødé Tëam", "2026 팀"];
    for (const name of names) {
      expect(isDepartmentSlug(autoDepartmentSlug(name))).toBe(true);
    }
  });
});

describe("isDepartmentSlug", () => {
  it("matches the shape the Gateway enforces", () => {
    expect(isDepartmentSlug("rnd")).toBe(true);
    expect(isDepartmentSlug("r")).toBe(true);
    expect(isDepartmentSlug("a".repeat(MAX_LENGTH))).toBe(true);
    expect(isDepartmentSlug("a".repeat(MAX_LENGTH + 1))).toBe(false);
    expect(isDepartmentSlug("-rnd")).toBe(false);
    expect(isDepartmentSlug("rnd-")).toBe(false);
    expect(isDepartmentSlug("RND")).toBe(false);
    expect(isDepartmentSlug("연구")).toBe(false);
    expect(isDepartmentSlug("")).toBe(false);
  });
});
