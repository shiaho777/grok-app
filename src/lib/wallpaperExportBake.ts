/**
 * Bake plan for sharing a video wallpaper: crop the visible focus slice and
 * trim to the clip, then reset focus/clip so cover-fill of the new file
 * matches the editor look at the exporter's window aspect.
 */

import {
  DEFAULT_WALLPAPER_FOCUS,
  normalizeWallpaperFocus,
  wallpaperVisibleRect,
  type WallpaperFocus,
} from "./wallpaperFocus";
import { parseWallpaperClip, type WallpaperClip } from "./wallpaperClip";
import { isThemeEditorDocument } from "./themeEditorShell";

export type PixelCrop = { x: number; y: number; w: number; h: number };

export type VideoBakePlan = {
  crop: PixelCrop | null;
  clip: WallpaperClip | null;
};

/** Cached main-workbench aspect for the standalone theme-editor window. */
let mainWindowAspectCache: number | null = null;

function readMediaElementAspect(): number | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(".app-wallpaper-media");
  if (!(el instanceof HTMLElement)) return null;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w > 1 && h > 1) return w / h;
  return null;
}

function readLocalWindowAspect(): number {
  if (typeof window === "undefined") return 16 / 10;
  const w = window.innerWidth || 1280;
  const h = window.innerHeight || 800;
  return w / Math.max(1, h);
}

function aspectFromPhysical(
  size: { width: number; height: number },
  factor: number,
): number {
  const scale = factor > 0 ? factor : 1;
  const w = size.width / scale;
  const h = size.height / scale;
  return w / Math.max(1, h);
}

/**
 * Sync aspect for wallpaper cover-fill / focus crop.
 * Prefer the live wallpaper surface; in the theme-editor shell fall back to the
 * cached main-window aspect (not the editor window's own size).
 */
export function readViewportAspect(): number {
  const fromMedia = readMediaElementAspect();
  if (fromMedia != null) return fromMedia;
  if (
    isThemeEditorDocument() &&
    mainWindowAspectCache != null &&
    mainWindowAspectCache > 0
  ) {
    return mainWindowAspectCache;
  }
  return readLocalWindowAspect();
}

/** Resolve the aspect the main workbench wallpaper actually uses. */
export async function resolveWallpaperViewportAspect(): Promise<number> {
  const fromMedia = readMediaElementAspect();
  if (fromMedia != null) {
    mainWindowAspectCache = fromMedia;
    return fromMedia;
  }
  if (isThemeEditorDocument()) {
    try {
      if (
        typeof window !== "undefined" &&
        ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
      ) {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const main = await WebviewWindow.getByLabel("main");
        if (main) {
          const size = await main.innerSize();
          const factor = await main.scaleFactor();
          const aspect = aspectFromPhysical(size, factor);
          if (Number.isFinite(aspect) && aspect > 0) {
            mainWindowAspectCache = aspect;
            return aspect;
          }
        }
      }
    } catch {
      /* browser / missing main */
    }
    if (mainWindowAspectCache != null && mainWindowAspectCache > 0) {
      return mainWindowAspectCache;
    }
  }
  const local = readLocalWindowAspect();
  return local;
}

/**
 * Keep wallpaper focus/export aspect in sync with the main workbench.
 * Theme-editor shell listens to the main window; otherwise local resize.
 */
export async function watchWallpaperViewportAspect(
  onChange: (aspect: number) => void,
): Promise<() => void> {
  let cancelled = false;
  const unsubs: Array<() => void> = [];

  const push = (aspect: number) => {
    if (cancelled || !(aspect > 0) || !Number.isFinite(aspect)) return;
    mainWindowAspectCache = aspect;
    onChange(aspect);
  };

  push(await resolveWallpaperViewportAspect());

  if (typeof window !== "undefined" && !isThemeEditorDocument()) {
    const onResize = () => {
      void resolveWallpaperViewportAspect().then(push);
    };
    window.addEventListener("resize", onResize);
    unsubs.push(() => window.removeEventListener("resize", onResize));
  }

  if (isThemeEditorDocument()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        const un = await main.onResized(async ({ payload }) => {
          try {
            const factor = await main.scaleFactor();
            push(aspectFromPhysical(payload, factor));
          } catch {
            void resolveWallpaperViewportAspect().then(push);
          }
        });
        unsubs.push(un);
      }
    } catch {
      /* browser / missing main */
    }
  }

  return () => {
    cancelled = true;
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  };
}

/** Test helper — clear cached main aspect between cases. */
export function __resetMainWindowAspectCacheForTests(): void {
  mainWindowAspectCache = null;
}

/** Test helper — seed cached main aspect (theme-editor shell path). */
export function __setMainWindowAspectCacheForTests(aspect: number | null): void {
  mainWindowAspectCache = aspect;
}

function evenFloor(n: number): number {
  const i = Math.max(0, Math.floor(n));
  return i - (i % 2);
}

/** ffmpeg yuv420p needs even x/y/w/h. */
export function evenPixelCrop(
  crop: PixelCrop,
  mediaW: number,
  mediaH: number,
): PixelCrop {
  const mw = Math.max(2, evenFloor(mediaW) || mediaW);
  const mh = Math.max(2, evenFloor(mediaH) || mediaH);
  let x = evenFloor(crop.x);
  let y = evenFloor(crop.y);
  let w = Math.max(2, evenFloor(crop.w));
  let h = Math.max(2, evenFloor(crop.h));
  if (x + w > mw) x = Math.max(0, evenFloor(mw - w));
  if (y + h > mh) y = Math.max(0, evenFloor(mh - h));
  if (x + w > mw) w = Math.max(2, evenFloor(mw - x));
  if (y + h > mh) h = Math.max(2, evenFloor(mh - y));
  return { x, y, w, h };
}

export function pixelCropFromFocus(
  mediaW: number,
  mediaH: number,
  viewAspect: number,
  focus: WallpaperFocus,
): PixelCrop {
  const vis = wallpaperVisibleRect(mediaW, mediaH, viewAspect, focus);
  return evenPixelCrop(
    {
      x: vis.x * mediaW,
      y: vis.y * mediaH,
      w: vis.w * mediaW,
      h: vis.h * mediaH,
    },
    mediaW,
    mediaH,
  );
}

/** Still-image crop: no yuv420p even rounding. */
export function pixelCropFromFocusRaw(
  mediaW: number,
  mediaH: number,
  viewAspect: number,
  focus: WallpaperFocus,
): PixelCrop {
  const vis = wallpaperVisibleRect(mediaW, mediaH, viewAspect, focus);
  const mw = Math.max(1, Math.round(mediaW));
  const mh = Math.max(1, Math.round(mediaH));
  let x = Math.max(0, Math.floor(vis.x * mw));
  let y = Math.max(0, Math.floor(vis.y * mh));
  let w = Math.max(1, Math.floor(vis.w * mw));
  let h = Math.max(1, Math.floor(vis.h * mh));
  if (x + w > mw) x = Math.max(0, mw - w);
  if (y + h > mh) y = Math.max(0, mh - h);
  if (x + w > mw) w = Math.max(1, mw - x);
  if (y + h > mh) h = Math.max(1, mh - y);
  return { x, y, w, h };
}

export function planImageBake(input: {
  mediaW: number;
  mediaH: number;
  viewAspect?: number;
  focus?: WallpaperFocus | null;
}): PixelCrop | null {
  const mw = Math.max(1, Math.round(input.mediaW));
  const mh = Math.max(1, Math.round(input.mediaH));
  const aspect =
    input.viewAspect && input.viewAspect > 0 ? input.viewAspect : mw / mh;
  const focus = normalizeWallpaperFocus(input.focus);
  const c = pixelCropFromFocusRaw(mw, mh, aspect, focus);
  if (isFullFrameCrop(c, mw, mh)) return null;
  return c;
}

export function isFullFrameCrop(
  crop: PixelCrop,
  mediaW: number,
  mediaH: number,
): boolean {
  return crop.x <= 1 && crop.y <= 1 && crop.w >= mediaW - 2 && crop.h >= mediaH - 2;
}

export function planVideoBake(input: {
  mediaW: number;
  mediaH: number;
  viewAspect?: number;
  focus?: WallpaperFocus | null;
  clip?: WallpaperClip | null;
}): VideoBakePlan | null {
  const mw = Math.max(1, Math.round(input.mediaW));
  const mh = Math.max(1, Math.round(input.mediaH));
  const aspect =
    input.viewAspect && input.viewAspect > 0 ? input.viewAspect : mw / mh;
  const focus = normalizeWallpaperFocus(input.focus);
  let crop: PixelCrop | null = null;
  const c = pixelCropFromFocus(mw, mh, aspect, focus);
  if (!isFullFrameCrop(c, mw, mh)) crop = c;
  const clip = parseWallpaperClip(input.clip);
  if (!crop && !clip) return null;
  return { crop, clip };
}

export function bakedWallpaperReset(): {
  focus: WallpaperFocus;
  clip: null;
} {
  return { focus: { ...DEFAULT_WALLPAPER_FOCUS }, clip: null };
}
