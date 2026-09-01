import { describe, expect, it } from "vitest";
import { sanitizeOfficeSheetHtml } from "./sanitizeOfficeHtml";

describe("sanitizeOfficeSheetHtml", () => {
  it("strips script tags and event handlers", () => {
    const dirty =
      '<table id="office-sheet"><tr><td onclick="alert(1)">x</td></tr></table><script>alert(2)</script>';
    const clean = sanitizeOfficeSheetHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).toMatch(/<table/i);
    expect(clean).toMatch(/>x</);
  });

  it("neutralizes javascript: hrefs", () => {
    const dirty = '<a href="javascript:alert(1)">y</a>';
    const clean = sanitizeOfficeSheetHtml(dirty);
    expect(clean.toLowerCase()).not.toContain("javascript:");
  });

  it("neutralizes unquoted javascript: / data:text-html URLs", () => {
    // HTML allows attribute values without quotes; a sanitizer that only
    // matches quoted values leaves these live.
    const cases = [
      "<a href=javascript:alert(1)>x</a>",
      "<a href=javascript:alert(1) >x</a>",
      "<a href=data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg>x</a>",
      "<img src=javascript:alert(1)>",
    ];
    for (const dirty of cases) {
      const clean = sanitizeOfficeSheetHtml(dirty);
      expect(clean.toLowerCase(), dirty).not.toContain("javascript:");
      expect(clean.toLowerCase(), dirty).not.toContain("data:text/html");
    }
  });

  it("drops srcdoc attributes with nested markup", () => {
    const dirty = '<iframe srcdoc="<script>alert(1)</script>"></iframe>';
    const clean = sanitizeOfficeSheetHtml(dirty);
    expect(clean.toLowerCase()).not.toContain("srcdoc");
    expect(clean.toLowerCase()).not.toContain("<script");
  });

  it("keeps normal URLs and sources intact", () => {
    const clean = sanitizeOfficeSheetHtml(
      '<a href="https://ok.com">keep</a><img src=keep.png>',
    );
    expect(clean).toContain('href="https://ok.com"');
    expect(clean).toContain("keep.png");
  });
});
