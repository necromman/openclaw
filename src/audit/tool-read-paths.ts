// Extracts the file paths a tool call is about to reveal.
//
// The metadata ledger deliberately stores no tool arguments at all. The delivery contract
// asks the opposite question - "which materials did this person look at" - which cannot be
// answered without the path. The compromise is this module: a closed list of tools whose
// whole purpose is to surface a file, and a closed list of parameter names that name one.
// Nothing else from the argument object is ever read, so a tool that happens to carry a
// secret in some other field cannot leak it into the ledger by accident.
import { isRecord } from "@openclaw/normalization-core/record-coerce";

/**
 * Tools whose successful call means a person saw file content.
 *
 * Deliberately not "every tool with a path argument": a write or an edit is a different
 * event, and a tool added later is excluded until someone decides it belongs here.
 */
const READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "read_file",
  "memory_get",
  "memory_search",
  "sessions_files",
  "session_files",
  "workspace_read",
  // Opening a chat attachment is the same event as opening a file. Its companion
  // `media_list` is not here: a listing of one's own uploads reveals names, not content.
  "media_read",
]);

/**
 * Argument names that name a file. `execute-plugin.ts` already folds file_path onto path.
 *
 * `id` is here for `media_read`, whose file is addressed by its media-store id rather than
 * a path. The id carries the uploader's own file name, which is what the ledger needs to
 * say what was opened. Only tools in the closed list above are ever read, so no other
 * tool's `id` argument can reach the ledger through it.
 */
const PATH_PARAM_NAMES = ["path", "file_path", "filePath", "paths", "files", "id"] as const;

/** No ledger row needs more than this to say what was opened. */
const MAX_RECORDED_PATHS = 8;
const MAX_PATH_CHARS = 512;

function collectPathValue(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      into.push(trimmed.length > MAX_PATH_CHARS ? trimmed.slice(0, MAX_PATH_CHARS) : trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (into.length >= MAX_RECORDED_PATHS) {
        return;
      }
      collectPathValue(item, into);
    }
  }
}

/** True when a successful call to this tool means a person saw file content. */
export function isFileRevealingToolName(toolName: string): boolean {
  return READ_TOOL_NAMES.has(toolName);
}

/**
 * The paths this call names, or an empty array when it names none.
 *
 * Returns an array rather than the raw arguments so the caller physically cannot pass the
 * rest of the argument object on to storage.
 */
export function projectToolReadPaths(toolName: string, params: unknown): string[] {
  if (!isFileRevealingToolName(toolName) || !isRecord(params)) {
    return [];
  }
  const paths: string[] = [];
  for (const name of PATH_PARAM_NAMES) {
    if (paths.length >= MAX_RECORDED_PATHS) {
      break;
    }
    collectPathValue(params[name], paths);
  }
  return paths.slice(0, MAX_RECORDED_PATHS);
}

/** Spread-friendly form for the diagnostic event builder: absent when nothing was named. */
export function projectToolReadPathsFact(
  toolName: string,
  params: unknown,
): { readPaths?: string[] } {
  const readPaths = projectToolReadPaths(toolName, params);
  return readPaths.length > 0 ? { readPaths } : {};
}
