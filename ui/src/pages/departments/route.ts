import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("departments"),
  component: () =>
    import("./departments-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-departments-page></openclaw-departments-page>`,
    })),
});
