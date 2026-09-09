// Turning a model catalog, a set of credentials, and one allowlist into what a screen
// draws, and turning a click back into an allowlist.
//
// Kept apart from the element so the rules can be read and tested without a browser. All
// of them are small, and all of them are about the same field: `modelPolicy.allow`, which
// the Gateway reads three ways depending on what is in it.
//
//   []                                     every model is offered
//   ["openai/*"]                           every model that provider answers for
//   ["openai/*", "anthropic/claude-x"]     one provider opened, another pinned
//
// So "allow every model of this provider" and "allow exactly these models" are not two
// settings with a mode switch between them. They are one list, per provider, and the
// screen shows it that way.

/** One model row, as the screen needs it. */
export type ModelCatalogRow = {
  ref: string;
  id: string;
  name: string;
  allowed: boolean;
};

/** One provider and everything the screen says about it. */
export type ModelCatalogProviderGroup = {
  provider: string;
  displayName: string;
  /** True when a credential for this provider is healthy enough to answer. */
  authenticated: boolean;
  /** True when the allowlist carries this provider's wildcard. */
  allowAll: boolean;
  models: ModelCatalogRow[];
  /** Models of this provider named one by one in the allowlist. */
  allowedCount: number;
};

/** The catalog entry fields this screen reads. */
export type ModelCatalogSourceEntry = {
  provider?: string;
  id?: string;
  name?: string;
};

/** The credential-health fields this screen reads. */
export type ModelAuthSourceProvider = {
  provider?: string;
  displayName?: string;
  status?: string;
};

/** Provider health values that mean "this provider can answer right now". */
const HEALTHY_AUTH_STATUS: ReadonlySet<string> = new Set(["ok", "warning", "degraded"]);

/** The wildcard entry that opens one whole provider. */
export function providerWildcard(provider: string): string {
  return `${provider}/*`;
}

/** The provider half of a model reference, or an empty string when there is none. */
export function providerOf(ref: string): string {
  const slash = ref.indexOf("/");
  return slash > 0 ? ref.slice(0, slash) : "";
}

/**
 * Group the catalog by provider and mark what the allowlist says about each row.
 *
 * Providers with no catalog rows are still listed when credentials name them: an
 * administrator looking for a provider that answers nothing needs to see that it is
 * authenticated and empty rather than absent, which reads as "not set up".
 */
export function buildProviderGroups(params: {
  catalog: readonly ModelCatalogSourceEntry[];
  auth: readonly ModelAuthSourceProvider[];
  allow: readonly string[];
  /** Refs kept visible even when the catalog does not list them, such as the primary. */
  pinned?: readonly string[];
}): ModelCatalogProviderGroup[] {
  const allowSet = new Set(params.allow);
  const authByProvider = new Map<string, ModelAuthSourceProvider>();
  for (const entry of params.auth) {
    if (entry.provider) {
      authByProvider.set(entry.provider, entry);
    }
  }
  const rowsByProvider = new Map<string, Map<string, ModelCatalogRow>>();
  const addRow = (provider: string, id: string, name: string) => {
    if (!provider || !id) {
      return;
    }
    const rows = rowsByProvider.get(provider) ?? new Map<string, ModelCatalogRow>();
    rowsByProvider.set(provider, rows);
    const ref = `${provider}/${id}`;
    if (!rows.has(ref)) {
      rows.set(ref, { ref, id, name: name || id, allowed: allowSet.has(ref) });
    }
  };
  for (const entry of params.catalog) {
    addRow(entry.provider ?? "", entry.id ?? "", entry.name ?? "");
  }
  for (const ref of [...(params.pinned ?? []), ...params.allow]) {
    if (ref.endsWith("/*")) {
      continue;
    }
    const provider = providerOf(ref);
    addRow(provider, ref.slice(provider.length + 1), "");
  }
  for (const provider of authByProvider.keys()) {
    if (!rowsByProvider.has(provider)) {
      rowsByProvider.set(provider, new Map());
    }
  }
  return [...rowsByProvider.entries()]
    .map(([provider, rows]) => {
      const auth = authByProvider.get(provider);
      const models = [...rows.values()].toSorted((left, right) =>
        left.name.localeCompare(right.name),
      );
      return {
        provider,
        displayName: auth?.displayName || provider,
        authenticated: HEALTHY_AUTH_STATUS.has(auth?.status ?? ""),
        allowAll: allowSet.has(providerWildcard(provider)),
        models,
        allowedCount: models.filter((model) => model.allowed).length,
      };
    })
    .toSorted((left, right) => left.provider.localeCompare(right.provider));
}

/** Add or remove one exact model from the allowlist. */
export function toggleAllowedModel(allow: readonly string[], ref: string): string[] {
  return allow.includes(ref) ? allow.filter((entry) => entry !== ref) : [...allow, ref];
}

/**
 * Open or close one whole provider.
 *
 * Opening drops that provider's exact entries: with the wildcard present they decide
 * nothing, and leaving them behind would make closing the provider again silently keep a
 * subset an administrator never re-chose.
 */
export function toggleProviderAll(allow: readonly string[], provider: string): string[] {
  const wildcard = providerWildcard(provider);
  if (allow.includes(wildcard)) {
    return allow.filter((entry) => entry !== wildcard);
  }
  return [...allow.filter((entry) => providerOf(entry) !== provider), wildcard];
}

/** True when the allowlist offers this model, by name or through its provider. */
export function allowlistCovers(allow: readonly string[], ref: string): boolean {
  if (ref.length === 0 || allow.length === 0) {
    return true;
  }
  return allow.includes(ref) || allow.includes(providerWildcard(providerOf(ref)));
}

/**
 * The refs a person may pick as the model that answers.
 *
 * A wildcard is not one of them: it names a provider, not a model. So an open provider
 * contributes its catalog rows here rather than the wildcard itself.
 */
export function selectableModelRefs(params: {
  groups: readonly ModelCatalogProviderGroup[];
  allow: readonly string[];
}): string[] {
  const refs: string[] = [];
  for (const group of params.groups) {
    for (const model of group.models) {
      if (allowlistCovers(params.allow, model.ref)) {
        refs.push(model.ref);
      }
    }
  }
  return refs;
}
