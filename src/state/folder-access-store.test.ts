import { afterEach, describe, expect, it } from "vitest";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  clearFolderRule,
  clearFolderRuleDescendants,
  listAllFolderRules,
  listFolderRulesForPaths,
  setFolderRule,
} from "./folder-access-store.js";
import { closeOpenClawAgentDatabasesForTest } from "./openclaw-agent-db.js";

afterEach(() => closeOpenClawAgentDatabasesForTest());

const ROOT = "/mnt/nas";

describe("folder access store", () => {
  it("writes a rule and reads it back by ancestry chain", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const rule = setFolderRule({
        scopeRoot: ROOT,
        folderPath: "00/a",
        subjectKind: "department",
        subjectId: "rnd",
        permission: "read",
        inherit: true,
        createdByProfileId: "p-admin",
        nowMs: 100,
      });
      expect(rule.folderPath).toBe("00/a");
      expect(rule.inherit).toBe(true);
      expect(rule.createdByProfileId).toBe("p-admin");
      const chain = listFolderRulesForPaths({
        scopeRoot: ROOT,
        folderPaths: ["00/a/b", "00/a", "00", ""],
      });
      expect(chain.map((row) => row.folderPath)).toEqual(["00/a"]);
    });
  });

  it("replaces the same subject on the same folder instead of adding a second row", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setFolderRule({
        scopeRoot: ROOT,
        folderPath: "00",
        subjectKind: "role",
        subjectId: "member",
        permission: "read",
        inherit: true,
        nowMs: 100,
      });
      const second = setFolderRule({
        scopeRoot: ROOT,
        folderPath: "00",
        subjectKind: "role",
        subjectId: "member",
        permission: "hidden",
        inherit: false,
        nowMs: 200,
      });
      const rows = listAllFolderRules(ROOT);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.permission).toBe("hidden");
      expect(rows[0]?.inherit).toBe(false);
      // The first write is when the rule came into being; the second only changes it.
      expect(second.createdAt).toBe(100);
      expect(second.updatedAt).toBe(200);
    });
  });

  it("keeps rules for different scope roots apart", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setFolderRule({
        scopeRoot: ROOT,
        folderPath: "00",
        subjectKind: "role",
        subjectId: "member",
        permission: "read",
        inherit: true,
        nowMs: 1,
      });
      setFolderRule({
        scopeRoot: "/mnt/other",
        folderPath: "00",
        subjectKind: "role",
        subjectId: "member",
        permission: "write",
        inherit: true,
        nowMs: 1,
      });
      expect(listAllFolderRules(ROOT)).toHaveLength(1);
      expect(listAllFolderRules("/mnt/other")[0]?.permission).toBe("write");
    });
  });

  it("clears one folder's rule without touching the rest", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      for (const folderPath of ["00", "00/a"]) {
        setFolderRule({
          scopeRoot: ROOT,
          folderPath,
          subjectKind: "department",
          subjectId: "rnd",
          permission: "read",
          inherit: true,
          nowMs: 1,
        });
      }
      expect(
        clearFolderRule({
          scopeRoot: ROOT,
          folderPath: "00/a",
          subjectKind: "department",
          subjectId: "rnd",
        }),
      ).toBe(1);
      expect(listAllFolderRules(ROOT).map((row) => row.folderPath)).toEqual(["00"]);
      expect(
        clearFolderRule({
          scopeRoot: ROOT,
          folderPath: "00/a",
          subjectKind: "department",
          subjectId: "rnd",
        }),
      ).toBe(0);
    });
  });

  it("clears descendants of one folder for one subject only", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const write = (folderPath: string, subjectId: string) =>
        setFolderRule({
          scopeRoot: ROOT,
          folderPath,
          subjectKind: "department",
          subjectId,
          permission: "read",
          inherit: true,
          nowMs: 1,
        });
      write("00", "rnd");
      write("00/a", "rnd");
      write("00/a/b", "rnd");
      write("00/a", "qa");
      // A sibling whose name merely starts with the same letters must survive.
      write("00x", "rnd");
      expect(
        clearFolderRuleDescendants({
          scopeRoot: ROOT,
          folderPath: "00",
          subjectKind: "department",
          subjectId: "rnd",
        }),
      ).toBe(2);
      expect(
        listAllFolderRules(ROOT)
          .map((row) => `${row.folderPath}:${row.subjectId}`)
          .sort(),
      ).toEqual(["00:rnd", "00/a:qa", "00x:rnd"]);
    });
  });

  it("treats the root as the parent of every rule when applying to descendants", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      for (const folderPath of ["", "00", "01/deep"]) {
        setFolderRule({
          scopeRoot: ROOT,
          folderPath,
          subjectKind: "role",
          subjectId: "member",
          permission: "read",
          inherit: true,
          nowMs: 1,
        });
      }
      expect(
        clearFolderRuleDescendants({
          scopeRoot: ROOT,
          folderPath: "",
          subjectKind: "role",
          subjectId: "member",
        }),
      ).toBe(2);
      expect(listAllFolderRules(ROOT).map((row) => row.folderPath)).toEqual([""]);
    });
  });
});
