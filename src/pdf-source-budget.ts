import type { SourcePresentation } from "./ui/contracts";

export interface PdfSourceBudgetLimitsV1 {
  readonly maxPages: number;
  readonly maxCharacters: number;
}

export interface PdfSourceBudgetUsageV1 {
  readonly pdfSourceCount: number;
  readonly pageCount: number;
  readonly characterCount: number;
  readonly remainingPages: number;
  readonly remainingCharacters: number;
}

export type PdfSourceBudgetProblemCodeV1 =
  | "invalid-limits"
  | "missing-page-range"
  | "page-limit"
  | "character-limit";

export interface PdfSourceBudgetProblemV1 {
  readonly code: PdfSourceBudgetProblemCodeV1;
  readonly message: string;
}

export function pdfSourceBudgetUsage(
  sources: readonly SourcePresentation[],
  limits: PdfSourceBudgetLimitsV1,
): PdfSourceBudgetUsageV1 {
  const limitProblem = pdfSourceBudgetLimitProblem(limits);
  if (limitProblem !== null) throw new Error(limitProblem.message);

  let pdfSourceCount = 0;
  let pageCount = 0;
  let characterCount = 0;
  for (const source of sources) {
    if (source.mode !== "pdf") continue;
    pdfSourceCount += 1;
    const selection = source.pdfPageSelection;
    if (selection === undefined || pdfPageSelectionProblem(selection) !== null) {
      throw new Error(
        `PDF source ${source.title} is missing a valid approved page range. Choose it again before generation.`,
      );
    }
    pageCount += selection.lastPage - selection.firstPage + 1;
    if (!Number.isSafeInteger(source.characterCount) || source.characterCount < 0) {
      throw new Error(`PDF source ${source.title} has an invalid extracted-text size.`);
    }
    characterCount += source.characterCount;
  }

  return {
    pdfSourceCount,
    pageCount,
    characterCount,
    remainingPages: Math.max(0, limits.maxPages - pageCount),
    remainingCharacters: Math.max(0, limits.maxCharacters - characterCount),
  };
}

export function pdfSourceBudgetProblem(
  sources: readonly SourcePresentation[],
  limits: PdfSourceBudgetLimitsV1,
): PdfSourceBudgetProblemV1 | null {
  const limitProblem = pdfSourceBudgetLimitProblem(limits);
  if (limitProblem !== null) return limitProblem;

  let usage: PdfSourceBudgetUsageV1;
  try {
    usage = pdfSourceBudgetUsage(sources, limits);
  } catch (error) {
    return {
      code: "missing-page-range",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (usage.pageCount > limits.maxPages) {
    return {
      code: "page-limit",
      message: `The approved PDF bundle contains ${usage.pageCount.toLocaleString()} pages, above the configured ${limits.maxPages.toLocaleString()}-page total. Remove a PDF or choose narrower page ranges.`,
    };
  }
  if (usage.characterCount > limits.maxCharacters) {
    return {
      code: "character-limit",
      message: `The approved PDF bundle contains ${usage.characterCount.toLocaleString()} extracted characters, above the configured ${limits.maxCharacters.toLocaleString()}-character total. Remove a PDF or choose narrower page ranges.`,
    };
  }
  return null;
}

function pdfSourceBudgetLimitProblem(
  limits: PdfSourceBudgetLimitsV1,
): PdfSourceBudgetProblemV1 | null {
  if (
    !Number.isSafeInteger(limits.maxPages)
    || limits.maxPages < 1
    || !Number.isSafeInteger(limits.maxCharacters)
    || limits.maxCharacters < 1
  ) {
    return {
      code: "invalid-limits",
      message: "The configured PDF page or extracted-text budget is invalid. Check Practice Problem Generator settings.",
    };
  }
  return null;
}

function pdfPageSelectionProblem(
  selection: NonNullable<SourcePresentation["pdfPageSelection"]>,
): string | null {
  if (
    !Number.isSafeInteger(selection.firstPage)
    || !Number.isSafeInteger(selection.lastPage)
    || !Number.isSafeInteger(selection.documentPageCount)
    || selection.firstPage < 1
    || selection.firstPage > selection.lastPage
    || selection.lastPage > selection.documentPageCount
  ) {
    return "The approved PDF page range is invalid.";
  }
  return null;
}
