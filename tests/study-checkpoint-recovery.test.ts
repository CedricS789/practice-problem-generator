import assert from "node:assert/strict";
import test from "node:test";

import { migratePracticeBankV2ToV3 } from "../src/learning-path";
import {
  createGuidedLessonState,
  recordIndependentAttempt,
  recordRecoveryAttempt,
  revealNextTeachingBlock,
  revealNextTutorHint,
  revealSelfExplanationAnswer,
  revealTutorRepairExplanation,
  submitSelfExplanation,
  type GuidedLessonStudyState,
} from "../src/learning-study";
import type {
  PracticeBankV2,
  PracticeBankV3,
  TutorLessonV1,
} from "../src/model";
import { createSourceHash, segmentSource } from "../src/segmenter";
import {
  createStudySessionCheckpoint,
  markStudySessionCheckpointMerging,
  parseStudySessionCheckpoint,
  updateStudySessionCheckpoint,
  type StudySessionCheckpointV1,
  type StudySessionLearningProgressV1,
} from "../src/study-checkpoint";
import {
  hasMeaningfulStudyCheckpointProgress,
  rebaseLatestStudySessionCheckpointBankPath,
  rebaseStudySessionCheckpointBankPath,
  resolveStudyCheckpointBankCandidate,
  summarizeStudyCheckpointProgress,
} from "../src/study-checkpoint-recovery";
import type { StudySessionProgressV1 } from "../src/ui/contracts";

const ORIGINAL_PATH = "Notes/2025-26 - Q2/ELEC-Y418/02 - Practice/Image Sensors - Practice.md";
const RELOCATED_PATH = "Notes/2025-26 - Q2/ELEC-Y418/Practice/Image Sensors - Practice.md";

function checkpointBank(): PracticeBankV2 {
  const sourceText = "# Synthetic\nAlpha causes beta.";
  const segments = segmentSource(sourceText);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: 2,
    bankId: "bank-checkpoint-recovery",
    revision: 4,
    createdAt: "2026-08-24T08:00:00.000Z",
    updatedAt: "2026-08-24T08:00:00.000Z",
    source: {
      vaultPath: "Notes/2025-26 - Q2/ELEC-Y418/1 - Theory/Image Sensors.md",
      wikilink: "[[Notes/2025-26 - Q2/ELEC-Y418/1 - Theory/Image Sensors]]",
      title: "Image Sensors",
      scope: "note",
      hash: createSourceHash(sourceText),
    },
    segments,
    visuals: [],
    exercises: [{
      id: "exercise-recovery-1",
      type: "single-select",
      title: "Effect",
      prompt: "What does alpha cause?",
      difficulty: "easy",
      sourceSegmentIds: [paragraph.id],
      choices: [
        { id: "choice-beta", text: "Beta" },
        { id: "choice-gamma", text: "Gamma" },
      ],
      correctChoiceIds: ["choice-beta"],
      groundedAnswer: "Alpha causes beta.",
    }],
    sessions: [],
  };
}

function startingProgress(
  bank: PracticeBankV2,
  currentInput: StudySessionProgressV1["currentInput"] = {
    exerciseId: "exercise-recovery-1",
    fields: {},
    selectedIds: [],
    ordering: [],
    submitted: null,
  },
): StudySessionProgressV1 {
  return {
    bankPath: ORIGINAL_PATH,
    bankId: bank.bankId,
    bankRevisionAtStart: bank.revision,
    exerciseCountAtStart: bank.exercises.length,
    sessionId: "session-checkpoint-recovery",
    startedAt: "2026-08-24T08:05:00.000Z",
    orderedExerciseIds: bank.exercises.map((exercise) => exercise.id),
    currentQuestionIndex: 0,
    answers: [],
    currentInput,
    answerReviewMode: "self",
    answerReviewProvider: "codex",
    answerReviewReasoningEffort: "high",
  };
}

function freshCheckpoint(): StudySessionCheckpointV1 {
  const bank = checkpointBank();
  return createStudySessionCheckpoint(
    ORIGINAL_PATH,
    bank,
    startingProgress(bank),
    "2026-08-24T08:05:02.000Z",
  );
}

function tutorLesson(bank: PracticeBankV2): TutorLessonV1 {
  const exercise = bank.exercises[0];
  const segmentId = exercise?.sourceSegmentIds[0];
  assert.ok(exercise);
  assert.ok(segmentId);
  return {
    id: "lesson-recovery-1",
    title: "Why alpha causes beta",
    objective: "Connect the supported premise to its consequence.",
    aspectIds: ["aspect-recovery"],
    prerequisiteAspectIds: [],
    guidedExerciseId: exercise.id,
    teachingBlocks: [
      {
        id: "block-recovery-why",
        kind: "why",
        title: "Why it matters",
        content: "The causal direction determines the prediction.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: "block-recovery-prerequisite",
        kind: "prerequisite",
        title: "Required premise",
        content: "Alpha is the named premise.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: "block-recovery-explanation",
        kind: "explanation",
        title: "Premise to consequence",
        content: "Alpha is the supported cause and beta is its consequence.",
        sourceSegmentIds: [segmentId],
      },
    ],
    selfExplanationCheck: {
      prompt: "Explain the causal direction.",
      groundedAnswer: "Alpha causes beta.",
      keyPoints: ["Alpha is the cause", "Beta is the consequence"],
      sourceSegmentIds: [segmentId],
    },
    hints: [
      {
        id: "hint-recovery-1",
        level: 1,
        text: "Identify the premise.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: "hint-recovery-2",
        level: 2,
        text: "Follow the stated causal arrow.",
        sourceSegmentIds: [segmentId],
      },
    ],
    repairExplanation: {
      text: "The source explicitly states that alpha causes beta.",
      sourceSegmentIds: [segmentId],
    },
  };
}

function guidedBank(): PracticeBankV3 {
  const migrated = migratePracticeBankV2ToV3(checkpointBank());
  const lesson = tutorLesson(migrated);
  const segmentId = lesson.teachingBlocks[0]?.sourceSegmentIds[0];
  assert.ok(segmentId);
  return {
    ...migrated,
    aspects: [{
      id: "aspect-recovery",
      title: "Causal direction",
      purpose: "Trace the supported cause to its consequence.",
      prerequisiteAspectIds: [],
      sourceSegmentIds: [segmentId],
      status: "supported",
    }],
    practiceSets: [{
      id: "set-recovery",
      title: "Synthetic set",
      purpose: "Practice the approved causal direction.",
      instructionalRole: "foundations",
      order: 0,
      assignments: [{
        exerciseId: lesson.guidedExerciseId,
        aspectIds: ["aspect-recovery"],
        role: "guided-check",
      }],
    }],
    tutorLessons: [lesson],
    learningPath: {
      id: "path-recovery",
      title: "Synthetic path",
      startingLevel: "new-to-topic",
      aspectIds: ["aspect-recovery"],
      steps: [
        { kind: "lesson", lessonId: lesson.id, order: 0 },
        { kind: "practice-set", setId: "set-recovery", order: 1 },
      ],
    },
  };
}

function activeLearningProgress(
  lesson: TutorLessonV1,
  state: GuidedLessonStudyState,
): StudySessionLearningProgressV1 {
  return {
    schemaVersion: 1,
    scope: {
      mode: "learning-path",
      learningPath: { id: "path-recovery", title: "Synthetic path" },
      sets: [{ id: "set-recovery", title: "Synthetic set" }],
    },
    pathStepIndex: 0,
    activeSetId: "set-recovery",
    activeLesson: { lesson, state, currentInput: "retry draft" },
    evidence: [],
    completedTutorLessons: [],
  };
}

test("bank resolution accepts the exact matching identity and deduplicates path aliases", () => {
  const checkpoint = freshCheckpoint();
  const exact = {
    bankPath: ORIGINAL_PATH.replaceAll("/", "\\"),
    bankId: checkpoint.bankId,
    loaded: "exact",
  } as const;
  const resolution = resolveStudyCheckpointBankCandidate(checkpoint, [
    exact,
    { bankPath: ORIGINAL_PATH.toLocaleLowerCase(), bankId: checkpoint.bankId, loaded: "duplicate" },
    { bankPath: RELOCATED_PATH, bankId: checkpoint.bankId, loaded: "copy" },
  ]);
  assert.equal(resolution.status, "exact");
  assert.equal(resolution.status === "exact" ? resolution.candidate : undefined, exact);
});

test("bank resolution relocates only one matching bank ID and never guesses by source", () => {
  const checkpoint = freshCheckpoint();
  const relocated = { bankPath: RELOCATED_PATH, bankId: checkpoint.bankId };
  assert.deepEqual(
    resolveStudyCheckpointBankCandidate(checkpoint, [relocated]),
    { status: "relocated", candidate: relocated },
  );
  assert.deepEqual(
    resolveStudyCheckpointBankCandidate(checkpoint, [{
      bankPath: RELOCATED_PATH,
      bankId: "different-bank-id",
      sourcePath: checkpoint.source.vaultPath,
    }]),
    { status: "missing" },
  );
});

test("bank resolution fails closed when one identity exists at multiple relocated paths", () => {
  const checkpoint = freshCheckpoint();
  const first = { bankPath: "Notes/A/Practice/Bank.md", bankId: checkpoint.bankId };
  const second = { bankPath: "Notes/B/Practice/Bank.md", bankId: checkpoint.bankId };
  const resolution = resolveStudyCheckpointBankCandidate(checkpoint, [
    second,
    first,
    { bankPath: "notes/a/practice/bank.md", bankId: checkpoint.bankId },
  ]);
  assert.equal(resolution.status, "ambiguous");
  assert.deepEqual(
    resolution.status === "ambiguous"
      ? resolution.candidates.map((candidate) => candidate.bankPath)
      : [],
    [first.bankPath, second.bankPath],
  );
});

test("checkpoint path rebasing preserves every other field and runs full validation", () => {
  const checkpoint = freshCheckpoint();
  const rebased = rebaseStudySessionCheckpointBankPath(checkpoint, RELOCATED_PATH);
  assert.equal(rebased.bankPath, RELOCATED_PATH);
  assert.equal(rebased.updatedAt, checkpoint.updatedAt);
  assert.deepEqual({ ...rebased, bankPath: checkpoint.bankPath }, checkpoint);
  assert.equal(parseStudySessionCheckpoint(rebased).status, "ok");

  assert.throws(
    () => rebaseStudySessionCheckpointBankPath(checkpoint, "../outside.md"),
    /safe vault-relative path/iu,
  );
  assert.throws(
    () => rebaseStudySessionCheckpointBankPath({
      ...checkpoint,
      currentQuestionIndex: 1,
    }, RELOCATED_PATH),
    /invalid study checkpoint/iu,
  );
});

test("a relocation finishing after a progress flush preserves the newer progress", () => {
  const bank = checkpointBank();
  const firstExercise = bank.exercises[0];
  assert.ok(firstExercise);
  bank.exercises = [
    firstExercise,
    {
      ...firstExercise,
      id: "exercise-recovery-2",
      title: "Second effect",
      prompt: "Which consequence is supported a second time?",
    },
  ];
  const captured = createStudySessionCheckpoint(
    ORIGINAL_PATH,
    bank,
    startingProgress(bank),
    "2026-08-24T08:05:02.000Z",
  );
  const newer = updateStudySessionCheckpoint(captured, {
    ...startingProgress(bank, {
      exerciseId: "exercise-recovery-2",
      fields: { response: "new input written while lookup was pending" },
      selectedIds: [],
      ordering: [],
      submitted: null,
    }),
    currentQuestionIndex: 1,
    answers: [{ exerciseId: "exercise-recovery-1", correct: true }],
  });

  const result = rebaseLatestStudySessionCheckpointBankPath(
    captured,
    newer,
    RELOCATED_PATH,
  );

  assert.equal(result.status, "rebased");
  if (result.status !== "rebased") return;
  assert.equal(result.checkpoint.bankPath, RELOCATED_PATH);
  assert.deepEqual(result.checkpoint.answers, newer.answers);
  assert.deepEqual(result.checkpoint.currentInput, newer.currentInput);
  assert.equal(result.checkpoint.updatedAt, newer.updatedAt);
});

test("a newly opened checkpoint is not meaningful progress, but real drafts are", () => {
  const checkpoint = freshCheckpoint();
  assert.deepEqual(summarizeStudyCheckpointProgress(checkpoint), {
    phase: "active",
    answeredCount: 0,
    skippedCount: 0,
    currentQuestionIndex: 0,
    totalQuestionCount: 1,
    hasDraft: false,
    pendingFinalMerge: false,
    pathStepIndex: null,
    guidedEvidenceCount: 0,
    completedTutorLessonCount: 0,
    revealedTeachingBlockCount: 0,
    revealedHintCount: 0,
    guidedRetryCount: 0,
    guidedIndependentAttemptCount: 0,
    guidedAnswerRevealCount: 0,
    hasMeaningfulProgress: false,
  });
  assert.equal(hasMeaningfulStudyCheckpointProgress(checkpoint), false);

  const bank = checkpointBank();
  const draft = createStudySessionCheckpoint(
    ORIGINAL_PATH,
    bank,
    startingProgress(bank, {
      exerciseId: bank.exercises[0]?.id ?? "",
      fields: { answer: "draft answer" },
      selectedIds: [],
      ordering: [],
      submitted: null,
    }),
  );
  assert.equal(summarizeStudyCheckpointProgress(draft).hasDraft, true);
  assert.equal(hasMeaningfulStudyCheckpointProgress(draft), true);
});

test("an ordering question counts only a changed order as draft progress", () => {
  const bank = checkpointBank();
  const segmentIds = bank.exercises[0]?.sourceSegmentIds;
  assert.ok(segmentIds);
  bank.exercises = [{
    id: "exercise-recovery-1",
    type: "ordering",
    title: "Causal sequence",
    prompt: "Put the supported sequence in order.",
    difficulty: "easy",
    sourceSegmentIds: segmentIds,
    items: [
      { id: "event-alpha", text: "Alpha" },
      { id: "event-beta", text: "Beta" },
    ],
    correctOrder: ["event-alpha", "event-beta"],
    groundedAnswer: "Alpha precedes beta.",
  }];
  const unchanged = createStudySessionCheckpoint(
    ORIGINAL_PATH,
    bank,
    startingProgress(bank, {
      exerciseId: "exercise-recovery-1",
      fields: {},
      selectedIds: [],
      ordering: ["event-alpha", "event-beta"],
      submitted: null,
    }),
  );
  assert.equal(summarizeStudyCheckpointProgress(unchanged).hasDraft, false);

  const reordered = createStudySessionCheckpoint(
    ORIGINAL_PATH,
    bank,
    startingProgress(bank, {
      exerciseId: "exercise-recovery-1",
      fields: {},
      selectedIds: [],
      ordering: ["event-beta", "event-alpha"],
      submitted: null,
    }),
  );
  assert.equal(summarizeStudyCheckpointProgress(reordered).hasDraft, true);
});

test("answers, skips, and a pending final merge are meaningful recovery progress", () => {
  const bank = checkpointBank();
  const active = freshCheckpoint();
  const answered = updateStudySessionCheckpoint(active, {
    ...startingProgress(bank),
    currentQuestionIndex: 1,
    answers: [{ exerciseId: "exercise-recovery-1", correct: true }],
    currentInput: null,
  });
  assert.deepEqual(
    summarizeStudyCheckpointProgress(answered),
    {
      ...summarizeStudyCheckpointProgress(active),
      answeredCount: 1,
      currentQuestionIndex: 1,
      hasMeaningfulProgress: true,
    },
  );

  const skipped = updateStudySessionCheckpoint(active, {
    ...startingProgress(bank),
    currentQuestionIndex: 1,
    skippedExerciseIds: ["exercise-recovery-1"],
    currentInput: null,
  });
  assert.equal(summarizeStudyCheckpointProgress(skipped).skippedCount, 1);
  const merging = markStudySessionCheckpointMerging(skipped, {
    id: skipped.sessionId,
    startedAt: skipped.startedAt,
    finishedAt: "2026-08-24T08:06:00.000Z",
    answers: [],
    skippedExerciseIds: ["exercise-recovery-1"],
    bankRevisionAtStart: bank.revision,
    exerciseCountAtStart: 1,
    orderedExerciseIds: ["exercise-recovery-1"],
  });
  assert.equal(summarizeStudyCheckpointProgress(merging).pendingFinalMerge, true);
  assert.equal(hasMeaningfulStudyCheckpointProgress(merging), true);
});

test("guided drafts, evidence, reveals, hints, retries, and attempts are summarized", () => {
  const bank = guidedBank();
  const lesson = bank.tutorLessons[0];
  assert.ok(lesson);
  let state = createGuidedLessonState(lesson, lesson.guidedExerciseId);
  for (let index = 0; index < lesson.teachingBlocks.length; index += 1) {
    state = revealNextTeachingBlock(lesson, state);
  }
  state = submitSelfExplanation(lesson, state, "Alpha causes beta.");
  state = revealSelfExplanationAnswer(lesson, state);
  state = recordIndependentAttempt(state, {
    exerciseId: lesson.guidedExerciseId,
    outcome: "incorrect",
    submittedAnswer: "Gamma",
  });
  state = revealNextTutorHint(lesson, state);
  state = recordRecoveryAttempt(state, {
    exerciseId: lesson.guidedExerciseId,
    outcome: "partial",
    submittedAnswer: "Alpha relates to beta.",
  });
  state = revealNextTutorHint(lesson, state);
  state = revealTutorRepairExplanation(lesson, state);
  const progress = {
    ...startingProgress(bank),
    learningProgress: activeLearningProgress(lesson, state),
  };
  const checkpoint = createStudySessionCheckpoint(ORIGINAL_PATH, bank, progress);
  const summary = summarizeStudyCheckpointProgress(checkpoint);
  assert.equal(summary.hasDraft, true);
  assert.equal(summary.revealedTeachingBlockCount, 3);
  assert.equal(summary.revealedHintCount, 2);
  assert.equal(summary.guidedRetryCount, 1);
  assert.equal(summary.guidedIndependentAttemptCount, 1);
  assert.equal(summary.guidedAnswerRevealCount, 2);
  assert.equal(summary.hasMeaningfulProgress, true);
});

test("completed guided evidence and tutor lessons remain meaningful without an active lesson", () => {
  const bank = guidedBank();
  const lesson = bank.tutorLessons[0];
  assert.ok(lesson);
  const evidence = [{
    exerciseId: lesson.guidedExerciseId,
    set: { id: "set-recovery", title: "Synthetic set" },
    aspects: [{ id: "aspect-recovery", title: "Causal direction" }],
    instructionalRole: "guided-check" as const,
    independent: false,
    hintsRevealed: 0,
    retries: 0,
    recoveryOutcome: "not-needed" as const,
  }];
  const completedTutorLessons = [{
    lesson: { id: lesson.id, title: lesson.title },
    aspects: [{ id: "aspect-recovery", title: "Causal direction" }],
  }];
  const progress: StudySessionProgressV1 = {
    ...startingProgress(bank),
    currentQuestionIndex: 1,
    answers: [{ exerciseId: lesson.guidedExerciseId, correct: true }],
    currentInput: null,
    learningProgress: {
      schemaVersion: 1,
      scope: {
        mode: "learning-path",
        learningPath: { id: "path-recovery", title: "Synthetic path" },
        sets: [{ id: "set-recovery", title: "Synthetic set" }],
      },
      pathStepIndex: 1,
      activeSetId: "set-recovery",
      activeLesson: null,
      evidence,
      completedTutorLessons,
    },
  };
  const checkpoint = createStudySessionCheckpoint(ORIGINAL_PATH, bank, progress);
  const summary = summarizeStudyCheckpointProgress(checkpoint);
  assert.equal(summary.guidedEvidenceCount, 1);
  assert.equal(summary.completedTutorLessonCount, 1);
  assert.equal(summary.pathStepIndex, 1);
  assert.equal(summary.hasMeaningfulProgress, true);
});
