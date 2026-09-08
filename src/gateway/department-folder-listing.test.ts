import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  departmentFolderRootCandidates,
  isDepartmentFolderRejection,
  listDepartmentFolders,
  parseDepartmentFolderPath,
  resolveDepartmentFolderRoot,
} from "./department-folder-listing.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

/**
 * A share root with two departments, one ordinary file, and one link out.
 *
 * The link is the point of the fixture: it is the shape an attacker plants inside a share
 * they can write to, and it must not appear in a picker whose whole promise is that every
 * row is inside the root.
 */
async function buildShareRoot(): Promise<{ root: string; outside: string }> {
  const base = tempDirs.make("openclaw-department-folders-");
  const root = path.join(base, "nas");
  const outside = path.join(base, "elsewhere");
  await mkdir(path.join(root, "rnd", "docs"), { recursive: true });
  await mkdir(path.join(root, "qa"), { recursive: true });
  await mkdir(path.join(outside, "payroll"), { recursive: true });
  await writeFile(path.join(root, "readme.txt"), "not a folder", "utf8");
  await symlink(outside, path.join(root, "escape"), "dir");
  return { root, outside };
}

describe("department folder path parsing", () => {
  it("accepts an empty path as the root", () => {
    expect(parseDepartmentFolderPath(undefined)).toEqual([]);
    expect(parseDepartmentFolderPath("  ")).toEqual([]);
  });

  it("accepts a plain relative path in either separator", () => {
    expect(parseDepartmentFolderPath("rnd/docs")).toEqual(["rnd", "docs"]);
    expect(parseDepartmentFolderPath("rnd\\docs")).toEqual(["rnd", "docs"]);
  });

  it("refuses an absolute path in either syntax", () => {
    expect(parseDepartmentFolderPath("/etc")).toBeUndefined();
    expect(parseDepartmentFolderPath("C:\\Windows")).toBeUndefined();
    expect(parseDepartmentFolderPath("\\\\server\\share")).toBeUndefined();
  });

  it("refuses a traversal before any filesystem call", () => {
    expect(parseDepartmentFolderPath("..")).toBeUndefined();
    expect(parseDepartmentFolderPath("rnd/../../etc")).toBeUndefined();
  });
});

describe("department folder root", () => {
  it("prefers the configured host root, then the fixed mount point", () => {
    expect(departmentFolderRootCandidates({ OPENCLAW_NAS_ROOT: "/srv/nas" })).toEqual([
      "/srv/nas",
      "/mnt/nas",
    ]);
    expect(departmentFolderRootCandidates({})).toEqual(["/mnt/nas"]);
    expect(departmentFolderRootCandidates({ OPENCLAW_NAS_ROOT: "  " })).toEqual(["/mnt/nas"]);
  });

  it("reports the default as unavailable when nothing is mounted", async () => {
    const resolved = await resolveDepartmentFolderRoot({
      OPENCLAW_NAS_ROOT: path.join(tempDirs.make("openclaw-department-missing-"), "absent"),
    });
    expect(resolved.available).toBe(false);
  });

  it("resolves a configured root that really exists", async () => {
    const { root } = await buildShareRoot();
    const resolved = await resolveDepartmentFolderRoot({ OPENCLAW_NAS_ROOT: root });
    expect(resolved.available).toBe(true);
    expect(resolved.root).toContain("nas");
  });
});

describe("department folder listing", () => {
  it("lists only the folders inside the root", async () => {
    const { root } = await buildShareRoot();
    const listing = await listDepartmentFolders({ root });
    if (isDepartmentFolderRejection(listing)) {
      throw new Error("the root itself must be listable");
    }
    expect(listing.available).toBe(true);
    expect(listing.entries.map((entry) => entry.name)).toEqual(["qa", "rnd"]);
    expect(listing.parent).toBeUndefined();
  });

  it("drops a symbolic link that leaves the root", async () => {
    const { root } = await buildShareRoot();
    const listing = await listDepartmentFolders({ root });
    if (isDepartmentFolderRejection(listing)) {
      throw new Error("the root itself must be listable");
    }
    expect(listing.entries.map((entry) => entry.name)).not.toContain("escape");
  });

  it("refuses a path that resolves outside the root through a link", async () => {
    const { root } = await buildShareRoot();
    const listing = await listDepartmentFolders({ root, path: "escape" });
    expect(isDepartmentFolderRejection(listing)).toBe(true);
  });

  it("refuses a traversal", async () => {
    const { root } = await buildShareRoot();
    expect(isDepartmentFolderRejection(await listDepartmentFolders({ root, path: "../" }))).toBe(
      true,
    );
    expect(isDepartmentFolderRejection(await listDepartmentFolders({ root, path: "/etc" }))).toBe(
      true,
    );
  });

  it("walks one level down and reports the parent", async () => {
    const { root } = await buildShareRoot();
    const listing = await listDepartmentFolders({ root, path: "rnd" });
    if (isDepartmentFolderRejection(listing)) {
      throw new Error("a folder inside the root must be listable");
    }
    expect(listing.path).toBe("rnd");
    expect(listing.parent).toBe("");
    expect(listing.entries.map((entry) => entry.name)).toEqual(["docs"]);
    expect(listing.entries[0]?.path).toBe("rnd/docs");
  });

  it("answers with an empty, unavailable listing when the root is not mounted", async () => {
    const listing = await listDepartmentFolders({
      root: path.join(tempDirs.make("openclaw-department-unmounted-"), "absent"),
    });
    if (isDepartmentFolderRejection(listing)) {
      throw new Error("a missing root is reported, not rejected");
    }
    expect(listing.available).toBe(false);
    expect(listing.entries).toEqual([]);
  });
});
