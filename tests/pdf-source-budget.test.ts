import assert from "node:assert/strict";
import test from "node:test";

import {
  pdfSourceBudgetProblem,
  pdfSourceBudgetUsage,
} from "../src/pdf-source-budget";
import type { SourcePresentation } from "../src/ui/contracts";

const limits = { maxPages: 40, maxCharacters: 120_000 } as const;

function note(title: string): SourcePresentation {
  return {
    mode: "note",
    title,
    path: `${title}.md`,
    characterCount: 500_000,
    excerpt: "A synthetic Markdown source.",
    visuals: [],
  };
}

function pdf(
  title: string,
  firstPage: number,
  lastPage: number,
  characterCount: number,
): SourcePresentation {
  return {
    mode: "pdf",
    title,
    path: `${title}.pdf`,
    characterCount,
    excerpt: "Synthetic locally extracted PDF text.",
    pdfPageSelection: {
      firstPage,
      lastPage,
      documentPageCount: 200,
    },
    visuals: [],
  };
}

test("PDF budget usage is shared across primary and supporting PDFs only", () => {
  const usage = pdfSourceBudgetUsage([
    note("Large note"),
    pdf("Primary PDF", 4, 15, 35_000),
    pdf("Supporting PDF", 50, 57, 25_000),
  ], limits);

  assert.deepEqual(usage, {
    pdfSourceCount: 2,
    pageCount: 20,
    characterCount: 60_000,
    remainingPages: 20,
    remainingCharacters: 60_000,
  });
});

test("aggregate PDF page excess is rejected even when each range fits alone", () => {
  const problem = pdfSourceBudgetProblem([
    pdf("First", 1, 24, 30_000),
    pdf("Second", 70, 88, 30_000),
  ], limits);

  assert.equal(problem?.code, "page-limit");
  assert.match(problem?.message ?? "", /43 pages.*40-page total/iu);
});

test("aggregate extracted PDF text excess is rejected without truncation", () => {
  const problem = pdfSourceBudgetProblem([
    pdf("First", 1, 4, 70_000),
    pdf("Second", 20, 23, 55_000),
  ], limits);

  assert.equal(problem?.code, "character-limit");
  assert.match(problem?.message ?? "", /125[,.]000 extracted characters.*120[,.]000-character total/iu);
});

test("PDF budget validation fails closed when page provenance is absent", () => {
  const missing: SourcePresentation = {
    mode: "pdf",
    title: "Missing range",
    path: "Missing range.pdf",
    characterCount: 2_000,
    excerpt: "Synthetic locally extracted PDF text.",
    visuals: [],
  };

  const problem = pdfSourceBudgetProblem([missing], limits);
  assert.equal(problem?.code, "missing-page-range");
  assert.match(problem?.message ?? "", /choose it again before generation/iu);
});
