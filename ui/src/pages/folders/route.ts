import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("folders"),
  component: () =>
    import("./folders-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-folders-page></openclaw-folders-page>`,
    })),
});
