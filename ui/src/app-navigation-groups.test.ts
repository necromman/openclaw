// Control UI tests cover sidebar entry customization behavior.
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_ENTRIES,
  SIDEBAR_NAV_ROUTES,
  isSessionsHubRoute,
  isSettingsNavigationRoute,
  normalizeSidebarEntries,
  parseSidebarEntry,
  serializeSidebarEntry,
  settingsNavigationOwnerRoute,
  sidebarMoreRoutes,
  visibleSettingsNavigationGroups,
  isSettingsNavigationRouteVisible,
} from "./app-navigation.ts";
import type { NativeDeviceSettingsCapability } from "./app/native-device-settings.ts";
import { readGatewayOperatorAccess } from "./app/operator-access.ts";
import { getStaticCommandPaletteCatalogItems } from "./components/command-palette-catalog-search.ts";
import {
  setIxAuthAdminAccess,
  setIxAuthManagedSession,
  setIxAuthSuperAdminAccess,
} from "./features/ix-auth/ix-auth-admin-access.ts";
import { findSettingsSearchBlocks } from "./pages/config/settings-search.ts";
import { createNativeDeviceSettingsSnapshot } from "./test-helpers/native-device-settings.ts";

const settingsGroups = visibleSettingsNavigationGroups(true);
const settingsRoutes = settingsGroups.flatMap((group) => group.routes);

describe("sidebar entries", () => {
  it.each([true, false])("shows device settings only with the capability, admin=%s", (canAdmin) => {
    const capability: NativeDeviceSettingsCapability = {
      snapshot: createNativeDeviceSettingsSnapshot(),
      subscribe: () => () => undefined,
      set: () => undefined,
      requestPermission: () => undefined,
      openSystemSettings: () => undefined,
      openPanel: () => undefined,
      checkForUpdates: () => undefined,
      refresh: () => undefined,
      dispose: () => undefined,
    };
    const search = (query: string, nativeDeviceSettings: NativeDeviceSettingsCapability | null) =>
      findSettingsSearchBlocks({
        query,
        schema: null,
        value: null,
        uiHints: {},
        canAdmin,
        nativeDeviceSettings,
      });
    expect(search("Dock icon", null)).toEqual([]);
    expect(search("Dock icon", capability)).toContainEqual(
      expect.objectContaining({ routeId: "device" }),
    );
    expect(search("computer presence", null)).toEqual([]);
    expect(search("computer presence", capability)).toContainEqual(
      expect.objectContaining({ routeId: "device-permissions" }),
    );
    const browserGroups = visibleSettingsNavigationGroups(canAdmin);
    const nativeGroups = visibleSettingsNavigationGroups(canAdmin, capability);
    expect(browserGroups.flatMap((group) => group.routes).includes("updates")).toBe(canAdmin);
    expect(nativeGroups.flatMap((group) => group.routes)).toContain("updates");
    expect(isSettingsNavigationRouteVisible("updates", canAdmin)).toBe(canAdmin);
    expect(isSettingsNavigationRouteVisible("updates", canAdmin, capability)).toBe(true);
    expect(search("Check for updates", capability)).toContainEqual(
      expect.objectContaining({ routeId: "updates" }),
    );
    expect(
      getStaticCommandPaletteCatalogItems(canAdmin, capability).some(
        (item) => item.routeId === "updates",
      ),
    ).toBe(true);
    expect(browserGroups.some((group) => group.labelKey === "nav.settingsGroupDevice")).toBe(false);
    expect(nativeGroups[1]).toEqual({
      labelKey: "nav.settingsGroupDevice",
      routes: ["device", "device-permissions"],
    });
    expect(
      visibleSettingsNavigationGroups(canAdmin, { ...capability, snapshot: null })[1]?.labelKey,
    ).toBe("nav.settingsGroupThisDevice");
    for (const route of ["device", "device-permissions"] as const) {
      expect(isSettingsNavigationRouteVisible(route, canAdmin)).toBe(false);
      expect(isSettingsNavigationRouteVisible(route, canAdmin, capability)).toBe(true);
      expect(browserGroups.flatMap((group) => group.routes)).not.toContain(route);
      expect(
        getStaticCommandPaletteCatalogItems(canAdmin).some((item) => item.routeId === route),
      ).toBe(false);
      expect(
        getStaticCommandPaletteCatalogItems(canAdmin, capability).some(
          (item) => item.routeId === route,
        ),
      ).toBe(true);
    }
  });
  it("keeps operational destinations visible by default", () => {
    expect(DEFAULT_SIDEBAR_ENTRIES).toEqual(["route:dashboards", "route:cron", "route:plugins"]);
  });

  it("drops retired routes from persisted entries", () => {
    expect(normalizeSidebarEntries(["route:overview", "route:usage"])).toEqual(["route:usage"]);
  });

  it("treats worktrees as a sessions hub tab without its own pin", () => {
    expect(isSessionsHubRoute("sessions")).toBe(true);
    expect(isSessionsHubRoute("worktrees")).toBe(true);
    expect(isSessionsHubRoute("chat")).toBe(false);
    expect(normalizeSidebarEntries(["route:worktrees", "route:usage"])).toEqual(["route:usage"]);
  });

  it("preserves the shipped Workboard placement slot outside customizable routes", () => {
    expect(normalizeSidebarEntries(["route:workboard", "workboard:ops"])).toEqual([
      "plugin:workboard/workboard",
      "plugin:workboard/board-ops",
    ]);
    expect(sidebarMoreRoutes([])).not.toContain("workboard");
  });

  it("recognizes every settings navigation route", () => {
    expect(settingsRoutes.every((routeId) => isSettingsNavigationRoute(routeId))).toBe(true);
  });

  it("places Updates in the System group immediately before About", () => {
    const system = settingsGroups.find((group) => group.labelKey === "nav.settingsGroupSystem");
    expect(system?.routes.slice(-2)).toEqual(["updates", "about"]);
  });

  it("places team secrets between Privacy & Security and Approvals", () => {
    const security = settingsGroups.find((group) => group.labelKey === "nav.settingsGroupSecurity");
    expect(security?.routes).toEqual(["security", "secrets", "approvals"]);
  });

  it("keeps model setup as a settings subpage without a sidebar entry", () => {
    expect(isSettingsNavigationRoute("model-setup")).toBe(true);
    expect(settingsNavigationOwnerRoute("model-setup")).toBe("model-providers");
  });

  it("keeps Agent Defaults routed as an Agents subpage without a sidebar entry", () => {
    expect(isSettingsNavigationRoute("ai-agents")).toBe(true);
    expect(settingsNavigationOwnerRoute("ai-agents")).toBe("agents");
  });

  it("filters admin-only settings while preserving legacy fail-open visibility", () => {
    const nonAdminRoutes = visibleSettingsNavigationGroups(false).flatMap((group) => group.routes);
    expect(nonAdminRoutes).toContain("approvals");
    expect(nonAdminRoutes).toContain("channels");
    expect(nonAdminRoutes).not.toContain("security");
    expect(nonAdminRoutes).not.toContain("communications");

    const legacyCanAdmin = readGatewayOperatorAccess({
      hello: { auth: { role: "operator" } },
    } as Parameters<typeof readGatewayOperatorAccess>[0]).canAdmin;
    expect(legacyCanAdmin).toBe(true);
    expect(visibleSettingsNavigationGroups(legacyCanAdmin)).toEqual(
      visibleSettingsNavigationGroups(true),
    );
  });

  it("drops stale device pins", () => {
    expect(normalizeSidebarEntries(["route:nodes", "route:usage"])).toEqual(["route:usage"]);
  });

  it("keeps the apps promo page available in More", () => {
    expect(sidebarMoreRoutes(DEFAULT_SIDEBAR_ENTRIES)).toContain("apps");
    expect(isSettingsNavigationRoute("apps")).toBe(false);
  });

  it("keeps Portals available in More", () => {
    expect(sidebarMoreRoutes(DEFAULT_SIDEBAR_ENTRIES)).toContain("portals");
    expect(isSettingsNavigationRoute("portals")).toBe(false);
  });

  it("keeps the plugin manager in customizable workspace routes", () => {
    expect(normalizeSidebarEntries(["route:plugins", "route:usage", "route:plugins"])).toEqual([
      "route:plugins",
      "route:usage",
    ]);
    expect(sidebarMoreRoutes(["route:usage", "session:agent:main:test"])).toContain("plugins");
  });

  it("round-trips route, Workboard, and session entries", () => {
    expect(parseSidebarEntry("route:usage")).toEqual({ type: "route", route: "usage" });
    expect(parseSidebarEntry("session:agent:main:test")).toEqual({
      type: "session",
      key: "agent:main:test",
    });
    expect(parseSidebarEntry("workboard:ops")).toEqual({
      type: "plugin",
      key: "workboard/board-ops",
    });
    expect(serializeSidebarEntry({ type: "route", route: "plugins" })).toBe("route:plugins");
    expect(serializeSidebarEntry({ type: "session", key: "agent:main:test" })).toBe(
      "session:agent:main:test",
    );
    expect(serializeSidebarEntry({ type: "plugin", key: "workboard/board-ops" })).toBe(
      "plugin:workboard/board-ops",
    );
  });

  it("normalizes persisted entries, dropping malformed and duplicate values", () => {
    expect(
      normalizeSidebarEntries([
        "route:usage",
        "session:agent:main:test",
        "route:tasks",
        "route:usage",
        "route:worktrees",
        "session:",
        "usage",
        7,
      ]),
    ).toEqual(["route:usage", "session:agent:main:test", "route:tasks"]);
    expect(normalizeSidebarEntries([])).toEqual([]);
  });

  it("recognizes OpenClaw settings and drops stale sidebar pins", () => {
    expect(isSettingsNavigationRoute("custodian")).toBe(true);
    expect(normalizeSidebarEntries(["route:custodian", "route:usage"])).toEqual(["route:usage"]);
  });

  it("falls back to null for non-list values so callers use defaults", () => {
    expect(normalizeSidebarEntries(undefined)).toBeNull();
    expect(normalizeSidebarEntries({ usage: true })).toBeNull();
    expect(normalizeSidebarEntries("route:usage")).toBeNull();
  });

  it("puts every hidden nav route into the More section", () => {
    const entries = ["route:tasks", "session:agent:main:test", "route:usage"] as const;
    const more = sidebarMoreRoutes(entries);
    expect(more).not.toContain("tasks");
    expect(more).not.toContain("usage");
    expect(new Set(["tasks", "usage", ...more])).toEqual(new Set(SIDEBAR_NAV_ROUTES));
  });
});

describe("identity-server administration entries", () => {
  afterEach(() => {
    // The flag is module state the session probe owns; leaving it set would hand the
    // next test a sidebar it did not ask for.
    setIxAuthAdminAccess(false);
  });

  it.each([true, false])(
    "hides both administration screens until the session says otherwise, admin=%s",
    (canAdmin) => {
      setIxAuthAdminAccess(false);
      const routes = visibleSettingsNavigationGroups(canAdmin).flatMap((group) => group.routes);
      expect(routes).not.toContain("audit");
      expect(routes).not.toContain("users");
      expect(isSettingsNavigationRouteVisible("audit", canAdmin)).toBe(false);
    },
  );

  it.each([true, false])(
    "offers the audit log wherever it offers user management, admin=%s",
    (canAdmin) => {
      // An identity-server administrator holds no Gateway operator scope, so the entry
      // has to survive canAdmin=false or the ledger is address-bar only for them.
      setIxAuthAdminAccess(true);
      const groups = visibleSettingsNavigationGroups(canAdmin);
      const routes = groups.flatMap((group) => group.routes);
      expect(routes).toContain("audit");
      expect(routes).toContain("users");
      expect(isSettingsNavigationRouteVisible("audit", canAdmin)).toBe(true);
      const security = groups.find((group) => group.labelKey === "nav.settingsGroupSecurity");
      expect(security?.routes).toContain("audit");
    },
  );

  it("keeps the audit log a lazily routed settings destination, not a sidebar pin", () => {
    expect(isSettingsNavigationRoute("audit")).toBe(true);
    expect(SIDEBAR_NAV_ROUTES).not.toContain("audit");
  });
});

describe("settings menu for a ranked account", () => {
  afterEach(() => {
    setIxAuthAdminAccess(false);
    setIxAuthManagedSession(false);
    setIxAuthSuperAdminAccess(false);
  });

  // Every entry below either writes Gateway configuration the whole company shares or
  // reads an administration API, so a staff account keeps none of them.
  const ADMINISTRATION_ROUTES = [
    "connection",
    "users",
    "departments",
    "folders",
    "channels",
    "devices",
    "agents",
    "model-providers",
    "model-catalog",
    "memory",
    "audit",
    "approvals",
    "advanced",
    "debug",
    "logs",
  ] as const;

  it.each([true, false])(
    "leaves a non-administrator only the settings that are its own, admin=%s",
    (canAdmin) => {
      setIxAuthManagedSession(true);
      setIxAuthAdminAccess(false);
      const routes = visibleSettingsNavigationGroups(canAdmin).flatMap((group) => group.routes);
      expect(routes).toEqual(["profile", "appearance", "notifications", "talk", "about"]);
      for (const routeId of ADMINISTRATION_ROUTES) {
        expect(isSettingsNavigationRouteVisible(routeId, canAdmin)).toBe(false);
      }
    },
  );

  it("gives an administrator the company screens and none of the system ones", () => {
    setIxAuthManagedSession(true);
    setIxAuthAdminAccess(true);
    setIxAuthSuperAdminAccess(false);
    const routes = visibleSettingsNavigationGroups(false).flatMap((group) => group.routes);
    expect(routes).toEqual([
      "profile",
      "appearance",
      "notifications",
      "users",
      "departments",
      "folders",
      "talk",
      // The administrator model screen. It is the one Gateway setting this rank
      // writes, through an identity route rather than through operator.admin.
      "model-catalog",
      "audit",
      "approvals",
      "about",
    ]);
  });

  it("keeps everything for a system administrator", () => {
    setIxAuthManagedSession(true);
    setIxAuthAdminAccess(true);
    setIxAuthSuperAdminAccess(true);
    const routes = visibleSettingsNavigationGroups(true).flatMap((group) => group.routes);
    for (const routeId of ["users", "departments", "audit", "advanced", "debug", "logs"] as const) {
      expect(routes).toContain(routeId);
    }
  });

  it("leaves the shared-token modes exactly as they were", () => {
    setIxAuthManagedSession(false);
    setIxAuthAdminAccess(false);
    const routes = visibleSettingsNavigationGroups(false).flatMap((group) => group.routes);
    for (const routeId of ["connection", "channels", "agents", "advanced", "logs"] as const) {
      expect(routes).toContain(routeId);
    }
  });
});
