'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { baseScaleFor, clampOffset, computeCropRect } from '@/lib/image-crop';

// Client-side crop before upload (V1): drag to reposition, a slider to
// zoom in, confirm to render the crop to a canvas and hand back a Blob —
// the ORIGINAL file is never uploaded, only this cropped output. Built on
// plain <canvas> + pointer events (no cropping library): the interaction
// surface here (pan/zoom one image against a fixed-ratio frame) is small
// enough that a dependency would cost more in bundle size and long-term
// maintenance than it saves — see the PR description for the full
// bundle-size/security/maintenance comparison against react-easy-crop.
const MAX_VIEWPORT_WIDTH = 480;

export function ImageCropModal({
  file,
  aspectRatio,
  outputWidth,
  onCancel,
  onConfirm,
  onSkip,
}: {
  file: File;
  // Width / height, e.g. 16/9 for banners.
  aspectRatio: number;
  // Output canvas width in pixels; height is derived from aspectRatio.
  outputWidth: number;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  // QA round (2026-11-23): cropping is OPTIONAL — this modal used to be
  // the only path from "file selected" to "uploaded," forcing every
  // banner through a crop to a fixed ratio even when the merchant's
  // original (e.g. a 16:9 photo with text already composed in it) would
  // lose content being forced into 16:5. Passing onSkip hands the
  // ORIGINAL file straight back, unmodified — the caller still runs it
  // through the normal compress/resize pipeline, it just skips this
  // crop entirely.
  onSkip?: (file: File) => void;
}) {
  const [viewportWidth, setViewportWidth] = useState(MAX_VIEWPORT_WIDTH);
  const viewportHeight = viewportWidth / aspectRatio;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const zoomRef = useRef(1);
  const hasInteractedRef = useRef(false);
  // Created and revoked in the SAME effect, paired 1:1 — not split across
  // a useMemo (computing the URL) and a separate useEffect (revoking it).
  // That split let Strict Mode's dev-only double-invoke create a second
  // object URL whose own revoke never ran in sync with it, leaking one
  // blob: URL per crop and surfacing as the stray "Failed to load
  // resource: net::ERR_FILE_NOT_FOUND" console errors a merchant sees
  // after cropping. URL.createObjectURL is a side effect (it allocates a
  // live browser resource), so it belongs in an effect, never in render.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    // This IS "synchronize with an external system": URL.createObjectURL
    // allocates a live browser resource with no synchronous, render-safe
    // way to produce it (unlike a pure computation), so it cannot move
    // into useMemo or a lazy useState initializer without reintroducing
    // the Strict Mode double-invoke leak this effect exists to avoid.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.min(MAX_VIEWPORT_WIDTH, entry.contentRect.width);
      setViewportWidth((current) => (current === width ? current : width));

      const naturalSize = naturalSizeRef.current;
      if (!naturalSize) return;
      const height = width / aspectRatio;
      const baseScale = baseScaleFor(width, height, naturalSize.width, naturalSize.height);
      if (!hasInteractedRef.current) {
        setZoom(1);
        zoomRef.current = 1;
        setOffset({
          x: (width - naturalSize.width * baseScale) / 2,
          y: (height - naturalSize.height * baseScale) / 2,
        });
      } else {
        setOffset((previous) =>
          clampOffset(
            previous,
            width,
            height,
            naturalSize.width,
            naturalSize.height,
            baseScale * zoomRef.current,
          ),
        );
      }
    });

    observer.observe(viewport);
    return () => observer.disconnect();
  }, [aspectRatio]);

  const baseScale = naturalSize
    ? baseScaleFor(viewportWidth, viewportHeight, naturalSize.width, naturalSize.height)
    : 1;
  const scale = baseScale * zoom;

  function handleImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    naturalSizeRef.current = { width, height };
    setNaturalSize({ width, height });
    // Center the image in the frame at the initial "cover" zoom.
    const initialScale = baseScaleFor(viewportWidth, viewportHeight, width, height);
    setOffset({
      x: (viewportWidth - width * initialScale) / 2,
      y: (viewportHeight - height * initialScale) / 2,
    });
  }

  function clamp(next: { x: number; y: number }, nextScale: number = scale) {
    if (!naturalSize) return next;
    return clampOffset(
      next,
      viewportWidth,
      viewportHeight,
      naturalSize.width,
      naturalSize.height,
      nextScale,
    );
  }

  function handlePointerDown(e: React.PointerEvent) {
    hasInteractedRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging({ startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const next = {
      x: dragging.originX + (e.clientX - dragging.startX),
      y: dragging.originY + (e.clientY - dragging.startY),
    };
    setOffset(clamp(next));
  }

  function handlePointerUp() {
    setDragging(null);
  }

  function handleZoomChange(nextZoom: number) {
    hasInteractedRef.current = true;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    setOffset((prev) => clamp(prev, baseScale * nextZoom));
  }

  const outputHeight = useMemo(
    () => Math.round(outputWidth / aspectRatio),
    [outputWidth, aspectRatio],
  );

  async function handleConfirm() {
    const img = imgRef.current;
    if (!img || !naturalSize) return;
    setConfirming(true);
    try {
      const rect = computeCropRect({
        viewportWidth,
        viewportHeight,
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
        scale,
        offsetX: offset.x,
        offsetY: offset.y,
      });
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported.');
      ctx.drawImage(
        img,
        rect.sourceX,
        rect.sourceY,
        rect.sourceWidth,
        rect.sourceHeight,
        0,
        0,
        outputWidth,
        outputHeight,
      );
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      );
      if (!blob) throw new Error('Failed to render crop.');
      onConfirm(blob);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crop image"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-lg bg-surface p-4">
        <div
          className="relative mx-auto touch-none overflow-hidden rounded-md bg-surface-muted"
          style={{ width: '100%', maxWidth: MAX_VIEWPORT_WIDTH, aspectRatio }}
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {objectUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- source for canvas drawImage, not a displayed <Image>
            <img
              ref={imgRef}
              src={objectUrl}
              alt=""
              onLoad={handleImageLoad}
              draggable={false}
              className="absolute select-none"
              style={{
                left: 0,
                top: 0,
                width: naturalSize ? naturalSize.width * scale : undefined,
                height: naturalSize ? naturalSize.height * scale : undefined,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                cursor: dragging ? 'grabbing' : 'grab',
              }}
            />
          )}
        </div>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            disabled={!naturalSize}
          />
        </label>

        {onSkip && (
          <p className="text-xs text-muted-foreground">
            Cắt ảnh là tuỳ chọn — bỏ qua để giữ nguyên ảnh gốc, chỉ cắt nếu bạn muốn khung vừa khít tỉ lệ khuyến nghị.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3.5 py-1.5 text-sm transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!naturalSize || confirming}
            className="rounded-md border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            {confirming ? 'Cropping…' : 'Cắt theo tỉ lệ khuyến nghị'}
          </button>
          {onSkip && (
            <button
              type="button"
              autoFocus
              onClick={() => onSkip(file)}
              className="rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              Giữ nguyên ảnh gốc
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
