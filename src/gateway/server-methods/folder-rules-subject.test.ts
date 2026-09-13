// The rule table read and written from the subject's side.
//
// Two things are worth proving and one is easy to get wrong. `folders.subject.tree` must
// keep hidden folders in the answer, because the editor exists to un-hide one, while
// `folders.tree.list` next door must keep dropping them. And `folders.rules.setMany`
// must land every item it can: an operator's page of edits that stops at the first bad
// path is worse than one that reports which row failed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAllFolderRules, setFolderRule } from "../../state/folder-access-store.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import { withOpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { folderRulesSubjectHandlers } from "./folder-rules-subject.js";

const ROOT = "/mnt/share";

const hoisted = vi.hoisted(() => ({
  resolveDepartmentFolderRoot: vi.fn(),
  readFolderLevel: vi.fn(),
}));

vi.mock("../department-folder-listing.js", async () => {
  const actual = await vi.importActual<typeof import("../department-folder-listing.js")>(
    "../department-folder-listing.js",
  );
  return { ...actual, resolveDepartmentFolderRoot: hoisted.resolveDepartmentFolderRoot };
});

vi.mock("../folder-tree-index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../folder-tree-index.js")>("../folder-tree-index.js");
  return { ...actual, readFolderLevel: hoisted.readFolderLevel };
});

function levelEntry(name: string) {
  return { name, path: name, absolutePath: `${ROOT}/${name}`, hasChildren: false };
}

beforeEach(() => {
  hoisted.resolveDepartmentFolderRoot.mockResolvedValue({ root: ROOT, available: true });
  hoisted.readFolderLevel.mockResolvedValue({
    root: ROOT,
    available: true,
    path: "",
    entries: [levelEntry("open"), levelEntry("secret")],
    source: "index",
    indexedAt: 5,
  });
});

afterEach(() => {
  hoisted.resolveDepartmentFolderRoot.mockReset();
  hoisted.readFolderLevel.mockReset();
  closeOpenClawAgentDatabasesForTest();
});

function createResponder() {
  const calls: { ok: boolean; payload?: unknown; error?: unknown }[] = [];
  return {
    calls,
    respond: (ok: boolean, payload?: unknown, error?: unknown) => {
      calls.push({ ok, payload, error });
    },
  };
}

/** A connection that passed the descriptor scope gate and holds no identity. */
const ADMIN_CLIENT = { connect: { scopes: ["operator.admin"] } };

/** A verified staff login: an identity with a rank that may not manage folder rules. */
const STAFF_CLIENT = {
  connect: { scopes: ["operator.read"] },
  internal: {
    ixAuthDepartments: {
      departments: ["rnd"],
      isSuperAdmin: false,
      profileId: "p-staff",
      gatewayRole: "member",
    },
  },
};

async function invoke(
  method: "folders.subject.tree" | "folders.rules.setMany",
  params: Record<string, unknown>,
  client: unknown = ADMIN_CLIENT,
) {
  const responder = createResponder();
  await folderRulesSubjectHandlers[method]?.({
    req: { type: "req", id: method, method, params: {} },
    params,
    client: client as never,
    isWebchatConnect: () => false,
    respond: responder.respond,
    context: { getRuntimeConfig: () => ({}) } as never,
  });
  expect(responder.calls).toHaveLength(1);
  return responder.calls[0]!;
}

type SubjectTreeEntry = {
  path: string;
  effective: string;
  ownRule?: { permission: string; inherit: boolean };
  inheritedFrom?: string;
  ownRuleCount: number;
};

describe("folders.subject.tree", () => {
  it("keeps a hidden folder in the list so it can be opened again", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setFolderRule({
        scopeRoot: ROOT,
        folderPath: "open",
        subjectKind: "department",
        subjectId: "rnd",
        permission: "read",
        inherit: true,
        nowMs: 100,
      });
      const call = await invoke("folders.subject.tree", {
        subjectKind: "department",
        subjectId: "rnd",
      });
      expect(call.ok).toBe(true);
      const entries = (call.payload as { entries: SubjectTreeEntry[] }).entries;
      expect(entries.map((entry) => entry.path)).toEqual(["open", "secret"]);
      expect(entries[0]).toMatchObject({
        effective: "read",
        ownRule: { permission: "read", inherit: true },
        ownRuleCount: 1,
      });
      // No rule anywhere in its chain, so the default applies and nothing is written here.
      expect(entries[1]).toMatchObject({ effective: "hidden", ownRuleCount: 0 });
      expect(entries[1]?.ownRule).toBeUndefined();
    });
  });

  it("names the ancestor an inherited verdict came from", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setFolderRule({
        scopeRoot: ROOT,
        folderPath: "",
        subjectKind: "role",
        subjectId: "member",
        permission: "read",
        inherit: true,
        nowMs: 100,
      });
      const call = await invoke("folders.subject.tree", {
        subjectKind: "role",
        subjectId: "member",
      });
      const entries = (call.payload as { entries: SubjectTreeEntry[] }).entries;
      expect(entries[0]).toMatchObject({ effective: "read", inheritedFrom: "" });
      expect(entries[0]?.ownRule).toBeUndefined();
    });
  });

  it("answers write for the one role that is never gated", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const call = await invoke("folders.subject.tree", {
        subjectKind: "role",
        subjectId: "superadmin",
      });
      const entries = (call.payload as { entries: SubjectTreeEntry[] }).entries;
      expect(entries.map((entry) => entry.effective)).toEqual(["write", "write"]);
    });
  });

  it("refuses a caller whose rank may not manage folder rules", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const call = await invoke(
        "folders.subject.tree",
        { subjectKind: "department", subjectId: "rnd" },
        STAFF_CLIENT,
      );
      expect(call.ok).toBe(false);
      expect(hoisted.readFolderLevel).not.toHaveBeenCalled();
    });
  });
});

describe("folders.rules.setMany", () => {
  it("writes, removes and reports one row per folder", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setFolderRule({
        scopeRoot: ROOT,
        folderPath: "secret",
        subjectKind: "department",
        subjectId: "rnd",
        permission: "write",
        inherit: true,
        nowMs: 100,
      });
      const call = await invoke("folders.rules.setMany", {
        subjectKind: "department",
        subjectId: "rnd",
        items: [
          { path: "open", permission: "read", inherit: false },
          { path: "secret", permission: null },
        ],
      });
      expect(call.ok).toBe(true);
      expect((call.payload as { results: unknown[] }).results).toEqual([
        { path: "open", ok: true },
        { path: "secret", ok: true },
      ]);
      const rules = listAllFolderRules(ROOT);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ folderPath: "open", permission: "read", inherit: false });
    });
  });

  it("keeps going past a path it refuses and says which one failed", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const call = await invoke("folders.rules.setMany", {
        subjectKind: "role",
        subjectId: "member",
        items: [
          { path: "../escape", permission: "write" },
          { path: "open", permission: "write" },
        ],
      });
      const results = (call.payload as { results: { path: string; ok: boolean }[] }).results;
      expect(results[0]?.ok).toBe(false);
      expect(results[1]).toEqual({ path: "open", ok: true });
      expect(listAllFolderRules(ROOT).map((rule) => rule.folderPath)).toEqual(["open"]);
    });
  });

  it("clears the subject's rules below a folder when asked to apply downward", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      setFolderRule({
        scopeRoot: ROOT,
        folderPath: "open/inner",
        subjectKind: "department",
        subjectId: "rnd",
        permission: "hidden",
        inherit: true,
        nowMs: 100,
      });
      await invoke("folders.rules.setMany", {
        subjectKind: "department",
        subjectId: "rnd",
        items: [{ path: "open", permission: "read", applyToDescendants: true }],
      });
      expect(listAllFolderRules(ROOT).map((rule) => rule.folderPath)).toEqual(["open"]);
    });
  });

  it("refuses a caller whose rank may not manage folder rules", async () => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const call = await invoke(
        "folders.rules.setMany",
        {
          subjectKind: "department",
          subjectId: "rnd",
          items: [{ path: "open", permission: "write" }],
        },
        STAFF_CLIENT,
      );
      expect(call.ok).toBe(false);
      expect(listAllFolderRules(ROOT)).toHaveLength(0);
    });
  });
});
