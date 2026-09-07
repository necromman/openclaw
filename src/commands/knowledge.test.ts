// Tests for what `openclaw knowledge sync` prints and how it validates its flags.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { RuntimeEnv } from "../runtime.js";
import { knowledgeSyncCommand } from "./knowledge.js";

const tempDirs = createTempDirTracker();

afterEach(() => {
  tempDirs.cleanup();
});

function createRuntime(): { runtime: RuntimeEnv; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    runtime: {
      error: vi.fn(),
      exit: vi.fn(),
      log: (message?: unknown) => {
        lines.push(String(message ?? ""));
      },
    } satisfies RuntimeEnv,
  };
}

async function seed(): Promise<{ source: string; out: string }> {
  const source = tempDirs.make("knowledge-cli-src-");
  const out = tempDirs.make("knowledge-cli-out-");
  await fs.writeFile(path.join(source, "시약-재고.md"), "# 시약 재고\n\n에탄올 12병\n", "utf8");
  await fs.writeFile(path.join(source, "기타.hwp"), "무시", "utf8");
  return { out, source };
}

describe("knowledgeSyncCommand", () => {
  test("prints one row per converted file and a count line", async () => {
    const { out, source } = await seed();
    const { lines, runtime } = createRuntime();
    await knowledgeSyncCommand({ out, source }, runtime);
    expect(lines[0]).toBe("ACTION\tCONVERTER\tSOURCE\tDETAIL");
    expect(lines[1]).toBe("created\tcopy\t시약-재고.md\t-");
    // The ignored hwp stays out of the default view; only counts mention it.
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("created=1");
    expect(lines[2]).toContain("ignored=1");
  });

  test("--verbose adds the rows an operator has to ask for", async () => {
    const { out, source } = await seed();
    const { lines, runtime } = createRuntime();
    await knowledgeSyncCommand({ out, source, verbose: true }, runtime);
    expect(lines.join("\n")).toContain("ignored\t-\t기타.hwp\textension");
  });

  test("--json prints the summary object instead of the table", async () => {
    const { out, source } = await seed();
    const { lines, runtime } = createRuntime();
    await knowledgeSyncCommand({ json: true, out, source }, runtime);
    const parsed: unknown = JSON.parse(lines.join("\n"));
    expect(parsed).toMatchObject({
      counts: { created: 1, ignored: 1 },
      dryRun: false,
      source: path.resolve(source),
    });
  });

  test("--dry-run marks the line and leaves the index empty", async () => {
    const { out, source } = await seed();
    const { lines, runtime } = createRuntime();
    await knowledgeSyncCommand({ dryRun: true, out, source }, runtime);
    expect(lines.at(-1)).toContain("dry-run");
    expect(await fs.readdir(out)).toEqual([]);
  });

  test("rejects a malformed count before touching the share", async () => {
    const { out, source } = await seed();
    const { runtime } = createRuntime();
    await expect(knowledgeSyncCommand({ concurrency: "0", out, source }, runtime)).rejects.toThrow(
      /--concurrency must be an integer/u,
    );
    await expect(knowledgeSyncCommand({ maxBytes: "many", out, source }, runtime)).rejects.toThrow(
      /--max-bytes must be an integer/u,
    );
    await expect(knowledgeSyncCommand({ source }, runtime)).rejects.toThrow(/--out is required/u);
  });
});
