import assert from "node:assert/strict";
import test from "node:test";

import type {
  SourceAlignmentDraftV1,
  SourceAlignmentProvenanceV1,
  SourceMaterialV2,
  SourceSegmentV1,
} from "../src/model";
import {
  alignmentProblemsForSourceReferences,
  buildSourceAlignmentPrompt,
  finalizeSourceAlignmentLedger,
  linkSourceAlignmentTargets,
  sourceAlignmentBlockers,
  sourceAlignmentDraftV1JsonSchema,
  sourceAlignmentInputHash,
  validateSourceAlignmentDraft,
  type SourceAlignmentGenerationInputV1,
} from "../src/source-alignment-generation";

const noteHash = `sha256:${"a".repeat(64)}`;
const schoolHash = `sha256:${"b".repeat(64)}`;

const segments: SourceSegmentV1[] = [
  {
    id: "note:claim",
    kind: "paragraph",
    ordinal: 0,
    headingPath: ["Learner note"],
    text: "The note says the capacitance increases with width.",
  },
  {
    id: "school:claim",
    kind: "paragraph",
    ordinal: 1,
    headingPath: ["Course slide"],
    text: "The course slide states that capacitance decreases with width.",
  },
];

function material(input: {
  readonly id: string;
  readonly classification: SourceMaterialV2["classification"];
  readonly hash: string;
  readonly segmentIds: string[];
}): SourceMaterialV2 {
  return {
    id: input.id,
    role: input.id === "note" ? "primary" : "supporting",
    vaultPath: `Private/${input.id}.md`,
    wikilink: `[[Private/${input.id}]]`,
    title: input.id,
    sourceHash: input.hash,
    scope: { kind: "note" },
    segmentIds: input.segmentIds,
    visualIds: [],
    classification: input.classification,
    classificationState: "confirmed",
  };
}

const input: SourceAlignmentGenerationInputV1 = {
  sourceMaterials: [
    material({
      id: "note",
      classification: "personal-note",
      hash: noteHash,
      segmentIds: ["note:claim"],
    }),
    material({
      id: "school",
      classification: "instructor-material",
      hash: schoolHash,
      segmentIds: ["school:claim"],
    }),
  ],
  segments,
};

const conflictDraft: SourceAlignmentDraftV1 = {
  schemaVersion: 1,
  records: [{
    id: "claim-capacitance",
    status: "conflict",
    noteSegmentIds: ["note:claim"],
    schoolSegmentIds: ["school:claim"],
    noteClaim: "Capacitance increases with width.",
    schoolClaim: "Capacitance decreases with width.",
    courseSupportedClaim: "For the submitted course relation, capacitance decreases with width.",
    resolution: "course-authority",
  }],
};

function provenance(): Omit<SourceAlignmentProvenanceV1, "sourceBundleHash"> {
  return {
    provider: "codex",
    providerVersion: "synthetic-1",
    model: "synthetic-model",
    reasoningEffort: "high",
    promptVersion: "practice-source-alignment-v1.1",
    generatedAt: "2026-08-25T12:00:00.000Z",
  };
}

test("alignment prompt preserves source authority and requires downstream completion approval", () => {
  const prompt = buildSourceAlignmentPrompt(input);
  assert.equal(sourceAlignmentDraftV1JsonSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.match(prompt, /selected material defines the topic and course context/iu);
  assert.match(prompt, /only when the learner explicitly approves the aggregated completion option/iu);
  assert.match(prompt, /does not add general context itself/iu);
  assert.match(prompt, /not course-checked/iu);
  assert.match(prompt, /never overrule confirmed school material/iu);
  assert.match(prompt, /official-correction, then instructor-material, then assigned-reference/iu);
  assert.match(prompt, /note:claim/u);
  assert.match(prompt, /school:claim/u);
  assert.doesNotMatch(prompt, /Private\/|wikilink/iu);
  assert.match(sourceAlignmentInputHash(input), /^sha256:[a-f0-9]{64}$/u);
});

test("raw Notability locators are omitted and never require an alignment record", () => {
  const locatorId = "note:notability-locator";
  const locatorInput: SourceAlignmentGenerationInputV1 = {
    sourceMaterials: input.sourceMaterials.map((source) => source.id === "note"
      ? { ...source, segmentIds: [...source.segmentIds, locatorId] }
      : source),
    segments: [
      ...input.segments,
      {
        id: locatorId,
        kind: "paragraph",
        ordinal: 2,
        headingPath: ["Captured page"],
        text: "```notability-region\n{\"title\":\"Lecture.pdf\",\"page\":13,\"rect\":{\"x\":0.1}}\n```",
      },
    ],
  };
  const prompt = buildSourceAlignmentPrompt(locatorInput);
  assert.doesNotMatch(prompt, /notability-region|Lecture\.pdf|"page": 13/iu);
  assert.deepEqual(validateSourceAlignmentDraft(conflictDraft, locatorInput), {
    valid: true,
    value: conflictDraft,
  });
});

test("alignment validation locks citation ownership, coverage, and course resolution", () => {
  assert.deepEqual(validateSourceAlignmentDraft(conflictDraft, input), {
    valid: true,
    value: conflictDraft,
  });
  const wrongOwnership = structuredClone(conflictDraft);
  wrongOwnership.records[0]!.noteSegmentIds = ["school:claim"];
  wrongOwnership.records[0]!.schoolSegmentIds = ["note:claim"];
  const result = validateSourceAlignmentDraft(wrongOwnership, input);
  assert.equal(result.valid, false);
  assert.match(result.errors?.join(" ") ?? "", /confirmed personal-note|confirmed school/iu);

  const silentOverride = structuredClone(conflictDraft);
  silentOverride.records[0]!.resolution = "manual-override";
  assert.match(
    validateSourceAlignmentDraft(silentOverride, input).errors?.join(" ") ?? "",
    /explicit learner action/iu,
  );
});

test("school-school ambiguity remains a blocker until excluded or resolved outside the model", () => {
  const secondSchool = material({
    id: "correction",
    classification: "official-correction",
    hash: `sha256:${"c".repeat(64)}`,
    segmentIds: ["correction:claim"],
  });
  const disagreementInput: SourceAlignmentGenerationInputV1 = {
    sourceMaterials: [...input.sourceMaterials, secondSchool],
    segments: [
      ...segments,
      {
        id: "correction:claim",
        kind: "paragraph",
        ordinal: 2,
        headingPath: ["Correction"],
        text: "The correction gives another relation.",
      },
    ],
  };
  const draft: SourceAlignmentDraftV1 = {
    schemaVersion: 1,
    records: [{
      id: "school-disagreement",
      status: "school-sources-disagree",
      noteSegmentIds: ["note:claim"],
      schoolSegmentIds: ["school:claim", "correction:claim"],
      noteClaim: "The learner note gives one relation.",
      schoolClaim: "The selected school sources disagree.",
      courseSupportedClaim: null,
      resolution: "unresolved",
    }],
  };
  assert.equal(validateSourceAlignmentDraft(draft, disagreementInput).valid, true);
  const ledger = finalizeSourceAlignmentLedger({
    ...disagreementInput,
    draft,
    provenance: provenance(),
  });
  assert.deepEqual(sourceAlignmentBlockers(ledger).map((record) => record.id), [
    "school-disagreement",
  ]);
  assert.match(
    alignmentProblemsForSourceReferences(ledger, ["school:claim"], "/exercise").join(" "),
    /cannot ground practice/iu,
  );
});

test("note-only and insufficient evidence become non-blocking AI-completion anchors", () => {
  const draft: SourceAlignmentDraftV1 = {
    schemaVersion: 1,
    records: [
      {
        id: "note-gap",
        status: "insufficient-evidence",
        noteSegmentIds: ["note:claim"],
        schoolSegmentIds: [],
        noteClaim: "The note introduces a width relation without enough context to establish it safely.",
        schoolClaim: null,
        courseSupportedClaim: null,
        resolution: "unresolved",
      },
      {
        id: "school-context",
        status: "school-only",
        noteSegmentIds: [],
        schoolSegmentIds: ["school:claim"],
        noteClaim: null,
        schoolClaim: "The selected school material supplies the submitted relation.",
        courseSupportedClaim: "Use the school-supported relation where it applies.",
        resolution: "course-authority",
      },
    ],
  };
  assert.equal(validateSourceAlignmentDraft(draft, input).valid, true);
  const ledger = finalizeSourceAlignmentLedger({
    ...input,
    draft,
    provenance: provenance(),
  });
  assert.equal(ledger.records[0]?.resolution, "not-required");
  assert.deepEqual(sourceAlignmentBlockers(ledger), []);
  assert.deepEqual(alignmentProblemsForSourceReferences(
    ledger,
    ["note:claim"],
    "/exercise",
  ), []);
});

test("exercise and tutor links are derived locally from exact source citations", () => {
  const ledger = finalizeSourceAlignmentLedger({
    ...input,
    draft: conflictDraft,
    provenance: provenance(),
  });
  const linked = linkSourceAlignmentTargets({
    ledger,
    exercises: [{
      id: "exercise-1",
      type: "short-answer",
      title: "Course relation",
      prompt: "State the submitted course relation.",
      difficulty: "medium",
      sourceSegmentIds: ["school:claim"],
      groundedAnswer: "Capacitance decreases with width.",
      acceptableAnswers: ["It decreases."],
      keyPoints: ["decreases", "width"],
    }],
    tutorLessons: [],
  });
  assert.deepEqual(linked.exerciseLinks, [{
    targetId: "exercise-1",
    alignmentRecordIds: ["claim-capacitance"],
  }]);
  assert.deepEqual(linked.tutorLessonLinks, []);
});
