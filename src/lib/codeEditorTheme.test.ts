/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeEditorThemeExtensions } from "./codeEditorTheme";

function mountedCssText(): string {
  const styleTags = Array.from(document.querySelectorAll("style")).map(
    (el) => el.textContent || "",
  );
  const adopted = Array.from(document.adoptedStyleSheets || []).map((sheet) => {
    try {
      return Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
    } catch {
      return "";
    }
  });
  return [...styleTags, ...adopted].join("\n");
}

describe("codeEditorThemeExtensions", () => {
  it("puts explicit ink and a solid plate on the editor", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 1;\n",
        extensions: codeEditorThemeExtensions("dark"),
      }),
      parent: host,
    });
    try {
      expect(view.contentDOM.textContent).toContain("const x = 1");
      const sheets = mountedCssText();
      expect(sheets).toMatch(/\.cm-content[^}]*color:\s*#abb2bf/i);
      expect(sheets).toMatch(/\.cm-line[^}]*color:\s*#abb2bf/i);
      // Solid plate — not fully transparent / color-mix only.
      expect(sheets).toMatch(/background-color:\s*#0a0a0a/i);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("uses light ink for light mode content", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: "hi\n",
        extensions: codeEditorThemeExtensions("light"),
      }),
      parent: host,
    });
    try {
      const sheets = mountedCssText();
      expect(sheets).toMatch(/\.cm-content[^}]*color:\s*#383a42/i);
      expect(sheets).toMatch(/background-color:\s*#fafafa/i);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
