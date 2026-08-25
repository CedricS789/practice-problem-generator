import assert from "node:assert/strict";
import test from "node:test";

import { snapshotSourcePresentation } from "../src/source-presentation";
import type { SourcePresentation } from "../src/ui/contracts";

test("durable source presentations discard circular Obsidian runtime fields", () => {
  const circularFile: Record<string, unknown> = {};
  circularFile["_"] = circularFile;
  const circularVisualRuntime: Record<string, unknown> = {};
  circularVisualRuntime["owner"] = circularVisualRuntime;

  const source = {
    mode: "note",
    title: "Synthetic source",
    path: "Synthetic source.md",
    characterCount: 42,
    excerpt: "Synthetic source text used only by this test.",
    visuals: [
      {
        id: "visual-one",
        kind: "static-image",
        state: "ready",
        start: 0,
        end: 10,
        selected: true,
        resolvedPath: "Assets/synthetic.png",
        mimeType: "image/png",
        runtime: circularVisualRuntime,
      },
    ],
    file: circularFile,
  } as unknown as SourcePresentation;

  assert.throws(() => JSON.stringify(source), /circular/iu);

  const snapshot = snapshotSourcePresentation(source);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.equal("file" in snapshot, false);
  assert.equal("runtime" in snapshot.visuals[0]!, false);
  assert.deepEqual(snapshot, {
    mode: "note",
    title: "Synthetic source",
    path: "Synthetic source.md",
    characterCount: 42,
    excerpt: "Synthetic source text used only by this test.",
    visuals: [
      {
        id: "visual-one",
        kind: "static-image",
        state: "ready",
        start: 0,
        end: 10,
        selected: true,
        resolvedPath: "Assets/synthetic.png",
        mimeType: "image/png",
      },
    ],
  });
});

test("durable PDF presentations preserve exact page-budget provenance", () => {
  const source: SourcePresentation = {
    mode: "pdf",
    title: "Synthetic PDF",
    path: "Sources/Synthetic.pdf",
    characterCount: 12_345,
    excerpt: "Synthetic extracted text.",
    detail: "PDF pages 7-11 of 80",
    pdfPageSelection: {
      firstPage: 7,
      lastPage: 11,
      documentPageCount: 80,
    },
    visuals: [],
  };

  assert.deepEqual(snapshotSourcePresentation(source).pdfPageSelection, {
    firstPage: 7,
    lastPage: 11,
    documentPageCount: 80,
  });
});
