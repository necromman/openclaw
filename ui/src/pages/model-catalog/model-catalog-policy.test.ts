import { describe, expect, it } from "vitest";
import {
  allowlistCovers,
  buildProviderGroups,
  selectableModelRefs,
  toggleAllowedModel,
  toggleProviderAll,
} from "./model-catalog-policy.ts";

const catalog = [
  { provider: "openai", id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
  { provider: "openai", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5" },
];

const auth = [
  { provider: "openai", displayName: "OpenAI", status: "ok" },
  { provider: "anthropic", displayName: "Anthropic", status: "error" },
];

describe("buildProviderGroups", () => {
  it("groups the catalog and marks the allowlist", () => {
    const groups = buildProviderGroups({
      catalog,
      auth,
      allow: ["openai/gpt-5.6-luna"],
    });
    expect(groups.map((group) => group.provider)).toEqual(["anthropic", "openai"]);
    const openai = groups.find((group) => group.provider === "openai");
    expect(openai?.authenticated).toBe(true);
    expect(openai?.allowAll).toBe(false);
    expect(openai?.allowedCount).toBe(1);
    expect(groups.find((group) => group.provider === "anthropic")?.authenticated).toBe(false);
  });

  it("marks a provider opened by its wildcard without listing the wildcard as a model", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: ["openai/*"] });
    const openai = groups.find((group) => group.provider === "openai");
    expect(openai?.allowAll).toBe(true);
    expect(openai?.models.map((model) => model.ref)).toEqual([
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
    ]);
  });

  it("keeps a pinned model the catalog does not list", () => {
    const groups = buildProviderGroups({
      catalog: [],
      auth: [],
      allow: [],
      pinned: ["openai/gpt-5.6-luna"],
    });
    expect(groups[0]?.models.map((model) => model.ref)).toEqual(["openai/gpt-5.6-luna"]);
  });

  it("lists an authenticated provider that answers no models", () => {
    const groups = buildProviderGroups({
      catalog: [],
      auth: [{ provider: "openai", displayName: "OpenAI", status: "ok" }],
      allow: [],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.models).toEqual([]);
  });
});

describe("toggleAllowedModel", () => {
  it("adds and removes one exact model", () => {
    expect(toggleAllowedModel([], "openai/a")).toEqual(["openai/a"]);
    expect(toggleAllowedModel(["openai/a", "openai/b"], "openai/a")).toEqual(["openai/b"]);
  });
});

describe("toggleProviderAll", () => {
  it("replaces this provider's exact entries with its wildcard", () => {
    expect(toggleProviderAll(["openai/a", "anthropic/b"], "openai")).toEqual([
      "anthropic/b",
      "openai/*",
    ]);
  });

  it("removes the wildcard again and leaves other providers alone", () => {
    expect(toggleProviderAll(["openai/*", "anthropic/b"], "openai")).toEqual(["anthropic/b"]);
  });
});

describe("allowlistCovers", () => {
  it("treats an empty allowlist as no restriction", () => {
    expect(allowlistCovers([], "openai/a")).toBe(true);
  });

  it("covers by exact name or by provider wildcard", () => {
    expect(allowlistCovers(["openai/a"], "openai/a")).toBe(true);
    expect(allowlistCovers(["openai/*"], "openai/a")).toBe(true);
    expect(allowlistCovers(["openai/*"], "anthropic/b")).toBe(false);
  });
});

describe("selectableModelRefs", () => {
  it("offers catalog rows rather than the wildcard itself", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: ["openai/*"] });
    expect(selectableModelRefs({ groups, allow: ["openai/*"] })).toEqual([
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
    ]);
  });

  it("offers everything when nothing is restricted", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: [] });
    expect(selectableModelRefs({ groups, allow: [] })).toEqual([
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
    ]);
  });
});
