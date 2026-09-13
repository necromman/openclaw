import { definePage, redirect, type RouteLocation } from "@openclaw/uirouter";
import { html } from "lit";
import { pathForRoute, routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";

export const page = definePage({
  ...routePageSpec("lobsterdex"),
  loaderDeps: (_context: ApplicationContext, location: RouteLocation) => location.pathname,
  loader: (context: ApplicationContext) =>
    redirect({
      pathname: pathForRoute("appearance", context.basePath),
      search: "",
      hash: "",
    }),
  component: async () => ({ header: true, render: () => html`` }),
});
