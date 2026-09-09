import { describe, expect, it } from "vitest";
import {
  allowlistCovers,
  buildProviderGroups,
  canEnableModel,
  expandProviderWildcards,
  hasExpandableWildcard,
  pruneFallbacks,
  selectableModelRefs,
  setProviderAllowed,
  toggleAllowedModel,
  type ModelCatalogProviderGroup,
} from "./model-catalog-policy.ts";

const catalog = [
  { provider: "openai", id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
  { provider: "openai", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5" },
];

const auth = [
  { provider: "openai", displayName: "OpenAI", status: "ok" },
  { provider: "anthropic", displayName: "Anthropic", status: "missing" },
];

function groupFor(
  groups: readonly ModelCatalogProviderGroup[],
  provider: string,
): ModelCatalogProviderGroup {
  const group = groups.find((entry) => entry.provider === provider);
  if (!group) {
    throw new Error(`no group for ${provider}`);
  }
  return group;
}

function firstModel(group: ModelCatalogProviderGroup) {
  const model = group.models[0];
  if (!model) {
    throw new Error(`no models for ${group.provider}`);
  }
  return model;
}

describe("buildProviderGroups", () => {
  it("groups the catalog and marks the allowlist", () => {
    const groups = buildProviderGroups({
      catalog,
      auth,
      allow: ["openai/gpt-5.6-luna"],
    });
    expect(groups.map((group) => group.provider)).toEqual(["anthropic", "openai"]);
    const openai = groupFor(groups, "openai");
    expect(openai.authenticated).toBe(true);
    expect(openai.allowAll).toBe(false);
    expect(openai.wildcard).toBe(false);
    expect(openai.allowedCount).toBe(1);
    expect(groupFor(groups, "anthropic").authenticated).toBe(false);
  });

  it("calls a provider open when every one of its rows is switched on", () => {
    const groups = buildProviderGroups({
      catalog,
      auth,
      allow: ["openai/gpt-5.6-luna", "openai/gpt-5.6-sol"],
    });
    const openai = groupFor(groups, "openai");
    expect(openai.allowAll).toBe(true);
    expect(openai.wildcard).toBe(false);
  });

  it("shows an older wildcard as every row switched on, without listing it as a model", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: ["openai/*"] });
    const openai = groupFor(groups, "openai");
    expect(openai.wildcard).toBe(true);
    expect(openai.allowAll).toBe(true);
    expect(openai.models.every((model) => model.allowed)).toBe(true);
    expect(openai.models.map((model) => model.ref)).toEqual([
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

  it("counts a key from configuration and an expiring credential as working", () => {
    for (const status of ["static", "expiring"]) {
      const groups = buildProviderGroups({
        catalog,
        auth: [{ provider: "openai", displayName: "OpenAI", status }],
        allow: [],
      });
      expect(groupFor(groups, "openai").authenticated).toBe(true);
    }
  });

  it("lists an authenticated provider that answers no models", () => {
    const groups = buildProviderGroups({
      catalog: [],
      auth: [{ provider: "openai", displayName: "OpenAI", status: "ok" }],
      allow: [],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.models).toEqual([]);
    expect(groups[0]?.allowAll).toBe(false);
  });

  it("calls a provider with no rows open only when its wildcard is stored", () => {
    const groups = buildProviderGroups({
      catalog: [],
      auth: [{ provider: "openai", displayName: "OpenAI", status: "ok" }],
      allow: ["openai/*"],
    });
    expect(groups[0]?.allowAll).toBe(true);
    expect(groups[0]?.wildcard).toBe(true);
  });
});

describe("expandProviderWildcards", () => {
  it("replaces a wildcard with the catalog rows behind it", () => {
    const allow = ["openai/*", "anthropic/claude-sonnet-5"];
    const groups = buildProviderGroups({ catalog, auth, allow });
    expect(expandProviderWildcards({ allow, groups })).toEqual([
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
      "anthropic/claude-sonnet-5",
    ]);
  });

  it("leaves a list that names its models alone", () => {
    const allow = ["openai/gpt-5.6-luna"];
    const groups = buildProviderGroups({ catalog, auth, allow });
    expect(expandProviderWildcards({ allow, groups })).toEqual(allow);
    expect(hasExpandableWildcard(groups)).toBe(false);
  });

  it("keeps a wildcard there is nothing to expand into", () => {
    const allow = ["openai/*"];
    const groups = buildProviderGroups({ catalog: [], auth: [], allow });
    expect(expandProviderWildcards({ allow, groups })).toEqual(["openai/*"]);
    expect(hasExpandableWildcard(groups)).toBe(false);
  });

  it("reports an expandable wildcard so the screen can say what it did", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: ["openai/*"] });
    expect(hasExpandableWildcard(groups)).toBe(true);
  });

  it("does not name the same model twice when a wildcard and an exact entry overlap", () => {
    const allow = ["openai/gpt-5.6-luna", "openai/*"];
    const groups = buildProviderGroups({ catalog, auth, allow });
    expect(expandProviderWildcards({ allow, groups })).toEqual([
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
    ]);
  });
});

describe("toggleAllowedModel", () => {
  it("adds and removes one exact model", () => {
    expect(toggleAllowedModel([], "openai/a")).toEqual(["openai/a"]);
    expect(toggleAllowedModel(["openai/a", "openai/b"], "openai/a")).toEqual(["openai/b"]);
  });
});

describe("setProviderAllowed", () => {
  it("names every catalog model rather than storing a wildcard", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: ["anthropic/claude-sonnet-5"] });
    expect(
      setProviderAllowed({
        allow: ["anthropic/claude-sonnet-5"],
        group: groupFor(groups, "openai"),
        allowed: true,
      }),
    ).toEqual(["anthropic/claude-sonnet-5", "openai/gpt-5.6-luna", "openai/gpt-5.6-sol"]);
  });

  it("drops every entry of the provider, an older wildcard included", () => {
    const allow = ["openai/*", "openai/gpt-5.6-luna", "anthropic/claude-sonnet-5"];
    const groups = buildProviderGroups({ catalog, auth, allow });
    expect(
      setProviderAllowed({ allow, group: groupFor(groups, "openai"), allowed: false }),
    ).toEqual(["anthropic/claude-sonnet-5"]);
  });

  it("replaces an older wildcard with the named models when switched on again", () => {
    const allow = ["openai/*"];
    const groups = buildProviderGroups({ catalog, auth, allow });
    expect(setProviderAllowed({ allow, group: groupFor(groups, "openai"), allowed: true })).toEqual(
      ["openai/gpt-5.6-luna", "openai/gpt-5.6-sol"],
    );
  });

  it("falls back to the wildcard only for a provider that answers no models", () => {
    const groups = buildProviderGroups({
      catalog: [],
      auth: [{ provider: "openai", displayName: "OpenAI", status: "ok" }],
      allow: [],
    });
    expect(
      setProviderAllowed({ allow: [], group: groupFor(groups, "openai"), allowed: true }),
    ).toEqual(["openai/*"]);
  });
});

describe("canEnableModel", () => {
  it("refuses to switch on a model of a provider that cannot answer", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: [] });
    const anthropic = groupFor(groups, "anthropic");
    expect(canEnableModel({ group: anthropic, model: firstModel(anthropic) })).toBe(false);
  });

  it("leaves a model already in the allowlist switchable, so nothing is dropped silently", () => {
    const groups = buildProviderGroups({
      catalog,
      auth,
      allow: ["anthropic/claude-sonnet-5"],
    });
    const anthropic = groupFor(groups, "anthropic");
    expect(anthropic.models[0]?.allowed).toBe(true);
    expect(canEnableModel({ group: anthropic, model: firstModel(anthropic) })).toBe(true);
  });

  it("allows anything of a provider that is signed in", () => {
    const groups = buildProviderGroups({ catalog, auth, allow: [] });
    const openai = groupFor(groups, "openai");
    expect(canEnableModel({ group: openai, model: firstModel(openai) })).toBe(true);
  });
});

describe("pruneFallbacks", () => {
  it("drops a fallback the allowlist no longer offers", () => {
    expect(
      pruneFallbacks({
        allow: ["openai/a"],
        fallbacks: ["openai/a", "anthropic/b"],
      }),
    ).toEqual(["openai/a"]);
  });

  it("keeps every fallback while nothing is restricted", () => {
    expect(pruneFallbacks({ allow: [], fallbacks: ["openai/a", "anthropic/b"] })).toEqual([
      "openai/a",
      "anthropic/b",
    ]);
  });

  it("keeps a fallback an older wildcard still covers", () => {
    expect(pruneFallbacks({ allow: ["openai/*"], fallbacks: ["openai/a"] })).toEqual(["openai/a"]);
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
