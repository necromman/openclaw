// Covers explicit-ownership detection and gateway error humanization for the agents screen.
import { render } from "lit";
import { expect, it } from "vitest";
import { t } from "../../i18n/index.ts";
import { createAgentViewTestProps } from "./agents-view.test-helpers.ts";
import { humanizeAgentConfigError, isExplicitAgentOwnership } from "./default-agent-lock.ts";
import { renderAgents } from "./view.ts";

const EXPLICIT_CONFIG = {
  agents: { ownership: "explicit", entries: { alpha: {}, beta: {} } },
};

const RAW_OWNERSHIP_ERROR =
  "GatewayRequestError: invalid config: agents.ownership: agents.ownership=explicit cannot be combined with a legacy default=true marker";

it("detects explicit agent ownership only when the config says so", () => {
  expect(isExplicitAgentOwnership(EXPLICIT_CONFIG)).toBe(true);
  expect(isExplicitAgentOwnership({ agents: { entries: { alpha: {} } } })).toBe(false);
  expect(isExplicitAgentOwnership({ agents: "explicit" })).toBe(false);
  expect(isExplicitAgentOwnership(null)).toBe(false);
  expect(isExplicitAgentOwnership(undefined)).toBe(false);
});

it("maps the known ownership error and passes anything else through", () => {
  expect(humanizeAgentConfigError(RAW_OWNERSHIP_ERROR)).toBe(
    t("agents.errors.explicitOwnershipDefault"),
  );
  expect(humanizeAgentConfigError("some other failure")).toBe("some other failure");
  expect(humanizeAgentConfigError(null)).toBeNull();
  expect(humanizeAgentConfigError("")).toBeNull();
});

function findSetDefaultButton(container: HTMLElement): HTMLButtonElement | null {
  const label = t("agents.setDefault");
  return (
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

it("disables Set Default and explains why under explicit ownership", () => {
  const container = document.createElement("div");
  render(
    renderAgents(
      createAgentViewTestProps({
        config: {
          form: EXPLICIT_CONFIG,
          loading: false,
          saving: false,
          dirty: false,
          error: null,
        },
      }),
    ),
    container,
  );

  const button = findSetDefaultButton(container);
  expect(button?.disabled).toBe(true);
  expect(button?.getAttribute("title")).toBe(t("agents.setDefaultLocked"));
  expect(container.querySelector("[data-default-agent-locked]")?.textContent?.trim()).toBe(
    t("agents.setDefaultLocked"),
  );
});

it("keeps Set Default available when ownership is not explicit", () => {
  const container = document.createElement("div");
  render(renderAgents(createAgentViewTestProps()), container);

  const button = findSetDefaultButton(container);
  expect(button?.disabled).toBe(false);
  expect(button?.hasAttribute("title")).toBe(false);
  expect(container.querySelector("[data-default-agent-locked]")).toBeNull();
});
