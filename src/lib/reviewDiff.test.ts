import { describe, expect, it } from "vitest";
import {
  buildReviewTree,
  countPatchDelta,
  decodeGitPath,
  parseReviewPatch,
  reviewFileBadge,
  truncateMiddle,
} from "./reviewDiff";

const SAMPLE = `diff --git a/apps/web/lib.ts b/apps/web/lib.ts
index 111..222 100644
--- a/apps/web/lib.ts
+++ b/apps/web/lib.ts
@@ -10,3 +10,4 @@
 context one
-old line
+new line
 context two
@@ -40,2 +41,3 @@
 more ctx
+added far
 more ctx2
`;

describe("countPatchDelta", () => {
  it("counts + and - body lines", () => {
    expect(countPatchDelta(SAMPLE)).toEqual({ added: 2, removed: 1 });
  });

  it("handles empty", () => {
    expect(countPatchDelta("")).toEqual({ added: 0, removed: 0 });
  });
});

describe("parseReviewPatch", () => {
  it("produces add/del/ctx lines and fold between hunks", () => {
    const p = parseReviewPatch(SAMPLE);
    expect(p.empty).toBe(false);
    expect(p.added).toBe(2);
    expect(p.removed).toBe(1);
    const folds = p.rows.filter((r) => r.type === "fold");
    expect(folds.length).toBe(1);
    if (folds[0]?.type === "fold") {
      // gap from end of first hunk (~13) to start of second (41)
      expect(folds[0].count).toBeGreaterThan(0);
    }
    const adds = p.rows.filter((r) => r.type === "line" && r.kind === "add");
    const dels = p.rows.filter((r) => r.type === "line" && r.kind === "del");
    expect(adds.length).toBe(2);
    expect(dels.length).toBe(1);
  });

  it("returns empty for blank patch", () => {
    expect(parseReviewPatch("   ").empty).toBe(true);
  });
});

describe("buildReviewTree", () => {
  it("nests directories and sorts dirs first", () => {
    const tree = buildReviewTree([
      { key: "a", relPath: "apps/web/a.ts", name: "a.ts" },
      { key: "b", relPath: "apps/web/b.ts", name: "b.ts" },
      { key: "c", relPath: "docs/readme.md", name: "readme.md" },
      { key: "d", relPath: "z-root.ts", name: "z-root.ts" },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["apps", "docs", "z-root.ts"]);
    const apps = tree.find((n) => n.name === "apps");
    expect(apps?.isDir).toBe(true);
    expect(apps?.children?.[0]?.name).toBe("web");
  });
});

describe("reviewFileBadge / truncateMiddle", () => {
  it("badges common extensions", () => {
    expect(reviewFileBadge("x.ts").label).toBe("TS");
    expect(reviewFileBadge("x.cjs").label).toBe("JS");
    expect(reviewFileBadge("note.md").label).toBe("M↓");
  });

  it("truncates middle", () => {
    expect(truncateMiddle("short", 20)).toBe("short");
    expect(truncateMiddle("abcdefghijklmnopqrstuvwxyz", 10).includes("…")).toBe(
      true,
    );
  });
});

describe("decodeGitPath", () => {
  it("decodes C-style octal Chinese paths and strips quotes", () => {
    // "docs/Agent执行SOP/246.md" as git quotepath output
    const quoted =
      '"docs/Agent\\346\\211\\247\\350\\241\\214SOP/246.md"';
    const decoded = decodeGitPath(quoted);
    expect(decoded.startsWith("docs/")).toBe(true);
    expect(decoded.endsWith("/246.md")).toBe(true);
    expect(decoded.includes("\\")).toBe(false);
    expect(decoded.includes('"')).toBe(false);
    // Must not explode into octal segments
    expect(decoded.split("/")).not.toContain("346");
  });

  it("strips stray quotes without escapes", () => {
    expect(decodeGitPath('"docs/foo.md"')).toBe("docs/foo.md");
    expect(decodeGitPath('246.md"')).toBe("246.md");
  });

  it("keeps astral (surrogate-pair) characters in unquoted paths", () => {
    // With core.quotepath=false the host emits already-decoded paths; the
    // decoder must round-trip astral chars (emoji / Ext-B) instead of
    // corrupting each UTF-16 unit into U+FFFD.
    expect(decodeGitPath("docs/🦊 fix.md")).toBe("docs/🦊 fix.md");
    expect(decodeGitPath("docs/𝛂-x.md")).toBe("docs/𝛂-x.md");
    // BMP CJK keeps working
    expect(decodeGitPath("docs/执行.md")).toBe("docs/执行.md");
  });

  it("builds a proper tree for quoted Chinese paths", () => {
    const quoted =
      '"docs/Agent\\346\\211\\247\\350\\241\\214SOP/246.md"';
    const tree = buildReviewTree([
      {
        key: "k1",
        relPath: quoted,
        name: '246.md"',
      },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("docs");
    expect(tree[0]!.isDir).toBe(true);
    const agent = tree[0]!.children?.[0];
    expect(agent?.isDir).toBe(true);
    // folder name should be decoded Chinese, not "346"
    expect(agent?.name).not.toBe("346");
    const file = agent?.children?.[0];
    expect(file?.isDir).toBe(false);
    expect(file?.name).toBe("246.md");
  });
});
