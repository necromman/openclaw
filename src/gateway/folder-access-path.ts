// Path normalization for folder access rules.
//
// A rule is a string compared against another string, so the two sides have to be made
// identical before they are compared, and this module is the only place that decides
// what "identical" means. Three facts from the delivery NAS shape it (measured, see
// chris-local/NAS-FOLDER-ACL.md section 2.3):
//
//   - Folder names are almost all Korean, and ten of them are stored decomposed (NFD)
//     while the rest are composed (NFC). Without a normalization pass the same folder
//     compares as two different folders and a `hidden` rule silently stops applying.
//   - Names contain spaces, `#`, and characters like `star` and the middle dot. So a
//     path never goes to a shell, only into argument arrays, and escaping happens in the
//     presentation layer if anywhere.
//   - No two sibling folders differ only by case, so comparison stays case sensitive,
//     which is also what the filesystem underneath does.
//
// The rule string is never used to touch the filesystem. Directory access always uses
// the name `readdir` handed back, so a normalization mismatch can make a rule miss but
// can never make a read fail or reach somewhere else.
import path from "node:path";

/** Longest folder path a rule may name. The deepest measured real path was 586 bytes. */
export const MAX_FOLDER_RULE_PATH_LENGTH = 1024;

/**
 * Folder names that never take part in rules or listings.
 *
 * Every share carries a `#recycle` (the SMB trash) and an `@eaDir` (the Synology index
 * sidecar tree), plus `@tmp` scratch directories. They are storage bookkeeping, not
 * company folders, and listing them would ask an operator to rule on them.
 */
export function isExcludedFolderName(name: string): boolean {
  return name === "#recycle" || name === "@eaDir" || name.startsWith("@tmp");
}

/** True when any segment of a root-relative path is an excluded folder name. */
export function hasExcludedFolderSegment(folderPath: string): boolean {
  return folderPath.split("/").some((segment) => isExcludedFolderName(segment));
}

function hasForbiddenCharacter(value: string): boolean {
  // Control characters cannot appear in a real name here (measured: zero newline or tab
  // names on the delivery NAS) and a rule carrying one would only ever be a mistake, or
  // an injection attempt into something downstream that does split on them.
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize one client-sent folder path into the form rules are stored in.
 *
 * Returns `undefined` for anything that is not a path inside the root. The caller turns
 * that into the same answer as `hidden`, because a path the server cannot place is a path
 * the caller has no business naming.
 *
 * `scopeRoot` is optional and only used to strip an absolute prefix a caller may have
 * echoed back from a listing. An absolute path that is not under the root is refused
 * rather than reinterpreted.
 */
export function normalizeFolderRulePath(
  raw: string | undefined,
  scopeRoot?: string,
): string | undefined {
  const value = (raw ?? "").trim();
  if (value.length === 0) {
    return "";
  }
  if (hasForbiddenCharacter(value)) {
    return undefined;
  }
  let candidate = value.replaceAll("\\", "/");
  // A drive letter is never a relative path and never inside a POSIX mount root.
  if (/^[A-Za-z]:/u.test(candidate)) {
    return undefined;
  }
  // A path made only of separators names the root of this scope, not the filesystem
  // root. Refusing it would make the one path every caller can always name unnameable.
  if (/^\/+$/u.test(candidate)) {
    return "";
  }
  if (candidate.startsWith("/")) {
    const root = (scopeRoot ?? "").replaceAll("\\", "/").replace(/\/+$/u, "");
    if (root.length === 0) {
      return undefined;
    }
    if (candidate === root) {
      candidate = "";
    } else if (candidate.startsWith(`${root}/`)) {
      candidate = candidate.slice(root.length + 1);
    } else {
      return undefined;
    }
  }
  const segments: string[] = [];
  for (const segment of candidate.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment.normalize("NFC"));
  }
  const normalized = segments.join("/");
  if (normalized.length > MAX_FOLDER_RULE_PATH_LENGTH) {
    return undefined;
  }
  return normalized;
}

/**
 * The path itself and every ancestor, deepest first, ending at the root.
 *
 * `"a/b/c"` yields `["a/b/c", "a/b", "a", ""]`. The deepest measured tree is 23 levels,
 * so this loop is bounded by the filesystem rather than by a guard of its own.
 */
export function folderRuleAncestry(folderPath: string): string[] {
  const normalized = folderPath.replace(/^\/+|\/+$/gu, "");
  if (normalized.length === 0) {
    return [""];
  }
  const segments = normalized.split("/");
  const chain: string[] = [];
  for (let depth = segments.length; depth > 0; depth -= 1) {
    chain.push(segments.slice(0, depth).join("/"));
  }
  chain.push("");
  return chain;
}

/** Join a normalized rule path onto a root, for display only. */
export function folderRuleAbsolutePath(scopeRoot: string, folderPath: string): string {
  return folderPath.length === 0 ? scopeRoot : path.posix.join(scopeRoot, folderPath);
}

/** True when `candidate` is `parent` itself or lives under it. */
export function isFolderPathUnder(parent: string, candidate: string): boolean {
  if (parent.length === 0) {
    return true;
  }
  return candidate === parent || candidate.startsWith(`${parent}/`);
}
