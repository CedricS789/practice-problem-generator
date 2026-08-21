import type { GifFramePositionV1 } from "./model";

export const DEFAULT_AI_TIMEOUT_MS = 3 * 60 * 60 * 1_000;
export const MIN_AI_TIMEOUT_MS = 60 * 1_000;
export const MAX_AI_TIMEOUT_MS = 12 * 60 * 60 * 1_000;

export function normalizeGifFrameDefault(value: unknown): GifFramePositionV1 {
  return value === "first" || value === "last" ? value : "middle";
}

export function normalizeAiTimeout(
  value: unknown,
  legacyDefault: number,
  migrateLegacy: boolean,
): number {
  if (migrateLegacy && (value === undefined || value === legacyDefault)) {
    return DEFAULT_AI_TIMEOUT_MS;
  }
  return Number.isFinite(value)
    ? Math.min(MAX_AI_TIMEOUT_MS, Math.max(MIN_AI_TIMEOUT_MS, value as number))
    : DEFAULT_AI_TIMEOUT_MS;
}
