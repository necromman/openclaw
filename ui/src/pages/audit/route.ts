import { definePage } from "@openclaw/uirouter";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("audit"),
  component: () => import("./audit-page.ts").then((module) => module.auditPageComponent),
});
