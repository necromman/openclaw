import { definePage, redirect, type RouteLocation } from "@openclaw/uirouter";
import { html } from "lit";
import { pathForRoute, routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { BRAND_FEATURES } from "../../brand.ts";

export const page = definePage({
  ...routePageSpec("apps"),
  // Hidden in this fork (BRAND_FEATURES.appsPage): the route stays registered so
  // upstream keeps applying, but a direct visit is sent home instead of
  // rendering the companion-apps page. Flip the flag to restore it.
  // loaderDeps is required for the router to run the loader at all.
  loaderDeps: (_context: ApplicationContext, location: RouteLocation) => location.pathname,
  loader: (context: ApplicationContext) =>
    BRAND_FEATURES.appsPage
      ? null
      : redirect({
          pathname: pathForRoute("chat", context.basePath),
          search: "",
          hash: "",
        }),
  component: async () => {
    if (!BRAND_FEATURES.appsPage) {
      // The loader already redirected; this render never reaches the user.
      return { header: true, render: () => html`` };
    }
    await import("./apps-page.ts");
    return { header: true, render: () => html`<openclaw-apps-page></openclaw-apps-page>` };
  },
});
