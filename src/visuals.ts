import {
  DEFAULT_MIN_MASK_SIZE,
  isNormalizedRect,
  type NormalizedRect,
} from "./geometry";
import type { GifFramePositionV1 } from "./model";
import { latexMarkupProblem } from "./latex";

export type VisualKind =
  | "static-image"
  | "animated-gif"
  | "video"
  | "remote-image"
  | "notability-region";

export type VisualState =
  | "ready"
  | "missing"
  | "frame-required"
  | "consent-required"
  | "cache-missing"
  | "invalid";

export interface LocalVisualResolution {
  readonly exists: boolean;
  readonly path?: string;
  readonly mimeType?: string;
  readonly previewUrl?: string;
}

export interface NotabilityRegionData {
  readonly version: number;
  readonly regionId: string;
  readonly title?: string;
  readonly page?: number;
  readonly sourceUrl?: string;
  readonly rect?: NormalizedRect;
}

export interface NotabilityVisualResolution {
  readonly cachePath?: string;
  readonly previewUrl?: string;
}

export interface DetectedVisual {
  readonly id: string;
  readonly kind: VisualKind;
  readonly state: VisualState;
  readonly start: number;
  readonly end: number;
  readonly selected: boolean;
  readonly sourceTarget?: string;
  readonly resolvedPath?: string;
  readonly previewUrl?: string;
  readonly mimeType?: string;
  readonly remoteUrl?: string;
  readonly remoteHost?: string;
  readonly region?: NotabilityRegionData;
  /** Durable source GIF/video path retained after a PNG frame is extracted. */
  readonly frameSourcePath?: string;
  readonly frameTimeSeconds?: number;
  readonly framePosition?: GifFramePositionV1;
  readonly reason?: string;
}

export interface VisualDetectionOptions {
  readonly resolveLocal?: (
    target: string,
  ) => LocalVisualResolution | null | undefined;
  readonly resolveNotability?: (
    region: NotabilityRegionData,
  ) => NotabilityVisualResolution | null | undefined;
}

export interface OcclusionMaskCandidate extends NormalizedRect {
  readonly id: string;
  readonly label: string;
  readonly answer: string;
}

export interface SelectedVisualFrame {
  readonly snapshotPath: string;
  readonly previewUrl: string;
  readonly timeSeconds: number;
  readonly position?: GifFramePositionV1;
  readonly label: string;
  readonly usingDefault: boolean;
}

export function applySelectedVisualFrame(
  visual: DetectedVisual,
  frame: SelectedVisualFrame,
): DetectedVisual {
  const frameSourcePath = visual.frameSourcePath ?? visual.resolvedPath;
  if (frameSourcePath === undefined) {
    throw new Error("The original animation or video path is missing.");
  }
  const {
    framePosition: _previousPosition,
    frameTimeSeconds: _previousTime,
    reason: _previousReason,
    ...base
  } = visual;
  void _previousPosition;
  void _previousTime;
  void _previousReason;
  return {
    ...base,
    state: "ready",
    selected: true,
    resolvedPath: frame.snapshotPath,
    frameSourcePath,
    mimeType: "image/png",
    previewUrl: frame.previewUrl,
    frameTimeSeconds: frame.timeSeconds,
    ...(frame.position === undefined ? {} : { framePosition: frame.position }),
    reason: frame.usingDefault
      ? `Using default ${frame.label}`
      : `Selected ${frame.label}`,
  };
}

export interface MaskValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const STATIC_IMAGE_EXTENSIONS = new Set([
  "jpeg",
  "jpg",
  "png",
  "webp",
]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mkv", "mov", "mp4", "webm"]);

function extensionOf(target: string): string {
  const withoutQuery = target.split(/[?#]/u, 1)[0] ?? target;
  const match = /\.([a-zA-Z0-9]+)$/u.exec(withoutQuery.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function kindForLocalTarget(target: string): VisualKind | null {
  const extension = extensionOf(target);
  if (extension === "gif") return "animated-gif";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (STATIC_IMAGE_EXTENSIONS.has(extension)) return "static-image";
  return null;
}

function visualId(kind: VisualKind, start: number, value: string): string {
  let hash = 2_166_136_261;
  const input = `${kind}:${start}:${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `visual-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function decodeTarget(target: string): string {
  const trimmed = target.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function isRemote(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function remoteRecord(
  url: string,
  start: number,
  end: number,
): DetectedVisual {
  try {
    const parsed = new URL(url);
    return {
      id: visualId("remote-image", start, parsed.href),
      kind: "remote-image",
      state: "consent-required",
      start,
      end,
      selected: false,
      remoteUrl: parsed.href,
      remoteHost: parsed.host,
    };
  } catch {
    return {
      id: visualId("remote-image", start, url),
      kind: "remote-image",
      state: "invalid",
      start,
      end,
      selected: false,
      reason: "The remote image URL is malformed.",
    };
  }
}

function localRecord(
  target: string,
  kind: VisualKind,
  start: number,
  end: number,
  resolver: VisualDetectionOptions["resolveLocal"],
): DetectedVisual {
  const resolution = resolver?.(target);
  const found = resolution?.exists === true;
  const needsFrame = kind === "animated-gif" || kind === "video";
  return {
    id: visualId(kind, start, target),
    kind,
    state: found ? (needsFrame ? "frame-required" : "ready") : "missing",
    start,
    end,
    selected: false,
    sourceTarget: target,
    ...(resolution?.path === undefined
      ? {}
      : { resolvedPath: resolution.path }),
    ...(resolution?.mimeType === undefined
      ? {}
      : { mimeType: resolution.mimeType }),
    ...(resolution?.previewUrl === undefined
      ? {}
      : { previewUrl: resolution.previewUrl }),
    ...(found ? {} : { reason: "The local attachment could not be resolved." }),
  };
}

function parseNotabilityRegion(value: unknown): NotabilityRegionData | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (record.v !== 1) return null;

  const result: {
    version: number;
    regionId: string;
    title?: string;
    page?: number;
    sourceUrl?: string;
    rect?: NormalizedRect;
  } = {
    version: 1,
    regionId: record.id,
  };
  if (typeof record.title === "string") result.title = record.title;
  if (typeof record.page === "number" && Number.isFinite(record.page)) {
    result.page = record.page;
  }
  if (typeof record.url === "string") result.sourceUrl = record.url;

  if (typeof record.rect === "object" && record.rect !== null) {
    const rect = record.rect as Record<string, unknown>;
    if (
      typeof rect.x === "number" &&
      typeof rect.y === "number" &&
      typeof rect.width === "number" &&
      typeof rect.height === "number"
    ) {
      const candidate: NormalizedRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      if (isNormalizedRect(candidate)) result.rect = candidate;
    }
  }

  return result;
}

/**
 * Detect supported visual embeds without retaining any surrounding note text.
 * Resolution remains caller-owned so this module can stay independent of the
 * Obsidian API and work in mobile bundles.
 */
export function detectVisuals(
  markdown: string,
  options: VisualDetectionOptions = {},
): readonly DetectedVisual[] {
  const visuals: DetectedVisual[] = [];
  const occupied: Array<readonly [number, number]> = [];

  const wikiEmbed = /!\[\[([^\]\n]+)\]\]/gu;
  for (const match of markdown.matchAll(wikiEmbed)) {
    const raw = match[1];
    const start = match.index;
    if (raw === undefined || start === undefined) continue;
    const target = decodeTarget((raw.split("|", 1)[0] ?? "").split("#", 1)[0] ?? "");
    const kind = kindForLocalTarget(target);
    if (kind === null) continue;
    const end = start + match[0].length;
    visuals.push(localRecord(target, kind, start, end, options.resolveLocal));
    occupied.push([start, end]);
  }

  const markdownImage = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"'\n]*["'])?\s*\)/gu;
  for (const match of markdown.matchAll(markdownImage)) {
    const start = match.index;
    if (start === undefined) continue;
    const end = start + match[0].length;
    if (occupied.some(([from, to]) => start < to && end > from)) continue;
    const target = decodeTarget(match[1] ?? match[2] ?? "");
    if (isRemote(target)) {
      visuals.push(remoteRecord(target, start, end));
      continue;
    }
    const kind = kindForLocalTarget(target);
    if (kind !== null) {
      visuals.push(localRecord(target, kind, start, end, options.resolveLocal));
    }
  }

  const notabilityBlock = /```notability-region\s*\r?\n([\s\S]*?)\r?\n```/gu;
  for (const match of markdown.matchAll(notabilityBlock)) {
    const start = match.index;
    const payload = match[1];
    if (start === undefined || payload === undefined) continue;
    const end = start + match[0].length;
    try {
      const region = parseNotabilityRegion(JSON.parse(payload) as unknown);
      if (region === null) {
        visuals.push({
          id: visualId("notability-region", start, payload),
          kind: "notability-region",
          state: "invalid",
          start,
          end,
          selected: false,
          reason: "The notability-region block is not a supported v1 block.",
        });
        continue;
      }
      const resolution = options.resolveNotability?.(region);
      const cachePath = resolution?.cachePath;
      visuals.push({
        id: visualId("notability-region", start, region.regionId),
        kind: "notability-region",
        state: cachePath === undefined ? "cache-missing" : "ready",
        start,
        end,
        selected: false,
        region,
        ...(cachePath === undefined ? {} : { resolvedPath: cachePath }),
        ...(resolution?.previewUrl === undefined
          ? {}
          : { previewUrl: resolution.previewUrl }),
        ...(cachePath === undefined
          ? { reason: "No Notability Live Region preview is currently cached." }
          : {}),
      });
    } catch {
      visuals.push({
        id: visualId("notability-region", start, payload),
        kind: "notability-region",
        state: "invalid",
        start,
        end,
        selected: false,
        reason: "The notability-region JSON is malformed.",
      });
    }
  }

  return visuals.sort((left, right) => left.start - right.start);
}

export function setVisualSelected(
  visuals: readonly DetectedVisual[],
  id: string,
  selected: boolean,
): readonly DetectedVisual[] {
  return visuals.map<DetectedVisual>((visual) =>
    visual.id === id ? { ...visual, selected } : { ...visual },
  );
}

export function acceptRemoteSnapshot(
  visuals: readonly DetectedVisual[],
  id: string,
  localSnapshotPath: string,
): readonly DetectedVisual[] {
  return visuals.map<DetectedVisual>((visual) => {
    if (visual.id !== id || visual.kind !== "remote-image") return { ...visual };
    const { reason: _reason, ...record } = visual;
    void _reason;
    return {
      ...record,
      state: "ready",
      selected: true,
      resolvedPath: localSnapshotPath,
    };
  });
}

export function validateOcclusionMasks(
  masks: readonly OcclusionMaskCandidate[],
): MaskValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, mask] of masks.entries()) {
    const location = `Mask ${index + 1}`;
    if (mask.id.trim().length === 0) errors.push(`${location} has no id.`);
    if (ids.has(mask.id)) errors.push(`${location} duplicates id ${mask.id}.`);
    ids.add(mask.id);
    if (mask.label.trim().length === 0) errors.push(`${location} has no label.`);
    if (mask.answer.trim().length === 0) errors.push(`${location} has no answer.`);
    const labelLatexProblem = latexMarkupProblem(mask.label);
    if (labelLatexProblem !== null) {
      errors.push(`${location} label LaTeX: ${labelLatexProblem}`);
    }
    const answerLatexProblem = latexMarkupProblem(mask.answer);
    if (answerLatexProblem !== null) {
      errors.push(`${location} answer LaTeX: ${answerLatexProblem}`);
    }
    if (!isNormalizedRect(mask, DEFAULT_MIN_MASK_SIZE)) {
      errors.push(`${location} is outside normalized image bounds.`);
    }
  }
  return { valid: errors.length === 0, errors };
}
