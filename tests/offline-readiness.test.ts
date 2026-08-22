import assert from "node:assert/strict";
import test from "node:test";

import { auditOfflineReadiness } from "../src/offline-readiness";
import type { PracticeBankV2 } from "../src/model";
import { createSourceHash, segmentSource } from "../src/segmenter";

function occlusionBank(path: string): PracticeBankV2 {
  const sourceText = "# Diagram\nIdentify node A.";
  const segments = segmentSource(sourceText);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: 2,
    bankId: "bank-offline-synthetic",
    revision: 0,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    source: {
      vaultPath: "Notes/Diagram.md",
      wikilink: "[[Notes/Diagram]]",
      title: "Diagram",
      scope: "note",
      hash: createSourceHash(sourceText),
    },
    segments,
    visuals: [{
      id: "visual-a",
      kind: "image",
      vaultPath: path,
      storage: "source",
      mimeType: "image/png",
      contentHash: `sha256:${"a".repeat(64)}`,
      width: 100,
      height: 100,
    }],
    exercises: [{
      id: "occlusion-a",
      type: "image-occlusion",
      title: "Node A",
      prompt: "Identify the hidden node.",
      difficulty: "medium",
      sourceSegmentIds: [paragraph.id],
      visualId: "visual-a",
      masks: [{
        id: "mask-a",
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        label: "Node",
        answer: "A",
      }],
      groundedAnswer: "Node A.",
    }],
    sessions: [],
  };
}

test("offline audit accepts a present static attachment in the commute subset", () => {
  const bank = occlusionBank("_Vault/Attachments/Practice Lab/a.png");
  const report = auditOfflineReadiness(
    [{ bankPath: "Notes/Practice/Diagram - Practice.md", bank }],
    () => ({ exists: true, extension: "png" }),
  );
  assert.equal(report.ready, true);
  assert.equal(report.referencedImagePaths.length, 1);
  assert.deepEqual(report.issues, []);
});

test("offline audit blocks a missing image and paths outside the selector", () => {
  const missing = auditOfflineReadiness(
    [{
      bankPath: "Notes/Practice/Diagram - Practice.md",
      bank: occlusionBank("_Vault/Attachments/Practice Lab/missing.png"),
    }],
    () => ({ exists: false }),
  );
  assert.equal(missing.ready, false);
  assert.match(missing.issues[0]?.message ?? "", /missing/iu);

  const outside = auditOfflineReadiness(
    [{
      bankPath: "Notes/Practice/Diagram - Practice.md",
      bank: occlusionBank("Course Images/a.png"),
    }],
    () => ({ exists: true, extension: "png" }),
  );
  assert.equal(outside.ready, false);
  assert.equal(outside.issues[0]?.severity, "error");
  assert.match(outside.issues[0]?.message ?? "", /will not be transferred/iu);
});
