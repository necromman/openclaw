import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("titles"),
  component: () =>
    import("./titles-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-titles-page></openclaw-titles-page>`,
    })),
});
