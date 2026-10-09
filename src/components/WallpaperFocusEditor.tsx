/**
 * Visual wallpaper focus editor — window-aspect crop frame over full media.
 * For video: dual-handle timeline to pick an in/out clip (no re-encode).
 *
 * Performance:
 * - Source blob never re-encoded; only focus + clip meta saved.
 * - Single muted looping <video> / <img>; not remounted while dragging.
 * - Crop-frame drag uses rAF + refs; clip handles update via rAF too.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { GlassModal } from "@/components/GlassModal";
import type { WallpaperClip, WallpaperKind } from "@/lib/themeSkin";
import {
  DEFAULT_WALLPAPER_FOCUS,
  WALLPAPER_CLIP_MIN_DURATION,
  WALLPAPER_FOCUS_MAX_ZOOM,
  enforceVideoClip,
  formatClipTime,
  normalizeWallpaperClip,
  normalizeWallpaperFocus,
  type WallpaperFocus,
} from "@/lib/themeSkin";
import {
  containRect,
  focusWithZoom,
  visibleRectToStageFrame,
  wallpaperVisibleRect,
} from "@/lib/wallpaperFocus";
import {
  readViewportAspect,
  watchWallpaperViewportAspect,
} from "@/lib/wallpaperExportBake";

export type WallpaperFocusEditorLabels = {
  title: string;
  hint: string;
  hintVideo: string;
  zoom: string;
  clip: string;
  clipStart: string;
  clipEnd: string;
  reset: string;
  cancel: string;
  apply: string;
  close: string;
};

export type WallpaperFocusApplyResult = {
  focus: WallpaperFocus;
  /** null = full video / not a video */
  clip: WallpaperClip | null;
  duration: number;
};

export type WallpaperFocusEditorProps = {
  open: boolean;
  onClose: () => void;
  onApply: (result: WallpaperFocusApplyResult) => void;
  mediaUrl: string;
  kind: WallpaperKind;
  initialFocus?: WallpaperFocus | null;
  initialClip?: WallpaperClip | null;
  labels: WallpaperFocusEditorLabels;
};

type MediaSize = { w: number; h: number };
type ClipHandle = "start" | "end" | "range";

export function WallpaperFocusEditor({
  open,
  onClose,
  onApply,
  mediaUrl,
  kind,
  initialFocus,
  initialClip = null,
  labels,
}: WallpaperFocusEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<WallpaperFocus>(
    normalizeWallpaperFocus(initialFocus ?? DEFAULT_WALLPAPER_FOCUS),
  );
  const clipRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const durationRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originCx: number;
    originCy: number;
  } | null>(null);
  const clipDragRef = useRef<{
    pointerId: number;
    handle: ClipHandle;
    originStart: number;
    originEnd: number;
    originX: number;
    trackW: number;
  } | null>(null);
  const rafRef = useRef(0);
  const frameElRef = useRef<HTMLDivElement>(null);
  const rangeElRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLButtonElement>(null);
  const endHandleRef = useRef<HTMLButtonElement>(null);

  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [viewAspect, setViewAspect] = useState(readViewportAspect);
  const [focus, setFocus] = useState<WallpaperFocus>(() =>
    normalizeWallpaperFocus(initialFocus ?? DEFAULT_WALLPAPER_FOCUS),
  );
  const [duration, setDuration] = useState(0);
  const [clip, setClip] = useState({ start: 0, end: 0 });

  useEffect(() => {
    if (!open) return;
    const next = normalizeWallpaperFocus(initialFocus ?? DEFAULT_WALLPAPER_FOCUS);
    focusRef.current = next;
    setFocus(next);
    setMediaSize(null);
    setDuration(0);
    durationRef.current = 0;
    const seed = initialClip
      ? { start: initialClip.start, end: initialClip.end }
      : { start: 0, end: 0 };
    clipRef.current = seed;
    setClip(seed);
  }, [open, mediaUrl, initialFocus, initialClip]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void watchWallpaperViewportAspect((aspect) => {
      if (!disposed) setViewAspect(aspect);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setStageSize((prev) => {
        const w = cr.width;
        const h = cr.height;
        if (Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5) {
          return prev;
        }
        return { w, h };
      });
    });
    ro.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (open) return;
    const el = mediaRef.current;
    if (el && "pause" in el) {
      try {
        (el as HTMLVideoElement).pause();
      } catch {
        /* ignore */
      }
    }
  }, [open]);

  const paintClipDom = useCallback((start: number, end: number, dur: number) => {
    if (!(dur > 0)) return;
    const leftPct = (start / dur) * 100;
    const widthPct = ((end - start) / dur) * 100;
    if (rangeElRef.current) {
      rangeElRef.current.style.left = `${leftPct}%`;
      rangeElRef.current.style.width = `${widthPct}%`;
    }
    if (startHandleRef.current) {
      startHandleRef.current.style.left = `${leftPct}%`;
    }
    if (endHandleRef.current) {
      endHandleRef.current.style.left = `${(end / dur) * 100}%`;
    }
  }, []);

  const commitClip = useCallback(
    (start: number, end: number, dur: number) => {
      const normalized = normalizeWallpaperClip({ start, end }, dur);
      const next = normalized ?? { start: 0, end: dur };
      clipRef.current = next;
      setClip(next);
      paintClipDom(next.start, next.end, dur);
      const v = mediaRef.current;
      if (v instanceof HTMLVideoElement) {
        try {
          if (v.currentTime < next.start || v.currentTime >= next.end) {
            v.currentTime = next.start;
          }
        } catch {
          /* ignore */
        }
      }
    },
    [paintClipDom],
  );

  const onMediaReady = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el instanceof HTMLVideoElement) {
      const w = el.videoWidth;
      const h = el.videoHeight;
      if (w > 0 && h > 0) setMediaSize({ w, h });
      const dur = el.duration;
      if (Number.isFinite(dur) && dur > 0) {
        durationRef.current = dur;
        setDuration(dur);
        const seeded = normalizeWallpaperClip(
          clipRef.current.end > clipRef.current.start
            ? clipRef.current
            : initialClip,
          dur,
        );
        const next = seeded ?? { start: 0, end: dur };
        clipRef.current = next;
        setClip(next);
        paintClipDom(next.start, next.end, dur);
        try {
          el.currentTime = next.start;
        } catch {
          /* ignore */
        }
        el.loop = false;
      }
      void el.play().catch(() => {});
      return;
    }
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    if (w > 0 && h > 0) setMediaSize({ w, h });
  }, [initialClip, paintClipDom]);

  useEffect(() => {
    if (!open || kind !== "video") return;
    const el = mediaRef.current;
    if (!(el instanceof HTMLVideoElement)) return;
    const onTime = () => {
      const c = clipRef.current;
      const dur = durationRef.current;
      if (!(dur > 0) || !(c.end > c.start)) return;
      enforceVideoClip(el, c);
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [open, kind, mediaUrl, duration]);

  const mediaBox = useMemo(() => {
    if (!mediaSize || stageSize.w <= 0 || stageSize.h <= 0) return null;
    return containRect(mediaSize.w, mediaSize.h, stageSize.w, stageSize.h);
  }, [mediaSize, stageSize.h, stageSize.w]);

  const applyFrameDom = useCallback(
    (next: WallpaperFocus) => {
      focusRef.current = next;
      const frameEl = frameElRef.current;
      if (!frameEl || !mediaSize || !mediaBox) return;
      const v = wallpaperVisibleRect(
        mediaSize.w,
        mediaSize.h,
        viewAspect,
        next,
      );
      const f = visibleRectToStageFrame(v, mediaBox);
      frameEl.style.transform = `translate3d(${f.x}px, ${f.y}px, 0)`;
      frameEl.style.width = `${f.w}px`;
      frameEl.style.height = `${f.h}px`;
    },
    [mediaBox, mediaSize, viewAspect],
  );

  useEffect(() => {
    if (!mediaSize || !mediaBox) return;
    const clamped = focusWithZoom(
      focusRef.current,
      focusRef.current.zoom,
      mediaSize.w,
      mediaSize.h,
      viewAspect,
    );
    focusRef.current = clamped;
    setFocus(clamped);
    applyFrameDom(clamped);
  }, [mediaSize, mediaBox, viewAspect, applyFrameDom]);

  const commitFocus = useCallback((next: WallpaperFocus) => {
    const n = normalizeWallpaperFocus(next);
    focusRef.current = n;
    setFocus(n);
  }, []);

  const onPointerDownFrame = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!mediaSize || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originCx: focusRef.current.cx,
      originCy: focusRef.current.cy,
    };
  };

  const onPointerMoveFrame = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !mediaSize || !mediaBox) {
      return;
    }
    e.preventDefault();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const dCx = mediaBox.w > 0 ? dx / mediaBox.w : 0;
    const dCy = mediaBox.h > 0 ? dy / mediaBox.h : 0;
    const panned = focusWithZoom(
      {
        cx: drag.originCx + dCx,
        cy: drag.originCy + dCy,
        zoom: focusRef.current.zoom,
      },
      focusRef.current.zoom,
      mediaSize.w,
      mediaSize.h,
      viewAspect,
    );
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      applyFrameDom(panned);
    });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    commitFocus(focusRef.current);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onWheelStage = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!mediaSize) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    const zoom = Math.min(
      WALLPAPER_FOCUS_MAX_ZOOM,
      Math.max(1, focusRef.current.zoom + delta),
    );
    const next = focusWithZoom(
      focusRef.current,
      zoom,
      mediaSize.w,
      mediaSize.h,
      viewAspect,
    );
    applyFrameDom(next);
    commitFocus(next);
  };

  const onZoomSlider = (value: number) => {
    if (!mediaSize) return;
    const next = focusWithZoom(
      focusRef.current,
      value,
      mediaSize.w,
      mediaSize.h,
      viewAspect,
    );
    applyFrameDom(next);
    commitFocus(next);
  };

  const beginClipDrag =
    (handle: ClipHandle) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !(duration > 0)) return;
      e.preventDefault();
      e.stopPropagation();
      const track = trackRef.current;
      if (!track) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      clipDragRef.current = {
        pointerId: e.pointerId,
        handle,
        originStart: clipRef.current.start,
        originEnd: clipRef.current.end,
        originX: e.clientX,
        trackW: track.clientWidth || 1,
      };
    };

  const onClipPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = clipDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const dur = durationRef.current;
    if (!(dur > 0)) return;
    const dx = e.clientX - drag.originX;
    const dt = (dx / drag.trackW) * dur;
    const minLen = Math.min(WALLPAPER_CLIP_MIN_DURATION, dur);
    let start = drag.originStart;
    let end = drag.originEnd;
    if (drag.handle === "start") {
      start = Math.min(drag.originStart + dt, end - minLen);
      start = Math.max(0, start);
    } else if (drag.handle === "end") {
      end = Math.max(drag.originEnd + dt, start + minLen);
      end = Math.min(dur, end);
    } else {
      const len = drag.originEnd - drag.originStart;
      start = drag.originStart + dt;
      end = start + len;
      if (start < 0) {
        start = 0;
        end = len;
      }
      if (end > dur) {
        end = dur;
        start = dur - len;
      }
    }
    clipRef.current = { start, end };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      paintClipDom(start, end, dur);
      const v = mediaRef.current;
      if (v instanceof HTMLVideoElement) {
        try {
          if (drag.handle === "start") v.currentTime = start;
          else if (drag.handle === "end") {
            v.currentTime = Math.max(start, end - 0.05);
          }
        } catch {
          /* ignore */
        }
      }
    });
  };

  const endClipDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = clipDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    clipDragRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const dur = durationRef.current;
    commitClip(clipRef.current.start, clipRef.current.end, dur);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onReset = () => {
    if (mediaSize) {
      const next = focusWithZoom(
        DEFAULT_WALLPAPER_FOCUS,
        1,
        mediaSize.w,
        mediaSize.h,
        viewAspect,
      );
      applyFrameDom(next);
      commitFocus(next);
    } else {
      commitFocus({ ...DEFAULT_WALLPAPER_FOCUS });
    }
    if (kind === "video" && duration > 0) {
      commitClip(0, duration, duration);
    }
  };

  const onConfirm = () => {
    const dur = durationRef.current;
    const clipOut =
      kind === "video" && dur > 0
        ? normalizeWallpaperClip(clipRef.current, dur)
        : null;
    onApply({
      focus: normalizeWallpaperFocus(focusRef.current),
      clip: clipOut,
      duration: dur,
    });
    onClose();
  };

  const vis =
    mediaSize && mediaBox
      ? wallpaperVisibleRect(mediaSize.w, mediaSize.h, viewAspect, focus)
      : null;
  const frame =
    vis && mediaBox ? visibleRectToStageFrame(vis, mediaBox) : null;

  const mediaStyle: CSSProperties | undefined = mediaBox
    ? {
        position: "absolute",
        left: mediaBox.x,
        top: mediaBox.y,
        width: mediaBox.w,
        height: mediaBox.h,
        objectFit: "fill",
      }
    : undefined;

  const showClip = kind === "video" && duration > 0;
  const startPct = duration > 0 ? (clip.start / duration) * 100 : 0;
  const endPct = duration > 0 ? (clip.end / duration) * 100 : 100;
  const widthPct = Math.max(0, endPct - startPct);

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={labels.title}
      size="lg"
      className="wallpaper-focus-modal"
      bodyClassName="wallpaper-focus-modal__body"
      wrapBody
      closeLabel={labels.close}
      closeOnOverlay={false}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            {labels.reset}
          </button>
          <div className="wallpaper-focus-modal__footer-spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {labels.cancel}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            onClick={onConfirm}
            disabled={!mediaSize || (kind === "video" && !(duration > 0))}
          >
            {labels.apply}
          </button>
        </>
      }
    >
      <p className="wallpaper-focus-modal__hint">
        {kind === "video" ? labels.hintVideo : labels.hint}
      </p>
      <div
        ref={stageRef}
        className="wallpaper-focus-stage"
        onWheel={onWheelStage}
      >
        {kind === "video" ? (
          <video
            ref={(el) => {
              mediaRef.current = el;
            }}
            className="wallpaper-focus-stage__media"
            src={mediaUrl}
            muted
            playsInline
            autoPlay
            preload="metadata"
            disablePictureInPicture
            style={mediaStyle}
            onLoadedMetadata={onMediaReady}
            onLoadedData={onMediaReady}
            onDurationChange={onMediaReady}
          />
        ) : (
          <img
            ref={(el) => {
              mediaRef.current = el;
            }}
            className="wallpaper-focus-stage__media"
            src={mediaUrl}
            alt=""
            draggable={false}
            style={mediaStyle}
            onLoad={onMediaReady}
          />
        )}
        {frame ? (
          <div
            ref={frameElRef}
            className="wallpaper-focus-frame"
            style={{
              transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`,
              width: frame.w,
              height: frame.h,
            }}
            onPointerDown={onPointerDownFrame}
            onPointerMove={onPointerMoveFrame}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="presentation"
          >
            <span className="wallpaper-focus-frame__edge" aria-hidden />
          </div>
        ) : null}
      </div>

      {showClip ? (
        <div className="wallpaper-clip">
          <div className="wallpaper-clip__head">
            <span className="wallpaper-clip__label">{labels.clip}</span>
            <span className="wallpaper-clip__times" aria-live="polite">
              {formatClipTime(clip.start)} – {formatClipTime(clip.end)}
              <span className="wallpaper-clip__dur">
                {" "}
                ({formatClipTime(clip.end - clip.start)})
              </span>
            </span>
          </div>
          <div
            ref={trackRef}
            className="wallpaper-clip__track"
            onPointerMove={onClipPointerMove}
            onPointerUp={endClipDrag}
            onPointerCancel={endClipDrag}
          >
            <div className="wallpaper-clip__rail" aria-hidden />
            <div
              ref={rangeElRef}
              className="wallpaper-clip__range"
              style={{ left: `${startPct}%`, width: `${widthPct}%` }}
              onPointerDown={beginClipDrag("range")}
              role="presentation"
            />
            <button
              ref={startHandleRef}
              type="button"
              className="wallpaper-clip__handle wallpaper-clip__handle--start"
              style={{ left: `${startPct}%` }}
              aria-label={labels.clipStart}
              onPointerDown={beginClipDrag("start")}
            />
            <button
              ref={endHandleRef}
              type="button"
              className="wallpaper-clip__handle wallpaper-clip__handle--end"
              style={{ left: `${endPct}%` }}
              aria-label={labels.clipEnd}
              onPointerDown={beginClipDrag("end")}
            />
          </div>
        </div>
      ) : null}

      <div className="wallpaper-focus-zoom">
        <label className="wallpaper-focus-zoom__label" htmlFor="wp-focus-zoom">
          {labels.zoom}
        </label>
        <input
          id="wp-focus-zoom"
          type="range"
          className="wallpaper-focus-zoom__range"
          min={1}
          max={WALLPAPER_FOCUS_MAX_ZOOM}
          step={0.05}
          value={focus.zoom}
          disabled={!mediaSize}
          aria-valuemin={1}
          aria-valuemax={WALLPAPER_FOCUS_MAX_ZOOM}
          aria-valuenow={Number(focus.zoom.toFixed(2))}
          aria-label={labels.zoom}
          onChange={(e) => onZoomSlider(Number(e.target.value))}
        />
        <span className="wallpaper-focus-zoom__value" aria-hidden>
          {focus.zoom.toFixed(1)}×
        </span>
      </div>
    </GlassModal>
  );
}
