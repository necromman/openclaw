// Gateway document extraction module implements a dependency-free OOXML to HTML fallback.
// It runs when no external converter is available, so it must never shell out and
// must never emit markup a preview iframe could execute.
import type JSZipArchive from "jszip";
import { extractHangulText, isHangulExtension } from "./document-extract-hangul.js";
import {
  formatXlsxDateCell,
  readXlsxDateStyles,
  type XlsxDateKind,
} from "./document-xlsx-dates.js";

/**
 * The two OOXML families whose part layout is simple enough to scan without a parser,
 * plus the two Hangul word processor containers, which have no converter behind them at
 * all and therefore reach a reader only here.
 */
const SUPPORTED_EXTENSIONS = new Set(["docx", "xlsx", "hwp", "hwpx"]);

// Preview payloads travel over the gateway connection, so the rendered document
// is capped well below the raw file cap.
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_SHEETS = 12;
const MAX_ROWS_PER_SHEET = 300;
const MAX_COLUMNS_PER_ROW = 40;

const TRUNCATION_NOTE = "Preview truncated.";

/** Escapes every character that could break out of text or an attribute value. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}

function findTagStart(xml: string, name: string, from: number): number {
  // The lookahead keeps <w:p> from matching <w:pPr> and <w:tbl> from matching <w:tblPr>.
  const pattern = new RegExp(`<${name}(?=[\\s/>])`, "gu");
  pattern.lastIndex = from;
  const match = pattern.exec(xml);
  return match ? match.index : -1;
}

type ElementRange = {
  openTag: string;
  contentStart: number;
  contentEnd: number;
  end: number;
};

/** Locates one element body, counting same-named descendants so nested tables resolve. */
function readElement(xml: string, name: string, start: number): ElementRange | undefined {
  const openEnd = xml.indexOf(">", start);
  if (openEnd < 0) {
    return undefined;
  }
  const openTag = xml.slice(start, openEnd + 1);
  if (xml[openEnd - 1] === "/") {
    return { contentEnd: openEnd + 1, contentStart: openEnd + 1, end: openEnd + 1, openTag };
  }
  const contentStart = openEnd + 1;
  const closeTag = `</${name}>`;
  let depth = 1;
  let cursor = contentStart;
  while (depth > 0) {
    const nextClose = xml.indexOf(closeTag, cursor);
    if (nextClose < 0) {
      return undefined;
    }
    const nextOpen = findTagStart(xml, name, cursor);
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const innerOpenEnd = xml.indexOf(">", nextOpen);
      if (innerOpenEnd < 0) {
        return undefined;
      }
      if (xml[innerOpenEnd - 1] !== "/") {
        depth += 1;
      }
      cursor = innerOpenEnd + 1;
      continue;
    }
    depth -= 1;
    cursor = nextClose + closeTag.length;
    if (depth === 0) {
      return { contentEnd: nextClose, contentStart, end: cursor, openTag };
    }
  }
  return undefined;
}

function collectElements(xml: string, name: string, limit: number): ElementRange[] {
  const found: ElementRange[] = [];
  let cursor = 0;
  while (found.length < limit) {
    const start = findTagStart(xml, name, cursor);
    if (start < 0) {
      break;
    }
    const element = readElement(xml, name, start);
    if (!element) {
      break;
    }
    found.push(element);
    cursor = element.end;
  }
  return found;
}

function attributeValue(openTag: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}="([^"]*)"`, "u");
  const match = pattern.exec(openTag);
  return match?.[1];
}

/** Concatenates the w:t runs of one paragraph or cell, keeping breaks as newlines. */
function readWordText(xml: string): string {
  let out = "";
  let cursor = 0;
  const token = /<w:(t|br|tab|cr)(?=[\s/>])/gu;
  token.lastIndex = 0;
  while (true) {
    token.lastIndex = cursor;
    const match = token.exec(xml);
    if (!match) {
      break;
    }
    const name = `w:${match[1]}`;
    const element = readElement(xml, name, match.index);
    if (!element) {
      break;
    }
    cursor = element.end;
    if (match[1] === "br" || match[1] === "cr") {
      out += "\n";
      continue;
    }
    if (match[1] === "tab") {
      out += " ";
      continue;
    }
    const raw = decodeXmlText(xml.slice(element.contentStart, element.contentEnd));
    // Word only guarantees literal whitespace when the run opts in; otherwise it
    // collapses, which is what a reader sees in the real document.
    const preserve = attributeValue(element.openTag, "xml:space") === "preserve";
    out += preserve ? raw : raw.replace(/\s+/gu, " ");
  }
  return out;
}

function textToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br />");
}

class HtmlBody {
  private readonly parts: string[] = [];
  private bytes = 0;
  private full = false;

  push(chunk: string): boolean {
    if (this.full) {
      return false;
    }
    const size = Buffer.byteLength(chunk, "utf8");
    if (this.bytes + size > MAX_OUTPUT_BYTES) {
      this.full = true;
      return false;
    }
    this.parts.push(chunk);
    this.bytes += size;
    return true;
  }

  get exhausted(): boolean {
    return this.full;
  }

  render(): string {
    const html = this.parts.join("");
    return this.full ? `${html}<p class="truncated">${TRUNCATION_NOTE}</p>` : html;
  }
}

type WordParagraph = {
  text: string;
  headingLevel?: number;
  listItem: boolean;
};

function readParagraph(xml: string, element: ElementRange): WordParagraph {
  const inner = xml.slice(element.contentStart, element.contentEnd);
  const propertiesEnd = inner.indexOf("</w:pPr>");
  const properties = propertiesEnd >= 0 ? inner.slice(0, propertiesEnd) : "";
  const style = /<w:pStyle[^>]*w:val="([^"]*)"/u.exec(properties)?.[1] ?? "";
  const headingMatch = /^Heading(\d+)$/u.exec(style);
  const headingLevel = headingMatch
    ? Math.min(3, Math.max(1, Number.parseInt(headingMatch[1] ?? "1", 10)))
    : undefined;
  return {
    headingLevel,
    listItem: properties.includes("<w:numPr"),
    text: readWordText(inner),
  };
}

function renderWordTable(xml: string, table: ElementRange, body: HtmlBody): void {
  const inner = xml.slice(table.contentStart, table.contentEnd);
  const rows = collectElements(inner, "w:tr", MAX_ROWS_PER_SHEET);
  if (rows.length === 0) {
    return;
  }
  if (!body.push("<table><tbody>")) {
    return;
  }
  for (const row of rows) {
    const rowInner = inner.slice(row.contentStart, row.contentEnd);
    const cells = collectElements(rowInner, "w:tc", MAX_COLUMNS_PER_ROW);
    if (!body.push("<tr>")) {
      return;
    }
    for (const cell of cells) {
      const cellInner = rowInner.slice(cell.contentStart, cell.contentEnd);
      const paragraphs = collectElements(cellInner, "w:p", MAX_ROWS_PER_SHEET).map((paragraph) =>
        readWordText(cellInner.slice(paragraph.contentStart, paragraph.contentEnd)),
      );
      if (!body.push(`<td>${textToHtml(paragraphs.join("\n"))}</td>`)) {
        return;
      }
    }
    if (!body.push("</tr>")) {
      return;
    }
  }
  body.push("</tbody></table>");
}

function extractDocxBody(documentXml: string): string {
  const body = new HtmlBody();
  const bodyElementStart = findTagStart(documentXml, "w:body", 0);
  const bodyElement =
    bodyElementStart >= 0 ? readElement(documentXml, "w:body", bodyElementStart) : undefined;
  const xml = bodyElement
    ? documentXml.slice(bodyElement.contentStart, bodyElement.contentEnd)
    : documentXml;
  let cursor = 0;
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      body.push("</ul>");
      listOpen = false;
    }
  };
  while (!body.exhausted) {
    const paragraphStart = findTagStart(xml, "w:p", cursor);
    const tableStart = findTagStart(xml, "w:tbl", cursor);
    if (paragraphStart < 0 && tableStart < 0) {
      break;
    }
    const takeTable = tableStart >= 0 && (paragraphStart < 0 || tableStart < paragraphStart);
    if (takeTable) {
      const table = readElement(xml, "w:tbl", tableStart);
      if (!table) {
        break;
      }
      closeList();
      renderWordTable(xml, table, body);
      cursor = table.end;
      continue;
    }
    const element = readElement(xml, "w:p", paragraphStart);
    if (!element) {
      break;
    }
    cursor = element.end;
    const paragraph = readParagraph(xml, element);
    if (paragraph.text.trim().length === 0) {
      continue;
    }
    const html = textToHtml(paragraph.text);
    if (paragraph.headingLevel) {
      closeList();
      body.push(`<h${paragraph.headingLevel}>${html}</h${paragraph.headingLevel}>`);
      continue;
    }
    if (paragraph.listItem) {
      if (!listOpen) {
        body.push("<ul>");
        listOpen = true;
      }
      body.push(`<li>${html}</li>`);
      continue;
    }
    closeList();
    body.push(`<p>${html}</p>`);
  }
  closeList();
  return body.render();
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) {
    return [];
  }
  const entries: string[] = [];
  let cursor = 0;
  while (true) {
    const start = findTagStart(xml, "si", cursor);
    if (start < 0) {
      break;
    }
    const element = readElement(xml, "si", start);
    if (!element) {
      break;
    }
    cursor = element.end;
    const inner = xml.slice(element.contentStart, element.contentEnd);
    let text = "";
    let textCursor = 0;
    while (true) {
      const textStart = findTagStart(inner, "t", textCursor);
      if (textStart < 0) {
        break;
      }
      const textElement = readElement(inner, "t", textStart);
      if (!textElement) {
        break;
      }
      textCursor = textElement.end;
      text += decodeXmlText(inner.slice(textElement.contentStart, textElement.contentEnd));
    }
    entries.push(text);
  }
  return entries;
}

function readCellText(params: {
  cellInner: string;
  type: string | undefined;
  styleIndex: number | undefined;
  shared: string[];
  dateStyles: readonly (XlsxDateKind | undefined)[];
}): string {
  const { cellInner, type, shared } = params;
  if (type === "inlineStr") {
    const isStart = findTagStart(cellInner, "is", 0);
    const isElement = isStart >= 0 ? readElement(cellInner, "is", isStart) : undefined;
    const scope = isElement
      ? cellInner.slice(isElement.contentStart, isElement.contentEnd)
      : cellInner;
    const textStart = findTagStart(scope, "t", 0);
    const textElement = textStart >= 0 ? readElement(scope, "t", textStart) : undefined;
    if (!textElement) {
      return "";
    }
    return decodeXmlText(scope.slice(textElement.contentStart, textElement.contentEnd));
  }
  const valueStart = findTagStart(cellInner, "v", 0);
  const valueElement = valueStart >= 0 ? readElement(cellInner, "v", valueStart) : undefined;
  const raw = valueElement
    ? decodeXmlText(cellInner.slice(valueElement.contentStart, valueElement.contentEnd))
    : "";
  if (type !== "s") {
    // A number whose cell format is a date is a date; the digits alone never say so.
    return (
      formatXlsxDateCell({
        raw,
        styleIndex: params.styleIndex,
        styles: params.dateStyles,
      }) ?? raw
    );
  }
  const index = Number.parseInt(raw, 10);
  return Number.isInteger(index) ? (shared[index] ?? "") : "";
}

function renderSheet(params: {
  body: HtmlBody;
  name: string;
  shared: string[];
  sheetXml: string;
  dateStyles: readonly (XlsxDateKind | undefined)[];
}): void {
  const rows = collectElements(params.sheetXml, "row", MAX_ROWS_PER_SHEET + 1);
  const rowsTruncated = rows.length > MAX_ROWS_PER_SHEET;
  const visibleRows = rowsTruncated ? rows.slice(0, MAX_ROWS_PER_SHEET) : rows;
  if (!params.body.push(`<section><h2>${escapeHtml(params.name)}</h2><table><tbody>`)) {
    return;
  }
  let columnsTruncated = false;
  for (const row of visibleRows) {
    const rowInner = params.sheetXml.slice(row.contentStart, row.contentEnd);
    const cells = collectElements(rowInner, "c", MAX_COLUMNS_PER_ROW + 1);
    if (cells.length > MAX_COLUMNS_PER_ROW) {
      columnsTruncated = true;
    }
    if (!params.body.push("<tr>")) {
      return;
    }
    for (const cell of cells.slice(0, MAX_COLUMNS_PER_ROW)) {
      const cellInner = rowInner.slice(cell.contentStart, cell.contentEnd);
      const style = Number.parseInt(attributeValue(cell.openTag, "s") ?? "", 10);
      const text = readCellText({
        cellInner,
        type: attributeValue(cell.openTag, "t"),
        styleIndex: Number.isInteger(style) ? style : undefined,
        shared: params.shared,
        dateStyles: params.dateStyles,
      });
      if (!params.body.push(`<td>${escapeHtml(text)}</td>`)) {
        return;
      }
    }
    if (!params.body.push("</tr>")) {
      return;
    }
  }
  params.body.push("</tbody></table>");
  if (rowsTruncated || columnsTruncated) {
    params.body.push(`<p class="truncated">${TRUNCATION_NOTE}</p>`);
  }
  params.body.push("</section>");
}

async function readZipText(zip: JSZipArchive, name: string): Promise<string | undefined> {
  const entry = zip.file(name);
  if (!entry) {
    return undefined;
  }
  try {
    return await entry.async("string");
  } catch {
    return undefined;
  }
}

async function extractXlsxBody(zip: JSZipArchive): Promise<string | undefined> {
  const workbookXml = await readZipText(zip, "xl/workbook.xml");
  if (!workbookXml) {
    return undefined;
  }
  const sheetNames: string[] = [];
  const sheetPattern = /<sheet\b[^>]*>/gu;
  let sheetMatch = sheetPattern.exec(workbookXml);
  while (sheetMatch && sheetNames.length < MAX_SHEETS + 1) {
    sheetNames.push(decodeXmlText(attributeValue(sheetMatch[0], "name") ?? ""));
    sheetMatch = sheetPattern.exec(workbookXml);
  }
  if (sheetNames.length === 0) {
    return undefined;
  }
  const sheetsTruncated = sheetNames.length > MAX_SHEETS;
  const shared = readSharedStrings(await readZipText(zip, "xl/sharedStrings.xml"));
  // Read once for the workbook: every sheet indexes into the same style table.
  const dateStyles = readXlsxDateStyles(await readZipText(zip, "xl/styles.xml"));
  const body = new HtmlBody();
  const visibleSheets = sheetsTruncated ? sheetNames.slice(0, MAX_SHEETS) : sheetNames;
  for (const [index, name] of visibleSheets.entries()) {
    // Workbook order matches the sheetN.xml numbering that Excel writes; a
    // missing part is skipped rather than shifting every later sheet's content.
    const sheetXml = await readZipText(zip, `xl/worksheets/sheet${index + 1}.xml`);
    if (!sheetXml) {
      continue;
    }
    renderSheet({ body, dateStyles, name: name || `Sheet ${index + 1}`, shared, sheetXml });
    if (body.exhausted) {
      break;
    }
  }
  if (sheetsTruncated) {
    body.push(`<p class="truncated">${TRUNCATION_NOTE}</p>`);
  }
  return body.render();
}

// The viewer swaps themes under the preview frame, so the palette is declared as
// tokens and re-declared for dark mode; every color has a light definition first
// so an engine without prefers-color-scheme support still renders readable text.
const DOCUMENT_STYLE = `
:root {
  color-scheme: light dark;
  --doc-bg: #ffffff;
  --doc-fg: #1b1d21;
  --doc-muted: #5c6068;
  --doc-line: #c9ccd2;
  --doc-fill: #f2f3f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --doc-bg: #16181c;
    --doc-fg: #e6e8ec;
    --doc-muted: #a4a9b3;
    --doc-line: #3a3d44;
    --doc-fill: #22252b;
  }
}
body {
  margin: 0;
  padding: 24px;
  background: var(--doc-bg);
  color: var(--doc-fg);
  font-family: system-ui, "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
  font-size: 14px;
  line-height: 1.65;
}
h1, h2, h3 { line-height: 1.3; margin: 1.4em 0 0.5em; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.05rem; }
p { margin: 0 0 0.85em; }
ul, ol { margin: 0 0 0.85em 1.25em; padding: 0; }
li { margin: 0 0 0.25em; }
section { margin: 0 0 2em; }
table { border-collapse: collapse; margin: 0 0 1em; max-width: 100%; }
th, td {
  border: 1px solid var(--doc-line);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
th { background: var(--doc-fill); font-weight: 600; }
img { max-width: 100%; }
.truncated {
  border-radius: 4px;
  background: var(--doc-fill);
  color: var(--doc-muted);
  font-size: 0.9em;
  padding: 6px 10px;
}
`.trim();

function wrapDocument(title: string, bodyHtml: string): string {
  const head = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>`;
  return `${head}<style>${DOCUMENT_STYLE}</style>${bodyHtml}`;
}

/** Converts a docx or xlsx buffer into safe, self-contained preview HTML. */
export async function extractDocumentHtml(params: {
  buffer: Buffer;
  sourceExtension: string;
}): Promise<{ ok: true; html: string } | { ok: false }> {
  const extension = params.sourceExtension.trim().toLowerCase().replace(/^\./u, "");
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return { ok: false };
  }
  if (isHangulExtension(extension)) {
    const extracted = await extractHangulText({
      buffer: params.buffer,
      sourceExtension: extension,
    });
    if (!extracted.ok) {
      return { ok: false };
    }
    // Table cells arrive as their own paragraphs, so the body is a flat run of blocks.
    const body = extracted.text
      .split(/\n{2,}/u)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
      .join("");
    return { html: wrapDocument("Document preview", body), ok: true };
  }
  let zip: JSZipArchive;
  try {
    const { default: JSZip } = await import("jszip");
    zip = await JSZip.loadAsync(params.buffer);
  } catch {
    return { ok: false };
  }
  if (extension === "docx") {
    const documentXml = await readZipText(zip, "word/document.xml");
    if (!documentXml) {
      return { ok: false };
    }
    return { html: wrapDocument("Document preview", extractDocxBody(documentXml)), ok: true };
  }
  const workbookBody = await extractXlsxBody(zip);
  if (workbookBody === undefined) {
    return { ok: false };
  }
  return { html: wrapDocument("Workbook preview", workbookBody), ok: true };
}
