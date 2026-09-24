"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { baseScaleFor, clampOffset, computeCropRect } from "@/lib/image-crop";

// Client-side crop before upload (V1): drag to reposition, a slider to
// zoom in, confirm to render the crop to a canvas and hand back a Blob —
// the ORIGINAL file is never uploaded, only this cropped output. Built on
// plain <canvas> + pointer events (no cropping library): the interaction
// surface here (pan/zoom one image against a fixed-ratio frame) is small
// enough that a dependency would cost more in bundle size and long-term
// maintenance than it saves — see the PR description for the full
// bundle-size/security/maintenance comparison against react-easy-crop.
const VIEWPORT_WIDTH = 480;

export function ImageCropModal({
  file,
  aspectRatio,
  outputWidth,
  onCancel,
  onConfirm,
}: {
  file: File;
  // width / height, e.g. 21/9 for desktop, 4/3 for mobile.
  aspectRatio: number;
  // Output canvas width in pixels; height is derived from aspectRatio.
  outputWidth: number;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const viewportHeight = Math.round(VIEWPORT_WIDTH / aspectRatio);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Derived synchronously (not via setState-in-effect) — a fresh File
  // always produces a fresh URL, so this is a pure function of props. The
  // effect below exists ONLY for the revoke-on-cleanup side effect.
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const baseScale = naturalSize ? baseScaleFor(VIEWPORT_WIDTH, viewportHeight, naturalSize.width, naturalSize.height) : 1;
  const scale = baseScale * zoom;

  function handleImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    setNaturalSize({ width, height });
    // Center the image in the frame at the initial "cover" zoom.
    const initialScale = baseScaleFor(VIEWPORT_WIDTH, viewportHeight, width, height);
    setOffset({
      x: (VIEWPORT_WIDTH - width * initialScale) / 2,
      y: (viewportHeight - height * initialScale) / 2,
    });
  }

  function clamp(next: { x: number; y: number }, nextScale: number = scale) {
    if (!naturalSize) return next;
    return clampOffset(next, VIEWPORT_WIDTH, viewportHeight, naturalSize.width, naturalSize.height, nextScale);
  }

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging({ startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const next = { x: dragging.originX + (e.clientX - dragging.startX), y: dragging.originY + (e.clientY - dragging.startY) };
    setOffset(clamp(next));
  }

  function handlePointerUp() {
    setDragging(null);
  }

  function handleZoomChange(nextZoom: number) {
    setZoom(nextZoom);
    setOffset((prev) => clamp(prev, baseScale * nextZoom));
  }

  const outputHeight = useMemo(() => Math.round(outputWidth / aspectRatio), [outputWidth, aspectRatio]);

  async function handleConfirm() {
    const img = imgRef.current;
    if (!img || !naturalSize) return;
    setConfirming(true);
    try {
      const rect = computeCropRect({
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight,
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
        scale,
        offsetX: offset.x,
        offsetY: offset.y,
      });
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported.");
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
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Failed to render crop.");
      onConfirm(blob);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Crop image">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-lg bg-surface p-4">
        <div
          className="relative mx-auto touch-none overflow-hidden rounded-md bg-surface-muted"
          style={{ width: VIEWPORT_WIDTH, height: viewportHeight, maxWidth: "100%" }}
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
                cursor: dragging ? "grabbing" : "grab",
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

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3.5 py-1.5 text-sm transition-colors hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!naturalSize || confirming}
            className="rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {confirming ? "Cropping…" : "Confirm crop"}
          </button>
        </div>
      </div>
    </div>
  );
}
