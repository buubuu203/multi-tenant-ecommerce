// Pure crop-geometry math, extracted from ImageCropModal.tsx so it's
// testable without a browser/DOM. Coordinates: the "viewport" is the
// fixed-size crop frame shown to the admin; `offset` is the displayed
// image's top-left corner in viewport pixels; `scale` is how many
// viewport pixels one natural image pixel occupies (so image size on
// screen = naturalSize * scale).

export type CropGeometry = {
  viewportWidth: number;
  viewportHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type CropRect = { sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number };

/**
 * The minimum scale at which the image fully covers the viewport in both
 * dimensions (same idea as CSS `object-fit: cover`) — this is zoom = 1;
 * the admin can only zoom IN from here, never below cover, so the crop
 * frame is never left showing empty space.
 */
export function baseScaleFor(viewportWidth: number, viewportHeight: number, naturalWidth: number, naturalHeight: number): number {
  return Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
}

/**
 * Clamps a pan offset so the scaled image always fully covers the
 * viewport — the crop frame can never show a gap past the image's edge
 * on any side.
 */
export function clampOffset(
  offset: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  scale: number,
): { x: number; y: number } {
  const scaledWidth = naturalWidth * scale;
  const scaledHeight = naturalHeight * scale;
  const minX = Math.min(0, viewportWidth - scaledWidth);
  const minY = Math.min(0, viewportHeight - scaledHeight);
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  };
}

/**
 * Converts the current viewport/scale/offset state into a crop rectangle
 * expressed in the SOURCE image's natural pixel coordinates — exactly
 * what `CanvasRenderingContext2D.drawImage`'s source-rect arguments need
 * to render only the visible crop region.
 */
export function computeCropRect(g: CropGeometry): CropRect {
  return {
    sourceX: -g.offsetX / g.scale,
    sourceY: -g.offsetY / g.scale,
    sourceWidth: g.viewportWidth / g.scale,
    sourceHeight: g.viewportHeight / g.scale,
  };
}
