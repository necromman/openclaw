import { describe, expect, it } from "vitest";
import { markdownToPreviewHtml } from "./document-markdown-html.js";

describe("markdownToPreviewHtml", () => {
  it("draws a pipe table as a table", () => {
    const html = markdownToPreviewHtml(
      ["| 품목 | 수량 |", "| --- | ---: |", "| 에탄올 | 3 |", "| 아세톤 | 5 |"].join("\n"),
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>품목</th>");
    expect(html).toContain('<td style="text-align:right">3</td>');
    expect(html.match(/<tr>/gu)?.length).toBe(3);
  });

  it("keeps a wide table inside its own scroller", () => {
    const html = markdownToPreviewHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html.startsWith('<div class="table-scroll">')).toBe(true);
  });

  it("renders the page headings the converter adds", () => {
    expect(markdownToPreviewHtml("## p.2\n\n본문")).toContain("<h2>p.2</h2>");
  });

  it("escapes document text rather than trusting it as markup", () => {
    const html = markdownToPreviewHtml("| a |\n| --- |\n| <script>alert(1)</script> |");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("leaves a link as literal text so a preview frame fetches nothing", () => {
    const html = markdownToPreviewHtml("[label](https://example.test/x)");
    expect(html).not.toContain("<a ");
    expect(html).toContain("https://example.test/x");
  });

  it("keeps a cell that contains an escaped pipe in one cell", () => {
    const html = markdownToPreviewHtml("| a | b |\n| --- | --- |\n| x \\| y | z |");
    expect(html).toContain("<td>x | y</td>");
    expect(html).toContain("<td>z</td>");
  });

  it("turns blank-line separated text into paragraphs and single newlines into breaks", () => {
    const html = markdownToPreviewHtml("첫 줄\n둘째 줄\n\n다음 문단");
    expect(html).toContain("<p>첫 줄<br>둘째 줄</p>");
    expect(html).toContain("<p>다음 문단</p>");
  });

  it("turns the converter's literal cell break back into a break", () => {
    const html = markdownToPreviewHtml("| a |\n| --- |\n| 직위<br>과장 |");
    expect(html).toContain("<td>직위<br>과장</td>");
  });

  it("still escapes every other tag in a cell", () => {
    const html = markdownToPreviewHtml("| a |\n| --- |\n| <img src=x onerror=1> |");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders bullet and numbered lists", () => {
    expect(markdownToPreviewHtml("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(markdownToPreviewHtml("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });
});
