// Directory browsing for the department screen's workspace picker.
//
// The picker exists so an operator can point an agent at a share without typing a path,
// and the point of this module is that the browser never gets to name the root. A folder
// is offerable only when it resolves, after every symbolic link is followed, to something
// inside the mount root the server chose. That check is here rather than on the screen
// because a screen check is a suggestion and this one is a boundary.
//
// Nothing here writes, and nothing here changes what an agent may reach: naming a folder
// as an agent's workspace is a separate, config-validated act. This only decides what may
// appear in the list.
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Where the shares appear inside the Gateway container.
 *
 * The compose file mounts every department share at `/mnt/nas/<slug>` regardless of where
 * they live on the host, so this is the path that exists on this side of the boundary.
 */
export const DEFAULT_DEPARTMENT_FOLDER_ROOT = "/mnt/nas";

/** Upper bound on one listing. A share with more folders than this is not a picker. */
const MAX_DEPARTMENT_FOLDER_ENTRIES = 500;

export type DepartmentFolderListing = {
  root: string;
  available: boolean;
  path: string;
  parent?: string;
  entries: { name: string; path: string; absolutePath: string }[];
};

/** A relative path that left the root, or was never relative to begin with. */
export type DepartmentFolderRejection = { rejected: "outside_root" };

export function isDepartmentFolderRejection(
  value: DepartmentFolderListing | DepartmentFolderRejection,
): value is DepartmentFolderRejection {
  return "rejected" in value;
}

/**
 * The roots this deployment might hold the shares under, most specific first.
 *
 * The compose file fixes the container-side mount point, so the default needs no setting
 * of its own. The share-root variable the compose file reads is deliberately not read
 * here: it names the parent of the shares *on the host*, which is what compose needs it
 * for and which usually does not exist inside the container. A deployment that mounts
 * somewhere else passes its own root instead of relying on a second name for the same
 * thing (see chris-local/DEPLOY.md section 11.4).
 */
export function departmentFolderRootCandidates(overrideRoot?: string): string[] {
  const configured = overrideRoot?.trim();
  return configured && configured.length > 0
    ? [configured, DEFAULT_DEPARTMENT_FOLDER_ROOT]
    : [DEFAULT_DEPARTMENT_FOLDER_ROOT];
}

/** The first candidate root that exists here, or the default when none does. */
export async function resolveDepartmentFolderRoot(
  overrideRoot?: string,
): Promise<{ root: string; available: boolean }> {
  for (const candidate of departmentFolderRootCandidates(overrideRoot)) {
    try {
      return { root: await realpath(candidate), available: true };
    } catch {
      // Not mounted here. Try the next candidate.
    }
  }
  return { root: DEFAULT_DEPARTMENT_FOLDER_ROOT, available: false };
}

/**
 * Split one client-sent path into segments, or refuse it.
 *
 * Absolute paths are refused in both syntaxes rather than normalized: a caller that sends
 * one is asking for a root of its own, and the answer to that is always no. `..` is
 * refused for the same reason, before any filesystem call, so a traversal attempt never
 * reaches `readdir` at all.
 */
export function parseDepartmentFolderPath(raw: string | undefined): string[] | undefined {
  const value = (raw ?? "").trim();
  if (value.length === 0) {
    return [];
  }
  if (path.posix.isAbsolute(value.replaceAll("\\", "/")) || path.win32.isAbsolute(value)) {
    return undefined;
  }
  const segments: string[] = [];
  for (const segment of value.split(/[\\/]+/u)) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment);
  }
  return segments;
}

/** True when `candidate` is the root itself or lives under it. */
function isInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function toRelativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

/**
 * List the directories directly under one folder inside the mount root.
 *
 * Every level is re-checked after `realpath`, including each child, so a symbolic link
 * planted inside a share cannot smuggle another part of the filesystem into the picker.
 * A child that escapes is dropped rather than reported: the operator is choosing a
 * workspace, and a link out of the share is not one of the choices.
 */
export async function listDepartmentFolders(params: {
  root: string;
  available?: boolean;
  path?: string;
}): Promise<DepartmentFolderListing | DepartmentFolderRejection> {
  const segments = parseDepartmentFolderPath(params.path);
  if (!segments) {
    return { rejected: "outside_root" };
  }
  const relativePath = segments.join("/");
  const empty: DepartmentFolderListing = {
    root: params.root,
    available: false,
    path: relativePath,
    ...(segments.length > 0 ? { parent: segments.slice(0, -1).join("/") } : {}),
    entries: [],
  };
  if (params.available === false) {
    return empty;
  }
  let rootReal: string;
  try {
    rootReal = await realpath(params.root);
  } catch {
    return empty;
  }
  let targetReal: string;
  try {
    targetReal = await realpath(path.join(rootReal, ...segments));
  } catch {
    // A path that does not resolve is refused rather than reported as empty: the caller
    // asked about somewhere that is not here, and an empty listing would read as "this
    // folder has no subfolders".
    return { rejected: "outside_root" };
  }
  if (!isInsideRoot(rootReal, targetReal)) {
    return { rejected: "outside_root" };
  }
  let names: string[];
  try {
    names = await readdir(targetReal);
  } catch {
    return { ...empty, root: rootReal, available: true };
  }
  const entries: DepartmentFolderListing["entries"] = [];
  for (const name of names) {
    if (entries.length >= MAX_DEPARTMENT_FOLDER_ENTRIES) {
      break;
    }
    if (name.startsWith(".")) {
      continue;
    }
    let childReal: string;
    try {
      childReal = await realpath(path.join(targetReal, name));
      if (!(await stat(childReal)).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    if (!isInsideRoot(rootReal, childReal)) {
      continue;
    }
    const childRelative = toRelativePath(rootReal, childReal);
    if (childRelative.length === 0) {
      continue;
    }
    entries.push({ name, path: childRelative, absolutePath: childReal });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return {
    root: rootReal,
    available: true,
    path: toRelativePath(rootReal, targetReal),
    ...(targetReal === rootReal ? {} : { parent: segments.slice(0, -1).join("/") }),
    entries,
  };
}
