export const DEFAULT_MIN_MASK_SIZE = 0.025;
const GEOMETRY_EPSILON = 1e-12;

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ResizeHandle =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw";

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value));

const finite = (value: number): boolean => Number.isFinite(value);

/** Return whether a rectangle is finite, normalized, and non-empty. */
export function isNormalizedRect(
  rect: NormalizedRect,
  minimumSize = 0,
): boolean {
  if (
    !finite(rect.x) ||
    !finite(rect.y) ||
    !finite(rect.width) ||
    !finite(rect.height)
  ) {
    return false;
  }

  return (
    rect.x >= -GEOMETRY_EPSILON &&
    rect.y >= -GEOMETRY_EPSILON &&
    rect.width >= minimumSize - GEOMETRY_EPSILON &&
    rect.height >= minimumSize - GEOMETRY_EPSILON &&
    rect.x + rect.width <= 1 + GEOMETRY_EPSILON &&
    rect.y + rect.height <= 1 + GEOMETRY_EPSILON
  );
}

/**
 * Normalize an arbitrary rectangle without mutating it. The requested minimum
 * is capped at the normalized canvas size so callers cannot create an
 * impossible rectangle.
 */
export function normalizeRect(
  rect: NormalizedRect,
  minimumSize = DEFAULT_MIN_MASK_SIZE,
): NormalizedRect {
  const min = clamp(finite(minimumSize) ? minimumSize : DEFAULT_MIN_MASK_SIZE);
  const rawX = finite(rect.x) ? rect.x : 0;
  const rawY = finite(rect.y) ? rect.y : 0;
  const rawWidth = finite(rect.width) ? Math.abs(rect.width) : min;
  const rawHeight = finite(rect.height) ? Math.abs(rect.height) : min;
  const width = clamp(rawWidth, min, 1);
  const height = clamp(rawHeight, min, 1);

  return {
    x: clamp(rawX, 0, 1 - width),
    y: clamp(rawY, 0, 1 - height),
    width,
    height,
  };
}

export function rectFromPoints(
  start: NormalizedPoint,
  end: NormalizedPoint,
  minimumSize = DEFAULT_MIN_MASK_SIZE,
): NormalizedRect {
  const x1 = clamp(finite(start.x) ? start.x : 0);
  const y1 = clamp(finite(start.y) ? start.y : 0);
  const x2 = clamp(finite(end.x) ? end.x : x1);
  const y2 = clamp(finite(end.y) ? end.y : y1);

  return normalizeRect(
    {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    },
    minimumSize,
  );
}

export function moveRect(
  rect: NormalizedRect,
  deltaX: number,
  deltaY: number,
  minimumSize = DEFAULT_MIN_MASK_SIZE,
): NormalizedRect {
  const safe = normalizeRect(rect, minimumSize);
  return {
    ...safe,
    x: clamp(safe.x + (finite(deltaX) ? deltaX : 0), 0, 1 - safe.width),
    y: clamp(safe.y + (finite(deltaY) ? deltaY : 0), 0, 1 - safe.height),
  };
}

/** Resize one of eight handles while keeping the opposite edge anchored. */
export function resizeRect(
  rect: NormalizedRect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  minimumSize = DEFAULT_MIN_MASK_SIZE,
): NormalizedRect {
  const safe = normalizeRect(rect, minimumSize);
  const min = clamp(minimumSize);
  let left = safe.x;
  let top = safe.y;
  let right = safe.x + safe.width;
  let bottom = safe.y + safe.height;
  const dx = finite(deltaX) ? deltaX : 0;
  const dy = finite(deltaY) ? deltaY : 0;

  if (handle.includes("w")) {
    left = clamp(left + dx, 0, right - min);
  }
  if (handle.includes("e")) {
    right = clamp(right + dx, left + min, 1);
  }
  if (handle.includes("n")) {
    top = clamp(top + dy, 0, bottom - min);
  }
  if (handle.includes("s")) {
    bottom = clamp(bottom + dy, top + min, 1);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function containsPoint(
  rect: NormalizedRect,
  point: NormalizedPoint,
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function getHandlePoint(
  rect: NormalizedRect,
  handle: ResizeHandle,
): NormalizedPoint {
  const safe = normalizeRect(rect, 0);
  const horizontal = handle.includes("w")
    ? safe.x
    : handle.includes("e")
      ? safe.x + safe.width
      : safe.x + safe.width / 2;
  const vertical = handle.includes("n")
    ? safe.y
    : handle.includes("s")
      ? safe.y + safe.height
      : safe.y + safe.height / 2;
  return { x: horizontal, y: vertical };
}

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];
