import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("model-catalog"),
  component: () =>
    import("./model-catalog-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-model-catalog-page></openclaw-model-catalog-page>`,
    })),
});
