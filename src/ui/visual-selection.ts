import type { DetectedVisual } from "../visuals";
import type { GifFramePosition } from "./contracts";

export interface BulkVisualSelectionResult {
  readonly visuals: readonly DetectedVisual[];
  readonly selectedCount: number;
  readonly skippedCount: number;
  readonly failures: readonly {
    readonly visualId: string;
    readonly message: string;
  }[];
}

export function isGifVisual(visual: DetectedVisual): boolean {
  return visual.kind === "animated-gif"
    || visual.mimeType === "image/gif"
    || visual.framePosition !== undefined;
}

export async function selectAllVisuals(
  input: readonly DetectedVisual[],
  gifFrameDefault: GifFramePosition,
  resolveGif?: (
    visual: DetectedVisual,
    position: GifFramePosition,
  ) => Promise<DetectedVisual | null>,
): Promise<BulkVisualSelectionResult> {
  const visuals = input.map((visual) => ({ ...visual }));
  const failures: Array<{ visualId: string; message: string }> = [];
  let skippedCount = 0;

  for (const [index, visual] of visuals.entries()) {
    if (visual.state === "ready") {
      visuals[index] = { ...visual, selected: true };
      continue;
    }
    if (
      visual.state === "frame-required"
      && isGifVisual(visual)
      && resolveGif !== undefined
    ) {
      try {
        const resolved = await resolveGif(visual, gifFrameDefault);
        if (resolved !== null) {
          visuals[index] = { ...resolved, selected: true };
          continue;
        }
      } catch (error) {
        failures.push({
          visualId: visual.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    skippedCount += 1;
  }

  return {
    visuals,
    selectedCount: visuals.filter((visual) => visual.selected).length,
    skippedCount,
    failures,
  };
}
