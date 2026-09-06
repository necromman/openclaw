// Tests for the parts of the document converter that never need a real LibreOffice.
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { convertDocumentToPdf, resolveDocumentConverter } from "./document-convert.js";

// A path that cannot exist keeps the probe deterministic on every platform.
const MISSING_BINARY = path.join(path.sep, "openclaw-missing-soffice", "soffice");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("convertDocumentToPdf", () => {
  test("rejects extensions outside the converter whitelist before probing", async () => {
    for (const extension of ["txt", "pdf", "png", "exe", ""]) {
      const result = await convertDocumentToPdf({
        buffer: Buffer.from("payload"),
        sourceExtension: extension,
      });
      expect(result).toEqual({ ok: false, reason: "conversion-failed" });
    }
  });

  test("reports a missing converter instead of failing the conversion", async () => {
    vi.stubEnv("SOFFICE_BIN", MISSING_BINARY);
    const result = await convertDocumentToPdf({
      buffer: Buffer.from("payload"),
      sourceExtension: "docx",
    });
    expect(result).toEqual({ ok: false, reason: "converter-unavailable" });
  });
});

describe("resolveDocumentConverter", () => {
  test("reports unavailable when the pinned binary does not exist", async () => {
    vi.stubEnv("SOFFICE_BIN", MISSING_BINARY);
    await expect(resolveDocumentConverter()).resolves.toEqual({ available: false });
  });

  test("re-probes when the pinned binary changes", async () => {
    vi.stubEnv("SOFFICE_BIN", MISSING_BINARY);
    await expect(resolveDocumentConverter()).resolves.toEqual({ available: false });
    vi.stubEnv("SOFFICE_BIN", `${MISSING_BINARY}-other`);
    await expect(resolveDocumentConverter()).resolves.toEqual({ available: false });
  });
});
