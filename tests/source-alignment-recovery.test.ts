import assert from "node:assert/strict";
import test from "node:test";

import type { SourceAlignmentDraftV1 } from "../src/model";
import {
  buildSourceAlignmentPrompt,
  type SourceAlignmentGenerationInputV1,
} from "../src/source-alignment-generation";
import {
  createSourceAlignmentRecoveryContext,
  createSourceAlignmentRecoveryResult,
  parseSourceAlignmentRecoveryContext,
  parseSourceAlignmentRecoveryResult,
} from "../src/source-alignment-recovery";

const alignmentInput: SourceAlignmentGenerationInputV1 = {
  sourceMaterials: [{
    id: "note",
    role: "primary",
    vaultPath: "Notes/Synthetic.md",
    wikilink: "[[Notes/Synthetic]]",
    title: "Synthetic note",
    sourceHash: `sha256:${"a".repeat(64)}`,
    scope: { kind: "note" },
    segmentIds: ["note:claim"],
    visualIds: [],
    classification: "personal-note",
    classificationState: "confirmed",
  }],
  segments: [{
    id: "note:claim",
    kind: "paragraph",
    ordinal: 0,
    headingPath: ["Claim"],
    text: "A synthetic note-only claim.",
  }],
};
const draft: SourceAlignmentDraftV1 = {
  schemaVersion: 1,
  records: [{
    id: "claim-one",
    status: "notes-only-unverified",
    noteSegmentIds: ["note:claim"],
    schoolSegmentIds: [],
    noteClaim: "A synthetic note-only claim.",
    schoolClaim: null,
    courseSupportedClaim: null,
    resolution: "not-required",
  }],
};
const jobId = "source-alignment-00000000-0000-4000-8000-000000000001";

test("source-alignment recovery locks the exact input, prompt, provider, and result", () => {
  const prompt = buildSourceAlignmentPrompt(alignmentInput);
  const context = createSourceAlignmentRecoveryContext({
    jobId,
    startedAt: "2026-08-25T10:00:00.000Z",
    alignmentInput,
    configuration: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    },
    prompt,
  });
  assert.deepEqual(parseSourceAlignmentRecoveryContext(JSON.stringify(context)), context);

  const result = createSourceAlignmentRecoveryResult({
    jobId,
    completedAt: "2026-08-25T10:05:00.000Z",
    attempts: 2,
    draft,
    alignmentInput,
  });
  assert.deepEqual(
    parseSourceAlignmentRecoveryResult(JSON.stringify(result), alignmentInput),
    result,
  );
});

test("source-alignment recovery rejects prompt, source, and result tampering", () => {
  const context = createSourceAlignmentRecoveryContext({
    jobId,
    startedAt: "2026-08-25T10:00:00.000Z",
    alignmentInput,
    configuration: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    },
    prompt: buildSourceAlignmentPrompt(alignmentInput),
  });
  assert.throws(
    () => parseSourceAlignmentRecoveryContext(JSON.stringify({
      ...context,
      prompt: `${context.prompt}\nUse outside knowledge.`,
    })),
    /prompt no longer matches/iu,
  );
  assert.throws(
    () => parseSourceAlignmentRecoveryContext(JSON.stringify({
      ...context,
      inputHash: `sha256:${"0".repeat(64)}`,
    })),
    /source payload changed/iu,
  );
  assert.throws(
    () => parseSourceAlignmentRecoveryResult(JSON.stringify({
      schemaVersion: 1,
      kind: "source-alignment-result",
      jobId,
      completedAt: "2026-08-25T10:05:00.000Z",
      attempts: 1,
      draft: { ...draft, records: [] },
    }), alignmentInput),
    /no alignment record|requires at least one/iu,
  );
});
