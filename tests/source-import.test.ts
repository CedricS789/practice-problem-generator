import assert from "node:assert/strict";
import test from "node:test";

import {
  createPdfSourceImport,
  parseSourceImportMarkdown,
  recordPdfSourceRevision,
  serializeSourceImportFrontmatter,
} from "../src/source-import";

const hash = `sha256:${"a".repeat(64)}`;
const pdfHash = `sha256:${"b".repeat(64)}`;

test("PDF source metadata round-trips as strict quoted frontmatter", () => {
  const value = createPdfSourceImport({
    sourceHash: hash,
    pdfContentHash: pdfHash,
    firstPage: 3,
    lastPage: 8,
    pageCount: 42,
    extractedAt: "2026-08-21T02:00:00.000Z",
  });
  const markdown = `---\n${serializeSourceImportFrontmatter(value)}\n---\n`;
  const parsed = parseSourceImportMarkdown(markdown);
  assert.deepEqual(parsed, { status: "ok", sourceImport: value });
});

test("PDF source metadata rejects unsupported, malformed, and out-of-range values", () => {
  assert.throws(
    () => createPdfSourceImport({
      sourceHash: hash,
      pdfContentHash: pdfHash,
      firstPage: 8,
      lastPage: 3,
      pageCount: 42,
      extractedAt: "2026-08-21T02:00:00.000Z",
    }),
    /falls outside/u,
  );
  const valid = createPdfSourceImport({
    sourceHash: hash,
    pdfContentHash: pdfHash,
    firstPage: 1,
    lastPage: 1,
    pageCount: 1,
    extractedAt: "2026-08-21T02:00:00.000Z",
  });
  const encoded = serializeSourceImportFrontmatter(valid);
  assert.equal(
    parseSourceImportMarkdown(`---\n${encoded.replace("pdf-pages", "other")}\n---\n`).status,
    "invalid",
  );
  assert.equal(
    parseSourceImportMarkdown("---\npractice-lab-source-import: nope\n---\n").status,
    "invalid",
  );
  assert.equal(parseSourceImportMarkdown("---\nsource: x\n---\n").status, "missing");
});

test("PDF source history records every generation revision without losing prior ranges", () => {
  const first = createPdfSourceImport({
    sourceHash: hash,
    pdfContentHash: pdfHash,
    firstPage: 1,
    lastPage: 4,
    pageCount: 42,
    extractedAt: "2026-08-21T02:00:00.000Z",
  });
  const recordedFirst = recordPdfSourceRevision(first, undefined, 0, "generation-one");
  const second = createPdfSourceImport({
    sourceHash: `sha256:${"c".repeat(64)}`,
    pdfContentHash: pdfHash,
    firstPage: 8,
    lastPage: 12,
    pageCount: 42,
    extractedAt: "2026-08-21T03:00:00.000Z",
  });
  const recordedSecond = recordPdfSourceRevision(
    second,
    recordedFirst,
    1,
    "generation-two",
  );
  assert.deepEqual(recordedSecond.revisions.map((revision) => ({
    bankRevision: revision.bankRevision,
    generationId: revision.generationId,
    firstPage: revision.firstPage,
    lastPage: revision.lastPage,
  })), [
    { bankRevision: 0, generationId: "generation-one", firstPage: 1, lastPage: 4 },
    { bankRevision: 1, generationId: "generation-two", firstPage: 8, lastPage: 12 },
  ]);
  assert.throws(
    () => recordPdfSourceRevision(second, recordedSecond, 1, "generation-three"),
    /already contains this bank revision|increase strictly/u,
  );
});
