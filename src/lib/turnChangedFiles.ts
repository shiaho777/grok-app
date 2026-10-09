/**
 * Per-turn changed-file strip helpers (Issue #998).
 * Derive unique edit paths from an assistant timeline — no new diff engine.
 */

import { countPatchDelta } from "./reviewDiff";
import {
  buildUnifiedDiff,
  isEditToolKind,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
  sessionFileLineDelta,
  type SessionFileChange,
} from "./sessionChanges";
import type { MessageToolSegment } from "./session";
import type { TimelineUnit } from "./timelinePhases";

export interface TurnChangedFileItem {
  /** Full path passed to Changes open handler. */
  path: string;
  /** Basename for the chip label. */
  name: string;
}

/** Expandable card model with optional live before/after patch (#998 P1). */
export type TurnChangedFileCard = {
  path: string;
  name: string;
  added: number;
  removed: number;
  /** Unified patch when before/after known; null → empty / fallback later. */
  patch: string | null;
  hasSnippet: boolean;
};

/** Max file chips before collapsing the rest behind “+N more”. */
export const TURN_CHANGED_FILES_VISIBLE_MAX = 6;

function visitEditPath(
  tool: MessageToolSegment,
  pathSet: Set<string>,
): void {
  const raw = (tool.path || "").trim();
  if (!raw) return;
  if (!isEditToolKind(tool.toolKind)) return;
  const n = normalizePath(raw);
  if (n) pathSet.add(n);
}

/**
 * Unique edit/write paths touched in this assistant timeline (stream order).
 * Empty when the turn did not mutate files.
 */
export function collectTurnModifiedPaths(
  units: TimelineUnit[],
): string[] {
  const pathSet = new Set<string>();
  for (const u of units) {
    if (u.kind === "phase") {
      for (const t of u.tools) visitEditPath(t, pathSet);
    } else if (u.kind === "tool") {
      visitEditPath(u.tool, pathSet);
    }
  }
  return Array.from(pathSet);
}

/** Map paths → chip items (basename label). Drops empty basenames. */
export function turnChangedFileItems(
  paths: string[],
): TurnChangedFileItem[] {
  const out: TurnChangedFileItem[] = [];
  for (const path of paths) {
    const name = pathBaseName(path) || path.trim();
    if (!name) continue;
    out.push({ path, name });
  }
  return out;
}

/**
 * Match a turn path to a session change (abs, project-rel, or basename).
 */
function findSessionChangeForPath(
  path: string,
  changes: readonly SessionFileChange[],
  projectPath?: string | null,
): SessionFileChange | undefined {
  const want = normalizePath(path);
  if (!want || changes.length === 0) return undefined;
  const wantLower = want.toLowerCase();
  const wantRel = normalizePath(
    pathRelativeToProject(want, projectPath) || want,
  ).toLowerCase();
  const wantBase = pathBaseName(want).toLowerCase();

  for (const c of changes) {
    const cp = normalizePath(c.path);
    if (!cp) continue;
    if (cp === want || cp.toLowerCase() === wantLower) return c;
    const cr = normalizePath(
      pathRelativeToProject(c.path, projectPath) || c.path,
    ).toLowerCase();
    if (cr && cr === wantRel) return c;
  }

  if (!wantBase) return undefined;
  for (const c of changes) {
    const cp = normalizePath(c.path);
    if (!cp) continue;
    const cr = normalizePath(
      pathRelativeToProject(c.path, projectPath) || c.path,
    ).toLowerCase();
    if (pathBaseName(cp).toLowerCase() === wantBase) return c;
    if (cr === wantBase || cr.endsWith("/" + wantBase)) return c;
  }
  return undefined;
}

/**
 * Build expandable cards for turn paths, joining live session before/after
 * snippets when available. Preserves `paths` order.
 */
export function buildTurnChangedFileCards(
  paths: readonly string[],
  sessionChanges: readonly SessionFileChange[] = [],
  projectPath?: string | null,
): TurnChangedFileCard[] {
  const out: TurnChangedFileCard[] = [];
  for (const raw of paths) {
    const path = normalizePath(raw) || raw.trim();
    if (!path) continue;
    const name = pathBaseName(path) || path;
    const change = findSessionChangeForPath(path, sessionChanges, projectPath);
    if (!change) {
      out.push({
        path,
        name,
        added: 0,
        removed: 0,
        patch: null,
        hasSnippet: false,
      });
      continue;
    }

    const rel =
      pathRelativeToProject(change.path, projectPath) ||
      normalizePath(change.path) ||
      change.name ||
      name;
    let patch: string | null = null;
    if (typeof change.before === "string" && typeof change.after === "string") {
      patch = buildUnifiedDiff(rel, change.before, change.after);
    } else if (typeof change.after === "string" && change.before == null) {
      patch = buildUnifiedDiff(rel, "", change.after);
    }

    const delta = sessionFileLineDelta(change);
    const fromPatch = patch ? countPatchDelta(patch) : null;
    out.push({
      path,
      name: change.name || name,
      added: delta?.added ?? fromPatch?.added ?? 0,
      removed: delta?.removed ?? fromPatch?.removed ?? 0,
      patch,
      hasSnippet: !!patch,
    });
  }
  return out;
}

/**
 * Split items into the visible chip row and a leftover count for “+N more”.
 */
export function splitTurnChangedFiles<T extends { path: string }>(
  items: T[],
  maxVisible = TURN_CHANGED_FILES_VISIBLE_MAX,
): { visible: T[]; hiddenCount: number } {
  if (maxVisible < 1 || items.length <= maxVisible) {
    return { visible: items, hiddenCount: 0 };
  }
  return {
    visible: items.slice(0, maxVisible),
    hiddenCount: items.length - maxVisible,
  };
}
