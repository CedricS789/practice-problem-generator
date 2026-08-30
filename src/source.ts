import { App, TFile, normalizePath } from "obsidian";
import { prepareSource, type SegmentedSourceV1 } from "./segmenter";
import type {
  PracticeBankV2,
  SourceMaterialClassificationStateV1,
  SourceMaterialClassificationV1,
  VisualSourceV1,
} from "./model";
import {
  suggestSourceClassification,
  type SourceClassificationSelectionV1,
  type SourceClassificationRulesV1,
} from "./source-classification";
import type { PdfExtractionResult } from "./pdf-tools";
import {
  createPdfSourceImport,
  type PdfSourceImportV1,
} from "./source-import";
import type {
  MarkdownSourceMode,
  SourcePresentation,
} from "./ui/contracts";
import {
  detectVisuals,
  type DetectedVisual,
  type LocalVisualResolution,
  type NotabilityRegionData
} from "./visuals";

export interface CollectedSource extends SourcePresentation, SegmentedSourceV1 {
  readonly file: TFile;
  readonly submittedText: string;
  readonly sourceImport?: PdfSourceImportV1;
  /**
   * Source kind is independent from primary/supporting ownership. Suggested
   * labels are presentation help only; only a confirmed label may establish
   * course authority in the alignment pipeline.
   */
  readonly classification?: SourceMaterialClassificationV1;
  readonly classificationState?: SourceMaterialClassificationStateV1;
}

export async function collectSource(
  app: App,
  mode: MarkdownSourceMode,
  selection?: string,
  classificationRules?: SourceClassificationRulesV1,
): Promise<CollectedSource> {
  const file = app.workspace.getActiveFile();
  if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
    throw new Error("Open a Markdown source note before using Practice Problem Generator.");
  }
  return collectSourceFromFile(app, file, mode, selection, classificationRules);
}

export async function collectSourceFromFile(
  app: App,
  file: TFile,
  mode: MarkdownSourceMode,
  selection?: string,
  classificationRules?: SourceClassificationRulesV1,
): Promise<CollectedSource> {
  if (/(?:^|\/)Practice(?:\/|$)/iu.test(file.path)) {
    throw new Error("A Practice Problem Generator bank cannot be used as its own source note.");
  }
  const submittedText = mode === "selection" ? selection ?? "" : await app.vault.cachedRead(file);
  if (mode === "selection" && submittedText.trim().length === 0) {
    throw new Error("Select some note text before generating from a selection.");
  }
  if (submittedText.trim().length < 20) {
    throw new Error("The source is too short to support grounded practice problems.");
  }

  const cacheEntries = await loadNotabilityCacheEntries(app);
  const visuals = detectVisuals(submittedText, {
    resolveLocal: (target) => resolveLocalVisual(app, file, target),
    resolveNotability: (region) => resolveNotability(app, cacheEntries, region)
  });
  const prepared = prepareSource(submittedText);
  if (prepared.segments.length === 0) {
    throw new Error("Practice Problem Generator could not find any headings or paragraphs in this source.");
  }

  const classification = suggestedSourceClassification(
    app,
    file,
    mode,
    classificationRules,
  );
  return {
    mode,
    title: file.basename,
    path: file.path,
    characterCount: submittedText.length,
    excerpt: createExcerpt(submittedText),
    visuals,
    file,
    submittedText,
    ...classification,
    ...prepared
  };
}

export function collectPdfSource(
  file: TFile,
  extraction: PdfExtractionResult,
  classificationRules?: SourceClassificationRulesV1,
): CollectedSource {
  if (file.extension.toLowerCase() !== "pdf") {
    throw new Error("Choose a PDF file before extracting a PDF source.");
  }
  const prepared = prepareSource(extraction.text);
  if (prepared.segments.length === 0) {
    throw new Error("Practice Problem Generator could not segment the extracted PDF text.");
  }
  const sourceImport = createPdfSourceImport({
    sourceHash: prepared.hash,
    pdfContentHash: extraction.pdfContentHash,
    firstPage: extraction.firstPage,
    lastPage: extraction.lastPage,
    pageCount: extraction.pageCount,
    extractedAt: new Date().toISOString(),
  });
  const classification = suggestSourceClassification({
    mode: "pdf",
    path: file.path,
    title: file.basename,
    ...(classificationRules === undefined ? {} : { rules: classificationRules }),
  });
  return {
    mode: "pdf",
    title: file.basename,
    path: file.path,
    characterCount: extraction.characterCount,
    excerpt: createExcerpt(extraction.text),
    detail: pdfSourceDetail(sourceImport),
    pdfPageSelection: {
      firstPage: sourceImport.firstPage,
      lastPage: sourceImport.lastPage,
      documentPageCount: sourceImport.pageCount,
    },
    visuals: [],
    file,
    submittedText: extraction.text,
    sourceImport,
    ...classification,
    ...prepared,
  };
}

/** Return an immutable source copy after the user explicitly confirms a label. */
export function confirmSourceClassification(
  source: CollectedSource,
  classification: SourceMaterialClassificationV1,
): CollectedSource {
  return {
    ...source,
    classification,
    classificationState: "confirmed",
  };
}

/**
 * Resolve a complete selection for persistence. Legacy/test sources without
 * the additive fields receive a conservative suggestion and never become
 * authority merely because their filename looks official.
 */
function suggestedSourceClassification(
  app: App,
  file: TFile,
  mode: MarkdownSourceMode,
  classificationRules?: SourceClassificationRulesV1,
): SourceClassificationSelectionV1 {
  const cache = app.metadataCache.getFileCache(file);
  const tags = [
    ...(cache?.tags?.map((entry) => entry.tag) ?? []),
    ...frontmatterTags(cache?.frontmatter?.tags),
  ];
  return suggestSourceClassification({
    mode,
    path: file.path,
    title: file.basename,
    tags,
    ...(classificationRules === undefined ? {} : { rules: classificationRules }),
  });
}

function frontmatterTags(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/[\s,]+/u).filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}


export interface RegenerationSourceResult {
  readonly source: CollectedSource;
  readonly currentNoteChanged: boolean;
  readonly restoredVisualCount: number;
}

export async function collectRegenerationSource(
  app: App,
  file: TFile,
  bank: PracticeBankV2,
  classificationRules?: SourceClassificationRulesV1,
): Promise<RegenerationSourceResult> {
  if (file.path !== bank.source.vaultPath) {
    throw new Error("The saved practice bank no longer points to this source note.");
  }
  if (bank.source.scope === "selection") {
    const submittedText = bank.segments.map((segment) => (
      segment.kind === "heading"
        ? `${"#".repeat(Math.min(6, Math.max(1, segment.headingPath.length)))} ${segment.text}`
        : segment.text
    )).join("\n\n");
    const visuals = await restoreSavedVisuals(app, file, [], bank.visuals);
    return {
      currentNoteChanged: false,
      restoredVisualCount: visuals.filter((visual) => visual.selected).length,
      source: {
        mode: "selection",
        title: bank.source.title,
        path: bank.source.vaultPath,
        characterCount: submittedText.length,
        excerpt: excerptFromSegments(bank),
        visuals,
        file,
        submittedText,
        hash: bank.source.hash,
        segments: bank.segments.map((segment) => ({
          ...segment,
          headingPath: [...segment.headingPath],
        })),
      },
    };
  }

  const current = await collectSourceFromFile(
    app,
    file,
    "note",
    undefined,
    classificationRules,
  );
  const visuals = await restoreSavedVisuals(
    app,
    file,
    current.visuals,
    bank.visuals,
  );
  return {
    currentNoteChanged: current.hash !== bank.source.hash,
    restoredVisualCount: visuals.filter((visual) => visual.selected).length,
    source: { ...current, visuals },
  };
}

export async function collectRegenerationPdfSource(
  app: App,
  file: TFile,
  bank: PracticeBankV2,
  extraction: PdfExtractionResult,
  savedImport: PdfSourceImportV1,
  classificationRules?: SourceClassificationRulesV1,
): Promise<RegenerationSourceResult> {
  if (file.path !== bank.source.vaultPath || file.extension.toLowerCase() !== "pdf") {
    throw new Error("The saved practice bank no longer points to this PDF source.");
  }
  if (savedImport.sourceHash !== bank.source.hash) {
    throw new Error("The saved PDF source metadata does not match this practice bank.");
  }
  const current = collectPdfSource(file, extraction, classificationRules);
  const visuals = await restoreSavedVisuals(app, file, [], bank.visuals);
  return {
    currentNoteChanged:
      current.hash !== bank.source.hash
      || current.sourceImport?.pdfContentHash !== savedImport.pdfContentHash,
    restoredVisualCount: visuals.filter((visual) => visual.selected).length,
    source: { ...current, visuals },
  };
}

export async function refreshVisuals(app: App, source: CollectedSource): Promise<readonly DetectedVisual[]> {
  const cacheEntries = await loadNotabilityCacheEntries(app);
  return detectVisuals(source.submittedText, {
    resolveLocal: (target) => resolveLocalVisual(app, source.file, target),
    resolveNotability: (region) => resolveNotability(app, cacheEntries, region)
  });
}

function resolveLocalVisual(app: App, sourceFile: TFile, target: string): LocalVisualResolution {
  const destination = app.metadataCache.getFirstLinkpathDest(target, sourceFile.path);
  if (!(destination instanceof TFile)) return { exists: false };
  const mimeType = mimeForExtension(destination.extension);
  return {
    exists: mimeType !== undefined,
    path: destination.path,
    previewUrl: app.vault.getResourcePath(destination),
    ...(mimeType === undefined ? {} : { mimeType })
  };
}

interface NotabilityCacheIndex {
  readonly available: boolean;
  readonly entries: ReadonlyMap<string, string>;
}

async function loadNotabilityCacheEntries(app: App): Promise<NotabilityCacheIndex> {
  const pluginRoot = normalizePath(`${app.vault.configDir}/plugins/notability-live-region`);
  try {
    if (!await app.vault.adapter.exists(`${pluginRoot}/manifest.json`)) {
      return { available: false, entries: new Map() };
    }
    const manifest = JSON.parse(await app.vault.adapter.read(`${pluginRoot}/manifest.json`)) as { version?: unknown };
    if (typeof manifest.version !== "string" || !manifest.version.startsWith("1.1.")) {
      return { available: false, entries: new Map() };
    }
    const indexPath = `${pluginRoot}/cache/index.json`;
    if (!await app.vault.adapter.exists(indexPath)) return { available: true, entries: new Map() };
    const parsed = JSON.parse(await app.vault.adapter.read(indexPath)) as {
      version?: unknown;
      entries?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
      return { available: true, entries: new Map() };
    }
    const entries = new Map<string, string>();
    for (const [regionId, raw] of Object.entries(parsed.entries)) {
      if (typeof raw !== "object" || raw === null) continue;
      const filename = (raw as { file?: unknown }).file;
      if (typeof filename !== "string" || !/^nr-[a-f0-9-]{36}\.png$/iu.test(filename)) continue;
      const cachePath = normalizePath(`${pluginRoot}/cache/${filename}`);
      if (await app.vault.adapter.exists(cachePath)) entries.set(regionId, cachePath);
    }
    return { available: true, entries };
  } catch {
    return { available: false, entries: new Map() };
  }
}

function resolveNotability(
  app: App,
  cache: NotabilityCacheIndex,
  region: NotabilityRegionData
): { cachePath?: string; previewUrl?: string } | undefined {
  if (!cache.available) return undefined;
  const path = cache.entries.get(region.regionId);
  return path === undefined ? {} : {
    cachePath: path,
    previewUrl: app.vault.adapter.getResourcePath(path)
  };
}

function mimeForExtension(extension: string): string | undefined {
  const normalized = extension.toLowerCase();
  if (normalized === "png") return "image/png";
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  if (normalized === "gif") return "image/gif";
  if (normalized === "svg") return "image/svg+xml";
  if (["mp4", "m4v", "mov", "mkv", "webm"].includes(normalized)) return `video/${normalized}`;
  return undefined;
}

function createExcerpt(source: string): string {
  const compact = source.replace(/```[\s\S]*?```/gu, " [embedded content] ").replace(/\s+/gu, " ").trim();
  return compact.length <= 320 ? compact : `${compact.slice(0, 317)}…`;
}

function pdfSourceDetail(sourceImport: PdfSourceImportV1): string {
  const range = sourceImport.firstPage === sourceImport.lastPage
    ? `PDF page ${sourceImport.firstPage}`
    : `PDF pages ${sourceImport.firstPage}–${sourceImport.lastPage}`;
  return `${range} of ${sourceImport.pageCount} · text extracted locally`;
}

async function restoreSavedVisuals(
  app: App,
  file: TFile,
  currentVisuals: readonly DetectedVisual[],
  savedVisuals: readonly VisualSourceV1[],
): Promise<readonly DetectedVisual[]> {
  const remaining = [...savedVisuals];
  const restored: DetectedVisual[] = [];
  for (const current of currentVisuals) {
    const savedIndex = remaining.findIndex((saved) => (
      saved.id === current.id
      || (saved.sourceEmbed !== undefined && saved.sourceEmbed === current.sourceTarget)
      || saved.vaultPath === current.resolvedPath
    ));
    if (savedIndex === -1) {
      restored.push(current);
      continue;
    }
    const saved = remaining.splice(savedIndex, 1)[0];
    if (saved !== undefined) {
      restored.push(await restoreSavedVisual(app, file, saved, restored.length, current));
    }
  }
  for (const saved of remaining) {
    restored.push(await restoreSavedVisual(app, file, saved, restored.length));
  }
  return restored;
}

async function restoreSavedVisual(
  app: App,
  file: TFile,
  saved: VisualSourceV1,
  index: number,
  current?: DetectedVisual,
): Promise<DetectedVisual> {
  const snapshotExists = await app.vault.adapter.exists(saved.vaultPath);
  if (
    current !== undefined
    && current.kind === "static-image"
    && current.state === "ready"
    && saved.kind === "image"
  ) {
    return { ...current, selected: true };
  }
  if (
    current !== undefined
    && (current.kind === "animated-gif" || current.kind === "video")
    && snapshotExists
  ) {
    const frameSourcePath = current.frameSourcePath ?? current.resolvedPath;
    return {
      ...current,
      state: "ready",
      selected: true,
      ...(frameSourcePath === undefined ? {} : { frameSourcePath }),
      resolvedPath: saved.vaultPath,
      previewUrl: app.vault.adapter.getResourcePath(saved.vaultPath),
      mimeType: saved.mimeType,
      ...(saved.frameTimeSeconds === undefined
        ? {}
        : { frameTimeSeconds: saved.frameTimeSeconds }),
      ...(saved.framePosition === undefined
        ? {}
        : { framePosition: saved.framePosition }),
      reason: "Reusing the frame selected for the previous generation. You can choose a different frame in Source.",
    };
  }
  if (
    current !== undefined
    && current.kind === "notability-region"
    && current.state === "ready"
  ) {
    return { ...current, selected: true };
  }
  if (snapshotExists) {
    const original = resolveOriginalMedia(app, file, saved);
    const originalKind = original === null ? null : mediaKind(original.extension);
    if (original !== null && (originalKind === "animated-gif" || originalKind === "video")) {
      return {
        id: saved.id,
        kind: originalKind,
        state: "ready",
        start: index,
        end: index + 1,
        selected: true,
        sourceTarget: saved.sourceEmbed ?? original.path,
        resolvedPath: saved.vaultPath,
        previewUrl: app.vault.adapter.getResourcePath(saved.vaultPath),
        mimeType: saved.mimeType,
        frameSourcePath: original.path,
        ...(saved.frameTimeSeconds === undefined
          ? {}
          : { frameTimeSeconds: saved.frameTimeSeconds }),
        ...(saved.framePosition === undefined
          ? {}
          : { framePosition: saved.framePosition }),
        reason: "Reusing the frame selected for the previous generation. You can choose a different frame in Source.",
      };
    }
    return {
      id: saved.id,
      kind: "static-image",
      state: "ready",
      start: index,
      end: index + 1,
      selected: true,
      sourceTarget: saved.sourceEmbed ?? "Saved generation snapshot",
      resolvedPath: saved.vaultPath,
      previewUrl: app.vault.adapter.getResourcePath(saved.vaultPath),
      mimeType: saved.mimeType,
      reason: "Reusing the durable visual selected for the previous generation.",
    };
  }
  if (current !== undefined) return { ...current, selected: false };
  return {
    id: saved.id,
    kind: "static-image",
    state: "missing",
    start: index,
    end: index + 1,
    selected: false,
    sourceTarget: saved.sourceEmbed ?? saved.vaultPath,
    resolvedPath: saved.vaultPath,
    mimeType: saved.mimeType,
    reason: "The visual used for the previous generation is no longer available.",
  };
}

function resolveOriginalMedia(
  app: App,
  file: TFile,
  saved: VisualSourceV1,
): TFile | null {
  if (saved.sourceEmbed === undefined) return null;
  const resolved = app.metadataCache.getFirstLinkpathDest(
    saved.sourceEmbed,
    file.path,
  );
  return resolved instanceof TFile ? resolved : null;
}

function mediaKind(extension: string): "animated-gif" | "video" | null {
  const normalized = extension.toLowerCase();
  if (normalized === "gif") return "animated-gif";
  if (["m4v", "mkv", "mov", "mp4", "webm"].includes(normalized)) return "video";
  return null;
}

function excerptFromSegments(bank: PracticeBankV2): string {
  const compact = bank.segments.map((segment) => segment.text).join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (compact.length === 0) return "Saved selection snapshot";
  return compact.length <= 320 ? compact : `${compact.slice(0, 317)}…`;
}
