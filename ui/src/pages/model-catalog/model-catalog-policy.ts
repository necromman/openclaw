// Turning a model catalog, a set of credentials, and one allowlist into what a screen
// draws, and turning a switch back into an allowlist.
//
// Kept apart from the element so the rules can be read and tested without a browser. All
// of them are small, and all of them are about the same field: `modelPolicy.allow`, which
// the Gateway reads two ways depending on what is in it.
//
//   []                                       every model is offered
//   ["openai/gpt-x", "anthropic/claude-y"]   exactly those models are offered
//
// A third shape exists in the Gateway and in settings saved before this screen changed:
// "openai/*", standing for every model that provider answers for. This screen still reads
// it and no longer writes it. A stored wildcard costs the chat model picker a full
// provider probe the first time somebody opens it, about fifteen seconds on the delivery
// (DEPLOY.md 3.4), because nothing in the configuration says which models the wildcard
// stood for until the provider has been asked. Naming the models makes the same promise
// without that wait. So a wildcard found in a saved setting is expanded into the catalog
// rows behind it before the screen draws, and what the screen saves is always the list of
// models an administrator switched on.

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
  /** True when every catalog row of this provider is offered. Drives the header switch. */
  allowAll: boolean;
  /** True when the allowlist still carries this provider's wildcard from an older save. */
  wildcard: boolean;
  models: ModelCatalogRow[];
  /** Models of this provider this allowlist offers. */
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

/**
 * Provider health values that mean "this provider can answer right now".
 *
 * The vocabulary is `AuthProviderHealthStatus` in src/agents/auth-health.ts: "ok" is a
 * live credential, "expiring" is one that still works and will need renewing, and
 * "static" is a key that came from configuration or the environment and never expires.
 * "expired" and "missing" are the two that cannot answer.
 */
const HEALTHY_AUTH_STATUS: ReadonlySet<string> = new Set(["ok", "expiring", "static"]);

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
      rows.set(ref, {
        ref,
        id,
        name: name || id,
        // A wildcard left over from an older save offers the row too, so the switch has
        // to show it on. Saving then writes the row's own reference instead.
        allowed: allowSet.has(ref) || allowSet.has(providerWildcard(provider)),
      });
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
      const wildcard = allowSet.has(providerWildcard(provider));
      const allowedCount = models.filter((model) => model.allowed).length;
      return {
        provider,
        displayName: auth?.displayName || provider,
        authenticated: HEALTHY_AUTH_STATUS.has(auth?.status ?? ""),
        // With no rows to count there is nothing to derive "all" from, so the stored
        // wildcard is the only thing that can say the provider is open.
        allowAll: models.length > 0 ? allowedCount === models.length : wildcard,
        wildcard,
        models,
        allowedCount,
      };
    })
    .toSorted((left, right) => left.provider.localeCompare(right.provider));
}

/**
 * Replace every provider wildcard with the catalog rows it stood for.
 *
 * Run once, when the catalog arrives, so nothing downstream has to think about the old
 * shape. A wildcard whose provider answered no models is kept as it is: there is nothing
 * to expand it into, and dropping it would quietly close a provider the saved setting had
 * open, which is a change nobody asked for.
 */
export function expandProviderWildcards(params: {
  allow: readonly string[];
  groups: readonly ModelCatalogProviderGroup[];
}): string[] {
  const modelsByProvider = new Map(
    params.groups.map((group) => [group.provider, group.models] as const),
  );
  const out: string[] = [];
  const push = (ref: string) => {
    if (!out.includes(ref)) {
      out.push(ref);
    }
  };
  for (const entry of params.allow) {
    if (!entry.endsWith("/*")) {
      push(entry);
      continue;
    }
    const models = modelsByProvider.get(providerOf(entry)) ?? [];
    if (models.length === 0) {
      push(entry);
      continue;
    }
    for (const model of models) {
      push(model.ref);
    }
  }
  return out;
}

/** True when the allowlist still carries a wildcard the catalog can expand. */
export function hasExpandableWildcard(groups: readonly ModelCatalogProviderGroup[]): boolean {
  return groups.some((group) => group.wildcard && group.models.length > 0);
}

/** Switch one exact model on or off. */
export function toggleAllowedModel(allow: readonly string[], ref: string): string[] {
  return allow.includes(ref) ? allow.filter((entry) => entry !== ref) : [...allow, ref];
}

/**
 * Switch every model of one provider on or off.
 *
 * Switching on names each catalog row rather than adding the provider's wildcard, which
 * is the whole point of this control: the saved value stays a list of models the chat
 * picker can offer without asking the provider anything. Switching off drops every entry
 * of that provider, the wildcard included, so an older save cannot leave a subset behind
 * that nobody chose.
 */
export function setProviderAllowed(params: {
  allow: readonly string[];
  group: ModelCatalogProviderGroup;
  allowed: boolean;
}): string[] {
  const provider = params.group.provider;
  const withoutProvider = params.allow.filter((entry) => providerOf(entry) !== provider);
  if (!params.allowed) {
    return withoutProvider;
  }
  const refs = params.group.models.map((model) => model.ref);
  // A provider that answered no models has nothing to name. Keeping its wildcard is the
  // only way to say "open" about it, and it costs nothing: there is no catalog to probe.
  return [...withoutProvider, ...(refs.length > 0 ? refs : [providerWildcard(provider)])];
}

/**
 * True when the screen may switch this row on.
 *
 * A provider with no working credential cannot answer, so offering its models would put
 * them in the chat picker only to fail the moment somebody picked one. Switching off is
 * never blocked: taking a model away is safe whatever the credential says, and a row that
 * is already in the allowlist stays visible and stays removable rather than disappearing.
 */
export function canEnableModel(params: {
  group: ModelCatalogProviderGroup;
  model: ModelCatalogRow;
}): boolean {
  return params.group.authenticated || params.model.allowed;
}

/** True when the allowlist offers this model, by name or through an older wildcard. */
export function allowlistCovers(allow: readonly string[], ref: string): boolean {
  if (ref.length === 0 || allow.length === 0) {
    return true;
  }
  return allow.includes(ref) || allow.includes(providerWildcard(providerOf(ref)));
}

/**
 * The fallback chain that survives an allowlist.
 *
 * A fallback the allowlist no longer offers is dropped rather than warned about. The
 * order is the only thing a fallback carries, and losing one place in an order is a
 * change a person can see at a glance. The primary is deliberately not treated this way:
 * something has to answer, so removing it silently would leave the deployment without a
 * default and nobody would have chosen the replacement.
 */
export function pruneFallbacks(params: {
  allow: readonly string[];
  fallbacks: readonly string[];
}): string[] {
  return params.fallbacks.filter((ref) => allowlistCovers(params.allow, ref));
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
