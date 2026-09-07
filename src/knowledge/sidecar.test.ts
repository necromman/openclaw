// Tests for sidecar naming, frontmatter, and the origin line a citation has to show.
import { describe, expect, test } from "vitest";
import {
  isSafeRelativePath,
  parseFrontmatter,
  renderSidecar,
  replaceSidecarFrontmatter,
  sidecarRelativePath,
  sourceRelativePathFromSidecar,
  toPosixRelative,
} from "./sidecar.js";
import type { KnowledgeSidecarMeta } from "./types.js";

const META: KnowledgeSidecarMeta = {
  convertedAt: "2026-09-08T07:30:00.000Z",
  converter: "pdf-text",
  sourceMtime: "2026-09-01T00:00:00.000Z",
  sourcePath: "/mnt/nas/rnd/시약 재고: 2026.pdf",
  sourceRelative: "시약 재고: 2026.pdf",
  sourceSha256: "a".repeat(64),
  sourceSize: 4096,
};

describe("sidecar paths", () => {
  test("appends the suffix so two formats of one name stay distinct", () => {
    expect(sidecarRelativePath("a/notes.pdf")).toBe("a/notes.pdf.md");
    expect(sidecarRelativePath("a/notes.docx")).toBe("a/notes.docx.md");
    expect(sidecarRelativePath("a\\notes.txt")).toBe("a/notes.txt.md");
  });

  test("maps a sidecar back to its source, and ignores foreign files", () => {
    expect(sourceRelativePathFromSidecar("a/notes.pdf.md")).toBe("a/notes.pdf");
    expect(sourceRelativePathFromSidecar("a/notes.pdf")).toBeUndefined();
    expect(sourceRelativePathFromSidecar(".md")).toBeUndefined();
  });

  test("refuses every relative path that could leave the index root", () => {
    expect(isSafeRelativePath("a/b.pdf")).toBe(true);
    expect(isSafeRelativePath("../b.pdf")).toBe(false);
    expect(isSafeRelativePath("a/../../b.pdf")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("C:/Windows/win.ini")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });

  test("normalizes separators without leaving a leading dot segment", () => {
    expect(toPosixRelative("./a\\b")).toBe("a/b");
  });
});

describe("sidecar content", () => {
  test("puts the origin path in the first lines any snippet will carry", () => {
    const rendered = renderSidecar(META, "## p.1\n\n본문\n\n\n");
    const lines = rendered.split("\n");
    expect(lines[0]).toBe("---");
    expect(rendered).toContain('source_path: "/mnt/nas/rnd/시약 재고: 2026.pdf"');
    expect(rendered).toContain("source_size: 4096");
    expect(rendered).toContain("> 원본: /mnt/nas/rnd/시약 재고: 2026.pdf");
    expect(rendered.endsWith("본문\n")).toBe(true);
  });

  test("round-trips every field the incremental comparison reads", () => {
    const parsed = parseFrontmatter(renderSidecar(META, "본문"));
    expect(parsed).toEqual(META);
  });

  test("returns undefined for content that is not a sidecar", () => {
    expect(parseFrontmatter("# 그냥 문서\n")).toBeUndefined();
    expect(parseFrontmatter("---\nsource_size: 1\n")).toBeUndefined();
  });

  test("refreshes only the frontmatter and leaves the body byte for byte", () => {
    const original = renderSidecar(META, "## p.1\n\n본문");
    const refreshed = replaceSidecarFrontmatter(original, {
      ...META,
      sourceMtime: "2026-09-08T09:00:00.000Z",
    });
    expect(refreshed).toBeDefined();
    expect(refreshed).toContain('source_mtime: "2026-09-08T09:00:00.000Z"');
    expect(refreshed?.slice(refreshed.indexOf("\n> 원본"))).toBe(
      original.slice(original.indexOf("\n> 원본")),
    );
    expect(replaceSidecarFrontmatter("no frontmatter", META)).toBeUndefined();
  });
});
