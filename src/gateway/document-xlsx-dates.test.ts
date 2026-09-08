import { describe, expect, test } from "vitest";
import {
  classifyXlsxFormatCode,
  formatXlsxSerialDate,
  readXlsxDateStyles,
} from "./document-xlsx-dates.js";

describe("classifyXlsxFormatCode", () => {
  test.each([
    ["yyyy-mm-dd", "date"],
    ["yyyy-mm-dd hh:mm", "datetime"],
    ["hh:mm:ss", "time"],
    // The locale prefix and the literal suffixes are not part of the pattern.
    ['[$-412]yyyy"년" m"월" d"일"', "date"],
  ])("reads %s as %s", (code, expected) => {
    expect(classifyXlsxFormatCode(code)).toBe(expected);
  });

  test.each([
    ["General"],
    ["#,##0"],
    ["0.00E+00"],
    // A quantity of months is not a date: `m` on its own decides nothing, and the
    // literal that gives it meaning is text.
    ['0"개월"'],
  ])("leaves %s alone", (code) => {
    expect(classifyXlsxFormatCode(code)).toBeUndefined();
  });
});

describe("formatXlsxSerialDate", () => {
  test("renders a whole-day serial as a date", () => {
    expect(formatXlsxSerialDate(46_023, "date")).toBe("2026-01-01");
  });

  test("shows the time a date-formatted cell happens to carry", () => {
    expect(formatXlsxSerialDate(46_023.5, "date")).toBe("2026-01-01 12:00");
  });

  test("rounds the floating-point fraction to the minute it was typed as", () => {
    // 09:30 arrives as a fraction that is not exactly 0.395833...
    expect(formatXlsxSerialDate(46_023 + 9.5 / 24 - 1e-9, "datetime")).toBe("2026-01-01 09:30");
  });

  test("keeps the phantom 1900 leap day from shifting early serials", () => {
    expect(formatXlsxSerialDate(1, "date")).toBe("1900-01-01");
    expect(formatXlsxSerialDate(61, "date")).toBe("1900-03-01");
  });

  test("renders a time-only format without a day", () => {
    expect(formatXlsxSerialDate(0.25, "time")).toBe("06:00");
  });

  test("refuses a value no date could occupy", () => {
    expect(formatXlsxSerialDate(-1, "date")).toBeUndefined();
    expect(formatXlsxSerialDate(9e9, "date")).toBeUndefined();
  });
});

describe("readXlsxDateStyles", () => {
  const styles =
    "<styleSheet>" +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;년&quot; mm&quot;월&quot;"/></numFmts>' +
    // cellStyleXfs shares the element name with cellXfs and must not be counted.
    '<cellStyleXfs count="1"><xf numFmtId="22"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>' +
    "</styleSheet>";

  test("indexes by cellXfs position and reads both builtin and custom formats", () => {
    expect(readXlsxDateStyles(styles)).toEqual([undefined, "date", "date"]);
  });

  test("answers nothing for a workbook with no style part", () => {
    expect(readXlsxDateStyles(undefined)).toEqual([]);
  });
});
