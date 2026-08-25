import assert from "node:assert/strict";
import test from "node:test";

import {
  createApprovedSourceBundle,
  sourceBundleProblem,
  sourceMaterialId,
} from "../src/source-bundle";
import type { CollectedSource } from "../src/source";

function source(
  path: string,
  hash: string,
  options: {
    readonly mode?: CollectedSource["mode"];
    readonly firstPage?: number;
    readonly lastPage?: number;
    readonly characterCount?: number;
    readonly documentPageCount?: number;
  } = {},
): CollectedSource {
  const mode = options.mode ?? "note";
  return {
    mode,
    path,
    title: path.split("/").at(-1) ?? path,
    characterCount: options.characterCount ?? 100,
    excerpt: `Excerpt for ${path}`,
    visuals: [{
      id: "visual-shared",
      kind: "static-image",
      state: "ready",
      start: 0,
      end: 1,
      selected: true,
      resolvedPath: "Attachments/example.png",
      mimeType: "image/png",
    }],
    file: { path } as CollectedSource["file"],
    submittedText: `Grounded source ${path}`,
    hash,
    segments: [{
      id: "seg-shared",
      kind: "paragraph",
      ordinal: 0,
      headingPath: ["Topic"],
      text: `Grounded segment ${path}`,
    }],
    ...(mode !== "pdf" ? {} : {
      sourceImport: {
        schemaVersion: 1 as const,
        kind: "pdf-pages" as const,
        sourceHash: hash,
        pdfContentHash: `pdf-${hash}`,
        firstPage: options.firstPage ?? 1,
        lastPage: options.lastPage ?? 2,
        pageCount: options.documentPageCount ?? 20,
        extractedAt: "2026-08-22T00:00:00.000Z",
        extractor: "pdftotext-layout-v1" as const,
        revisions: [],
      },
    }),
  };
}

test("approved bundles namespace every segment and visual by material", () => {
  const primary = source("Notes/Primary.md", "sha256:primary");
  const supporting = source("Notes/Support.md", "sha256:support");
  const bundle = createApprovedSourceBundle(primary, [supporting]);

  assert.equal(bundle.materials.length, 2);
  assert.equal(bundle.materials[0]?.role, "primary");
  assert.equal(bundle.materials[1]?.role, "supporting");
  assert.equal(new Set(bundle.combined.segments.map((entry) => entry.id)).size, 2);
  assert.equal(new Set(bundle.combined.visuals.map((entry) => entry.id)).size, 2);
  assert.match(bundle.combined.segments[0]?.id ?? "", /^material-[a-f0-9]{16}:seg-shared$/u);
  assert.deepEqual(bundle.materials[0]?.segmentIds, [bundle.combined.segments[0]?.id]);
  assert.deepEqual(bundle.materials[1]?.visualIds, [bundle.combined.visuals[1]?.id]);
  assert.equal(bundle.primary.path, primary.path);
});

test("PDF material identity includes the exact approved page range", () => {
  const first = source("Books/Course.pdf", "sha256:same", {
    mode: "pdf",
    firstPage: 4,
    lastPage: 8,
  });
  const second = source("Books/Course.pdf", "sha256:same", {
    mode: "pdf",
    firstPage: 9,
    lastPage: 12,
  });
  assert.notEqual(sourceMaterialId(first), sourceMaterialId(second));
  const bundle = createApprovedSourceBundle(first, [second]);
  assert.deepEqual(bundle.materials.map((entry) => entry.scope), [
    {
      kind: "pdf-pages",
      firstPage: 4,
      lastPage: 8,
      pageCount: 20,
      pdfContentHash: "pdf-sha256:same",
    },
    {
      kind: "pdf-pages",
      firstPage: 9,
      lastPage: 12,
      pageCount: 20,
      pdfContentHash: "pdf-sha256:same",
    },
  ]);
});

test("the exact same scope cannot be submitted twice", () => {
  const selected = source("Notes/Topic.md", "sha256:topic");
  assert.equal(sourceBundleProblem(selected, [selected])?.code, "duplicate-scope");
  assert.throws(
    () => createApprovedSourceBundle(selected, [selected]),
    /same source scope was selected more than once/iu,
  );
});

test("supporting source limit is enforced before prompt construction", () => {
  const primary = source("Notes/Primary.md", "sha256:primary");
  const supporting = Array.from({ length: 5 }, (_value, index) => (
    source(`Notes/Support ${index + 1}.md`, `sha256:${index + 1}`)
  ));
  assert.equal(sourceBundleProblem(primary, supporting)?.code, "too-many-supporting");
});

test("approved bundle enforces aggregate PDF page and character budgets before prompts", () => {
  const primary = source("Books/Primary.pdf", "sha256:primary", {
    mode: "pdf",
    firstPage: 1,
    lastPage: 24,
    characterCount: 70_000,
    documentPageCount: 200,
  });
  const supporting = source("Books/Supporting.pdf", "sha256:support", {
    mode: "pdf",
    firstPage: 50,
    lastPage: 68,
    characterCount: 55_000,
    documentPageCount: 200,
  });
  const limits = { maxPages: 40, maxCharacters: 120_000 } as const;

  assert.equal(
    sourceBundleProblem(primary, [supporting], limits)?.code,
    "pdf-page-limit",
  );
  const misleadingPresentation: CollectedSource = {
    ...primary,
    pdfPageSelection: {
      firstPage: 1,
      lastPage: 1,
      documentPageCount: 200,
    },
  };
  assert.equal(
    sourceBundleProblem(misleadingPresentation, [supporting], limits)?.code,
    "pdf-page-limit",
  );
  assert.throws(
    () => createApprovedSourceBundle(primary, [supporting], limits),
    /approved PDF bundle contains 43 pages/iu,
  );

  const characterOnly = source("Books/Text-heavy.pdf", "sha256:text-heavy", {
    mode: "pdf",
    firstPage: 70,
    lastPage: 73,
    characterCount: 55_000,
    documentPageCount: 200,
  });
  assert.equal(
    sourceBundleProblem(primary, [characterOnly], limits)?.code,
    "pdf-character-limit",
  );
});

test("approved bundles require authoritative PDF import provenance", () => {
  const selected = source("Books/Untrusted.pdf", "sha256:untrusted", {
    mode: "pdf",
    firstPage: 1,
    lastPage: 2,
  });
  const { sourceImport: _sourceImport, ...withoutImport } = selected;
  void _sourceImport;
  const presentationOnly: CollectedSource = {
    ...withoutImport,
    pdfPageSelection: {
      firstPage: 1,
      lastPage: 2,
      documentPageCount: 20,
    },
  };

  assert.equal(
    sourceBundleProblem(
      presentationOnly,
      [],
      { maxPages: 40, maxCharacters: 120_000 },
    )?.code,
    "pdf-provenance",
  );
});
