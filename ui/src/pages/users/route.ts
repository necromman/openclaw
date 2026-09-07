import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("users"),
  component: () =>
    import("./users-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-users-page></openclaw-users-page>`,
    })),
});
