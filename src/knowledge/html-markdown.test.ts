// Tests for the preview-HTML to Markdown pass used by the docx and xlsx converters.
import { describe, expect, test } from "vitest";
import { decodeHtmlEntities, documentHtmlToMarkdown } from "./html-markdown.js";

describe("documentHtmlToMarkdown", () => {
  test("keeps heading levels, list items and paragraph line breaks", () => {
    const markdown = documentHtmlToMarkdown(
      "<style>x</style><h1>보고서</h1><p>첫 줄<br />둘째 줄</p><ul><li>항목 하나</li><li>항목 둘</li></ul>",
    );
    expect(markdown).toBe("# 보고서\n\n첫 줄\n둘째 줄\n\n- 항목 하나\n\n- 항목 둘");
  });

  test("renders a Word table as a Markdown table in document order", () => {
    const markdown = documentHtmlToMarkdown(
      "<style>x</style><p>앞</p>" +
        "<table><thead><tr><th>시약</th><th>수량</th></tr></thead>" +
        "<tbody><tr><td>에탄올</td><td>12</td></tr></tbody></table>" +
        "<p>뒤</p>",
    );
    expect(markdown).toBe(
      ["앞", "", "| 시약 | 수량 |", "| --- | --- |", "| 에탄올 | 12 |", "", "뒤"].join("\n"),
    );
  });

  test("gives every sheet its own heading and pads ragged rows", () => {
    const markdown = documentHtmlToMarkdown(
      "<style>x</style><section><h2>재고</h2>" +
        "<table><tbody><tr><td>품목</td><td>수량</td><td>단위</td></tr>" +
        "<tr><td>에탄올</td></tr></tbody></table></section>",
    );
    expect(markdown).toContain("## 재고");
    expect(markdown).toContain("| 품목 | 수량 | 단위 |");
    expect(markdown).toContain("| 에탄올 |  |  |");
  });

  test("escapes a pipe so one cell cannot break the row it sits in", () => {
    const markdown = documentHtmlToMarkdown(
      "<style>x</style><table><tbody><tr><td>a &amp; b | c</td></tr></tbody></table>",
    );
    expect(markdown).toContain("| a & b \\| c |");
  });

  test("decodes the escaping the preview writer applies to text nodes", () => {
    expect(decodeHtmlEntities("&lt;a&gt; &amp; &quot;b&quot; &#39;c&#39; &#xAC00;")).toBe(
      "<a> & \"b\" 'c' 가",
    );
  });
});
