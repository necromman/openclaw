// Control UI tests cover the first-paint theme contract.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveBootTheme,
  resolvedModeForTheme,
  THEME_SETTINGS_KEY_PREFIX,
  waClassForMode,
} from "./theme-boot.ts";

const indexHtmlPath = path.resolve(
  process.cwd(),
  path.basename(process.cwd()) === "ui" ? "index.html" : "ui/index.html",
);

type StoredSettings = { theme?: unknown; themeMode?: unknown };

/** Every stored shape first paint has to agree with the bundle on. */
const CASES: { name: string; stored: StoredSettings | null; prefersLight: boolean }[] = [
  { name: "explicit dark", stored: { theme: "claw", themeMode: "dark" }, prefersLight: true },
  { name: "explicit light", stored: { theme: "claw", themeMode: "light" }, prefersLight: false },
  {
    name: "system on dark OS",
    stored: { theme: "claw", themeMode: "system" },
    prefersLight: false,
  },
  {
    name: "system on light OS",
    stored: { theme: "claw", themeMode: "system" },
    prefersLight: true,
  },
  { name: "no stored settings", stored: null, prefersLight: false },
  { name: "no stored settings, light OS", stored: null, prefersLight: true },
  { name: "empty object", stored: {}, prefersLight: true },
  { name: "unknown theme", stored: { theme: "nope", themeMode: "dark" }, prefersLight: true },
  { name: "unknown mode", stored: { theme: "tide", themeMode: "nope" }, prefersLight: false },
  { name: "non-string values", stored: { theme: 7, themeMode: null }, prefersLight: true },
  {
    name: "legacy theme name",
    stored: { theme: "fieldmanual", themeMode: "dark" },
    prefersLight: false,
  },
  { name: "custom dark", stored: { theme: "custom", themeMode: "dark" }, prefersLight: true },
  { name: "custom light", stored: { theme: "custom", themeMode: "light" }, prefersLight: false },
  ...(
    [
      "knot",
      "dash",
      "absolutely",
      "tide",
      "beacon",
      "phosphor",
      "crt",
      "manuscript",
      "rose",
      "miami",
    ] as const
  ).flatMap((theme) =>
    (["dark", "light"] as const).map((mode) => ({
      name: `${theme} ${mode}`,
      stored: { theme, themeMode: mode } as StoredSettings,
      prefersLight: mode === "dark",
    })),
  ),
];

describe("resolveBootTheme", () => {
  it("resolves stored modes without consulting the system preference", () => {
    expect(resolveBootTheme("claw", "dark", true)).toMatchObject({
      resolvedTheme: "dark",
      resolvedMode: "dark",
      waClass: "wa-dark",
      paletteTheme: "claw",
    });
    expect(resolveBootTheme("claw", "light", false)).toMatchObject({
      resolvedTheme: "light",
      resolvedMode: "light",
      waClass: "wa-light",
    });
  });

  it("follows the system preference for system mode", () => {
    expect(resolveBootTheme("knot", "system", true).resolvedTheme).toBe("openknot-light");
    expect(resolveBootTheme("knot", "system", false).resolvedTheme).toBe("openknot");
  });

  it("falls back to claw/system for missing or invalid stored values", () => {
    expect(resolveBootTheme(undefined, undefined, false)).toMatchObject({
      resolvedTheme: "dark",
      paletteTheme: "claw",
    });
    expect(resolveBootTheme("fieldmanual", "bright", true)).toMatchObject({
      resolvedTheme: "light",
      paletteTheme: "claw",
    });
    expect(resolveBootTheme(7, null, true).resolvedTheme).toBe("light");
  });

  it("keeps imported themes on their own resolved names", () => {
    expect(resolveBootTheme("custom", "dark", true).resolvedTheme).toBe("custom");
    expect(resolveBootTheme("custom", "light", false).resolvedTheme).toBe("custom-light");
  });

  it("maps resolved themes to a mode and a Web Awesome class", () => {
    expect(resolvedModeForTheme("miami-light")).toBe("light");
    expect(resolvedModeForTheme("miami")).toBe("dark");
    expect(waClassForMode("light")).toBe("wa-light");
    expect(waClassForMode("dark")).toBe("wa-dark");
  });
});

describe("index.html startup theme script", () => {
  it("stamps the same theme the bundle would for every stored value", async () => {
    const html = await readFile(indexHtmlPath, "utf8");
    const startupScript = /<script[^>]*>([^]*?var THEMES = \{[^]*?)<\/script>/.exec(html)?.[1];
    expect(startupScript, "expected the startup theme script in index.html").toBeTruthy();

    for (const testCase of CASES) {
      const root = createRootStub();
      const sandbox = createSandbox(root, testCase.stored, testCase.prefersLight);
      // oxlint-disable-next-line typescript/no-implied-eval -- running the shipped inline script is the point of this test.
      const run = new Function(
        "window",
        "document",
        "localStorage",
        `"use strict";${startupScript}`,
      );
      run(sandbox.window, sandbox.document, sandbox.localStorage);

      const expected = resolveBootTheme(
        testCase.stored?.theme,
        testCase.stored?.themeMode,
        testCase.prefersLight,
      );
      expect(
        {
          theme: root.attributes["data-theme"],
          mode: root.attributes["data-theme-mode"],
          resolved: root.attributes["data-theme-resolved"],
          wa: root.classes.has("wa-light") ? "wa-light" : "wa-dark",
          colorScheme: root.style.colorScheme,
        },
        testCase.name,
      ).toEqual({
        theme: expected.resolvedTheme,
        mode: expected.resolvedMode,
        resolved: expected.resolvedMode,
        wa: expected.waClass,
        colorScheme: expected.resolvedMode,
      });
      expect(root.classes.has(expected.waClass === "wa-light" ? "wa-dark" : "wa-light")).toBe(
        false,
      );
    }
  });

  it("reads the settings key prefix the app writes", async () => {
    const html = await readFile(indexHtmlPath, "utf8");
    expect(html).toContain(`"${THEME_SETTINGS_KEY_PREFIX}"`);
  });
});

type RootStub = {
  attributes: Record<string, string>;
  classes: Set<string>;
  style: { colorScheme: string };
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  classList: { add: (name: string) => void; remove: (name: string) => void };
};

function createRootStub(): RootStub {
  const attributes: Record<string, string> = {};
  const classes = new Set<string>();
  return {
    attributes,
    classes,
    style: { colorScheme: "" },
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    classList: {
      add: (name) => {
        classes.add(name);
      },
      remove: (name) => {
        classes.delete(name);
      },
    },
  };
}

function createSandbox(root: RootStub, stored: StoredSettings | null, prefersLight: boolean) {
  const store = new Map<string, string>();
  if (stored) {
    store.set(`${THEME_SETTINGS_KEY_PREFIX}:wss://gateway.example`, JSON.stringify(stored));
  }
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    // The inline script enumerates keys with Object.keys(localStorage).
    ...Object.fromEntries(store),
  };
  const head = { appendChild: () => undefined };
  return {
    localStorage,
    window: {
      matchMedia: (query: string) => ({ matches: query.includes("light") && prefersLight }),
    },
    document: {
      documentElement: root,
      head,
      createElement: () => ({ setAttribute: () => undefined, remove: () => undefined }),
    },
  };
}
