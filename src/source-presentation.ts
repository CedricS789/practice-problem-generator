import type { SourcePresentation } from "./ui/contracts";
import type { DetectedVisual, NotabilityRegionData } from "./visuals";

/**
 * Keep durable and provider-facing source metadata separate from Obsidian's
 * runtime objects. CollectedSource structurally extends SourcePresentation, so
 * returning or spreading it can accidentally retain a circular TFile graph.
 */
export function snapshotSourcePresentation(
  source: SourcePresentation,
): SourcePresentation {
  return {
    mode: source.mode,
    title: source.title,
    path: source.path,
    characterCount: source.characterCount,
    excerpt: source.excerpt,
    ...(source.detail === undefined ? {} : { detail: source.detail }),
    ...(source.pdfPageSelection === undefined
      ? {}
      : {
          pdfPageSelection: {
            firstPage: source.pdfPageSelection.firstPage,
            lastPage: source.pdfPageSelection.lastPage,
            documentPageCount: source.pdfPageSelection.documentPageCount,
          },
        }),
    visuals: source.visuals.map(snapshotDetectedVisual),
  };
}

function snapshotDetectedVisual(visual: DetectedVisual): DetectedVisual {
  return {
    id: visual.id,
    kind: visual.kind,
    state: visual.state,
    start: visual.start,
    end: visual.end,
    selected: visual.selected,
    ...(visual.sourceTarget === undefined ? {} : { sourceTarget: visual.sourceTarget }),
    ...(visual.resolvedPath === undefined ? {} : { resolvedPath: visual.resolvedPath }),
    ...(visual.previewUrl === undefined ? {} : { previewUrl: visual.previewUrl }),
    ...(visual.mimeType === undefined ? {} : { mimeType: visual.mimeType }),
    ...(visual.remoteUrl === undefined ? {} : { remoteUrl: visual.remoteUrl }),
    ...(visual.remoteHost === undefined ? {} : { remoteHost: visual.remoteHost }),
    ...(visual.region === undefined ? {} : { region: snapshotRegion(visual.region) }),
    ...(visual.frameSourcePath === undefined ? {} : { frameSourcePath: visual.frameSourcePath }),
    ...(visual.frameTimeSeconds === undefined ? {} : { frameTimeSeconds: visual.frameTimeSeconds }),
    ...(visual.framePosition === undefined ? {} : { framePosition: visual.framePosition }),
    ...(visual.reason === undefined ? {} : { reason: visual.reason }),
  };
}

function snapshotRegion(region: NotabilityRegionData): NotabilityRegionData {
  return {
    version: region.version,
    regionId: region.regionId,
    ...(region.title === undefined ? {} : { title: region.title }),
    ...(region.page === undefined ? {} : { page: region.page }),
    ...(region.sourceUrl === undefined ? {} : { sourceUrl: region.sourceUrl }),
    ...(region.rect === undefined
      ? {}
      : {
          rect: {
            x: region.rect.x,
            y: region.rect.y,
            width: region.rect.width,
            height: region.rect.height,
          },
        }),
  };
}
