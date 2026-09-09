import { describe, expect, it } from "vitest";
import {
  applyModelPolicyToConfig,
  buildModelPolicyOverridesDocument,
  parseSubmittedModelPolicy,
  policyHidesItsOwnModels,
  readModelPolicyFromConfig,
  type IxAuthAdminModelPolicy,
} from "./ix-auth-admin-model-policy.js";

function policy(overrides: Partial<IxAuthAdminModelPolicy> = {}): IxAuthAdminModelPolicy {
  return { primary: "", fallbacks: [], allow: [], utilityModel: "", ...overrides };
}

describe("parseSubmittedModelPolicy", () => {
  it("accepts a fixed list of exact models", () => {
    const parsed = parseSubmittedModelPolicy({
      primary: "openai/gpt-5.6-luna",
      fallbacks: ["anthropic/claude-sonnet-5"],
      allow: ["openai/gpt-5.6-luna", "anthropic/claude-sonnet-5"],
    });
    expect(parsed).toEqual({
      ok: true,
      policy: policy({
        primary: "openai/gpt-5.6-luna",
        fallbacks: ["anthropic/claude-sonnet-5"],
        allow: ["openai/gpt-5.6-luna", "anthropic/claude-sonnet-5"],
      }),
    });
  });

  it("accepts a provider wildcard in the allowlist and a mix of both", () => {
    const parsed = parseSubmittedModelPolicy({
      primary: "openai/gpt-5.6-luna",
      allow: ["openai/*", "anthropic/claude-sonnet-5"],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.policy.allow).toEqual(["openai/*", "anthropic/claude-sonnet-5"]);
  });

  it("treats an absent allowlist as unrestricted rather than as a rejection", () => {
    const parsed = parseSubmittedModelPolicy({ primary: "openai/gpt-5.6-luna" });
    expect(parsed.ok && parsed.policy.allow).toEqual([]);
  });

  it("refuses a wildcard where a model has to answer", () => {
    expect(parseSubmittedModelPolicy({ primary: "openai/*" }).ok).toBe(false);
    expect(parseSubmittedModelPolicy({ fallbacks: ["openai/*"] }).ok).toBe(false);
    expect(parseSubmittedModelPolicy({ utilityModel: "openai/*" }).ok).toBe(false);
  });

  it("refuses references that are not a provider and a model", () => {
    for (const primary of [
      "gpt-5.6-luna",
      "openai/gpt 5.6",
      "openai/../etc/passwd",
      "OPENAI/gpt-5.6-luna",
      "openai/",
      42,
    ]) {
      expect(parseSubmittedModelPolicy({ primary }).ok).toBe(false);
    }
  });

  it("drops duplicates and refuses an allowlist longer than the cap", () => {
    const duplicated = parseSubmittedModelPolicy({
      allow: ["openai/a", "openai/a", "openai/b"],
    });
    expect(duplicated.ok && duplicated.policy.allow).toEqual(["openai/a", "openai/b"]);
    const tooLong = parseSubmittedModelPolicy({
      allow: Array.from({ length: 101 }, (_, index) => `openai/m${index}`),
    });
    expect(tooLong.ok).toBe(false);
  });
});

describe("policyHidesItsOwnModels", () => {
  it("passes an empty allowlist, which means no restriction", () => {
    expect(policyHidesItsOwnModels(policy({ primary: "openai/a" }))).toBe(false);
  });

  it("passes when a provider wildcard covers the primary", () => {
    expect(policyHidesItsOwnModels(policy({ primary: "openai/a", allow: ["openai/*"] }))).toBe(
      false,
    );
  });

  it("catches a primary or a fallback the allowlist would hide", () => {
    expect(policyHidesItsOwnModels(policy({ primary: "openai/a", allow: ["anthropic/b"] }))).toBe(
      true,
    );
    expect(
      policyHidesItsOwnModels(
        policy({ primary: "openai/a", fallbacks: ["anthropic/b"], allow: ["openai/a"] }),
      ),
    ).toBe(true);
  });
});

describe("applyModelPolicyToConfig", () => {
  it("writes only the model leaves and leaves the rest of the config alone", () => {
    const config: Record<string, unknown> = {
      gateway: { auth: { mode: "ix-auth" } },
      agents: { ownership: "explicit", entries: { main: { name: "shared" } } },
    };
    applyModelPolicyToConfig(
      config,
      policy({
        primary: "openai/gpt-5.6-luna",
        fallbacks: ["anthropic/claude-sonnet-5"],
        allow: ["openai/*"],
      }),
    );
    expect(config).toEqual({
      gateway: { auth: { mode: "ix-auth" } },
      agents: {
        ownership: "explicit",
        entries: { main: { name: "shared" } },
        defaults: {
          model: {
            primary: "openai/gpt-5.6-luna",
            fallbacks: ["anthropic/claude-sonnet-5"],
          },
          modelPolicy: { allow: ["openai/*"] },
        },
      },
    });
  });

  it("removes the model leaf when the primary is cleared", () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { model: { primary: "openai/a" }, utilityModel: "openai/b" } },
    };
    applyModelPolicyToConfig(config, policy());
    expect(config).toEqual({ agents: { defaults: { modelPolicy: { allow: [] } } } });
  });
});

describe("readModelPolicyFromConfig", () => {
  it("reads the object form", () => {
    expect(
      readModelPolicyFromConfig({
        agents: {
          defaults: {
            model: { primary: "openai/a", fallbacks: ["anthropic/b"] },
            modelPolicy: { allow: ["openai/*"] },
            utilityModel: "openai/c",
          },
        },
      }),
    ).toEqual({
      primary: "openai/a",
      fallbacks: ["anthropic/b"],
      allow: ["openai/*"],
      utilityModel: "openai/c",
    });
  });

  it("reads the string form and an empty config", () => {
    expect(readModelPolicyFromConfig({ agents: { defaults: { model: "openai/a" } } })).toEqual(
      policy({ primary: "openai/a" }),
    );
    expect(readModelPolicyFromConfig(undefined)).toEqual(policy());
  });
});

describe("buildModelPolicyOverridesDocument", () => {
  it("carries only the admin-editable region", () => {
    const document = buildModelPolicyOverridesDocument({
      policy: policy({
        primary: "openai/a",
        fallbacks: ["anthropic/b"],
        allow: ["openai/*"],
      }),
      updatedAtMs: Date.parse("2026-09-09T00:00:00.000Z"),
      updatedBy: "admin@deploy.local",
    });
    expect(document).toEqual({
      version: 1,
      updatedAt: "2026-09-09T00:00:00.000Z",
      updatedBy: "admin@deploy.local",
      agents: {
        defaults: {
          model: { primary: "openai/a", fallbacks: ["anthropic/b"] },
          modelPolicy: { allow: ["openai/*"] },
        },
      },
    });
  });

  it("keeps the allowlist even when it is empty, so a restart cannot restore an old one", () => {
    const document = buildModelPolicyOverridesDocument({
      policy: policy(),
      updatedAtMs: 0,
    });
    expect(document.agents).toEqual({ defaults: { modelPolicy: { allow: [] } } });
  });
});
