import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("folders"),
  component: () =>
    // Both directions through the rule table are loaded together: the switch between them
    // has to be instant, and the pair is one screen from the operator's side.
    Promise.all([
      import("./folders-page.ts"),
      import("./folder-subjects-page.ts"),
      import("./folders-mode-page.ts"),
    ]).then(() => ({
      header: true,
      render: () => html`<openclaw-folders-mode-page></openclaw-folders-mode-page>`,
    })),
});
