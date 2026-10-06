/**
 * Review-panel pure helpers: parse unified patches into render rows,
 * fold unmodified spans, build a simple path tree for the side list.
 */

import { pathBaseName } from "@/lib/sessionChanges";

/**
 * Decode a git path that may be C-style quoted with octal escapes.
 * Example: `"docs/Agent\\346\\211\\247SOP/246.md"` → `docs/Agent执行SOP/246.md`
 * Also strips stray quotes so the tree never gets a `"docs` segment.
 */
export function decodeGitPath(input: string): string {
  let s = (input || "").trim();
  if (!s) return "";
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1);
  }
  // Partial corruption: leftover edge quotes
  while (s.startsWith('"')) s = s.slice(1);
  while (s.endsWith('"')) s = s.slice(0, -1);

  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const n = s[i + 1]!;
      if (n >= "0" && n <= "7") {
        let j = i + 1;
        let oct = "";
        while (j < s.length && oct.length < 3) {
          const d = s[j]!;
          if (d < "0" || d > "7") break;
          oct += d;
          j++;
        }
        bytes.push(parseInt(oct, 8) & 0xff);
        i = j - 1;
        continue;
      }
      if (n === "n") {
        bytes.push(0x0a);
        i++;
        continue;
      }
      if (n === "t") {
        bytes.push(0x09);
        i++;
        continue;
      }
      if (n === "r") {
        bytes.push(0x0d);
        i++;
        continue;
      }
      if (n === '"' || n === "\\" || n === "'") {
        bytes.push(n.charCodeAt(0));
        i++;
        continue;
      }
    }
    // Push UTF-16 code unit as bytes via TextEncoder for non-ASCII source text
    // that is already decoded (path without escapes).
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      // High surrogate: encode the whole astral pair in one step — feeding a
      // lone surrogate to TextEncoder emits U+FFFD per unit and corrupts
      // emoji / extension-B filenames.
      const enc = new TextEncoder().encode(s.slice(i, i + 2));
      for (let k = 0; k < enc.length; k++) bytes.push(enc[k]!);
      i++;
    } else {
      const enc = new TextEncoder().encode(s[i]!);
      for (let k = 0; k < enc.length; k++) bytes.push(enc[k]!);
    }
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(bytes),
    );
  } catch {
    decoded = s;
  }
  // Normalize separators only after unescaping (so \346 is not a path split).
  return decoded.replace(/\\/g, "/");
}

export type ReviewDiffLineKind = "ctx" | "add" | "del" | "meta" | "hunk";

export type ReviewDiffRow =
  | {
      type: "line";
      kind: ReviewDiffLineKind;
      /** Display line number (new side when available, else old). */
      ln: number | null;
      oldLn: number | null;
      newLn: number | null;
      text: string;
    }
  | {
      type: "fold";
      /** Unmodified / skipped lines between hunks. */
      count: number;
      id: string;
    };

export type ReviewParsedFile = {
  added: number;
  removed: number;
  rows: ReviewDiffRow[];
  /** True when the patch is empty / unparseable. */
  empty: boolean;
};

const HUNK_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@/;

/**
 * Count +/-/ lines in a unified patch (ignores headers).
 */
export function countPatchDelta(patch: string | null | undefined): {
  added: number;
  removed: number;
} {
  if (!patch) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("@@")
    ) {
      continue;
    }
    if (raw.startsWith("+")) added++;
    else if (raw.startsWith("-")) removed++;
  }
  return { added, removed };
}

/**
 * Parse a single-file unified diff into render rows with fold markers
 * for gaps between hunks (Codex-style "N unmodified lines").
 */
export function parseReviewPatch(patch: string | null | undefined): ReviewParsedFile {
  if (!patch || !patch.trim()) {
    return { added: 0, removed: 0, rows: [], empty: true };
  }
  const lines = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows: ReviewDiffRow[] = [];
  let added = 0;
  let removed = 0;
  let oldLn = 0;
  let newLn = 0;
  let prevHunkNewEnd: number | null = null;
  let foldIdx = 0;
  let sawHunk = false;

  for (const raw of lines) {
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("rename ") ||
      raw.startsWith("copy ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("Binary ") ||
      raw.startsWith("GIT binary")
    ) {
      continue;
    }

    const hm = raw.match(HUNK_RE);
    if (hm) {
      sawHunk = true;
      const nextOld = Number(hm[1]);
      const nextNew = Number(hm[3]);
      if (prevHunkNewEnd != null && nextNew > prevHunkNewEnd + 1) {
        const gap = nextNew - prevHunkNewEnd - 1;
        if (gap > 0) {
          rows.push({
            type: "fold",
            count: gap,
            id: `fold-${foldIdx++}`,
          });
        }
      }
      oldLn = nextOld;
      newLn = nextNew;
      prevHunkNewEnd = nextNew - 1;
      continue;
    }

    if (!sawHunk && !raw.startsWith(" ") && !raw.startsWith("+") && !raw.startsWith("-")) {
      continue;
    }

    if (raw.startsWith("\\")) {
      // "\ No newline at end of file"
      continue;
    }

    if (raw.startsWith("+")) {
      added++;
      rows.push({
        type: "line",
        kind: "add",
        ln: newLn,
        oldLn: null,
        newLn,
        text: raw.slice(1),
      });
      prevHunkNewEnd = newLn;
      newLn++;
      continue;
    }
    if (raw.startsWith("-")) {
      removed++;
      rows.push({
        type: "line",
        kind: "del",
        ln: oldLn,
        oldLn,
        newLn: null,
        text: raw.slice(1),
      });
      oldLn++;
      continue;
    }
    // context (leading space) or bare
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    rows.push({
      type: "line",
      kind: "ctx",
      ln: newLn || oldLn || null,
      oldLn: oldLn || null,
      newLn: newLn || null,
      text,
    });
    prevHunkNewEnd = newLn;
    oldLn++;
    newLn++;
  }

  return { added, removed, rows, empty: rows.length === 0 };
}

/** Path tree node for the review side list. */
export type ReviewTreeNode = {
  id: string;
  name: string;
  /** Full relative path for files; dir path for folders. */
  path: string;
  isDir: boolean;
  children?: ReviewTreeNode[];
  /** File meta when !isDir */
  fileKey?: string;
  added?: number;
  removed?: number;
  kind?: string;
  binary?: boolean;
};

export type ReviewTreeFileMeta = {
  key: string;
  relPath: string;
  name: string;
  added?: number;
  removed?: number;
  kind?: string;
  binary?: boolean;
};

/**
 * Build a sorted directory tree from flat relative paths.
 */
export function buildReviewTree(files: readonly ReviewTreeFileMeta[]): ReviewTreeNode[] {
  type Mutable = {
    id: string;
    name: string;
    path: string;
    isDir: boolean;
    children: Map<string, Mutable>;
    file?: ReviewTreeFileMeta;
  };

  const root: Mutable = {
    id: "",
    name: "",
    path: "",
    isDir: true,
    children: new Map(),
  };

  for (const f of files) {
    const rel = decodeGitPath(f.relPath);
    // Only split on path separators — never on backslash-as-escape leftovers.
    const parts = rel.split("/").filter((p) => p.length > 0 && p !== ".");
    if (parts.length === 0) continue;
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (isLast) {
        const cleanName =
          decodeGitPath(f.name || "") || part || pathBaseName(rel);
        node.children.set(part, {
          id: f.key,
          name: cleanName,
          path: rel,
          isDir: false,
          children: new Map(),
          file: { ...f, relPath: rel, name: cleanName },
        });
      } else {
        let next = node.children.get(part);
        if (!next || !next.isDir) {
          next = {
            id: `dir:${acc}`,
            name: part,
            path: acc,
            isDir: true,
            children: new Map(),
          };
          node.children.set(part, next);
        }
        node = next;
      }
    }
  }

  const toNodes = (m: Mutable): ReviewTreeNode[] => {
    const list = Array.from(m.children.values()).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return list.map((c) => {
      if (c.isDir) {
        return {
          id: c.id,
          name: c.name,
          path: c.path,
          isDir: true,
          children: toNodes(c),
        };
      }
      const f = c.file!;
      return {
        id: c.id,
        name: c.name || pathBaseName(c.path),
        path: c.path,
        isDir: false,
        fileKey: f.key,
        added: f.added,
        removed: f.removed,
        kind: f.kind,
        binary: f.binary,
      };
    });
  };

  return toNodes(root);
}

/** Truncate middle of a long file name for compact headers. */
export function truncateMiddle(name: string, max = 28): string {
  const s = (name || "").trim();
  if (s.length <= max) return s;
  const keep = Math.max(4, Math.floor((max - 1) / 2));
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

/**
 * Extension / basename badge label for review chips (JS / TS / MD …).
 */
export function reviewFileBadge(name: string): { label: string; tone: string } {
  const lower = (name || "").toLowerCase();
  const base = lower.includes("/") ? lower.split("/").pop() || lower : lower;
  if (base === ".gitignore" || base.endsWith("ignore")) {
    return { label: "GIT", tone: "git" };
  }
  const ext = base.includes(".") ? base.split(".").pop() || "" : "";
  switch (ext) {
    case "ts":
    case "tsx":
      return { label: "TS", tone: "ts" };
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { label: "JS", tone: "js" };
    case "md":
    case "mdx":
      return { label: "M↓", tone: "md" };
    case "json":
      return { label: "{}", tone: "json" };
    case "css":
    case "scss":
      return { label: "CSS", tone: "css" };
    case "rs":
      return { label: "RS", tone: "rs" };
    case "py":
      return { label: "PY", tone: "py" };
    case "sh":
    case "bash":
    case "zsh":
      return { label: "$", tone: "sh" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return { label: "IMG", tone: "img" };
    case "toml":
    case "yaml":
    case "yml":
      return { label: "CFG", tone: "cfg" };
    default:
      if (!ext) return { label: "·", tone: "file" };
      return { label: ext.slice(0, 3).toUpperCase(), tone: "file" };
  }
}
