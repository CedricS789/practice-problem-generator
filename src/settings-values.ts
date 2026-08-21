import type { GifFramePositionV1 } from "./model";

export function normalizeGifFrameDefault(value: unknown): GifFramePositionV1 {
  return value === "first" || value === "last" ? value : "middle";
}
