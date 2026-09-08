// Dates in a workbook are numbers, and only the cell's format says so.
//
// A spreadsheet stores 2026-01-31 as 46053: the count of days since the 1900 epoch, with
// the time of day in the fraction. Nothing in the cell distinguishes that from a quantity
// or a part number, so a reader that prints the value verbatim turns every deadline, lot
// date and expiry in an indexed workbook into a five-digit integer that no search for a
// date can ever match. The format attached to the cell is the only signal, and this
// module is the one place that reads it.
//
// The 1904 workbook option is not handled: it is a legacy Mac setting, the delivery
// documents are Excel-for-Windows workbooks, and guessing wrong there would shift every
// date by four years rather than fail visibly. A workbook that uses it keeps the old
// behaviour of printing the serial.

/** What a cell format says the number underneath it means. */
export type XlsxDateKind = "date" | "datetime" | "time";

/**
 * Built-in format ids that carry a date or a time.
 *
 * The numbering is fixed by the file format: 14-22 are the western date and time formats,
 * 45-47 are the elapsed and minute-second ones, and 27-36 plus 50-58 are the East Asian
 * date formats a Korean workbook actually uses. Ids outside this table are numeric,
 * currency, percentage or text formats and are left alone.
 */
const XLSX_BUILTIN_DATE_FORMATS: ReadonlyMap<number, XlsxDateKind> = new Map<number, XlsxDateKind>([
  [14, "date"],
  [15, "date"],
  [16, "date"],
  [17, "date"],
  [18, "time"],
  [19, "time"],
  [20, "time"],
  [21, "time"],
  [22, "datetime"],
  [27, "date"],
  [28, "date"],
  [29, "date"],
  [30, "date"],
  [31, "date"],
  [32, "time"],
  [33, "time"],
  [34, "date"],
  [35, "date"],
  [36, "date"],
  [45, "time"],
  [46, "time"],
  [47, "time"],
  [50, "date"],
  [51, "date"],
  [52, "date"],
  [53, "date"],
  [54, "date"],
  [55, "date"],
  [56, "date"],
  [57, "date"],
  [58, "date"],
]);

/** Days between the spreadsheet epoch and the Unix epoch, for serials from 1900-03-01. */
const XLSX_EPOCH_OFFSET_DAYS = 25_569;

/**
 * The same offset for serials before that date.
 *
 * The file format keeps a 1900-02-29 that never existed, so every serial up to 60 is one
 * day further from the Unix epoch than arithmetic alone would say. Shifting the offset for
 * that range is what makes serial 1 read as 1900-01-01 instead of a day earlier.
 */
const XLSX_EPOCH_OFFSET_DAYS_BEFORE_LEAP_BUG = 25_568;

/** Serial for 9999-12-31, past which the value is not a date anybody meant to write. */
const XLSX_MAX_SERIAL = 2_958_465;

const MILLISECONDS_PER_DAY = 86_400_000;

function decodeXmlAttributeValue(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "u").exec(tag);
  return match?.[1];
}

/**
 * Classify one custom format code.
 *
 * Literal text is removed first, because a format like `0"일"` is a count of days and not
 * a date, and a locale prefix like `[$-412]` is not part of the pattern at all. What
 * remains is read for the letters the format language reserves: `y` and `d` for a date,
 * `h` and `s` for a time. `m` is deliberately not one of them - it means month next to a
 * date token and minute next to a time token, so on its own it decides nothing.
 */
export function classifyXlsxFormatCode(code: string): XlsxDateKind | undefined {
  const pattern = code
    .replaceAll(/"[^"]*"/gu, "")
    .replaceAll(/\[[^\]]*\]/gu, "")
    .replaceAll(/\\./gu, "")
    .toLowerCase();
  const hasDate = /[yd]/u.test(pattern);
  const hasTime = /[hs]/u.test(pattern);
  if (hasDate && hasTime) {
    return "datetime";
  }
  if (hasDate) {
    return "date";
  }
  return hasTime ? "time" : undefined;
}

/**
 * Read `xl/styles.xml` into one answer per cell style index.
 *
 * A cell names its style by position in `cellXfs`, so the result is an array indexed the
 * same way. `cellStyleXfs` earlier in the same file has the same element name and a
 * different meaning, which is why the block is located before its entries are read rather
 * than every `xf` in the document being taken.
 */
export function readXlsxDateStyles(stylesXml: string | undefined): (XlsxDateKind | undefined)[] {
  if (!stylesXml) {
    return [];
  }
  const custom = new Map<number, XlsxDateKind>();
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*>/gu)) {
    const id = Number.parseInt(readAttribute(match[0], "numFmtId") ?? "", 10);
    const code = readAttribute(match[0], "formatCode");
    if (!Number.isInteger(id) || code === undefined) {
      continue;
    }
    const kind = classifyXlsxFormatCode(decodeXmlAttributeValue(code));
    if (kind) {
      custom.set(id, kind);
    }
  }
  const open = /<cellXfs\b[^>]*>/u.exec(stylesXml);
  if (!open || open.index === undefined) {
    return [];
  }
  const start = open.index + open[0].length;
  const end = stylesXml.indexOf("</cellXfs>", start);
  const block = stylesXml.slice(start, end === -1 ? undefined : end);
  const kinds: (XlsxDateKind | undefined)[] = [];
  for (const match of block.matchAll(/<xf\b[^>]*>/gu)) {
    const id = Number.parseInt(readAttribute(match[0], "numFmtId") ?? "", 10);
    kinds.push(
      Number.isInteger(id) ? (XLSX_BUILTIN_DATE_FORMATS.get(id) ?? custom.get(id)) : undefined,
    );
  }
  return kinds;
}

/**
 * Render one serial as the date it stands for.
 *
 * Seconds are rounded away: a serial is a fraction of a day in binary floating point, so
 * a time entered as 09:30 arrives as 09:29:59.9999 and printing it unrounded would put
 * false precision into an index. A date-formatted cell that nonetheless carries a time of
 * day shows it, because a stamp of "when" is worth more than tidiness about the format.
 *
 * Returns `undefined` for anything outside the range a date can occupy, which leaves the
 * caller printing the number exactly as before.
 */
export function formatXlsxSerialDate(serial: number, kind: XlsxDateKind): string | undefined {
  if (!Number.isFinite(serial) || serial < 0 || serial > XLSX_MAX_SERIAL) {
    return undefined;
  }
  const offset =
    serial < 61 ? XLSX_EPOCH_OFFSET_DAYS_BEFORE_LEAP_BUG : XLSX_EPOCH_OFFSET_DAYS;
  const rounded = Math.round((serial - offset) * MILLISECONDS_PER_DAY);
  const moment = new Date(Math.round(rounded / 60_000) * 60_000);
  if (Number.isNaN(moment.getTime())) {
    return undefined;
  }
  const iso = moment.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  if (kind === "time") {
    return time;
  }
  return kind === "datetime" || time !== "00:00" ? `${day} ${time}` : day;
}

/** The text one numeric cell should show, or undefined when it is not a date. */
export function formatXlsxDateCell(params: {
  raw: string;
  styleIndex: number | undefined;
  styles: readonly (XlsxDateKind | undefined)[];
}): string | undefined {
  if (params.styleIndex === undefined) {
    return undefined;
  }
  const kind = params.styles[params.styleIndex];
  if (!kind) {
    return undefined;
  }
  const serial = Number(params.raw);
  return params.raw.trim().length === 0 ? undefined : formatXlsxSerialDate(serial, kind);
}
