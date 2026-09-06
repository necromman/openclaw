/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { base64ToBytes } from "./document-preview.ts";

function decodeToString(value: string): string {
  return String.fromCharCode(...base64ToBytes(value));
}

describe("base64ToBytes", () => {
  it("round-trips ascii payloads", () => {
    expect(decodeToString(btoa("hello world"))).toBe("hello world");
  });

  it("decodes high bytes outside the ascii range", () => {
    const source = String.fromCharCode(0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80);
    const bytes = base64ToBytes(btoa(source));
    expect([...bytes]).toEqual([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80]);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("returns an empty array for an empty string", () => {
    const bytes = base64ToBytes("");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
  });

  it("returns an empty array for malformed input instead of throwing", () => {
    expect(() => base64ToBytes("!!!not base64!!!")).not.toThrow();
    expect(base64ToBytes("!!!not base64!!!").length).toBe(0);
    // A single character can never be a whole base64 group.
    expect(base64ToBytes("a").length).toBe(0);
  });
});
