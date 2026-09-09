// Renders the small Markdown dialect the Hangul converter emits into preview HTML.
//
// `rhwp export-markdown` is the only producer this reads, and what it produces is
// headings, pipe tables (merged cells flattened into repeated or empty cells), lists and
// paragraphs. Most Hangul documents on the delivery share are forms, so the tables are
// the point: without them the preview shows a column of loose cell text and the reader
// has to guess which label belonged to which box.
//
// Why not a Markdown library: the two in this repository are development dependencies,
// and a general renderer passes raw HTML through by design. This input is customer
// document content going into a preview frame, so every character is escaped first and
// markup is only ever produced by this file. That constraint is also what keeps the
// dialect small - anything not recognized stays visible as the literal text it was.
import { escapeDocumentHtml } from "./document-html-escape.js";

/** Ceiling on one rendered document, matching the extractor's own output cap. */
const MAX_ROWS = 4000;

type TableAlignment = "left" | "center" | "right" | undefined;

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) {
    return false;
  }
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/u.test(trimmed);
}

/** Splits one pipe row into cells, honouring a backslash-escaped pipe. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  // A row written with the outer pipes yields an empty cell at each end.
  if (cells.length > 0 && cells[0]?.trim() === "") {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === "") {
    cells.pop();
  }
  return cells.map((cell) => cell.trim());
}

function alignments(separator: string): TableAlignment[] {
  return splitRow(separator).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) {
      return "center";
    }
    if (right) {
      return "right";
    }
    return left ? "left" : undefined;
  });
}

/**
 * Inline markup, applied to already-escaped text.
 *
 * Only emphasis and inline code, because those are the only inline forms the converter
 * emits and every additional rule is another way for document text to be misread as
 * markup. Link and image syntax is deliberately left as literal text: a preview frame
 * that fetched a URL out of a customer document would be a new network path nobody asked
 * for.
 */
function renderInline(escaped: string): string {
  return (
    escaped
      // The converter writes a line break inside a table cell as a literal <br>, because a
      // Markdown table row cannot contain a newline. It is escaped with everything else
      // first and only this one shape, which carries no attributes and nothing executable,
      // is turned back into markup. Leaving it escaped printed "<br>" in the middle of
      // every approval box on the delivery share.
      .replace(/&lt;br\s*\/?&gt;/gu, "<br>")
      .replace(/`([^`]+)`/gu, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/gu, "$1<em>$2</em>")
  );
}

function cellHtml(value: string, tag: "th" | "td", align: TableAlignment): string {
  const style = align ? ` style="text-align:${align}"` : "";
  return `<${tag}${style}>${renderInline(escapeDocumentHtml(value))}</${tag}>`;
}

function renderTable(rows: readonly string[], separator: string): string {
  const columnAlignments = alignments(separator);
  const header = rows[0];
  const parts: string[] = ['<div class="table-scroll"><table>'];
  if (header !== undefined) {
    parts.push("<thead><tr>");
    for (const [index, cell] of splitRow(header).entries()) {
      parts.push(cellHtml(cell, "th", columnAlignments[index]));
    }
    parts.push("</tr></thead>");
  }
  if (rows.length > 1) {
    parts.push("<tbody>");
    for (const row of rows.slice(1)) {
      parts.push("<tr>");
      for (const [index, cell] of splitRow(row).entries()) {
        parts.push(cellHtml(cell, "td", columnAlignments[index]));
      }
      parts.push("</tr>");
    }
    parts.push("</tbody>");
  }
  parts.push("</table></div>");
  return parts.join("");
}

function renderParagraph(lines: readonly string[]): string {
  const body = lines.map((line) => renderInline(escapeDocumentHtml(line.trim()))).join("<br>");
  return body.length === 0 ? "" : `<p>${body}</p>`;
}

function renderList(items: readonly string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const body = items.map((item) => `<li>${renderInline(escapeDocumentHtml(item))}</li>`).join("");
  return `<${tag}>${body}</${tag}>`;
}

/**
 * Convert one Markdown document into preview HTML.
 *
 * The output is a body fragment; the caller wraps it with the document stylesheet that
 * the other preview lanes already share, so a Hangul form and a spreadsheet look like the
 * same product rather than two.
 */
export function markdownToPreviewHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n").slice(0, MAX_ROWS);
  const out: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(renderParagraph(paragraph));
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      out.push(renderList(listItems, listOrdered));
      listItems = [];
    }
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(trimmed);
    if (heading) {
      flush();
      const level = Math.min(heading[1]?.length ?? 1, 6);
      out.push(`<h${level}>${renderInline(escapeDocumentHtml(heading[2] ?? ""))}</h${level}>`);
      continue;
    }
    if (/^([-*_])\s*(\1\s*){2,}$/u.test(trimmed)) {
      flush();
      out.push("<hr>");
      continue;
    }
    const next = lines[index + 1] ?? "";
    if (trimmed.includes("|") && isTableSeparator(next)) {
      flush();
      const rows: string[] = [trimmed];
      let cursor = index + 2;
      while (cursor < lines.length && (lines[cursor] ?? "").trim().includes("|")) {
        rows.push((lines[cursor] ?? "").trim());
        cursor += 1;
      }
      out.push(renderTable(rows, next));
      index = cursor - 1;
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/u.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (listItems.length > 0 && listOrdered) {
        flushList();
      }
      listOrdered = false;
      listItems.push(bullet[1] ?? "");
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/u.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (listItems.length > 0 && !listOrdered) {
        flushList();
      }
      listOrdered = true;
      listItems.push(numbered[1] ?? "");
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flush();
  return out.join("");
}
