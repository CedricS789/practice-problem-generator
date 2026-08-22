import assert from "node:assert/strict";
import test from "node:test";

import {
  completeGuidedLesson,
  createGuidedLessonState,
  createSessionExerciseEvidence,
  recordIndependentAttempt,
  recordRecoveryAttempt,
  revealNextTeachingBlock,
  revealNextTutorHint,
  revealSelfExplanationAnswer,
  revealTutorRepairExplanation,
  sequenceLearningPathItems,
  sequencePracticeSetItems,
  submitSelfExplanation,
} from "../src/learning-study";
import type {
  ExerciseV1,
  LearningAspectV1,
  LearningPathV1,
  PracticeSetV1,
  TutorLessonV1,
} from "../src/model";

const lesson: TutorLessonV1 = {
  id: "lesson-a",
  title: "Mechanism",
  objective: "Explain the supported mechanism.",
  aspectIds: ["aspect-a"],
  prerequisiteAspectIds: [],
  guidedExerciseId: "exercise-a",
  teachingBlocks: [
    { id: "block-why", kind: "why", title: "Why", content: "Why it matters", sourceSegmentIds: ["seg-a"] },
    { id: "block-how", kind: "explanation", title: "How", content: "Premise to consequence", sourceSegmentIds: ["seg-a"] },
  ],
  selfExplanationCheck: {
    prompt: "Explain it.",
    groundedAnswer: "Grounded explanation.",
    keyPoints: ["premise", "consequence"],
    sourceSegmentIds: ["seg-a"],
  },
  hints: [
    { id: "hint-1", level: 1, text: "Start from the premise.", sourceSegmentIds: ["seg-a"] },
    { id: "hint-2", level: 2, text: "Connect it to the consequence.", sourceSegmentIds: ["seg-a"] },
  ],
  repairExplanation: { text: "Repair explanation.", sourceSegmentIds: ["seg-a"] },
};

test("guided study preserves the original attempt while support gets stronger", () => {
  const initial = createGuidedLessonState(lesson, "exercise-a");
  const block1 = revealNextTeachingBlock(lesson, initial);
  const block2 = revealNextTeachingBlock(lesson, block1);
  const explained = submitSelfExplanation(lesson, block2, "My explanation");
  const independent = revealSelfExplanationAnswer(lesson, explained);
  const failed = recordIndependentAttempt(independent, {
    exerciseId: "exercise-a",
    outcome: "incorrect",
    submittedAnswer: "first answer",
  });
  const hint1 = revealNextTutorHint(lesson, failed);
  const retry1 = recordRecoveryAttempt(hint1, {
    exerciseId: "exercise-a",
    outcome: "partial",
    submittedAnswer: "retry one",
  });
  const hint2 = revealNextTutorHint(lesson, retry1);
  const repaired = revealTutorRepairExplanation(lesson, hint2);
  const recovered = recordRecoveryAttempt(repaired, {
    exerciseId: "exercise-a",
    outcome: "correct",
    submittedAnswer: "retry two",
  });

  assert.equal(recovered.phase, "complete");
  assert.equal(recovered.recoveryOutcome, "recovered");
  assert.equal(recovered.originalIndependentAttempt?.submittedAnswer, "first answer");
  assert.deepEqual(recovered.revealedHintIds, ["hint-1", "hint-2"]);
  assert.equal(recovered.recoveryAttempts.length, 2);
  assert.equal(initial.phase, "teaching");
  assert.deepEqual(initial.revealedTeachingBlockIds, []);
});

test("guided transitions fail closed when support order is bypassed", () => {
  const initial = createGuidedLessonState(lesson, "exercise-a");
  assert.throws(() => submitSelfExplanation(lesson, initial, "too early"), /not active/iu);
  const ready = revealNextTeachingBlock(lesson, revealNextTeachingBlock(lesson, initial));
  assert.throws(() => revealSelfExplanationAnswer(lesson, ready), /submit/iu);
  const explained = revealSelfExplanationAnswer(
    lesson,
    submitSelfExplanation(lesson, ready, "answer"),
  );
  const failed = recordIndependentAttempt(explained, {
    exerciseId: "exercise-a",
    outcome: "incorrect",
  });
  assert.throws(() => revealTutorRepairExplanation(lesson, failed), /progressively stronger/iu);
  assert.equal(completeGuidedLesson(failed).recoveryOutcome, "unresolved");
});

test("session evidence separates guided assistance from independent scoring", () => {
  const aspect: LearningAspectV1 = {
    id: "aspect-a",
    title: "Aspect A",
    purpose: "Learn A",
    status: "supported",
    prerequisiteAspectIds: [],
    sourceSegmentIds: ["seg-a"],
  };
  const evidence = createSessionExerciseEvidence({
    assignment: { exerciseId: "exercise-a", aspectIds: [aspect.id], role: "guided-check" },
    set: { id: "set-a", title: "Set A" },
    aspects: [aspect],
    assistance: {
      originalIndependentAttempt: { exerciseId: "exercise-a", outcome: "incorrect" },
      hintsRevealed: 2,
      retries: 1,
      repairExplanationRevealed: true,
      recoveryOutcome: "recovered",
    },
  });
  assert.equal(evidence.independent, false);
  assert.equal(evidence.hintsRevealed, 2);
  assert.equal(evidence.retries, 1);
  assert.equal(evidence.recoveryOutcome, "recovered");
});

function exercise(id: string, type: ExerciseV1["type"]): ExerciseV1 {
  const base = { id, title: id, prompt: id, difficulty: "medium" as const, sourceSegmentIds: ["seg-a"] };
  if (type === "single-select") {
    return { ...base, type, choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctChoiceIds: ["a"], groundedAnswer: "A" };
  }
  return { ...base, type: "short-answer", groundedAnswer: "Answer", acceptableAnswers: ["Answer"], keyPoints: ["Answer"] };
}

test("path sequencing preserves step order and isolates deterministic set shuffling", () => {
  const exercises = [
    exercise("e1", "short-answer"),
    exercise("e2", "single-select"),
    exercise("e3", "short-answer"),
  ];
  const set: PracticeSetV1 = {
    id: "set-a",
    title: "Set A",
    purpose: "Purpose",
    instructionalRole: "foundations",
    order: 0,
    assignments: exercises.map((entry) => ({ exerciseId: entry.id, aspectIds: ["aspect-a"], role: "independent" })),
  };
  const path: LearningPathV1 = {
    id: "path-a",
    title: "Path",
    startingLevel: "new-to-topic",
    aspectIds: ["aspect-a"],
    steps: [
      { kind: "lesson", lessonId: lesson.id, order: 0 },
      { kind: "practice-set", setId: set.id, order: 1 },
    ],
  };
  const options = { mode: "shuffle-all" as const, seed: 42 };
  const first = sequencePracticeSetItems(set, exercises, options).map((entry) => entry.id);
  const second = sequencePracticeSetItems(set, exercises, options).map((entry) => entry.id);
  assert.deepEqual(first, second);
  const sequence = sequenceLearningPathItems(path, [set], [lesson], exercises, options);
  assert.deepEqual(sequence.map((entry) => entry.kind), ["lesson", "practice-set"]);
});
