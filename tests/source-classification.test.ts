import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSourceClassificationRules,
  sourceClassificationSelection,
  suggestSourceClassification,
} from "../src/source-classification";
import { createApprovedSourceBundle } from "../src/source-bundle";
import type { CollectedSource } from "../src/source";

function source(classification: CollectedSource["classification"]): CollectedSource {
  return {
    mode: "note",
    title: "Synthetic topic",
    path: "Notes/Synthetic topic.md",
    characterCount: 32,
    excerpt: "Synthetic source used in a test.",
    visuals: [],
    file: { path: "Notes/Synthetic topic.md" } as CollectedSource["file"],
    submittedText: "Synthetic source used in a test.",
    hash: `sha256:${"a".repeat(64)}`,
    segments: [{
      id: "segment-1",
      kind: "paragraph",
      ordinal: 0,
      headingPath: ["Topic"],
      text: "Synthetic source used in a test.",
    }],
    ...(classification === undefined
      ? {}
      : { classification, classificationState: "confirmed" }),
  };
}

test("source classification suggestions are conservative and never confirmed implicitly", () => {
  assert.deepEqual(suggestSourceClassification({
    mode: "note",
    path: "Notes/My explanation.md",
    title: "My explanation",
  }), {
    classification: "personal-note",
    classificationState: "suggested",
  });
  assert.deepEqual(suggestSourceClassification({
    mode: "pdf",
    path: "Course/Lecture slides.pdf",
    title: "Lecture slides",
  }), {
    classification: "instructor-material",
    classificationState: "suggested",
  });
  assert.deepEqual(suggestSourceClassification({
    mode: "pdf",
    path: "Uploads/Unknown.pdf",
    title: "Unknown",
  }), {
    classification: "unclassified",
    classificationState: "suggested",
  });
});

test("source classification suggestions honor configurable folder and tag phrases", () => {
  const rules = normalizeSourceClassificationRules({
    officialCorrection: ["approved answers"],
    instructorMaterial: ["faculty pack"],
    assignedReference: ["reading list"],
    personalNote: [],
  });
  assert.deepEqual(suggestSourceClassification({
    mode: "pdf",
    path: "Course/Faculty pack/week 2.pdf",
    title: "Week 2",
    rules,
  }), {
    classification: "instructor-material",
    classificationState: "suggested",
  });
  assert.deepEqual(suggestSourceClassification({
    mode: "pdf",
    path: "Uploads/Unknown.pdf",
    title: "Unknown",
    tags: ["approved answers"],
    rules,
  }), {
    classification: "official-correction",
    classificationState: "suggested",
  });
  assert.deepEqual(suggestSourceClassification({
    mode: "pdf",
    path: "Notes/Personal.pdf",
    title: "Personal",
    rules,
  }), {
    classification: "unclassified",
    classificationState: "suggested",
  });
});

test("confirmed source labels propagate into source materials and approved hashes", () => {
  const noteBundle = createApprovedSourceBundle(source("personal-note"), []);
  const schoolBundle = createApprovedSourceBundle(source("instructor-material"), []);
  assert.equal(noteBundle.materials[0]?.classification, "personal-note");
  assert.equal(noteBundle.materials[0]?.classificationState, "confirmed");
  assert.notEqual(noteBundle.bundleHash, schoolBundle.bundleHash);
  assert.deepEqual(sourceClassificationSelection(source(undefined)), {
    classification: "personal-note",
    classificationState: "suggested",
  });
});
