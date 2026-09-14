import { describe, expect, test } from "vitest";
import { resolveDirectSessionTargets } from "./session-sharing-target-input.js";

describe("resolveDirectSessionTargets", () => {
  test("reads session keys from key, keys, sessionKey and sessionKeys", () => {
    expect(resolveDirectSessionTargets("sessions.describe", { key: "agent:main:main" })).toEqual([
      { sessionKey: "agent:main:main" },
    ]);
    expect(
      resolveDirectSessionTargets("sessions.preview", {
        keys: ["agent:main:one", "agent:main:two"],
        agentId: "main",
      }),
    ).toEqual([
      { sessionKey: "agent:main:one", agentId: "main" },
      { sessionKey: "agent:main:two", agentId: "main" },
    ]);
    expect(
      resolveDirectSessionTargets("sessions.search", { sessionKeys: ["agent:main:one"] }),
    ).toEqual([{ sessionKey: "agent:main:one" }]);
  });

  test("never reads preference keys as session keys", () => {
    // ui.theme and friends are profile preference names. Treating them as sessions made
    // every profile appearance read fail on a multi-agent, explicitly owned deployment.
    expect(
      resolveDirectSessionTargets("users.prefs.get", {
        keys: ["ui.theme", "ui.themeMode", "ui.accent"],
      }),
    ).toEqual([]);
    expect(
      resolveDirectSessionTargets("users.prefs.set", { entries: { "ui.theme": "claw" } }),
    ).toEqual([]);
  });

  test("keeps ignoring session listing and creation params", () => {
    expect(resolveDirectSessionTargets("sessions.create", { key: "agent:main:main" })).toEqual([]);
    expect(resolveDirectSessionTargets("sessions.list", { key: "agent:main:main" })).toEqual([]);
  });
});
