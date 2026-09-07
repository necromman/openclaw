// Knowledge command registration for the document sidecar index.
import type { Command } from "commander";
import {
  knowledgeSyncCommand,
  type KnowledgeSyncCommandOptions,
} from "../../commands/knowledge.js";
import {
  KNOWLEDGE_DEFAULT_CONCURRENCY,
  KNOWLEDGE_DEFAULT_INCLUDE,
  KNOWLEDGE_DEFAULT_MAX_BYTES,
} from "../../knowledge/types.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

function optionalOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Register `openclaw knowledge sync` and its parent group. */
export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program
    .command("knowledge")
    .description("Index document folders as Markdown sidecars for memory search");
  knowledge
    .command("sync")
    .description("Convert a document folder into Markdown sidecars in an index folder")
    .requiredOption("--source <dir>", "Folder to read documents from (never written to)")
    .requiredOption("--out <dir>", "Index folder the sidecars are written to")
    .option(
      "--include <extensions>",
      "Comma-separated extensions to index",
      KNOWLEDGE_DEFAULT_INCLUDE.join(","),
    )
    .option(
      "--max-bytes <bytes>",
      "Skip source files larger than this",
      String(KNOWLEDGE_DEFAULT_MAX_BYTES),
    )
    .option(
      "--concurrency <count>",
      "How many documents to convert at once",
      String(KNOWLEDGE_DEFAULT_CONCURRENCY),
    )
    .option("--dry-run", "Report what would change without converting or writing", false)
    .option("--verbose", "Also list skipped and ignored files", false)
    .option("--json", "Output the run summary as JSON", false)
    .action(async (opts: Record<string, unknown>) => {
      const options: KnowledgeSyncCommandOptions = {
        dryRun: Boolean(opts.dryRun),
        json: Boolean(opts.json),
        verbose: Boolean(opts.verbose),
        ...(optionalOption(opts.source) ? { source: optionalOption(opts.source) } : {}),
        ...(optionalOption(opts.out) ? { out: optionalOption(opts.out) } : {}),
        ...(optionalOption(opts.include) ? { include: optionalOption(opts.include) } : {}),
        ...(optionalOption(opts.maxBytes) ? { maxBytes: optionalOption(opts.maxBytes) } : {}),
        ...(optionalOption(opts.concurrency)
          ? { concurrency: optionalOption(opts.concurrency) }
          : {}),
      };
      await runCommandWithRuntime(defaultRuntime, async () => {
        await knowledgeSyncCommand(options, defaultRuntime);
      });
    });
}
