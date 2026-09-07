/** Operator CLI for the document sidecar index that makes a share searchable. */
import { sanitizeTerminalText } from "../../packages/terminal-core/src/safe-text.js";
import { syncKnowledgeIndex } from "../knowledge/sync.js";
import type { KnowledgeSyncEntry, KnowledgeSyncSummary } from "../knowledge/types.js";
import { KNOWLEDGE_MAX_BYTES_LIMIT, KNOWLEDGE_MAX_CONCURRENCY } from "../knowledge/types.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";

export type KnowledgeSyncCommandOptions = {
  source?: string;
  out?: string;
  include?: string;
  maxBytes?: string;
  concurrency?: string;
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
};

/** Rows an operator always wants to see; the rest need `--verbose`. */
const ALWAYS_SHOWN: ReadonlySet<KnowledgeSyncEntry["action"]> = new Set([
  "created",
  "updated",
  "deleted",
  "failed",
]);

function parseCount(value: string | undefined, flag: string, max: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${flag} must be an integer between 1 and ${max}.`);
  }
  return parsed;
}

function requireOption(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${flag} is required.`);
  }
  return trimmed;
}

function formatRows(summary: KnowledgeSyncSummary, verbose: boolean): string[] {
  const rows = ["ACTION\tCONVERTER\tSOURCE\tDETAIL"];
  for (const entry of summary.entries) {
    if (!verbose && !ALWAYS_SHOWN.has(entry.action)) {
      continue;
    }
    rows.push(
      [
        entry.action,
        entry.converter ?? "-",
        sanitizeTerminalText(entry.relativePath),
        entry.reason ?? "-",
      ].join("\t"),
    );
  }
  return rows;
}

function formatCounts(summary: KnowledgeSyncSummary): string {
  const counts = summary.counts;
  return [
    `created=${counts.created}`,
    `updated=${counts.updated}`,
    `deleted=${counts.deleted}`,
    `skipped=${counts.skipped}`,
    `ignored=${counts.ignored}`,
    `failed=${counts.failed}`,
  ].join("  ");
}

/**
 * `openclaw knowledge sync` - convert a document share into Markdown sidecars.
 *
 * The command owns no schedule of its own: a cron entry or a timer runs it, and the
 * agent that should see the result names the index folder in
 * `memory.search.extraPaths`.
 */
export async function knowledgeSyncCommand(
  options: KnowledgeSyncCommandOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const maxBytes = parseCount(options.maxBytes, "--max-bytes", KNOWLEDGE_MAX_BYTES_LIMIT);
  const concurrency = parseCount(options.concurrency, "--concurrency", KNOWLEDGE_MAX_CONCURRENCY);
  const summary = await syncKnowledgeIndex({
    dryRun: options.dryRun === true,
    out: requireOption(options.out, "--out"),
    source: requireOption(options.source, "--source"),
    ...(options.include ? { include: options.include.split(",") } : {}),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(concurrency === undefined ? {} : { concurrency }),
  });
  if (options.json) {
    writeRuntimeJson(runtime, summary);
    return;
  }
  for (const row of formatRows(summary, options.verbose === true)) {
    runtime.log(row);
  }
  runtime.log(
    `${summary.dryRun ? "dry-run  " : ""}${formatCounts(summary)}  (${summary.durationMs}ms)`,
  );
  if (summary.converterMissing) {
    runtime.log(
      "LibreOffice was not found, so slide and legacy office files were left out. Install libreoffice-impress and rerun.",
    );
  }
  if (summary.counts.failed > 0) {
    runtime.log("Rerun with --verbose to see every skipped file.");
  }
}
