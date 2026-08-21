export const SOURCE_IMPORT_VERSION = 1 as const;
export const SOURCE_IMPORT_FRONTMATTER_KEY = "practice-lab-source-import";

export interface PdfSourceImportV1 {
  readonly schemaVersion: typeof SOURCE_IMPORT_VERSION;
  readonly kind: "pdf-pages";
  readonly sourceHash: string;
  readonly pdfContentHash: string;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly pageCount: number;
  readonly extractedAt: string;
  readonly extractor: "pdftotext-layout-v1";
  readonly revisions: readonly PdfSourceRevisionV1[];
}

export interface PdfSourceRevisionV1 {
  readonly bankRevision: number;
  readonly generationId: string;
  readonly sourceHash: string;
  readonly pdfContentHash: string;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly pageCount: number;
  readonly extractedAt: string;
}

export type SourceImportV1 = PdfSourceImportV1;

export type SourceImportParseResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "ok"; readonly sourceImport: SourceImportV1 };

export function createPdfSourceImport(
  input: Omit<
    PdfSourceImportV1,
    "schemaVersion" | "kind" | "extractor" | "revisions"
  >,
): PdfSourceImportV1 {
  const candidate: PdfSourceImportV1 = {
    schemaVersion: SOURCE_IMPORT_VERSION,
    kind: "pdf-pages",
    extractor: "pdftotext-layout-v1",
    revisions: [],
    ...input,
  };
  const problem = sourceImportProblem(candidate);
  if (problem !== null) throw new Error(problem);
  return structuredClone(candidate);
}

export function recordPdfSourceRevision(
  current: PdfSourceImportV1,
  previous: PdfSourceImportV1 | undefined,
  bankRevision: number,
  generationId: string,
): PdfSourceImportV1 {
  const currentProblem = sourceImportProblem(current);
  if (currentProblem !== null) throw new Error(currentProblem);
  if (previous !== undefined) {
    const previousProblem = sourceImportProblem(previous);
    if (previousProblem !== null) throw new Error(previousProblem);
  }
  const revision: PdfSourceRevisionV1 = {
    bankRevision,
    generationId,
    sourceHash: current.sourceHash,
    pdfContentHash: current.pdfContentHash,
    firstPage: current.firstPage,
    lastPage: current.lastPage,
    pageCount: current.pageCount,
    extractedAt: current.extractedAt,
  };
  const problem = sourceRevisionProblem(revision);
  if (problem !== null) throw new Error(problem);
  const prior = previous?.revisions ?? [];
  if (prior.some((entry) => entry.bankRevision === bankRevision)) {
    throw new Error("PDF source history already contains this bank revision.");
  }
  if (prior.some((entry) => entry.generationId === generationId)) {
    throw new Error("PDF source history already contains this generation ID.");
  }
  if ((prior.at(-1)?.bankRevision ?? -1) >= bankRevision) {
    throw new Error("PDF source-history revisions must increase strictly.");
  }
  return structuredClone({
    ...current,
    revisions: [...prior, revision],
  });
}

export function serializeSourceImportFrontmatter(
  sourceImport: SourceImportV1,
): string {
  const problem = sourceImportProblem(sourceImport);
  if (problem !== null) {
    throw new Error(`Cannot serialize invalid source-import metadata: ${problem}`);
  }
  return `${SOURCE_IMPORT_FRONTMATTER_KEY}: ${yamlString(JSON.stringify(sourceImport))}`;
}

export function parseSourceImportMarkdown(
  markdown: string,
): SourceImportParseResult {
  const raw = frontmatterValue(markdown, SOURCE_IMPORT_FRONTMATTER_KEY);
  if (raw === undefined) return { status: "missing" };
  try {
    const encoded = JSON.parse(raw) as unknown;
    if (typeof encoded !== "string") throw new Error("Expected a quoted JSON string.");
    const value = JSON.parse(encoded) as unknown;
    const problem = sourceImportProblem(value);
    return problem === null
      ? { status: "ok", sourceImport: structuredClone(value as SourceImportV1) }
      : { status: "invalid", message: problem };
  } catch {
    return {
      status: "invalid",
      message: "The saved PDF source metadata is malformed or incomplete.",
    };
  }
}

function sourceImportProblem(value: unknown): string | null {
  if (!isRecord(value)) return "Source-import metadata must be an object.";
  const allowed = new Set([
    "schemaVersion",
    "kind",
    "sourceHash",
    "pdfContentHash",
    "firstPage",
    "lastPage",
    "pageCount",
    "extractedAt",
    "extractor",
    "revisions",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "Source-import metadata contains an unknown field.";
  }
  if (
    value.schemaVersion !== SOURCE_IMPORT_VERSION
    || value.kind !== "pdf-pages"
    || value.extractor !== "pdftotext-layout-v1"
  ) {
    return "The source-import version or kind is unsupported.";
  }
  if (!sha256(value.sourceHash)) return "The extracted-source hash is invalid.";
  if (!sha256(value.pdfContentHash)) return "The PDF content hash is invalid.";
  if (!positiveInteger(value.pageCount)) return "The PDF page count is invalid.";
  if (!positiveInteger(value.firstPage) || !positiveInteger(value.lastPage)) {
    return "The PDF page range is invalid.";
  }
  if (
    value.firstPage > value.lastPage
    || value.lastPage > value.pageCount
  ) {
    return "The PDF page range falls outside the document.";
  }
  if (
    typeof value.extractedAt !== "string"
    || !Number.isFinite(Date.parse(value.extractedAt))
  ) {
    return "The PDF extraction timestamp is invalid.";
  }
  if (!Array.isArray(value.revisions) || value.revisions.length > 10_000) {
    return "The PDF source history is invalid.";
  }
  let priorRevision = -1;
  const generationIds = new Set<string>();
  for (const [index, revision] of value.revisions.entries()) {
    const problem = sourceRevisionProblem(revision);
    if (problem !== null) return `PDF source revision ${index + 1}: ${problem}`;
    const typed = revision as PdfSourceRevisionV1;
    if (typed.bankRevision <= priorRevision) {
      return "PDF source-history revisions must increase strictly.";
    }
    if (generationIds.has(typed.generationId)) {
      return "PDF source-history generation IDs must be unique.";
    }
    priorRevision = typed.bankRevision;
    generationIds.add(typed.generationId);
  }
  const latest = value.revisions.at(-1) as PdfSourceRevisionV1 | undefined;
  if (
    latest !== undefined
    && (
      latest.sourceHash !== value.sourceHash
      || latest.pdfContentHash !== value.pdfContentHash
      || latest.firstPage !== value.firstPage
      || latest.lastPage !== value.lastPage
      || latest.pageCount !== value.pageCount
      || latest.extractedAt !== value.extractedAt
    )
  ) {
    return "The current PDF source metadata must match its latest revision.";
  }
  return null;
}

function sourceRevisionProblem(value: unknown): string | null {
  if (!isRecord(value)) return "the revision must be an object.";
  const allowed = new Set([
    "bankRevision",
    "generationId",
    "sourceHash",
    "pdfContentHash",
    "firstPage",
    "lastPage",
    "pageCount",
    "extractedAt",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "the revision contains an unknown field.";
  }
  if (!Number.isSafeInteger(value.bankRevision) || (value.bankRevision as number) < 0) {
    return "the bank revision is invalid.";
  }
  if (
    typeof value.generationId !== "string"
    || value.generationId.length < 1
    || value.generationId.length > 200
    || !/^[A-Za-z0-9._:-]+$/u.test(value.generationId)
  ) return "the generation ID is invalid.";
  if (!sha256(value.sourceHash) || !sha256(value.pdfContentHash)) {
    return "the source hash is invalid.";
  }
  if (
    !positiveInteger(value.firstPage)
    || !positiveInteger(value.lastPage)
    || !positiveInteger(value.pageCount)
    || value.firstPage > value.lastPage
    || value.lastPage > value.pageCount
  ) return "the page range is invalid.";
  if (
    typeof value.extractedAt !== "string"
    || !Number.isFinite(Date.parse(value.extractedAt))
  ) return "the extraction timestamp is invalid.";
  return null;
}

function frontmatterValue(markdown: string, key: string): string | undefined {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escapedKey}:\\s*(.+)$`, "mu").exec(
    normalized.slice(4, end),
  )?.[1];
}

function yamlString(value: string): string {
  return JSON.stringify(value) ?? "undefined";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
