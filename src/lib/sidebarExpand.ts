/**
 * Sidebar project-folder expand/collapse persistence helpers.
 *
 * Product rule: missing id ⇒ expanded. Only collapsed folders are stored
 * (`sidebarCollapsedProjectIds`). Empty list after migration means the user
 * expanded everything and that must round-trip (#1230).
 *
 * One-shot: an unmigrated crowded tree (12+ projects, nothing collapsed)
 * starts collapsed so Windows WebView2 does not mount hundreds of rows.
 */

/** Many open folders × a few chats each stutter; collapse until the user opens some. */
export const SIDEBAR_AUTO_COLLAPSE_PROJECT_THRESHOLD = 12;

export type ExpandMapOpts = {
  /**
   * First hydrate before `sidebarCollapseDefaultMigrated`.
   * Later hydrates must pass false so “expand all” stays expanded.
   */
  autoCollapseUnmigrated?: boolean;
};

/** Build expand map for known project ids from persisted collapsed ids. */
export function expandMapFromCollapsedIds(
  projectIds: string[],
  collapsedIds: string[] | null | undefined,
  opts?: ExpandMapOpts,
): Record<string, boolean> {
  const collapsed = new Set(
    (collapsedIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const crowded =
    !!opts?.autoCollapseUnmigrated &&
    projectIds.length >= SIDEBAR_AUTO_COLLAPSE_PROJECT_THRESHOLD &&
    collapsed.size === 0;
  const map: Record<string, boolean> = {};
  for (const id of projectIds) {
    if (collapsed.has(id) || crowded) map[id] = false;
    else map[id] = true;
  }
  return map;
}

/** First sidebar hydrate: auto-collapse only when the one-shot flag is still off. */
export function hydrateSidebarExpandMap(input: {
  projectIds: string[];
  collapsedIds: string[] | null | undefined;
  migrated: boolean;
}): { map: Record<string, boolean>; shouldPersistMigration: boolean } {
  return {
    map: expandMapFromCollapsedIds(input.projectIds, input.collapsedIds, {
      autoCollapseUnmigrated: !input.migrated,
    }),
    shouldPersistMigration: !input.migrated,
  };
}

/** Ids that should be written to settings (explicitly collapsed). */
export function collapsedIdsFromExpandMap(
  map: Record<string, boolean>,
): string[] {
  return Object.entries(map)
    .filter(([, open]) => open === false)
    .map(([id]) => id)
    .sort();
}

/** True when two collapsed-id lists encode the same set. */
export function sameCollapsedIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}
