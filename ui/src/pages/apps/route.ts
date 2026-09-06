import { definePage, redirect } from "@openclaw/uirouter";
import { html, nothing } from "lit";
import { pathForRoute, routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { BRAND_FEATURES } from "../../brand.ts";

export const page = definePage({
  ...routePageSpec("apps"),
  // Hidden in this fork (see BRAND_FEATURES.appsPage): the route stays
  // registered so upstream keeps applying, but it sends a direct visit home
  // instead of rendering the companion-apps page. Flip the flag to restore it.
  loader: (context: ApplicationContext) =>
    BRAND_FEATURES.appsPage
      ? undefined
      : redirect({ pathname: pathForRoute("chat", context.basePath) }),
  component: () =>
    BRAND_FEATURES.appsPage
      ? import("./apps-page.ts").then(() => ({
          header: true,
          render: () => html`<openclaw-apps-page></openclaw-apps-page>`,
        }))
      : Promise.resolve({ header: true, render: () => nothing }),
});
