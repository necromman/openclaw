// Tests for the per-format extractors behind `openclaw knowledge sync`.
import iconv from "iconv-lite";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { convertDocumentToPdfMock, pdfDocument } = vi.hoisted(() => ({
  convertDocumentToPdfMock: vi.fn(),
  pdfDocument: { destroy: vi.fn(), pageCount: 0, text: vi.fn() },
}));

vi.mock("clawpdf", () => ({
  createEngine: async () => ({
    destroy: async () => {},
    open: async () => pdfDocument,
  }),
}));

vi.mock("../gateway/document-convert.js", () => ({
  convertDocumentToPdf: convertDocumentToPdfMock,
}));

const { convertKnowledgeSource, decodeTextBuffer } = await import("./convert.js");
const { releaseKnowledgePdfEngine } = await import("./convert-pdf.js");

const DOCUMENT_XML_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';

async function buildDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `${DOCUMENT_XML_HEADER}<w:body>${bodyXml}</w:body></w:document>`);
  return await zip.generateAsync({ type: "nodebuffer" });
}

async function buildXlsx(
  sheets: { name: string; rowsXml: string }[],
  stylesXml?: string,
): Promise<Buffer> {
  const zip = new JSZip();
  const tags = sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}"/>`)
    .join("");
  zip.file("xl/workbook.xml", `<workbook><sheets>${tags}</sheets></workbook>`);
  if (stylesXml) {
    zip.file("xl/styles.xml", stylesXml);
  }
  for (const [index, sheet] of sheets.entries()) {
    zip.file(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet><sheetData>${sheet.rowsXml}</sheetData></worksheet>`,
    );
  }
  return await zip.generateAsync({ type: "nodebuffer" });
}

function inlineCell(value: string): string {
  return `<c t="inlineStr"><is><t>${value}</t></is></c>`;
}

beforeEach(() => {
  convertDocumentToPdfMock.mockReset();
  pdfDocument.text.mockReset();
  pdfDocument.destroy.mockReset();
  pdfDocument.pageCount = 0;
});

afterEach(async () => {
  await releaseKnowledgePdfEngine();
});

describe("text sources", () => {
  test("decodes UTF-8 and falls back to CP949 for legacy Korean text", async () => {
    expect(await decodeTextBuffer(Buffer.from("한글 메모", "utf8"))).toBe("한글 메모");
    expect(await decodeTextBuffer(iconv.encode("한글 메모", "cp949"))).toBe("한글 메모");
  });

  test("copies a CP949 txt into the sidecar without replacement characters", async () => {
    const result = await convertKnowledgeSource({
      buffer: iconv.encode("시약 재고 현황\r\n에탄올 12병", "cp949"),
      extension: "txt",
    });
    expect(result).toEqual({
      body: "시약 재고 현황\n에탄올 12병",
      converter: "copy",
      ok: true,
    });
  });

  test("reports an empty source rather than writing a sidecar with nothing in it", async () => {
    expect(await convertKnowledgeSource({ buffer: Buffer.from("   \n"), extension: "md" })).toEqual(
      {
        ok: false,
        reason: "empty",
      },
    );
  });
});

describe("office sources", () => {
  test("turns a Word table into a Markdown table without calling LibreOffice", async () => {
    const docx = await buildDocx(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>재고 보고</w:t></w:r></w:p>' +
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>품목</w:t></w:r></w:p></w:tc>" +
        "<w:tc><w:p><w:r><w:t>수량</w:t></w:r></w:p></w:tc></w:tr>" +
        "<w:tr><w:tc><w:p><w:r><w:t>에탄올</w:t></w:r></w:p></w:tc>" +
        "<w:tc><w:p><w:r><w:t>12</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    );
    const result = await convertKnowledgeSource({ buffer: docx, extension: "docx" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.converter).toBe("docx-html");
    expect(result.body).toContain("# 재고 보고");
    expect(result.body).toContain("| 품목 | 수량 |");
    expect(result.body).toContain("| 에탄올 | 12 |");
    expect(convertDocumentToPdfMock).not.toHaveBeenCalled();
  });

  test("gives each worksheet its own heading", async () => {
    const xlsx = await buildXlsx([
      { name: "재고", rowsXml: `<row>${inlineCell("품목")}${inlineCell("수량")}</row>` },
      { name: "발주", rowsXml: `<row>${inlineCell("업체")}</row>` },
    ]);
    const result = await convertKnowledgeSource({ buffer: xlsx, extension: "xlsx" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.converter).toBe("xlsx-html");
    expect(result.body).toContain("## 재고");
    expect(result.body).toContain("## 발주");
  });

  test("writes a date cell as a date, not as the serial underneath it", async () => {
    // Three formats for the same number: none, the builtin short date, and a Korean
    // custom one. Only the two date-formatted cells may change.
    const styles =
      "<styleSheet>" +
      '<numFmts count="1">' +
      '<numFmt numFmtId="164" formatCode="yyyy&quot;년&quot; mm&quot;월&quot; dd&quot;일&quot;"/>' +
      "</numFmts>" +
      '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>' +
      "</styleSheet>";
    const xlsx = await buildXlsx(
      [
        {
          name: "일정",
          rowsXml:
            `<row>${inlineCell("납기")}` +
            '<c s="0"><v>46023</v></c>' +
            '<c s="1"><v>46023</v></c>' +
            '<c s="2"><v>46023.5</v></c></row>',
        },
      ],
      styles,
    );
    const result = await convertKnowledgeSource({ buffer: xlsx, extension: "xlsx" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.converter).toBe("xlsx-html");
    expect(result.body).toContain("| 납기 | 46023 | 2026-01-01 | 2026-01-01 12:00 |");
  });

  test("falls back to LibreOffice when the archive reader cannot open a docx", async () => {
    pdfDocument.pageCount = 1;
    pdfDocument.text.mockReturnValue("복구된 본문");
    convertDocumentToPdfMock.mockResolvedValue({
      converter: "/usr/bin/soffice",
      ok: true,
      pdf: Buffer.from("%PDF-1.4"),
    });
    const result = await convertKnowledgeSource({
      buffer: Buffer.from("not an archive"),
      extension: "docx",
    });
    expect(result).toEqual({
      body: "## p.1\n\n복구된 본문",
      converter: "soffice-pdf-text",
      ok: true,
    });
  });
});

describe("slide and legacy sources", () => {
  test("routes pptx through LibreOffice and then through the PDF reader", async () => {
    pdfDocument.pageCount = 2;
    pdfDocument.text.mockReturnValueOnce("표지").mockReturnValueOnce("두 번째 장");
    convertDocumentToPdfMock.mockResolvedValue({
      converter: "/usr/bin/soffice",
      ok: true,
      pdf: Buffer.from("%PDF-1.4"),
    });
    const result = await convertKnowledgeSource({
      buffer: Buffer.from("pptx bytes"),
      extension: "pptx",
    });
    expect(convertDocumentToPdfMock).toHaveBeenCalledWith({
      buffer: Buffer.from("pptx bytes"),
      sourceExtension: "pptx",
    });
    expect(result).toEqual({
      body: "## p.1\n\n표지\n\n## p.2\n\n두 번째 장",
      converter: "soffice-pdf-text",
      ok: true,
    });
  });

  test("reports a missing converter instead of pretending the file was indexed", async () => {
    convertDocumentToPdfMock.mockResolvedValue({ ok: false, reason: "converter-unavailable" });
    expect(await convertKnowledgeSource({ buffer: Buffer.from("x"), extension: "pptx" })).toEqual({
      ok: false,
      reason: "converter-unavailable",
    });
  });

  test("refuses an extension no extractor claims", async () => {
    expect(await convertKnowledgeSource({ buffer: Buffer.from("x"), extension: "zip" })).toEqual({
      ok: false,
      reason: "conversion-failed",
    });
  });
});

describe("hangul sources", () => {
  test("reads a hwpx through the built-in reader, never through LibreOffice", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/hwp+zip");
    zip.file(
      "Contents/section0.xml",
      '<?xml version="1.0"?><hs:sec><hp:p><hp:run><hp:t>시약 재고 현황</hp:t></hp:run></hp:p></hs:sec>',
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    expect(await convertKnowledgeSource({ buffer, extension: "hwpx" })).toEqual({
      body: "시약 재고 현황",
      converter: "hwp-text",
      ok: true,
    });
    expect(convertDocumentToPdfMock).not.toHaveBeenCalled();
  });

  test("reports an unreadable hwp as a conversion failure", async () => {
    expect(
      await convertKnowledgeSource({ buffer: Buffer.from("not a document"), extension: "hwp" }),
    ).toEqual({ ok: false, reason: "conversion-failed" });
    expect(convertDocumentToPdfMock).not.toHaveBeenCalled();
  });
});

describe("pdf sources", () => {
  test("marks every page so a citation line range names a page", async () => {
    pdfDocument.pageCount = 3;
    pdfDocument.text
      .mockReturnValueOnce("첫 장")
      .mockReturnValueOnce("   ")
      .mockReturnValueOnce("셋째 장");
    const result = await convertKnowledgeSource({
      buffer: Buffer.from("%PDF-1.4"),
      extension: "pdf",
    });
    expect(result).toEqual({
      body: "## p.1\n\n첫 장\n\n## p.2\n\n## p.3\n\n셋째 장",
      converter: "pdf-text",
      ok: true,
    });
    expect(pdfDocument.destroy).toHaveBeenCalledTimes(1);
  });

  test("treats a scan with no text layer as empty", async () => {
    pdfDocument.pageCount = 1;
    pdfDocument.text.mockReturnValue("");
    expect(
      await convertKnowledgeSource({ buffer: Buffer.from("%PDF-1.4"), extension: "pdf" }),
    ).toEqual({ ok: false, reason: "empty" });
  });
});
