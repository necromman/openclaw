import { render } from "lit";
import { expect, it } from "vitest";
import { t } from "../../i18n/index.ts";
import { createAgentViewTestProps } from "./agents-view.test-helpers.ts";
import { renderAgents } from "./view.ts";

it("surfaces agent config save errors in the active panel", () => {
  const container = document.createElement("div");
  render(
    renderAgents(
      createAgentViewTestProps({
        config: {
          form: { agents: { entries: { beta: {} } } },
          loading: false,
          saving: false,
          dirty: true,
          error: "mock validation failure",
        },
      }),
    ),
    container,
  );

  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("mock validation failure");
});

it("rewrites the explicit-ownership gateway error into a reader-facing sentence", () => {
  const container = document.createElement("div");
  render(
    renderAgents(
      createAgentViewTestProps({
        config: {
          form: { agents: { entries: { beta: {} } } },
          loading: false,
          saving: false,
          dirty: true,
          error:
            "GatewayRequestError: invalid config: agents.ownership: agents.ownership=explicit cannot be combined with a legacy default=true marker",
        },
      }),
    ),
    container,
  );

  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain(t("agents.errors.explicitOwnershipDefault"));
  expect(alert?.textContent).not.toContain("legacy default=true marker");
});
