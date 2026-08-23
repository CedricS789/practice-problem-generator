import { App } from "obsidian";
import type { MediaInput } from "./cli/contracts";
import {
  downloadRemoteImage,
  gifFrameAtPosition,
  persistSnapshot,
  persistPngSnapshot,
  readNotabilityPreview,
  readVaultBinary,
  sampleAnimatedFrames,
  type MediaToolOptions
} from "./media";
import type { GifFramePositionV1, VisualSourceV1 } from "./model";
import { applySelectedVisualFrame, type DetectedVisual } from "./visuals";
import { chooseFrame } from "./frame-picker";
import { confirmRemoteImageImport } from "./remote-import";

export interface PreparedVisual {
  readonly source: VisualSourceV1;
  readonly media: MediaInput;
}

export async function importRemoteVisual(app: App, visual: DetectedVisual): Promise<DetectedVisual> {
  if (visual.kind !== "remote-image" || !visual.remoteUrl || !visual.remoteHost) {
    throw new Error("This visual is not a valid remote image.");
  }
  const downloaded = await downloadRemoteImage({
    url: visual.remoteUrl,
    approvedHost: visual.remoteHost
  });
  if (!await confirmRemoteImageImport(app, downloaded)) return visual;
  const imported = await persistSnapshot(app, downloaded.bytes, downloaded.extension);
  const { reason: _discardedReason, ...withoutReason } = visual;
  return {
    ...withoutReason,
    state: imported.path.toLowerCase().endsWith(".gif") ? "frame-required" : "ready",
    selected: imported.path.toLowerCase().endsWith(".gif") ? false : true,
    resolvedPath: imported.path,
    mimeType: mimeFromPath(imported.path),
    previewUrl: app.vault.adapter.getResourcePath(imported.path)
  };
}

export async function chooseVisualFrame(
  app: App,
  visual: DetectedVisual,
  tools: MediaToolOptions,
  position?: GifFramePositionV1,
): Promise<DetectedVisual | null> {
  if (visual.kind !== "animated-gif" && visual.kind !== "video" && visual.kind !== "remote-image") {
    throw new Error("This visual does not require frame extraction.");
  }
  const frameSourcePath = visual.frameSourcePath ?? visual.resolvedPath;
  if (!frameSourcePath) throw new Error("The animation or video could not be resolved.");
  const extension = frameSourcePath.toLowerCase().endsWith(".gif") ? "gif" : "mp4";
  if (position !== undefined && extension !== "gif") {
    throw new Error("First, middle, and last defaults apply only to GIFs.");
  }
  const bytes = await readVaultBinary(app, frameSourcePath);
  const frames = await sampleAnimatedFrames(
    bytes,
    extension,
    tools,
    extension === "gif" ? 3 : 6,
  );
  const selected = position === undefined
    ? await chooseFrame(app, frames)
    : gifFrameAtPosition(frames, position);
  if (selected === null) return null;
  const snapshot = await persistPngSnapshot(app, selected.bytes);
  return applySelectedVisualFrame(visual, {
    snapshotPath: snapshot.path,
    previewUrl: app.vault.adapter.getResourcePath(snapshot.path),
    timeSeconds: selected.timeSeconds,
    ...(selected.position === undefined ? {} : { position: selected.position }),
    label: selected.label,
    usingDefault: position !== undefined,
  });
}

export async function prepareSelectedVisuals(
  app: App,
  visuals: readonly DetectedVisual[]
): Promise<readonly PreparedVisual[]> {
  const prepared: PreparedVisual[] = [];
  for (const visual of visuals.filter((candidate) => candidate.selected)) {
    if (visual.state !== "ready") throw new Error(`Visual ${visual.id} is not ready for generation.`);
    let vaultPath = visual.resolvedPath;
    let bytes: ArrayBuffer;
    let kind: VisualSourceV1["kind"];
    let storage: VisualSourceV1["storage"];
    let mimeType: VisualSourceV1["mimeType"];

    if (visual.kind === "notability-region") {
      if (!visual.region) throw new Error("Notability region metadata is missing.");
      bytes = await readNotabilityPreview(app, visual.region.regionId);
      const snapshot = await persistPngSnapshot(app, bytes);
      vaultPath = snapshot.path;
      kind = "notability-region";
      storage = "practice-snapshot";
      mimeType = "image/png";
    } else {
      if (!vaultPath) throw new Error(`Visual ${visual.id} has no resolved vault path.`);
      bytes = await readVaultBinary(app, vaultPath);
      mimeType = supportedMime(visual.mimeType ?? mimeFromPath(vaultPath));
      if (visual.kind === "animated-gif" || visual.framePosition !== undefined) {
        kind = "gif-frame";
        storage = "practice-snapshot";
        mimeType = "image/png";
      } else if (visual.kind === "video") {
        kind = "video-frame";
        storage = "practice-snapshot";
        mimeType = "image/png";
      } else if (visual.kind === "remote-image") {
        kind = "remote-snapshot";
        storage = "practice-snapshot";
      } else {
        kind = "image";
        storage = "source";
      }
    }

    if (!vaultPath) throw new Error(`Visual ${visual.id} has no durable vault path.`);
    const dimensions = await imageDimensions(bytes, mimeType);
    const hash = await binaryHash(bytes);
    const source: VisualSourceV1 = {
      id: visual.id,
      kind,
      vaultPath,
      storage,
      mimeType,
      contentHash: `sha256:${hash}`,
      width: dimensions.width,
      height: dimensions.height,
      ...(visual.sourceTarget === undefined ? {} : { sourceEmbed: visual.sourceTarget }),
      ...(visual.remoteHost === undefined ? {} : { remoteHost: visual.remoteHost }),
      ...(visual.frameTimeSeconds === undefined ? {} : { frameTimeSeconds: visual.frameTimeSeconds }),
      ...(visual.framePosition === undefined ? {} : { framePosition: visual.framePosition })
    };
    prepared.push({
      source,
      // Vault.readBinary already returns a job-owned ArrayBuffer. Retain that
      // exact buffer instead of duplicating every selected image in memory.
      media: { bytes, mimeType }
    });
  }
  return prepared;
}

async function binaryHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function imageDimensions(bytes: ArrayBuffer, mimeType: string): Promise<{ width: number; height: number }> {
  const blob = new Blob([bytes], { type: mimeType });
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width < 1 || bitmap.height < 1) throw new Error("The selected visual has invalid dimensions.");
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth < 1 || image.naturalHeight < 1) reject(new Error("The selected visual has invalid dimensions."));
      else resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected visual could not be decoded."));
    };
    image.src = url;
  });
}

function supportedMime(value: string): VisualSourceV1["mimeType"] {
  if (value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif") return value;
  throw new Error(`Unsupported image type for occlusion: ${value}`);
}

function mimeFromPath(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}
