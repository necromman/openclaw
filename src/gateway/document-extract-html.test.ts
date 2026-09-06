// Tests for the dependency-free OOXML to HTML preview fallback.
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { extractDocumentHtml } from "./document-extract-html.js";

const DOCUMENT_XML_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';

function paragraph(text: string, properties = ""): string {
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function buildDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `${DOCUMENT_XML_HEADER}<w:body>${bodyXml}</w:body></w:document>`);
  return await zip.generateAsync({ type: "nodebuffer" });
}

async function buildXlsx(params: {
  sheets: { name: string; rowsXml: string }[];
  sharedStrings?: string[];
}): Promise<Buffer> {
  const zip = new JSZip();
  const sheetTags = params.sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}"/>`)
    .join("");
  zip.file("xl/workbook.xml", `<workbook><sheets>${sheetTags}</sheets></workbook>`);
  if (params.sharedStrings) {
    const items = params.sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("");
    zip.file("xl/sharedStrings.xml", `<sst>${items}</sst>`);
  }
  for (const [index, sheet] of params.sheets.entries()) {
    zip.file(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet><sheetData>${sheet.rowsXml}</sheetData></worksheet>`,
    );
  }
  return await zip.generateAsync({ type: "nodebuffer" });
}

type ExtractResult = Awaited<ReturnType<typeof extractDocumentHtml>>;

function expectHtml(result: ExtractResult): string {
  if (!result.ok) {
    throw new Error("expected extracted html");
  }
  return result.html;
}

describe("extractDocumentHtml", () => {
  test("rejects unsupported extensions and unreadable archives", async () => {
    const unsupported = await extractDocumentHtml({
      buffer: Buffer.from("irrelevant"),
      sourceExtension: "pdf",
    });
    expect(unsupported).toEqual({ ok: false });
    const corrupt = await extractDocumentHtml({
      buffer: Buffer.from("not an archive"),
      sourceExtension: "docx",
    });
    expect(corrupt).toEqual({ ok: false });
  });

  test("renders docx headings, paragraphs, lists and tables", async () => {
    const listProperties = '<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>';
    const buffer = await buildDocx(
      [
        paragraph("Quarterly report", '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'),
        paragraph("Detail", '<w:pPr><w:pStyle w:val="Heading4"/></w:pPr>'),
        '<w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>',
        paragraph("First", listProperties),
        paragraph("Second", listProperties),
        "<w:tbl><w:tr>" +
          "<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>" +
          "<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>" +
          "</w:tr></w:tbl>",
      ].join(""),
    );
    const html = expectHtml(await extractDocumentHtml({ buffer, sourceExtension: "docx" }));
    expect(html.startsWith('<!doctype html><meta charset="utf-8">')).toBe(true);
    expect(html).toContain("<h1>Quarterly report</h1>");
    // Heading levels past three clamp to h3 so the output tag set stays fixed.
    expect(html).toContain("<h3>Detail</h3>");
    expect(html).toContain("<p>Hello world</p>");
    expect(html).toContain("<ul><li>First</li><li>Second</li></ul>");
    expect(html).toContain("<table><tbody><tr><td>A1</td><td>B1</td></tr></tbody></table>");
  });

  test("escapes markup carried in docx text", async () => {
    const buffer = await buildDocx(paragraph("&lt;script&gt;alert(1)&lt;/script&gt;"));
    const html = expectHtml(await extractDocumentHtml({ buffer, sourceExtension: "docx" }));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror=");
  });

  test("renders xlsx sheets with shared and inline strings", async () => {
    const buffer = await buildXlsx({
      sharedStrings: ["Name", "Alice"],
      sheets: [
        {
          name: "Data",
          rowsXml:
            '<row r="1"><c r="A1" t="s"><v>0</v></c>' +
            '<c r="B1" t="inlineStr"><is><t>Inline</t></is></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row>',
        },
      ],
    });
    const html = expectHtml(await extractDocumentHtml({ buffer, sourceExtension: "xlsx" }));
    expect(html).toContain("<section><h2>Data</h2>");
    expect(html).toContain("<tr><td>Name</td><td>Inline</td></tr>");
    expect(html).toContain("<tr><td>Alice</td><td>42</td></tr>");
    expect(html).not.toContain('class="truncated"');
  });

  test("notes truncation once a sheet passes the row cap", async () => {
    const rowsXml = Array.from(
      { length: 301 },
      (_unused, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`,
    ).join("");
    const buffer = await buildXlsx({ sheets: [{ name: "Big", rowsXml }] });
    const html = expectHtml(await extractDocumentHtml({ buffer, sourceExtension: "xlsx" }));
    expect(html).toContain('<p class="truncated">');
    expect(html).toContain("<td>299</td>");
    expect(html).not.toContain("<td>300</td>");
  });

  test("notes truncation once the workbook passes the sheet cap", async () => {
    const sheets = Array.from({ length: 13 }, (_unused, index) => ({
      name: `Sheet${index + 1}`,
      rowsXml: `<row r="1"><c r="A1" t="inlineStr"><is><t>cell${index}</t></is></c></row>`,
    }));
    const buffer = await buildXlsx({ sheets });
    const html = expectHtml(await extractDocumentHtml({ buffer, sourceExtension: "xlsx" }));
    expect(html).toContain("<h2>Sheet12</h2>");
    expect(html).not.toContain("<h2>Sheet13</h2>");
    expect(html).toContain('<p class="truncated">');
  });
});
