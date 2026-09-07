// Tests for the incremental sidecar sync: what it writes, what it leaves, what it removes.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { parseFrontmatter } from "./sidecar.js";
import { syncKnowledgeIndex } from "./sync.js";
import type { KnowledgeSyncEntry, KnowledgeSyncSummary } from "./types.js";

const tempDirs = createTempDirTracker();

afterEach(() => {
  tempDirs.cleanup();
});

function roots(): { source: string; out: string } {
  return { out: tempDirs.make("knowledge-out-"), source: tempDirs.make("knowledge-src-") };
}

async function writeSource(root: string, relativePath: string, content: string): Promise<string> {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
  return absolute;
}

function entryFor(summary: KnowledgeSyncSummary, relativePath: string): KnowledgeSyncEntry {
  const found = summary.entries.find((entry) => entry.relativePath === relativePath);
  if (!found) {
    throw new Error(`no entry for ${relativePath} in ${JSON.stringify(summary.entries)}`);
  }
  return found;
}

async function exists(target: string): Promise<boolean> {
  return await fs
    .stat(target)
    .then(() => true)
    .catch(() => false);
}

describe("syncKnowledgeIndex", () => {
  test("writes one sidecar per document and keeps the folder shape", async () => {
    const { out, source } = roots();
    await writeSource(source, "보고/시약-재고.md", "# 시약 재고\n\n에탄올 12병");
    const summary = await syncKnowledgeIndex({ out, source });
    expect(summary.counts.created).toBe(1);
    const sidecar = path.join(out, "보고/시약-재고.md.md");
    const content = await fs.readFile(sidecar, "utf8");
    expect(content).toContain(`> 원본: ${path.join(source, "보고", "시약-재고.md")}`);
    expect(content).toContain("에탄올 12병");
    const meta = parseFrontmatter(content);
    expect(meta?.converter).toBe("copy");
    expect(meta?.sourceRelative).toBe("보고/시약-재고.md");
    expect(meta?.sourceSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("second run over an untouched folder converts nothing", async () => {
    const { out, source } = roots();
    await writeSource(source, "a.txt", "본문");
    await syncKnowledgeIndex({ out, source });
    const before = await fs.stat(path.join(out, "a.txt.md"));
    const second = await syncKnowledgeIndex({ out, source });
    expect(second.counts).toMatchObject({ created: 0, skipped: 1, updated: 0 });
    const after = await fs.stat(path.join(out, "a.txt.md"));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  test("reconverts when the bytes change", async () => {
    const { out, source } = roots();
    await writeSource(source, "a.txt", "처음");
    await syncKnowledgeIndex({ out, source });
    await writeSource(source, "a.txt", "고친 내용");
    const second = await syncKnowledgeIndex({ out, source });
    expect(entryFor(second, "a.txt").action).toBe("updated");
    expect(await fs.readFile(path.join(out, "a.txt.md"), "utf8")).toContain("고친 내용");
  });

  test("a moved timestamp over identical bytes refreshes the record, not the body", async () => {
    const { out, source } = roots();
    const absolute = await writeSource(source, "a.txt", "본문");
    await syncKnowledgeIndex({ out, source });
    const original = await fs.readFile(path.join(out, "a.txt.md"), "utf8");
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(absolute, later, later);
    const second = await syncKnowledgeIndex({ out, source });
    expect(entryFor(second, "a.txt").action).toBe("skipped");
    const refreshed = await fs.readFile(path.join(out, "a.txt.md"), "utf8");
    expect(parseFrontmatter(refreshed)?.sourceMtime).not.toBe(
      parseFrontmatter(original)?.sourceMtime,
    );
    expect(refreshed.slice(refreshed.indexOf("> 원본"))).toBe(
      original.slice(original.indexOf("> 원본")),
    );
    // The third run has nothing left to do, which is the point of refreshing.
    expect((await syncKnowledgeIndex({ out, source })).counts.skipped).toBe(1);
  });

  test("removes the sidecar when its source is gone, and prunes the empty folder", async () => {
    const { out, source } = roots();
    await writeSource(source, "보고/a.txt", "본문");
    await syncKnowledgeIndex({ out, source });
    await fs.rm(path.join(source, "보고", "a.txt"));
    const second = await syncKnowledgeIndex({ out, source });
    expect(second.counts.deleted).toBe(1);
    expect(await exists(path.join(out, "보고/a.txt.md"))).toBe(false);
    expect(await exists(path.join(out, "보고"))).toBe(false);
  });

  test("leaves a file the sync did not write alone", async () => {
    const { out, source } = roots();
    await writeSource(source, "a.txt", "본문");
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, "운영-메모.md"), "# 손으로 쓴 메모\n", "utf8");
    const summary = await syncKnowledgeIndex({ out, source });
    expect(summary.counts.deleted).toBe(0);
    expect(await exists(path.join(out, "운영-메모.md"))).toBe(true);
  });

  test("skips a file over the size ceiling and one with an unlisted extension", async () => {
    const { out, source } = roots();
    await writeSource(source, "big.txt", "가".repeat(500));
    await writeSource(source, "notes.hwp", "무시");
    const summary = await syncKnowledgeIndex({ maxBytes: 64, out, source });
    expect(entryFor(summary, "big.txt")).toMatchObject({ action: "ignored", reason: "too-large" });
    expect(entryFor(summary, "notes.hwp")).toMatchObject({
      action: "ignored",
      reason: "extension",
    });
    expect(await exists(path.join(out, "big.txt.md"))).toBe(false);
  });

  test("honours an explicit include list", async () => {
    const { out, source } = roots();
    await writeSource(source, "a.txt", "본문");
    await writeSource(source, "b.md", "본문");
    const summary = await syncKnowledgeIndex({ include: ["md"], out, source });
    expect(entryFor(summary, "a.txt").action).toBe("ignored");
    expect(entryFor(summary, "b.md").action).toBe("created");
    expect(summary.include).toEqual(["md"]);
  });

  test("never follows a symlinked source out of the share", async () => {
    const { out, source } = roots();
    const outside = tempDirs.make("knowledge-outside-");
    await fs.writeFile(path.join(outside, "secret.txt"), "급여 대장", "utf8");
    try {
      await fs.symlink(path.join(outside, "secret.txt"), path.join(source, "link.txt"));
    } catch {
      // Creating a symlink needs a privilege this host may not grant; the guard is
      // still covered by the walker's own policy on the hosts that do.
      return;
    }
    const summary = await syncKnowledgeIndex({ out, source });
    expect(entryFor(summary, "link.txt")).toMatchObject({ action: "ignored", reason: "symlink" });
    expect(await exists(path.join(out, "link.txt.md"))).toBe(false);
  });

  test("dry run reports the same plan and writes nothing", async () => {
    const { out, source } = roots();
    await writeSource(source, "a.txt", "본문");
    const planned = await syncKnowledgeIndex({ dryRun: true, out, source });
    expect(planned.dryRun).toBe(true);
    expect(entryFor(planned, "a.txt").action).toBe("created");
    expect(await exists(path.join(out, "a.txt.md"))).toBe(false);
    await syncKnowledgeIndex({ out, source });
    await fs.rm(path.join(source, "a.txt"));
    const plannedDelete = await syncKnowledgeIndex({ dryRun: true, out, source });
    expect(plannedDelete.counts.deleted).toBe(1);
    expect(await exists(path.join(out, "a.txt.md"))).toBe(true);
  });

  test("the JSON summary carries the run settings and one row per file", async () => {
    const { out, source } = roots();
    await writeSource(source, "a.txt", "본문");
    const summary = await syncKnowledgeIndex({
      concurrency: 3,
      maxBytes: 1024,
      now: () => new Date("2026-09-08T07:00:00.000Z"),
      out,
      source,
    });
    expect(summary).toMatchObject({
      concurrency: 3,
      converterMissing: false,
      dryRun: false,
      durationMs: 0,
      finishedAt: "2026-09-08T07:00:00.000Z",
      maxBytes: 1024,
      out: path.resolve(out),
      source: path.resolve(source),
      startedAt: "2026-09-08T07:00:00.000Z",
    });
    expect(Object.keys(summary.counts).sort()).toEqual([
      "created",
      "deleted",
      "failed",
      "ignored",
      "skipped",
      "updated",
    ]);
    expect(summary.entries).toEqual([
      {
        action: "created",
        converter: "copy",
        relativePath: "a.txt",
        sidecarPath: "a.txt.md",
        sidecarBytes: expect.any(Number),
        sourceBytes: 6,
      },
    ]);
  });

  test("refuses an index folder that overlaps the share", async () => {
    const source = tempDirs.make("knowledge-src-");
    await expect(syncKnowledgeIndex({ out: path.join(source, "index"), source })).rejects.toThrow(
      /--out must not be inside --source/u,
    );
    await expect(syncKnowledgeIndex({ out: source, source })).rejects.toThrow(/different/u);
  });

  test("refuses a source that is not a directory", async () => {
    const { out, source } = roots();
    const file = await writeSource(source, "a.txt", "본문");
    await expect(syncKnowledgeIndex({ out, source: file })).rejects.toThrow(/not a directory/u);
  });
});
