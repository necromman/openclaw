// Whether the signed-in account may open a settings destination at all, and what the
// shell renders in its place when it may not.
//
// Hiding a menu entry only removes the shortcut: the address bar still works, and every
// settings route is a plain URL. The Gateway refuses the calls behind these screens on
// its own, so this is not the security boundary; it is the difference between a screen
// that explains itself and a screen full of controls that answer 403.
//
// The route outlet is rendered here rather than in the shell so the decision and the
// element it replaces stay in one file.
import { html, nothing } from "lit";
import {
  isSettingsNavigationRouteVisible,
  settingsNavigationOwnerRoute,
  titleForRoute,
} from "../app-navigation.ts";
// Route ids come from the path table, not from the route table: this module must not pull
// every page module into the startup bundle just to name a route.
import type { RouteId } from "../app-route-paths.ts";
import { t } from "../i18n/index.ts";
import type { ShellViewHost } from "./app-shell-view.ts";
import { readGatewayOperatorAccess } from "./operator-access.ts";

/**
 * True when this settings route is one the account may not open.
 *
 * A subpage is judged by the entry that owns it, so hiding Agents also closes the agent
 * editor it links to rather than leaving a back door one URL deep.
 */
function isSettingsRouteAccessDenied(params: {
  routeId: RouteId;
  settingsTakeover: boolean;
  canAdmin: boolean;
  nativeDeviceSettings: Parameters<typeof isSettingsNavigationRouteVisible>[2];
}): boolean {
  if (!params.settingsTakeover) {
    return false;
  }
  return !isSettingsNavigationRouteVisible(
    settingsNavigationOwnerRoute(params.routeId),
    params.canAdmin,
    params.nativeDeviceSettings,
  );
}

/**
 * The panel shown in place of a settings page the account may not open.
 *
 * It keeps the page title so the address the person typed still names something, and says
 * in one line who may open it.
 */
function renderSettingsAccessDenied(routeId: RouteId) {
  return html`
    <section class="content-header">
      <div>
        <div class="page-title">${titleForRoute(routeId)}</div>
        <div class="page-subtitle">${t("ixAuth.settings.forbidden")}</div>
      </div>
    </section>
  `;
}

/**
 * The shell's route outlet, or the refusal panel when the route is out of reach.
 *
 * Replacing the element rather than disabling it is deliberate: an outlet that never
 * mounts never runs the route's loader, so a screen the account may not see also asks the
 * Gateway for nothing on its behalf.
 */
export function renderShellRouterOutlet(
  host: ShellViewHost,
  blocked: boolean,
  connected: boolean,
  settingsTakeover: boolean,
) {
  const context = host.context;
  const runtime = host.runtime;
  if (!context || !runtime) {
    return nothing;
  }
  const routeId = host.routeState.routeId ?? "chat";
  const denied = isSettingsRouteAccessDenied({
    routeId,
    settingsTakeover,
    canAdmin: readGatewayOperatorAccess(context.gateway.snapshot).canAdmin,
    nativeDeviceSettings: context.nativeDeviceSettings,
  });
  if (denied) {
    return renderSettingsAccessDenied(routeId);
  }
  return html`<openclaw-router-outlet
    ?inert=${blocked}
    aria-disabled=${blocked ? "true" : nothing}
    .router=${runtime.router}
    .retryContext=${context}
    .onNotFound=${() => host.replaceChatWithCurrentSession()}
    .notFoundRecoveryReady=${connected}
  ></openclaw-router-outlet>`;
}
