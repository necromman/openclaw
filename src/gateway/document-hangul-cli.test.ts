// Tests for the optional rhwp bridge. The binary itself is not present in CI, so these
// cover the parts that must behave correctly without it: the extension gate, the operator
// pin, and the "not installed" answer that sends callers to the built-in reader.
import { afterEach, describe, expect, test } from "vitest";
import {
  convertHangulToMarkdown,
  resetHangulConverterProbe,
  resolveHangulConverter,
} from "./document-hangul-cli.js";

const originalPin = process.env.RHWP_BIN;

function setPin(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.RHWP_BIN;
  } else {
    process.env.RHWP_BIN = value;
  }
  resetHangulConverterProbe();
}

afterEach(() => {
  setPin(originalPin);
});

describe("resolveHangulConverter", () => {
  test("reports a pinned path that does not exist as unavailable", async () => {
    // An operator pin is authoritative: quietly searching PATH instead would hide the
    // typo behind a working conversion and make the mistake impossible to notice.
    setPin("/nonexistent/rhwp-binary");
    expect(await resolveHangulConverter()).toEqual({ available: false });
  });
});

describe("convertHangulToMarkdown", () => {
  test("refuses an extension the binary must never be handed", async () => {
    setPin("/nonexistent/rhwp-binary");
    expect(
      await convertHangulToMarkdown({ buffer: Buffer.from("x"), sourceExtension: "docx" }),
    ).toEqual({ ok: false, reason: "conversion-failed" });
  });

  test("says the converter is missing rather than that the file is broken", async () => {
    setPin("/nonexistent/rhwp-binary");
    expect(
      await convertHangulToMarkdown({ buffer: Buffer.from("x"), sourceExtension: "hwp" }),
    ).toEqual({ ok: false, reason: "converter-unavailable" });
  });
});
