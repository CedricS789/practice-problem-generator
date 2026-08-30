import assert from "node:assert/strict";
import test from "node:test";

import {
  LEARNING_BLUEPRINT_DRAFT_VERSION,
  PRACTICE_SET_DRAFT_VERSION,
  type LearningBlueprintDraftV1,
  type PracticeSetDraftV1,
} from "../src/learning-path-generation";
import { reconcileLearningWorkspaceDrafts } from "../src/learning-path-reconciliation";

const blueprint: LearningBlueprintDraftV1 = {
  schemaVersion: LEARNING_BLUEPRINT_DRAFT_VERSION,
  blueprintId: "blueprint-reconcile",
  title: "Reconciliation fixture",
  overview: "Synthetic relationship fixture.",
  aspects: [{
    id: "aspect-a",
    title: "Foundation",
    purpose: "Ground the foundation.",
    status: "supported",
    prerequisiteAspectIds: [],
    sourceSegmentIds: ["segment-a"],
  }, {
    id: "aspect-b",
    title: "Mechanism",
    purpose: "Build on the foundation.",
    status: "supported",
    prerequisiteAspectIds: ["aspect-a"],
    sourceSegmentIds: ["segment-b"],
  }],
  tutorLessonBriefs: [],
  sets: [{
    id: "set-one",
    title: "Connected set",
    purpose: "Exercise both aspects.",
    instructionalRole: "mechanisms",
    order: 0,
    aspectIds: ["aspect-a", "aspect-b"],
    tutorLessonBriefIds: [],
    recommendedQuantity: 2,
    recommendedDifficulty: "deep-exam",
  }],
};

const draft: PracticeSetDraftV1 = {
  schemaVersion: PRACTICE_SET_DRAFT_VERSION,
  setId: "set-one",
  exercises: [{
    id: "exercise-owned",
    type: "short-answer",
    title: "Owned evidence",
    prompt: "Explain the mechanism.",
    difficulty: "medium",
    sourceSegmentIds: ["segment-b"],
    groundedAnswer: "The mechanism follows the source.",
    acceptableAnswers: ["mechanism"],
    keyPoints: ["mechanism"],
  }, {
    id: "exercise-unmapped",
    type: "short-answer",
    title: "Unmapped evidence",
    prompt: "State the extra supported detail.",
    difficulty: "medium",
    sourceSegmentIds: ["segment-unmapped"],
    groundedAnswer: "The submitted segment states the detail.",
    acceptableAnswers: ["detail"],
    keyPoints: ["detail"],
  }],
  assignments: [{
    exerciseId: "exercise-owned",
    aspectIds: ["aspect-a"],
    role: "guided-check",
  }, {
    exerciseId: "exercise-unmapped",
    aspectIds: ["aspect-a"],
    role: "independent",
  }],
  tutorLessons: [{
    id: "lesson-one",
    title: "Connected lesson",
    objective: "Teach both supported aspects.",
    aspectIds: ["aspect-a", "aspect-b"],
    prerequisiteAspectIds: ["aspect-a"],
    guidedExerciseId: "exercise-owned",
    teachingBlocks: [{
      id: "block-why",
      kind: "why",
      title: "Why",
      content: "The mechanism matters.",
      sourceSegmentIds: ["segment-b"],
    }, {
      id: "block-prerequisite",
      kind: "prerequisite",
      title: "Prerequisite",
      content: "Start from the foundation.",
      sourceSegmentIds: ["segment-a"],
    }, {
      id: "block-explanation",
      kind: "explanation",
      title: "Explanation",
      content: "Then connect the mechanism.",
      sourceSegmentIds: ["segment-b"],
    }],
    selfExplanationCheck: {
      prompt: "Explain the connection.",
      groundedAnswer: "Foundation then mechanism.",
      keyPoints: ["foundation", "mechanism"],
      sourceSegmentIds: ["segment-a", "segment-b"],
    },
    hints: [{
      id: "hint-one",
      level: 1,
      text: "Start from the foundation.",
      sourceSegmentIds: ["segment-a"],
    }],
    repairExplanation: {
      text: "Connect the two supported statements.",
      sourceSegmentIds: ["segment-a", "segment-b"],
    },
  }],
};

test("legacy guided drafts reconcile relationship arrays without changing learner content", () => {
  const result = reconcileLearningWorkspaceDrafts(blueprint, [draft]);
  const reconciled = result.drafts[0];
  assert.ok(reconciled);
  assert.deepEqual(reconciled.assignments[0]?.aspectIds, ["aspect-a", "aspect-b"]);
  assert.ok(result.aspects[0]?.sourceSegmentIds.includes("segment-unmapped"));
  assert.deepEqual(reconciled.tutorLessons[0]?.aspectIds, ["aspect-a", "aspect-b"]);
  assert.deepEqual(reconciled.tutorLessons[0]?.prerequisiteAspectIds, []);
  assert.equal(reconciled.exercises[0]?.prompt, draft.exercises[0]?.prompt);
  assert.equal(reconciled.tutorLessons[0]?.teachingBlocks[0]?.content,
    draft.tutorLessons[0]?.teachingBlocks[0]?.content);
  assert.ok(result.reconciledLinkCount >= 3);
  assert.equal(result.reconciledTutorBlockOrderCount, 0);
});

test("legacy guided drafts normalize tutor teaching order without changing content", () => {
  const unordered = structuredClone(draft);
  const originalBlocks = unordered.tutorLessons[0]!.teachingBlocks;
  unordered.tutorLessons[0]!.teachingBlocks = [
    originalBlocks[2]!,
    originalBlocks[0]!,
    originalBlocks[1]!,
  ];
  const before = structuredClone(unordered);

  const result = reconcileLearningWorkspaceDrafts(blueprint, [unordered]);
  const reconciled = result.drafts[0]?.tutorLessons[0];
  assert.deepEqual(
    reconciled?.teachingBlocks.map((block) => block.kind),
    ["why", "prerequisite", "explanation"],
  );
  assert.deepEqual(
    [...(reconciled?.teachingBlocks ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id)),
    [...before.tutorLessons[0]!.teachingBlocks]
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.equal(result.reconciledTutorBlockOrderCount, 1);
  assert.deepEqual(unordered, before);

  const repeated = reconcileLearningWorkspaceDrafts(blueprint, result.drafts);
  assert.equal(repeated.reconciledTutorBlockOrderCount, 0);
});
