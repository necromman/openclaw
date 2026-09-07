// Converts the restricted preview HTML produced by `extractDocumentHtml` to Markdown.
//
// This is deliberately not a general HTML parser. The input is generated a few files
// away by `src/gateway/document-extract-html.ts`, which emits a closed tag set with
// every text node already escaped, so a scanner over that exact set is both smaller and
// more predictable than a DOM. Anything outside the set degrades to its text content.

const ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** Reverses the escaping `document-extract-html.ts` applies to every text node. */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body.startsWith("#x") || body.startsWith("#X")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Strips the generated head so only the rendered body is scanned. */
function bodyOf(html: string): string {
  const styleEnd = html.lastIndexOf("</style>");
  return styleEnd < 0 ? html : html.slice(styleEnd + "</style>".length);
}

/** Turns inline markup into plain text, keeping the line breaks Word put there. */
function inlineText(fragment: string): string {
  return decodeHtmlEntities(
    fragment
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<[^>]*>/gu, "")
      .replace(/\r/gu, ""),
  ).trim();
}

/** A table cell must not break the row it sits in. */
function cellText(fragment: string): string {
  return inlineText(fragment).replace(/\n+/gu, " ").replace(/\|/gu, "\\|").trim();
}

function readRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/giu;
  let rowMatch = rowPattern.exec(tableHtml);
  while (rowMatch) {
    const cells: string[] = [];
    const cellPattern = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/giu;
    let cellMatch = cellPattern.exec(rowMatch[1] ?? "");
    while (cellMatch) {
      cells.push(cellText(cellMatch[2] ?? ""));
      cellMatch = cellPattern.exec(rowMatch[1] ?? "");
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
    rowMatch = rowPattern.exec(tableHtml);
  }
  return rows;
}

/**
 * Renders one table as a Markdown table.
 *
 * Markdown has no headerless table, so the first row always becomes the header. For a
 * spreadsheet that is usually true anyway, and where it is not the cell text still
 * indexes and still reads.
 */
function renderTable(tableHtml: string): string {
  const rows = readRows(tableHtml);
  if (rows.length === 0) {
    return "";
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
  const lines = [
    pad(rows[0] ?? []),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
  ];
  for (const row of rows.slice(1)) {
    lines.push(pad(row));
  }
  return lines.join("\n");
}

/** Renders the non-table part of the body: headings, paragraphs and list items. */
function renderBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/giu;
  let match = pattern.exec(html);
  while (match) {
    const tag = (match[1] ?? "").toLowerCase();
    const text = inlineText(match[2] ?? "");
    if (text.length > 0) {
      if (tag.startsWith("h")) {
        blocks.push(`${"#".repeat(Number.parseInt(tag.slice(1), 10))} ${text}`);
      } else if (tag === "li") {
        blocks.push(`- ${text}`);
      } else {
        blocks.push(text);
      }
    }
    match = pattern.exec(html);
  }
  return blocks;
}

/**
 * Converts one preview HTML document to Markdown.
 *
 * Tables are lifted out first so their inner `<p>`-free cells never reach the block
 * scanner, then the remaining spans are rendered in document order.
 */
export function documentHtmlToMarkdown(html: string): string {
  const body = bodyOf(html);
  const parts: string[] = [];
  const tablePattern = /<table[^>]*>[\s\S]*?<\/table>/giu;
  let cursor = 0;
  let match = tablePattern.exec(body);
  while (match) {
    parts.push(...renderBlocks(body.slice(cursor, match.index)));
    const table = renderTable(match[0]);
    if (table.length > 0) {
      parts.push(table);
    }
    cursor = match.index + match[0].length;
    match = tablePattern.exec(body);
  }
  parts.push(...renderBlocks(body.slice(cursor)));
  return parts
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
