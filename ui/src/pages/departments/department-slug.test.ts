import { describe, expect, it } from "vitest";
import {
  DEPARTMENT_SLUG_MAX_LENGTH,
  DEPARTMENT_SLUG_PATTERN,
  isDepartmentSlug,
  romanizeHangul,
  suggestDepartmentSlug,
} from "./department-slug.ts";

describe("romanizeHangul", () => {
  it("writes Hangul syllables with the Revised Romanization letters", () => {
    expect(romanizeHangul("연구개발")).toBe("yeongugaebal");
    expect(romanizeHangul("품질")).toBe("pumjil");
    expect(romanizeHangul("영업")).toBe("yeongeop");
    expect(romanizeHangul("경영지원")).toBe("gyeongyeongjiwon");
  });

  it("leaves everything that is not a Hangul syllable alone", () => {
    expect(romanizeHangul("R&D 2팀")).toBe("R&D 2tim");
    expect(romanizeHangul("Quality")).toBe("Quality");
  });
});

describe("suggestDepartmentSlug", () => {
  it("turns a Korean name into a code the Gateway accepts", () => {
    expect(suggestDepartmentSlug("연구개발", [])).toBe("yeongugaebal");
    expect(suggestDepartmentSlug("품질", [])).toBe("pumjil");
  });

  it("lowercases English names and hyphenates the gaps", () => {
    expect(suggestDepartmentSlug("Research and Development", [])).toBe("research-and-development");
  });

  it("folds punctuation and mixed scripts into single hyphens", () => {
    expect(suggestDepartmentSlug("  R&D / 품질 (2팀)!  ", [])).toBe("r-d-pumjil-2tim");
  });

  it("falls back to a generic code when nothing usable is left", () => {
    expect(suggestDepartmentSlug("---", [])).toBe("dept");
    expect(suggestDepartmentSlug("", [])).toBe("dept");
  });

  it("truncates to the length the Gateway allows, without a trailing hyphen", () => {
    const slug = suggestDepartmentSlug("abcdefghij klmnopqrst uvwxyz abcdefghij", []);
    expect(slug.length).toBeLessThanOrEqual(DEPARTMENT_SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(isDepartmentSlug(slug)).toBe(true);
  });

  it("steps past codes already in use", () => {
    expect(suggestDepartmentSlug("품질", ["pumjil"])).toBe("pumjil-2");
    expect(suggestDepartmentSlug("품질", ["pumjil", "pumjil-2"])).toBe("pumjil-3");
  });

  it("keeps the counter inside the length limit when the base is already long", () => {
    const taken = ["abcdefghijklmnopqrstuvwxyzabcdef"];
    const slug = suggestDepartmentSlug("abcdefghijklmnopqrstuvwxyzabcdefghij", taken);
    expect(slug.length).toBeLessThanOrEqual(DEPARTMENT_SLUG_MAX_LENGTH);
    expect(slug.endsWith("-2")).toBe(true);
    expect(isDepartmentSlug(slug)).toBe(true);
  });

  it("compares taken codes without caring about case or padding", () => {
    expect(suggestDepartmentSlug("품질", [" PUMJIL "])).toBe("pumjil-2");
  });

  it("always answers with something the server regular expression accepts", () => {
    const names = ["연구개발", "품질", "영업", "R&D", "---", "", "Ünïcødé Tëam", "2026 팀"];
    for (const name of names) {
      expect(DEPARTMENT_SLUG_PATTERN.test(suggestDepartmentSlug(name, []))).toBe(true);
    }
  });
});

describe("isDepartmentSlug", () => {
  it("matches the shape the Gateway enforces", () => {
    expect(isDepartmentSlug("rnd")).toBe(true);
    expect(isDepartmentSlug("r")).toBe(true);
    expect(isDepartmentSlug("a".repeat(DEPARTMENT_SLUG_MAX_LENGTH))).toBe(true);
    expect(isDepartmentSlug("a".repeat(DEPARTMENT_SLUG_MAX_LENGTH + 1))).toBe(false);
    expect(isDepartmentSlug("-rnd")).toBe(false);
    expect(isDepartmentSlug("rnd-")).toBe(false);
    expect(isDepartmentSlug("RND")).toBe(false);
    expect(isDepartmentSlug("연구")).toBe(false);
    expect(isDepartmentSlug("")).toBe(false);
  });
});
