import { describe, expect, it } from "vitest";
import {
  documentPreviewKindForPath,
  isDocumentPreviewPath,
  isHangulDocumentPath,
} from "./document-preview-kinds.ts";

describe("documentPreviewKindForPath", () => {
  it("maps every portable document extension to its family", () => {
    expect(documentPreviewKindForPath("report.pdf")).toBe("pdf");
    expect(documentPreviewKindForPath("report.doc")).toBe("word");
    expect(documentPreviewKindForPath("report.docx")).toBe("word");
    expect(documentPreviewKindForPath("report.odt")).toBe("word");
    expect(documentPreviewKindForPath("report.rtf")).toBe("word");
    expect(documentPreviewKindForPath("budget.xls")).toBe("sheet");
    expect(documentPreviewKindForPath("budget.xlsx")).toBe("sheet");
    expect(documentPreviewKindForPath("budget.ods")).toBe("sheet");
    expect(documentPreviewKindForPath("deck.ppt")).toBe("slides");
    expect(documentPreviewKindForPath("deck.pptx")).toBe("slides");
    expect(documentPreviewKindForPath("deck.odp")).toBe("slides");
    expect(documentPreviewKindForPath("memo.hwp")).toBe("hangul");
    expect(documentPreviewKindForPath("memo.hwpx")).toBe("hangul");
  });

  it("ignores extension case", () => {
    expect(documentPreviewKindForPath("Report.PDF")).toBe("pdf");
    expect(documentPreviewKindForPath("Budget.XlsX")).toBe("sheet");
    expect(documentPreviewKindForPath("MEMO.HWPX")).toBe("hangul");
  });

  it("classifies the basename of both separator styles", () => {
    expect(documentPreviewKindForPath("docs/reports/q3.pdf")).toBe("pdf");
    expect(documentPreviewKindForPath("C:\\Users\\chris\\Desktop\\q3.docx")).toBe("word");
    // A directory named "pdf" must not decide the kind; only the basename does.
    expect(documentPreviewKindForPath("C:\\pdf\\notes.txt")).toBeNull();
    expect(documentPreviewKindForPath("pdf/notes")).toBeNull();
  });

  it("returns null for dotfiles, extensionless names, and other files", () => {
    expect(documentPreviewKindForPath(".pdf")).toBeNull();
    expect(documentPreviewKindForPath("src/.docx")).toBeNull();
    expect(documentPreviewKindForPath("Makefile")).toBeNull();
    expect(documentPreviewKindForPath("notes.")).toBeNull();
    expect(documentPreviewKindForPath("")).toBeNull();
    expect(documentPreviewKindForPath("index.ts")).toBeNull();
    expect(documentPreviewKindForPath("photo.png")).toBeNull();
  });
});

describe("isDocumentPreviewPath", () => {
  it("accepts every renderable family and rejects hangul and non-documents", () => {
    expect(isDocumentPreviewPath("report.pdf")).toBe(true);
    expect(isDocumentPreviewPath("report.docx")).toBe(true);
    expect(isDocumentPreviewPath("budget.ods")).toBe(true);
    expect(isDocumentPreviewPath("deck.pptx")).toBe(true);
    expect(isDocumentPreviewPath("memo.hwp")).toBe(false);
    expect(isDocumentPreviewPath("memo.hwpx")).toBe(false);
    expect(isDocumentPreviewPath("index.ts")).toBe(false);
    expect(isDocumentPreviewPath("Makefile")).toBe(false);
  });
});

describe("isHangulDocumentPath", () => {
  it("matches only hwp and hwpx", () => {
    expect(isHangulDocumentPath("memo.hwp")).toBe(true);
    expect(isHangulDocumentPath("C:\\docs\\memo.HWPX")).toBe(true);
    expect(isHangulDocumentPath("report.pdf")).toBe(false);
    expect(isHangulDocumentPath(".hwp")).toBe(false);
    expect(isHangulDocumentPath("hwp")).toBe(false);
  });
});
