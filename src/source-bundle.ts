import type { SourceMaterialScopeV1, SourceMaterialV1 } from "./model";
import { createSourceHash, sha256Hex } from "./segmenter";
import type { CollectedSource } from "./source";

export const MAX_SUPPORTING_SOURCES = 4;

export interface ApprovedSourceBundleV1 {
  readonly primary: CollectedSource;
  readonly supporting: readonly CollectedSource[];
  /** A provider-ready source whose segment and visual IDs are globally unique. */
  readonly combined: CollectedSource;
  readonly materials: readonly SourceMaterialV1[];
  readonly bundleHash: string;
}

export interface SourceBundleProblem {
  readonly code: "too-many-supporting" | "duplicate-scope" | "empty-source";
  readonly message: string;
}

/**
 * Builds the exact, user-approved source bundle. This function never follows
 * links: every member must already have been collected from an explicit user
 * choice. IDs are namespaced before any AI prompt is assembled.
 */
export function createApprovedSourceBundle(
  primary: CollectedSource,
  supporting: readonly CollectedSource[],
): ApprovedSourceBundleV1 {
  const problem = sourceBundleProblem(primary, supporting);
  if (problem !== null) throw new Error(problem.message);

  const inputs = [primary, ...supporting];
  const materialIds = inputs.map((source) => sourceMaterialId(source));
  const namespaced = inputs.map((source, index) => (
    namespaceCollectedSource(source, materialIds[index] ?? `material-${index + 1}`)
  ));
  const namespacedPrimary = namespaced[0];
  if (namespacedPrimary === undefined) {
    throw new Error("A primary source is required for a guided learning path.");
  }

  const materials = namespaced.map((source, index) => sourceMaterialRecord(
    source,
    materialIds[index] ?? `material-${index + 1}`,
    index === 0 ? "primary" : "supporting",
  ));
  const bundleHash = createSourceHash(JSON.stringify(materials.map((material) => ({
    id: material.id,
    role: material.role,
    vaultPath: material.vaultPath,
    sourceHash: material.sourceHash,
    scope: material.scope,
  }))));
  const combinedText = namespaced.map((source, index) => (
    `SOURCE ${index + 1}: ${source.title}\n${source.submittedText}`
  )).join("\n\n");
  const combinedSegments = namespaced.flatMap((source) => source.segments)
    .map((segment, ordinal) => ({ ...segment, ordinal }));
  const combinedVisuals = namespaced.flatMap((source) => source.visuals);

  return {
    primary: namespacedPrimary,
    supporting: namespaced.slice(1),
    materials,
    bundleHash,
    combined: {
      ...namespacedPrimary,
      title: supporting.length === 0
        ? namespacedPrimary.title
        : `${namespacedPrimary.title} + ${supporting.length} supporting ${supporting.length === 1 ? "source" : "sources"}`,
      characterCount: namespaced.reduce(
        (total, source) => total + source.characterCount,
        0,
      ),
      excerpt: bundleExcerpt(namespaced),
      detail: bundleDetail(namespaced),
      submittedText: combinedText,
      hash: bundleHash,
      segments: combinedSegments,
      visuals: combinedVisuals,
    },
  };
}

export function sourceBundleProblem(
  primary: CollectedSource,
  supporting: readonly CollectedSource[],
): SourceBundleProblem | null {
  if (supporting.length > MAX_SUPPORTING_SOURCES) {
    return {
      code: "too-many-supporting",
      message: `A guided path may include at most ${MAX_SUPPORTING_SOURCES} supporting sources.`,
    };
  }
  const all = [primary, ...supporting];
  if (all.some((source) => source.segments.length === 0 || source.hash.trim().length === 0)) {
    return {
      code: "empty-source",
      message: "Every approved source must contain at least one grounded segment and a source hash.",
    };
  }
  const identities = new Set<string>();
  for (const source of all) {
    const identity = sourceScopeIdentity(source);
    if (identities.has(identity)) {
      return {
        code: "duplicate-scope",
        message: `The same source scope was selected more than once: ${source.title}.`,
      };
    }
    identities.add(identity);
  }
  return null;
}

export function sourceMaterialId(source: CollectedSource): string {
  return `material-${sha256Hex(sourceScopeIdentity(source)).slice(0, 16)}`;
}

export function sourceScopeIdentity(source: CollectedSource): string {
  return JSON.stringify({
    path: source.path,
    scope: sourceMaterialScope(source),
    hash: source.hash,
  });
}

export function sourceMaterialScope(source: CollectedSource): SourceMaterialScopeV1 {
  if (source.mode === "pdf") {
    const imported = source.sourceImport;
    if (imported === undefined) {
      throw new Error(`PDF source ${source.title} has no approved page-range provenance.`);
    }
    return {
      kind: "pdf-pages",
      firstPage: imported.firstPage,
      lastPage: imported.lastPage,
      pageCount: imported.pageCount,
      pdfContentHash: imported.pdfContentHash,
    };
  }
  return { kind: source.mode };
}

export function namespaceCollectedSource(
  source: CollectedSource,
  materialId: string,
): CollectedSource {
  const prefix = `${materialId}:`;
  return {
    ...source,
    segments: source.segments.map((segment) => ({
      ...segment,
      id: `${prefix}${segment.id}`,
      headingPath: [...segment.headingPath],
    })),
    visuals: source.visuals.map((visual) => ({
      ...visual,
      id: `${prefix}${visual.id}`,
    })),
  };
}

function sourceMaterialRecord(
  source: CollectedSource,
  id: string,
  role: SourceMaterialV1["role"],
): SourceMaterialV1 {
  return {
    id,
    role,
    vaultPath: source.path,
    wikilink: sourceWikilink(source.path),
    title: source.title,
    sourceHash: source.hash,
    scope: sourceMaterialScope(source),
    segmentIds: source.segments.map((segment) => segment.id),
    visualIds: source.visuals.map((visual) => visual.id),
  };
}

function sourceWikilink(path: string): string {
  return `[[${path.replace(/\.md$/iu, "")}]]`;
}

function bundleExcerpt(sources: readonly CollectedSource[]): string {
  const text = sources.map((source) => source.excerpt).join(" · ");
  return text.length <= 320 ? text : `${text.slice(0, 317)}…`;
}

function bundleDetail(sources: readonly CollectedSource[]): string {
  return sources.map((source, index) => (
    `${index === 0 ? "Primary" : `Supporting ${index}`}: ${source.title}${source.detail === undefined ? "" : ` (${source.detail})`}`
  )).join(" · ");
}
