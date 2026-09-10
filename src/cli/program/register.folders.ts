// Folder command registration for the shared-mount tree snapshot.
import type { Command } from "commander";
import {
  foldersClearCommand,
  foldersScanCommand,
  foldersStatusCommand,
  type FoldersClearCommandOptions,
  type FoldersScanCommandOptions,
  type FoldersStatusCommandOptions,
} from "../../commands/folders.js";
import { FOLDER_TREE_DEFAULT_CONCURRENCY } from "../../gateway/folder-tree-scan.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

function optionalOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Register `openclaw folders` and its subcommands. */
export function registerFoldersCommand(program: Command): void {
  const folders = program
    .command("folders")
    .description("Index the shared folder tree so the folder screen does not read the NAS");
  folders
    .command("scan")
    .description("Walk the shared mount and store where its folders are")
    .option("--root <dir>", "Mount root to walk. Defaults to the container mount point")
    .option("--path <dir>", "Root-relative branch to walk. Defaults to the whole mount")
    .option(
      "--concurrency <count>",
      "How many directories to read at once",
      String(FOLDER_TREE_DEFAULT_CONCURRENCY),
    )
    .option("--quiet", "Do not print progress lines", false)
    .option("--json", "Output the run summary as JSON", false)
    .action(async (opts: Record<string, unknown>) => {
      const options: FoldersScanCommandOptions = {
        json: Boolean(opts.json),
        quiet: Boolean(opts.quiet),
        ...(optionalOption(opts.root) ? { root: optionalOption(opts.root) } : {}),
        ...(optionalOption(opts.path) ? { path: optionalOption(opts.path) } : {}),
        ...(optionalOption(opts.concurrency)
          ? { concurrency: optionalOption(opts.concurrency) }
          : {}),
      };
      await runCommandWithRuntime(defaultRuntime, async () => {
        await foldersScanCommand(options, defaultRuntime);
      });
    });
  folders
    .command("status")
    .description("Report when the folder snapshot was last written")
    .option("--root <dir>", "Mount root to report on")
    .option("--json", "Output the status as JSON", false)
    .action(async (opts: Record<string, unknown>) => {
      const options: FoldersStatusCommandOptions = {
        json: Boolean(opts.json),
        ...(optionalOption(opts.root) ? { root: optionalOption(opts.root) } : {}),
      };
      await runCommandWithRuntime(defaultRuntime, async () => {
        await foldersStatusCommand(options, defaultRuntime);
      });
    });
  folders
    .command("clear")
    .description("Forget the folder snapshot; the screen reads the NAS live again")
    .option("--root <dir>", "Mount root to forget")
    .action(async (opts: Record<string, unknown>) => {
      const options: FoldersClearCommandOptions = optionalOption(opts.root)
        ? { root: optionalOption(opts.root) }
        : {};
      await runCommandWithRuntime(defaultRuntime, async () => {
        await foldersClearCommand(options, defaultRuntime);
      });
    });
}
