import { describe, expect, it } from "vitest";
import {
  folderRuleAbsolutePath,
  folderRuleAncestry,
  hasExcludedFolderSegment,
  isExcludedFolderName,
  isFolderPathUnder,
  normalizeFolderRulePath,
} from "./folder-access-path.js";

describe("folder rule path normalization", () => {
  it("treats an empty path as the root itself", () => {
    expect(normalizeFolderRulePath(undefined)).toBe("");
    expect(normalizeFolderRulePath("   ")).toBe("");
    expect(normalizeFolderRulePath("/", "/mnt/nas")).toBe("");
  });

  it("collapses separators and drops empty and single-dot segments", () => {
    expect(normalizeFolderRulePath("a//b/./c/")).toBe("a/b/c");
    expect(normalizeFolderRulePath("a\\b\\c")).toBe("a/b/c");
  });

  it("composes decomposed Korean names so one folder is one key", () => {
    // The same share name written decomposed (NFD) and composed (NFC). Ten real folders
    // on the delivery NAS are stored decomposed, so without this the same folder would
    // hold two different rules and neither would apply reliably.
    const decomposed = "\u1100\u1169\u11bc\u110b\u116d\u11bc";
    const composed = "\uacf5\uc6a9";
    expect(decomposed).not.toBe(composed);
    expect(normalizeFolderRulePath(decomposed)).toBe(composed);
  });

  it("refuses traversal, drive letters and control characters", () => {
    expect(normalizeFolderRulePath("a/../../etc")).toBeUndefined();
    expect(normalizeFolderRulePath("..")).toBeUndefined();
    expect(normalizeFolderRulePath("C:/Windows")).toBeUndefined();
    expect(normalizeFolderRulePath("a\nb")).toBeUndefined();
    expect(normalizeFolderRulePath("a\tb")).toBeUndefined();
    expect(normalizeFolderRulePath("a\u0000b")).toBeUndefined();
  });

  it("refuses a path longer than the stored column allows", () => {
    expect(normalizeFolderRulePath("x".repeat(1025))).toBeUndefined();
    expect(normalizeFolderRulePath("x".repeat(1024))).toHaveLength(1024);
  });

  it("strips a root prefix but refuses an absolute path outside the root", () => {
    expect(normalizeFolderRulePath("/mnt/nas/00/inside", "/mnt/nas")).toBe("00/inside");
    expect(normalizeFolderRulePath("/mnt/nas", "/mnt/nas")).toBe("");
    expect(normalizeFolderRulePath("/etc/passwd", "/mnt/nas")).toBeUndefined();
    // Without a root to measure against, an absolute path cannot be placed at all.
    expect(normalizeFolderRulePath("/mnt/nas/00")).toBeUndefined();
  });

  it("keeps the characters real share names actually contain", () => {
    expect(normalizeFolderRulePath("00/#business form/10. device (GMP)")).toBe(
      "00/#business form/10. device (GMP)",
    );
  });

  it("preserves case, because the filesystem underneath does", () => {
    expect(normalizeFolderRulePath("Design/PC")).toBe("Design/PC");
    expect(normalizeFolderRulePath("design/pc")).toBe("design/pc");
  });
});

describe("folder rule ancestry", () => {
  it("walks from the folder outward and ends at the root", () => {
    expect(folderRuleAncestry("a/b/c")).toEqual(["a/b/c", "a/b", "a", ""]);
    expect(folderRuleAncestry("")).toEqual([""]);
    expect(folderRuleAncestry("a")).toEqual(["a", ""]);
  });
});

describe("excluded folder names", () => {
  it("drops the storage bookkeeping directories every share carries", () => {
    expect(isExcludedFolderName("#recycle")).toBe(true);
    expect(isExcludedFolderName("@eaDir")).toBe(true);
    expect(isExcludedFolderName("@tmp")).toBe(true);
    expect(isExcludedFolderName("#business")).toBe(false);
    expect(hasExcludedFolderSegment("00/@eaDir/thumb")).toBe(true);
    expect(hasExcludedFolderSegment("00/business")).toBe(false);
  });
});

describe("folder path helpers", () => {
  it("joins for display without letting the root disappear", () => {
    expect(folderRuleAbsolutePath("/mnt/nas", "")).toBe("/mnt/nas");
    expect(folderRuleAbsolutePath("/mnt/nas", "a/b")).toBe("/mnt/nas/a/b");
  });

  it("treats the root as the parent of everything", () => {
    expect(isFolderPathUnder("", "anything")).toBe(true);
    expect(isFolderPathUnder("a", "a/b")).toBe(true);
    expect(isFolderPathUnder("a", "a")).toBe(true);
    expect(isFolderPathUnder("a", "ab")).toBe(false);
  });
});
