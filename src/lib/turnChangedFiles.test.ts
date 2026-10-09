import { describe, expect, it } from "vitest";
import type { SessionFileChange } from "./sessionChanges";
import type { TimelineUnit } from "./timelinePhases";
import {
  buildTurnChangedFileCards,
  collectTurnModifiedPaths,
  splitTurnChangedFiles,
  turnChangedFileItems,
  TURN_CHANGED_FILES_VISIBLE_MAX,
} from "./turnChangedFiles";

function toolUnit(
  id: string,
  toolKind: string,
  path?: string,
): TimelineUnit {
  return {
    kind: "tool",
    si: 0,
    tool: {
      kind: "tool",
      toolCallId: id,
      title: toolKind,
      toolKind,
      status: "completed",
      path,
    },
  };
}

describe("collectTurnModifiedPaths", () => {
  it("collects unique edit paths in encounter order", () => {
    const units: TimelineUnit[] = [
      toolUnit("r1", "read_file", "/p/a.ts"),
      toolUnit("e1", "search_replace", "/p/a.ts"),
      toolUnit("e2", "write", "/p/b.ts"),
      toolUnit("e3", "search_replace", "/p/a.ts"),
      toolUnit("b1", "bash", "/tmp/out.log"),
    ];
    expect(collectTurnModifiedPaths(units)).toEqual([
      "/p/a.ts",
      "/p/b.ts",
    ]);
  });

  it("reads paths from phase tools", () => {
    const units: TimelineUnit[] = [
      {
        kind: "phase",
        id: "p0",
        items: [],
        thoughts: [],
        tools: [
          {
            kind: "tool",
            toolCallId: "e1",
            title: "Edit",
            toolKind: "str_replace",
            status: "completed",
            path: "/proj/src/App.tsx",
          },
        ],
        startSi: 0,
        endSi: 0,
        live: false,
        errorCount: 0,
        runningCount: 0,
      },
    ];
    expect(collectTurnModifiedPaths(units)).toEqual(["/proj/src/App.tsx"]);
  });

  it("returns empty when no edit tools have paths", () => {
    expect(
      collectTurnModifiedPaths([
        toolUnit("r1", "read_file", "/p/a.ts"),
        toolUnit("e1", "search_replace"),
      ]),
    ).toEqual([]);
  });
});

describe("turnChangedFileItems", () => {
  it("maps paths to basenames", () => {
    expect(turnChangedFileItems(["/a/b/c.ts", "plain.md"])).toEqual([
      { path: "/a/b/c.ts", name: "c.ts" },
      { path: "plain.md", name: "plain.md" },
    ]);
  });
});

describe("splitTurnChangedFiles", () => {
  it("keeps all items when under the visible max", () => {
    const items = turnChangedFileItems(["/a.ts", "/b.ts"]);
    expect(splitTurnChangedFiles(items)).toEqual({
      visible: items,
      hiddenCount: 0,
    });
  });

  it("hides overflow past the visible max", () => {
    const paths = Array.from(
      { length: TURN_CHANGED_FILES_VISIBLE_MAX + 3 },
      (_, i) => `/f${i}.ts`,
    );
    const items = turnChangedFileItems(paths);
    const split = splitTurnChangedFiles(items);
    expect(split.visible).toHaveLength(TURN_CHANGED_FILES_VISIBLE_MAX);
    expect(split.hiddenCount).toBe(3);
  });
});

function change(
  partial: Partial<SessionFileChange> & Pick<SessionFileChange, "path">,
): SessionFileChange {
  const path = partial.path;
  return {
    name: partial.name ?? path.split("/").pop() ?? path,
    toolKind: partial.toolKind ?? "search_replace",
    status: partial.status ?? "completed",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
    path,
  };
}

describe("buildTurnChangedFileCards", () => {
  it("attaches unified patch and deltas when before/after exist", () => {
    const cards = buildTurnChangedFileCards(
      ["/proj/a.ts", "/proj/b.ts"],
      [
        change({
          path: "/proj/a.ts",
          before: "one\n",
          after: "one\ntwo\n",
        }),
        change({
          path: "/proj/b.ts",
          before: "keep\ngone\n",
          after: "keep\n",
        }),
      ],
      "/proj",
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      path: "/proj/a.ts",
      name: "a.ts",
      hasSnippet: true,
      added: 1,
      removed: 0,
    });
    expect(cards[0]!.patch).toContain("+++ b/a.ts");
    expect(cards[0]!.patch).toContain("+two");
    expect(cards[1]).toMatchObject({
      path: "/proj/b.ts",
      name: "b.ts",
      hasSnippet: true,
      added: 0,
      removed: 1,
    });
  });

  it("treats after-only as a new-file snippet", () => {
    const cards = buildTurnChangedFileCards(
      ["/proj/new.ts"],
      [change({ path: "/proj/new.ts", after: "hello\nworld\n" })],
      "/proj",
    );
    expect(cards[0]).toMatchObject({
      hasSnippet: true,
      added: 2,
      removed: 0,
    });
    expect(cards[0]!.patch).toContain("+hello");
  });

  it("returns empty snippet cards when sessionChanges miss the path", () => {
    const cards = buildTurnChangedFileCards(
      ["/proj/orphan.ts"],
      [change({ path: "/proj/other.ts", before: "a", after: "b" })],
    );
    expect(cards).toEqual([
      {
        path: "/proj/orphan.ts",
        name: "orphan.ts",
        added: 0,
        removed: 0,
        patch: null,
        hasSnippet: false,
      },
    ]);
  });

  it("preserves path order and matches by project-relative path", () => {
    const cards = buildTurnChangedFileCards(
      ["src/b.ts", "src/a.ts"],
      [
        change({
          path: "/work/src/a.ts",
          before: "x\n",
          after: "y\n",
        }),
        change({
          path: "/work/src/b.ts",
          before: "1\n",
          after: "1\n2\n",
        }),
      ],
      "/work",
    );
    expect(cards.map((c) => c.name)).toEqual(["b.ts", "a.ts"]);
    expect(cards[0]!.hasSnippet).toBe(true);
    expect(cards[1]!.hasSnippet).toBe(true);
  });
});
