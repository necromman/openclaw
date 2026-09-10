// What an administrator may decide about models, and nothing else.
//
// The delivery template owns the whole Gateway configuration except one small region:
// which model answers, which model answers when the first cannot, and which models a
// person may pick in chat. That region is what this file describes, reads and rewrites.
// Everything outside it (identity, departments, tool policy, proxies) stays the
// template's, because those are the promises the deployment was set up on and an
// administrator changing them from a browser would be changing the appliance rather than
// running it.
//
// The allowlist has three shapes and they are all the same list:
//   - exact refs only            -> chat offers exactly those models
//   - "provider/*"               -> chat offers every model that provider answers for
//   - a mix of the two           -> one provider opened, another pinned
// The Gateway already reads a "provider/*" entry as a provider wildcard
// (`parseConfiguredModelVisibilityEntries` in src/agents/model-selection-shared.ts), so
// the three states are one field and not three, and the chat picker and the new-session
// screen both get them without a second rule.
//
// The wildcard is still read here and still accepted from a submission, but the screen no
// longer writes one. A stored wildcard makes the chat model picker probe the whole
// provider the first time it opens, which the delivery measured at about fifteen seconds
// (DEPLOY.md 3.4). So the administration screen expands a wildcard it finds into the
// models behind it and saves those, and this file keeps reading the old shape so a
// deployment that still has one keeps working until somebody saves.
//
// An empty list means "no restriction" to the Gateway, which is not the same promise as
// "every model of the providers we authenticated". It is kept reachable because it is
// what the shipped default means, but the screen names it plainly.
import { asOptionalRecord } from "@openclaw/normalization-core/record-coerce";

/** The models region of the configuration, as an administrator sees and submits it. */
export type IxAuthAdminModelPolicy = {
  /** Model that answers first. Empty string means the Gateway default. */
  primary: string;
  /** Models tried in order when the primary cannot answer. */
  fallbacks: string[];
  /** Chat picker allowlist. Empty means unrestricted. */
  allow: string[];
  /** Small-task model. Empty string means unset. */
  utilityModel: string;
};

/**
 * Longest reference this route stores.
 *
 * The catalog's longest real entries are of the shape
 * `together/meta-llama/Llama-3.3-70B-Instruct-Turbo`, well under half of this. The cap is
 * here so the allowlist has a worst case that can be multiplied out, which is what the
 * body limit below is derived from.
 */
export const IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH = 160;

/**
 * Longest allowlist this route accepts.
 *
 * The screen no longer stores a provider wildcard: what it saves is always the models an
 * administrator switched on, one by one, because a wildcard in the configuration makes
 * the chat model picker wait for a full provider probe on its first open (DEPLOY.md 3.4).
 * That turns the catalog size into the real bound, and the delivery's catalog is already
 * eighty-two entries. Three hundred leaves room for the catalog to grow without an
 * administrator meeting a limit that only exists because of how the value is written.
 *
 * The arithmetic that keeps this inside `IX_AUTH_ADMIN_MODELS_BODY_MAX_BYTES`: one JSON
 * array element costs the reference plus two quotes and a comma, so the allowlist alone
 * is at most (160 + 3) * 300 = 48900 bytes. The other three fields add at most three more
 * references plus their names, under 700 bytes, so the whole document stays below 50 KiB
 * against a 64 KiB limit.
 */
export const IX_AUTH_ADMIN_MODEL_ALLOW_MAX = 300;

/** Longest fallback chain this route accepts. */
const IX_AUTH_ADMIN_MODEL_FALLBACK_MAX = 8;

/**
 * Body limit for `/auth/admin/models` alone.
 *
 * Every other route in the `/auth/*` namespace reads a form: an address, a password, a
 * role. The shared 4 KiB (`IX_AUTH_BODY_MAX_BYTES`) is generous for those and stays where
 * it is. This one reads a list, and the list is the catalog. It lives here rather than
 * beside the route because it is derived from the two caps directly above it, and a
 * reader changing one of them has to see the third number move.
 */
export const IX_AUTH_ADMIN_MODELS_BODY_MAX_BYTES = 64 * 1024;

/**
 * One model reference: `provider/model`, or `provider/*` for the whole provider.
 *
 * Deliberately narrow. The reference travels into the configuration file, so a value
 * carrying whitespace, quotes or backslashes would be a way to write something other than
 * a model name into it.
 *
 * The model half may itself carry slashes, because real catalog entries do:
 * `huggingface/deepseek-ai/DeepSeek-R1`, `together/meta-llama/Llama-3.3-70B-Instruct-Turbo`,
 * `nvidia/z-ai/glm-5.1`. Refusing those refused the very models the screen lists, so
 * switching a provider on failed with `invalid_body` and said nothing about why. Every
 * segment still has to begin with a letter or a digit, which is what keeps `..`, a
 * leading dot, and an empty segment out: a relative path cannot be spelled here.
 */
const MODEL_REF_SEGMENT = "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}";
const MODEL_REF_PATTERN = new RegExp(
  `^[a-z0-9][a-z0-9._-]{0,63}/(?:\\*|${MODEL_REF_SEGMENT}(?:/${MODEL_REF_SEGMENT}){0,4})$`,
  "u",
);

/** True when a reference is a whole-provider wildcard. */
function isProviderWildcardRef(ref: string): boolean {
  return ref.endsWith("/*");
}

/** The provider half of a reference, or an empty string when there is none. */
function providerOfModelRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash > 0 ? ref.slice(0, slash) : "";
}

function normalizeRef(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > IX_AUTH_ADMIN_MODEL_REF_MAX_LENGTH) {
    return undefined;
  }
  return MODEL_REF_PATTERN.test(trimmed) ? trimmed : undefined;
}

function normalizeRefList(value: unknown, max: number): string[] | undefined {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > max) {
    return undefined;
  }
  const out: string[] = [];
  for (const entry of value) {
    const ref = normalizeRef(entry);
    if (!ref) {
      return undefined;
    }
    if (!out.includes(ref)) {
      out.push(ref);
    }
  }
  return out;
}

/**
 * One optional exact reference.
 *
 * Returns the empty string when the field is absent or blank, and undefined when the
 * value is present but is not a model reference this route will store. A wildcard is
 * refused here: these fields name the model that has to answer, and "any model of this
 * provider" does not name one.
 */
function normalizeExactRefOrEmpty(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.trim().length === 0) {
    return "";
  }
  const ref = normalizeRef(value);
  return ref !== undefined && !isProviderWildcardRef(ref) ? ref : undefined;
}

/** Read one submitted policy, or report that it is not one. */
export function parseSubmittedModelPolicy(
  body: Record<string, unknown>,
): { ok: true; policy: IxAuthAdminModelPolicy } | { ok: false } {
  const primary = normalizeExactRefOrEmpty(body.primary);
  if (primary === undefined) {
    return { ok: false };
  }
  const utilityModel = normalizeExactRefOrEmpty(body.utilityModel);
  if (utilityModel === undefined) {
    return { ok: false };
  }
  const fallbacks = normalizeRefList(body.fallbacks, IX_AUTH_ADMIN_MODEL_FALLBACK_MAX);
  if (!fallbacks || fallbacks.some(isProviderWildcardRef)) {
    return { ok: false };
  }
  const allow = normalizeRefList(body.allow, IX_AUTH_ADMIN_MODEL_ALLOW_MAX);
  if (!allow) {
    return { ok: false };
  }
  return { ok: true, policy: { primary, fallbacks, allow, utilityModel } };
}

/**
 * True when the allowlist would hide the model that has to answer.
 *
 * The Gateway would still run: a primary outside the allowlist answers, it just cannot be
 * re-selected from chat. That gap reads as a broken picker to whoever meets it later, so
 * the route refuses it rather than storing it.
 */
export function policyHidesItsOwnModels(policy: IxAuthAdminModelPolicy): boolean {
  if (policy.allow.length === 0) {
    return false;
  }
  const covers = (ref: string): boolean =>
    ref.length === 0 ||
    policy.allow.includes(ref) ||
    policy.allow.includes(`${providerOfModelRef(ref)}/*`);
  return !covers(policy.primary) || policy.fallbacks.some((ref) => !covers(ref));
}

type MutableRecord = Record<string, unknown>;

function childRecord(parent: MutableRecord, key: string): MutableRecord {
  const existing = asOptionalRecord(parent[key]);
  if (existing) {
    return existing;
  }
  const created: MutableRecord = {};
  parent[key] = created;
  return created;
}

/**
 * Write one policy into a configuration object, in place.
 *
 * Only the leaves this file owns are touched. `agents.defaults.model` is written as the
 * object form even for a single model, because the fallbacks live in the same leaf and
 * the string form has nowhere to keep them.
 */
export function applyModelPolicyToConfig(
  config: MutableRecord,
  policy: IxAuthAdminModelPolicy,
): void {
  const defaults = childRecord(childRecord(config, "agents"), "defaults");
  if (policy.primary.length === 0) {
    delete defaults.model;
  } else {
    defaults.model = {
      primary: policy.primary,
      ...(policy.fallbacks.length > 0 ? { fallbacks: [...policy.fallbacks] } : {}),
    };
  }
  childRecord(defaults, "modelPolicy").allow = [...policy.allow];
  if (policy.utilityModel.length === 0) {
    delete defaults.utilityModel;
  } else {
    defaults.utilityModel = policy.utilityModel;
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

/** Read the policy currently in a configuration object. */
export function readModelPolicyFromConfig(config: unknown): IxAuthAdminModelPolicy {
  const empty: IxAuthAdminModelPolicy = {
    primary: "",
    fallbacks: [],
    allow: [],
    utilityModel: "",
  };
  const defaults = asOptionalRecord(asOptionalRecord(asOptionalRecord(config)?.agents)?.defaults);
  if (!defaults) {
    return empty;
  }
  const modelRecord = asOptionalRecord(defaults.model);
  const primaryValue = typeof defaults.model === "string" ? defaults.model : modelRecord?.primary;
  return {
    primary: typeof primaryValue === "string" ? primaryValue : "",
    fallbacks: readStringArray(modelRecord?.fallbacks),
    allow: readStringArray(asOptionalRecord(defaults.modelPolicy)?.allow),
    utilityModel: typeof defaults.utilityModel === "string" ? defaults.utilityModel : "",
  };
}

/**
 * The document kept beside the configuration so a restart does not undo this screen.
 *
 * The delivery renders its configuration template over the state volume on every start
 * (DEPLOY.md 3.4), which is what makes an edit to the template arrive. This file is the
 * exception the start script merges back on top of that render, and it holds only the
 * paths above. Keeping it small and separate is the point: everything not in it is
 * template-owned, and reading the file says which is which.
 */
export function buildModelPolicyOverridesDocument(params: {
  policy: IxAuthAdminModelPolicy;
  updatedAtMs: number;
  updatedBy?: string;
}): Record<string, unknown> {
  const defaults: MutableRecord = {
    modelPolicy: { allow: [...params.policy.allow] },
  };
  if (params.policy.primary.length > 0) {
    defaults.model = {
      primary: params.policy.primary,
      ...(params.policy.fallbacks.length > 0 ? { fallbacks: [...params.policy.fallbacks] } : {}),
    };
  }
  if (params.policy.utilityModel.length > 0) {
    defaults.utilityModel = params.policy.utilityModel;
  }
  return {
    version: 1,
    updatedAt: new Date(params.updatedAtMs).toISOString(),
    ...(params.updatedBy ? { updatedBy: params.updatedBy } : {}),
    agents: { defaults },
  };
}
