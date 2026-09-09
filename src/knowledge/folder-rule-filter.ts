// Applies the folder access rules to `openclaw knowledge sync`.
//
// Who is asking, at index time, is nobody. The sync is a cron entry: it reads a share
// and writes Markdown sidecars into one shared pool that memory search reads later. There
// is no request identity to decide against, and there is no per-reader filter on the way
// out of that pool. So the only verdict available at that moment is about the folder,
// and it is the one this module takes: a folder is indexed when the operator has opened
// it to somebody, and left alone when nobody has been named.
//
// That is the same default the screen uses, read from the same table. A folder with no
// rule in its chain is hidden from everyone, so it never produces a sidecar; a folder
// that is hidden after the fact stops being walked, and the sync's existing orphan pass
// then removes the sidecars it wrote before, because a sidecar survives only as long as
// the walk keeps finding its source.
//
// Two switches keep this from surprising a deployment that is not using the feature.
// The rules only ever apply inside the shared mount, and they only apply to a share the
// rule table actually mentions: a rule on the share itself, on something under it, or on
// an ancestor it inherits from. A share nobody has ruled on has not been described yet,
// and reading "described by nothing" as "secret from everyone" would empty an index the
// operator never meant to touch. Once the first rule naming a share is written, that
// share is governed and the default inside it is hidden, as it is everywhere else.
import { realpath } from "node:fs/promises";
import path from "node:path";
import { resolveDepartmentFolderRoot } from "../gateway/department-folder-listing.js";
import {
  folderRuleAncestry,
  isFolderPathUnder,
  normalizeFolderRulePath,
} from "../gateway/folder-access-path.js";
import {
  buildFolderRuleIndex,
  isFolderVisibleToAnySubject,
} from "../gateway/folder-access-policy.js";
import { listAllFolderRules } from "../state/folder-access-store.js";

/** The index-time verdict for one share, or nothing when the rules do not reach it. */
export type KnowledgeFolderFilter = {
  /** Mount the rules are written against. */
  scopeRoot: string;
  /** How many rules were in force for this run. */
  ruleCount: number;
  /** True when a folder, named relative to `--source`, may be indexed. */
  allows: (relativeDirectory: string) => boolean;
};

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function joinRulePath(base: string, relative: string): string {
  const trimmed = relative.replace(/^\/+|\/+$/gu, "");
  if (trimmed.length === 0 || trimmed === ".") {
    return base;
  }
  return base.length === 0 ? trimmed : `${base}/${trimmed}`;
}

/**
 * Prepare the folder filter for one sync, or report that none applies.
 *
 * Returns `undefined` when the shared mount is not present here, when `--source` is not
 * inside it, or when no rule has been written yet. In every one of those cases the sync
 * behaves exactly as it did before this existed.
 */
export async function prepareKnowledgeFolderFilter(params: {
  source: string;
}): Promise<KnowledgeFolderFilter | undefined> {
  const scope = await resolveDepartmentFolderRoot();
  if (!scope.available) {
    return undefined;
  }
  let sourceReal: string;
  try {
    sourceReal = await realpath(params.source);
  } catch {
    return undefined;
  }
  const relative = path.relative(scope.root, sourceReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  const base = normalizeFolderRulePath(toPosix(relative));
  if (base === undefined) {
    return undefined;
  }
  const rules = listAllFolderRules(scope.root);
  // An ancestor rule counts only when it inherits; one pinned to a single folder above
  // this share says nothing about the share.
  const ancestors = new Set(folderRuleAncestry(base).slice(1));
  const relevant = rules.filter(
    (rule) =>
      isFolderPathUnder(base, rule.folderPath) || (ancestors.has(rule.folderPath) && rule.inherit),
  );
  if (relevant.length === 0) {
    return undefined;
  }
  const index = buildFolderRuleIndex(rules);
  return {
    scopeRoot: scope.root,
    ruleCount: relevant.length,
    allows: (relativeDirectory: string) =>
      isFolderVisibleToAnySubject({
        folderPath: joinRulePath(base, toPosix(relativeDirectory)),
        index,
      }),
  };
}
