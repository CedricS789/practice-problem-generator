import assert from "node:assert/strict";
import test from "node:test";

import {
  containsPoint,
  getHandlePoint,
  isNormalizedRect,
  moveRect,
  normalizeRect,
  rectFromPoints,
  resizeRect,
  RESIZE_HANDLES,
  type NormalizedRect,
} from "../src/geometry";

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

function assertRectClose(
  actual: NormalizedRect,
  expected: NormalizedRect,
): void {
  assertClose(actual.x, expected.x);
  assertClose(actual.y, expected.y);
  assertClose(actual.width, expected.width);
  assertClose(actual.height, expected.height);
}

test("normalizeRect clamps coordinates and preserves the input", () => {
  const input: NormalizedRect = Object.freeze({
    x: -0.2,
    y: 0.95,
    width: 0.4,
    height: 0.4,
  });
  const normalized = normalizeRect(input, 0.05);

  assert.deepEqual(normalized, { x: 0, y: 0.6, width: 0.4, height: 0.4 });
  assert.deepEqual(input, { x: -0.2, y: 0.95, width: 0.4, height: 0.4 });
  assert.equal(isNormalizedRect(normalized, 0.05), true);
});

test("normalizeRect replaces non-finite values", () => {
  const normalized = normalizeRect(
    { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 0, height: -0.2 },
    0.1,
  );
  assert.deepEqual(normalized, { x: 0, y: 0, width: 0.1, height: 0.2 });
});

test("moveRect remains inside normalized bounds", () => {
  const input = { x: 0.2, y: 0.2, width: 0.3, height: 0.4 };
  assert.deepEqual(moveRect(input, 2, -2), {
    x: 0.7,
    y: 0,
    width: 0.3,
    height: 0.4,
  });
  assert.deepEqual(input, { x: 0.2, y: 0.2, width: 0.3, height: 0.4 });
});

test("resizeRect anchors the opposite edge for all corner directions", () => {
  const input = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
  assertRectClose(resizeRect(input, "nw", 0.1, 0.1, 0.05), {
    x: 0.3,
    y: 0.3,
    width: 0.3,
    height: 0.3,
  });
  assertRectClose(resizeRect(input, "se", 0.2, 0.3, 0.05), {
    x: 0.2,
    y: 0.2,
    width: 0.6000000000000001,
    height: 0.7000000000000002,
  });
  assertRectClose(resizeRect(input, "w", 0.8, 0, 0.1), {
    x: 0.5000000000000001,
    y: 0.2,
    width: 0.09999999999999998,
    height: 0.4000000000000001,
  });
});

test("all eight resize handles remain bounded", () => {
  const input = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  for (const handle of RESIZE_HANDLES) {
    const resized = resizeRect(input, handle, 2, -2, 0.05);
    assert.equal(isNormalizedRect(resized, 0.05), true, handle);
  }
});

test("rectFromPoints accepts reverse dragging and enforces a minimum", () => {
  assert.deepEqual(rectFromPoints({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.3 }), {
    x: 0.2,
    y: 0.3,
    width: 0.6000000000000001,
    height: 0.39999999999999997,
  });
  assert.deepEqual(
    rectFromPoints({ x: 0.98, y: 0.98 }, { x: 0.98, y: 0.98 }, 0.05),
    { x: 0.95, y: 0.95, width: 0.05, height: 0.05 },
  );
});

test("point and handle helpers use normalized geometry", () => {
  const rect = { x: 0.1, y: 0.2, width: 0.4, height: 0.6 };
  assert.equal(containsPoint(rect, { x: 0.5, y: 0.8 }), true);
  assert.equal(containsPoint(rect, { x: 0.51, y: 0.8 }), false);
  const north = getHandlePoint(rect, "n");
  assertClose(north.x, 0.3);
  assertClose(north.y, 0.2);
  const southEast = getHandlePoint(rect, "se");
  assertClose(southEast.x, 0.5);
  assertClose(southEast.y, 0.8);
});

test("isNormalizedRect rejects invalid and out-of-bounds masks", () => {
  assert.equal(isNormalizedRect({ x: 0, y: 0, width: 1, height: 1 }), true);
  assert.equal(isNormalizedRect({ x: 0.9, y: 0, width: 0.2, height: 0.2 }), false);
  assert.equal(
    isNormalizedRect({ x: 0, y: 0, width: Number.NaN, height: 0.2 }),
    false,
  );
  assert.equal(isNormalizedRect({ x: 0, y: 0, width: 0, height: 0.2 }, 0.01), false);
});
