import { describe, expect, it } from "vitest";
import {
  applyModelPolicyToConfig,
  buildModelPolicyOverridesDocument,
  IX_AUTH_ADMIN_MODEL_ALLOW_MAX,
  IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH,
  IX_AUTH_ADMIN_MODELS_BODY_MAX_BYTES,
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

  // The catalog this delivery lists carries these verbatim. A pattern that stopped at one
  // slash refused them, so switching such a provider on failed with `invalid_body`.
  it("accepts a model id that carries slashes of its own", () => {
    for (const primary of [
      "huggingface/deepseek-ai/DeepSeek-R1",
      "together/meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "nvidia/z-ai/glm-5.1",
      "ollama-cloud/gpt-oss:120b",
    ]) {
      const parsed = parseSubmittedModelPolicy({ primary });
      expect(parsed.ok && parsed.policy.primary).toBe(primary);
    }
  });

  it("still refuses a path, a quote, a backslash, or whitespace inside a longer id", () => {
    for (const primary of [
      "together/meta-llama/../../etc/passwd",
      "together/meta-llama/.hidden",
      "together/meta-llama//Llama",
      'together/meta-llama/"Llama"',
      "together/meta-llama\\Llama",
      "together/meta llama/Llama",
      "together/a/b/c/d/e/f",
    ]) {
      expect(parseSubmittedModelPolicy({ primary }).ok).toBe(false);
    }
  });

  it("refuses a reference past the length cap the body limit is derived from", () => {
    const tooLong = `openai/${"m".repeat(IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH)}`;
    expect(tooLong.length).toBeGreaterThan(IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH);
    expect(parseSubmittedModelPolicy({ primary: tooLong }).ok).toBe(false);
    // A reference exactly at the cap has to be spelled in segments, because no single
    // segment may exceed 128 characters. Two of them plus the provider land on the cap.
    const rest = IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH - "openai/".length - 1;
    const atCap = `openai/${"m".repeat(128)}/${"m".repeat(rest - 128)}`;
    expect(atCap.length).toBe(IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH);
    expect(parseSubmittedModelPolicy({ primary: atCap }).ok).toBe(true);
  });

  it("drops duplicates and refuses an allowlist longer than the cap", () => {
    const duplicated = parseSubmittedModelPolicy({
      allow: ["openai/a", "openai/a", "openai/b"],
    });
    expect(duplicated.ok && duplicated.policy.allow).toEqual(["openai/a", "openai/b"]);
    const atCap = parseSubmittedModelPolicy({
      allow: Array.from(
        { length: IX_AUTH_ADMIN_MODEL_ALLOW_MAX },
        (_, index) => `openai/m${index}`,
      ),
    });
    expect(atCap.ok).toBe(true);
    const tooLong = parseSubmittedModelPolicy({
      allow: Array.from(
        { length: IX_AUTH_ADMIN_MODEL_ALLOW_MAX + 1 },
        (_, index) => `openai/m${index}`,
      ),
    });
    expect(tooLong.ok).toBe(false);
  });

  // The whole point of the raised cap: the delivery's catalog is eighty-two models, and
  // the screen now saves them one by one instead of a provider wildcard.
  it("takes a whole catalog named one model at a time", () => {
    const allow = Array.from({ length: 82 }, (_, index) => `openai/gpt-5.6-model-${index}`);
    const parsed = parseSubmittedModelPolicy({ primary: allow[0], allow });
    expect(parsed.ok && parsed.policy.allow).toHaveLength(82);
  });

  it("keeps the allowlist inside the body limit this route reads through", () => {
    const longestRef = `openai/${"m".repeat(IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH - "openai/".length)}`;
    const worstCase = Array.from({ length: IX_AUTH_ADMIN_MODEL_ALLOW_MAX }, () => longestRef);
    const body = JSON.stringify({ primary: "", fallbacks: [], allow: worstCase, utilityModel: "" });
    expect(body.length).toBeLessThan(IX_AUTH_ADMIN_MODELS_BODY_MAX_BYTES);
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
