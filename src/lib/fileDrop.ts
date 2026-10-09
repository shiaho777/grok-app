/**
 * File drag-drop helpers (HTML5 DataTransfer + Tauri native path events).
 *
 * Windows strategy (#628 / #999 / #1017):
 * - Keep `dragDropEnabled: true` so Explorer folder/file drops can deliver
 *   absolute paths. Sidebar "add project" needs those paths; HTML5 alone often
 *   has empty `File.path` for folders. Never set `dragDropEnabled: false` —
 *   that regresses to a forbidden cursor when paired with a hidden create.
 * - Main window is created hidden (`visible: false`); wry's early OLE inject
 *   can miss WebView2 child HWNDs (tauri#14643). Host re-registers drop
 *   targets after `show()` (`win_file_drop`) and emits `tauri://drag-*`.
 * - HTML5 capture-phase listeners remain as a fallback (path via `File.path`
 *   or `text/uri-list`) and for non-OS drags. When a native drop already ran,
 *   `shouldSkipHtml5AfterNative` prevents a second attach.
 * - Zones: sidebar → add project; main/chat → attach files.
 * - Path-less blob drops (some cross-app images) may still need paste / picker.
 */

/** How long HTML5 drop should yield to a just-handled Tauri OS drop. */
export const HTML5_NATIVE_DROP_GUARD_MS = 400;

/** True when this drag looks like OS files (Explorer / Finder / Nautilus). */
export function isFileDrag(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  if (
    types.includes("Files") ||
    types.includes("application/x-moz-file") ||
    types.includes("text/uri-list")
  ) {
    return true;
  }
  if (data.files && data.files.length > 0) return true;
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.kind === "file") return true;
    }
  }
  return false;
}

/** Absolute paths from WebView `File.path` (Electron / some WKWebView). */
export function pathsFromDroppedFiles(files: Iterable<File>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const path = ((f as File & { path?: string }).path || "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** `file://` URL → local path (Windows drive letters un-prefixed). */
export function fileUrlToFsPath(raw: string): string | null {
  const s = raw.trim();
  if (!/^file:/i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "file:") return null;
    let path = decodeURIComponent(u.pathname);
    // Chromium file URLs use `/C:/...` — strip the leading slash.
    if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
    // file://localhost/Users/... → pathname already `/Users/...`
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Decode `text/uri-list` lines into absolute filesystem paths.
 * Ignores http(s) links and blank / comment lines.
 */
export function pathsFromUriList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    let path = "";
    if (/^file:/i.test(t)) {
      path = fileUrlToFsPath(t) ?? "";
    } else if (
      /^[A-Za-z]:[\\/]/.test(t) ||
      t.startsWith("\\\\") ||
      (t.startsWith("/") && !t.startsWith("//"))
    ) {
      path = t;
    }
    path = path.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * Best-effort absolute paths from an HTML5 drop.
 * Prefers `File.path`, then `text/uri-list` (only reliable inside `drop`).
 */
export function pathsFromDataTransfer(
  data: DataTransfer | null | undefined,
): string[] {
  if (!data) return [];
  const files = data.files?.length ? Array.from(data.files) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    const path = p.trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push(path);
  };
  for (const p of pathsFromDroppedFiles(files)) push(p);
  try {
    const types = Array.from(data.types ?? []);
    if (types.includes("text/uri-list")) {
      for (const p of pathsFromUriList(data.getData("text/uri-list"))) push(p);
    }
  } catch {
    /* getData can throw outside drop in some engines */
  }
  return out;
}

/**
 * Skip the HTML5 fallback when Tauri already consumed this OS drop.
 * Prevents a second temp-file attach of the same Explorer/Finder files.
 */
export function shouldSkipHtml5AfterNative(
  nativeDropAtMs: number,
  nowMs: number,
  windowMs: number = HTML5_NATIVE_DROP_GUARD_MS,
): boolean {
  if (!(nativeDropAtMs > 0) || !(nowMs >= 0)) return false;
  const dt = nowMs - nativeDropAtMs;
  return dt >= 0 && dt < windowMs;
}
