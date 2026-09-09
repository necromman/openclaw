// The provider blocks of the model screen: one section per provider, one switch per
// model, and the rule that decides which switches a person may touch.
//
// Split out of `model-catalog-page.ts` so that file stays inside the repository's
// seven-hundred-line ceiling, and because this half is pure rendering: it is handed a
// group, the current allowlist, and one callback, and it answers markup. Everything it
// decides is decided by `model-catalog-policy.ts`, which is testable without a browser.
import { html, type TemplateResult } from "lit";
import { renderSettingsRow, renderSettingsSection } from "../../components/settings-ui.ts";
import { t } from "../../i18n/index.ts";
import {
  canEnableModel,
  type ModelCatalogProviderGroup,
  type ModelCatalogRow,
} from "./model-catalog-policy.ts";

export type ModelCatalogProviderCallbacks = {
  /** True while a save is in flight, which freezes every control on the screen. */
  busy: boolean;
  /** Switch one model on or off. */
  onToggleModel: (model: ModelCatalogRow) => void;
  /** Switch every model of one provider on or off. */
  onToggleProvider: (group: ModelCatalogProviderGroup, allowed: boolean) => void;
};

/**
 * One model row.
 *
 * A switch rather than an add/remove button. The state of a model is a state, not an
 * event: "this model is offered in chat" is either true or false, and a switch says which
 * one it is at a glance across eighty rows, where a pair of buttons only says what would
 * happen if you pressed one. The fallback list keeps its remove buttons, because the
 * order there is the value and a switch cannot express a position.
 *
 * `role="switch"` is on a real checkbox: the browser keeps the keyboard behaviour, the
 * label association and the checked state, and the role only changes what a screen reader
 * calls it. The look is in ui/src/styles/fork-style.css.
 */
function renderModelSwitch(params: {
  group: ModelCatalogProviderGroup;
  model: ModelCatalogRow;
  callbacks: ModelCatalogProviderCallbacks;
}): TemplateResult {
  const blocked = !canEnableModel({ group: params.group, model: params.model });
  return html`
    <label
      class=${blocked ? "model-catalog-model model-catalog-model--blocked" : "model-catalog-model"}
      title=${blocked ? t("ixAuth.models.modelBlocked") : ""}
    >
      <input
        type="checkbox"
        role="switch"
        class="fork-switch"
        .checked=${params.model.allowed}
        ?disabled=${blocked || params.callbacks.busy}
        aria-label=${t("ixAuth.models.modelSwitchLabel", { model: params.model.ref })}
        @change=${() => params.callbacks.onToggleModel(params.model)}
      />
      <span class="model-catalog-model__name">${params.model.name}</span>
      <code class="model-catalog-model__ref">${params.model.ref}</code>
    </label>
  `;
}

function renderModelList(params: {
  group: ModelCatalogProviderGroup;
  callbacks: ModelCatalogProviderCallbacks;
}): TemplateResult {
  if (params.group.models.length === 0) {
    return renderSettingsRow({ title: t("ixAuth.models.noModels") });
  }
  return renderSettingsRow({
    title: t("ixAuth.models.allowedModels"),
    description: t("ixAuth.models.allowedModelsHelp"),
    stacked: true,
    control: html`
      <div class="model-catalog-models">
        ${params.group.models.map((model) =>
          renderModelSwitch({ group: params.group, model, callbacks: params.callbacks }),
        )}
      </div>
    `,
  });
}

/**
 * One provider block.
 *
 * The header switch is the only whole-provider control, and it writes the same kind of
 * value as the rows below it: switching it on names every catalog model one by one. There
 * is no separate "wildcard" state to be in, so nothing on this screen can put one back
 * into the configuration.
 *
 * Without a working credential the switch can still be turned off but not on. Turning it
 * on would list models in the chat picker that fail the moment somebody picks them, which
 * looks to that person like the product is broken rather than like the provider is not
 * signed in.
 */
export function renderModelCatalogProviderSection(params: {
  group: ModelCatalogProviderGroup;
  callbacks: ModelCatalogProviderCallbacks;
}): TemplateResult {
  const { group, callbacks } = params;
  const blocked = !group.authenticated && !group.allowAll;
  return renderSettingsSection(
    {
      title: group.displayName,
      description: group.authenticated
        ? t("ixAuth.models.authenticated")
        : t("ixAuth.models.notAuthenticated"),
      count: group.allowedCount,
    },
    [
      renderSettingsRow({
        title: t("ixAuth.models.allowAll"),
        description: blocked ? t("ixAuth.models.allowAllBlocked") : t("ixAuth.models.allowAllHelp"),
        control: html`
          <input
            type="checkbox"
            role="switch"
            class="fork-switch"
            .checked=${group.allowAll}
            ?disabled=${blocked || callbacks.busy}
            aria-label=${t("ixAuth.models.providerSwitchLabel", { provider: group.displayName })}
            @change=${(event: Event) =>
              // SAFETY: the listener is bound to this input element, so its event target
              // is that element and nothing else can dispatch a change through it.
              callbacks.onToggleProvider(group, (event.target as HTMLInputElement).checked)}
          />
        `,
      }),
      renderModelList({ group, callbacks }),
    ],
  );
}
