import { test } from "node:test";
import assert from "node:assert/strict";
import { baseScaleFor, clampOffset, computeCropRect } from "../src/lib/image-crop";

test("baseScaleFor picks the covering (larger) ratio when width is binding", () => {
  const scale = baseScaleFor(400, 100, 1000, 1000);
  assert.equal(scale, 0.4);
});

test("baseScaleFor picks the covering (larger) ratio when height is binding", () => {
  const scale = baseScaleFor(400, 100, 200, 1000);
  assert.equal(scale, 2);
});

test("clampOffset snaps back to (0, 0) when there is no overflow to pan within", () => {
  const clamped = clampOffset({ x: 50, y: -50 }, 400, 100, 400, 100, 1);
  assert.deepEqual(clamped, { x: 0, y: 0 });
});

test("clampOffset allows panning within the available overflow margin", () => {
  const clamped = clampOffset({ x: -200, y: -50 }, 400, 100, 800, 200, 1);
  assert.deepEqual(clamped, { x: -200, y: -50 });
});

test("clampOffset rejects panning past either edge of the image", () => {
  const clampedRight = clampOffset({ x: 100, y: 100 }, 400, 100, 800, 200, 1);
  assert.deepEqual(clampedRight, { x: 0, y: 0 });
  const clampedLeft = clampOffset({ x: -500, y: -300 }, 400, 100, 800, 200, 1);
  assert.deepEqual(clampedLeft, { x: -400, y: -100 });
});

test("computeCropRect converts viewport/offset/scale into natural-pixel source coordinates", () => {
  const rect = computeCropRect({
    viewportWidth: 400,
    viewportHeight: 100,
    naturalWidth: 1000,
    naturalHeight: 1000,
    scale: 2,
    offsetX: -100,
    offsetY: -20,
  });
  assert.deepEqual(rect, { sourceX: 50, sourceY: 10, sourceWidth: 200, sourceHeight: 50 });
});
