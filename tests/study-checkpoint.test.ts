import assert from "node:assert/strict";
import test from "node:test";

import { createSessionSummary } from "../src/bank-repository";
import type { PracticeBankV2, PracticeBankV3 } from "../src/model";
import { migratePracticeBankV2ToV3 } from "../src/learning-path";
import { mergeSessionSummary } from "../src/persistence";
import { createSourceHash, segmentSource } from "../src/segmenter";
import {
  checkpointBankSnapshot,
  createStudySessionCheckpoint,
  finishedSessionFromCheckpoint,
  markStudySessionCheckpointMerging,
  parseStudySessionCheckpoint,
  updateStudySessionCheckpoint,
  type StudySessionLearningProgressV1,
} from "../src/study-checkpoint";
import {
  createGuidedLessonState,
  recordIndependentAttempt,
  recordRecoveryAttempt,
  revealNextTeachingBlock,
  revealNextTutorHint,
  revealSelfExplanationAnswer,
  submitSelfExplanation,
} from "../src/learning-study";
import type { GuidedLessonStudyState } from "../src/learning-study";
import type { TutorLessonV1 } from "../src/model";
import type { StudySessionProgressV1 } from "../src/ui/contracts";

function checkpointBank(): PracticeBankV2 {
  const sourceText = "# Synthetic\nAlpha causes beta.";
  const segments = segmentSource(sourceText);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: 2,
    bankId: "bank-checkpoint-synthetic",
    revision: 0,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    source: {
      vaultPath: "Notes/Synthetic.md",
      wikilink: "[[Notes/Synthetic]]",
      title: "Synthetic",
      scope: "note",
      hash: createSourceHash(sourceText),
    },
    segments,
    visuals: [],
    exercises: [{
      id: "exercise-checkpoint-1",
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

function startingProgress(bank: PracticeBankV2): StudySessionProgressV1 {
  const exercise = bank.exercises[0];
  assert.ok(exercise);
  return {
    bankPath: "Notes/Practice/Synthetic - Practice.md",
    bankId: bank.bankId,
    bankRevisionAtStart: bank.revision,
    exerciseCountAtStart: 1,
    sessionId: "session-checkpoint-1",
    startedAt: "2026-08-22T08:05:00.000Z",
    orderedExerciseIds: [exercise.id],
    currentQuestionIndex: 0,
    answers: [],
    currentInput: {
      exerciseId: exercise.id,
      fields: {},
      selectedIds: ["choice-beta"],
      ordering: [],
      submitted: null,
    },
    answerReviewMode: "ai",
    answerReviewProvider: "codex",
    answerReviewReasoningEffort: "ultra",
  };
}

function tutorLesson(bank: PracticeBankV2): TutorLessonV1 {
  const segmentId = bank.exercises[0]?.sourceSegmentIds[0];
  const exerciseId = bank.exercises[0]?.id;
  assert.ok(segmentId);
  assert.ok(exerciseId);
  return {
    id: "lesson-checkpoint-1",
    title: "Why alpha causes beta",
    objective: "Connect the supported premise to its consequence.",
    aspectIds: ["aspect-checkpoint"],
    prerequisiteAspectIds: [],
    guidedExerciseId: exerciseId,
    teachingBlocks: [
      {
        id: "block-checkpoint-why",
        kind: "why",
        title: "Why it matters",
        content: "The causal direction determines the prediction.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: "block-checkpoint-prerequisite",
        kind: "prerequisite",
        title: "Required premise",
        content: "Alpha is the named premise.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: "block-checkpoint-how",
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
        id: "hint-checkpoint-1",
        level: 1,
        text: "Identify the premise.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: "hint-checkpoint-2",
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

function guidedCheckpointBank(): PracticeBankV3 {
  const migrated = migratePracticeBankV2ToV3(checkpointBank());
  const lesson = tutorLesson(migrated);
  const segmentId = lesson.teachingBlocks[0]?.sourceSegmentIds[0];
  assert.ok(segmentId);
  return {
    ...migrated,
    aspects: [{
      id: "aspect-checkpoint",
      title: "Causal direction",
      purpose: "Trace the supported cause to its consequence.",
      prerequisiteAspectIds: [],
      sourceSegmentIds: [segmentId],
      status: "supported",
    }],
    practiceSets: [{
      id: "set-checkpoint",
      title: "Synthetic set",
      purpose: "Practice the approved causal direction.",
      instructionalRole: "foundations",
      order: 0,
      assignments: [{
        exerciseId: lesson.guidedExerciseId,
        aspectIds: ["aspect-checkpoint"],
        role: "guided-check",
      }],
    }],
    tutorLessons: [lesson],
    learningPath: {
      id: "path-checkpoint",
      title: "Synthetic path",
      startingLevel: "new-to-topic",
      aspectIds: ["aspect-checkpoint"],
      steps: [
        { kind: "lesson", lessonId: lesson.id, order: 0 },
        { kind: "practice-set", setId: "set-checkpoint", order: 1 },
      ],
    },
  };
}

function learningProgress(
  lesson: TutorLessonV1,
  state: GuidedLessonStudyState | null,
  currentInput: string,
  evidence: StudySessionLearningProgressV1["evidence"] = [],
  completedTutorLessons: StudySessionLearningProgressV1["completedTutorLessons"] = [],
): StudySessionLearningProgressV1 {
  return {
    schemaVersion: 1,
    scope: {
      mode: "learning-path",
      learningPath: { id: "path-checkpoint", title: "Synthetic path" },
      sets: [{ id: "set-checkpoint", title: "Synthetic set" }],
    },
    pathStepIndex: 0,
    activeSetId: "set-checkpoint",
    activeLesson: state === null
      ? null
      : { lesson, state, currentInput },
    evidence,
    completedTutorLessons,
  };
}

function withLearningProgress(
  progress: StudySessionProgressV1,
  learning: StudySessionLearningProgressV1,
): StudySessionProgressV1 & { readonly learningProgress: StudySessionLearningProgressV1 } {
  return { ...progress, learningProgress: learning };
}

test("study checkpoint restores current input and locks the exact bank revision", () => {
  const bank = checkpointBank();
  const checkpoint = createStudySessionCheckpoint(
    "Notes/Practice/Synthetic - Practice.md",
    bank,
    startingProgress(bank),
    "2026-08-22T08:05:05.000Z",
  );
  assert.equal(checkpoint.phase, "active");
  assert.deepEqual(checkpoint.currentInput?.selectedIds, ["choice-beta"]);
  assert.equal(checkpoint.answerReviewReasoningEffort, "ultra");
  assert.equal(parseStudySessionCheckpoint(checkpoint).status, "ok");
});

test("completed checkpoint merges once after a newer bank revision arrives", () => {
  const bank = checkpointBank();
  const active = createStudySessionCheckpoint(
    "Notes/Practice/Synthetic - Practice.md",
    bank,
    startingProgress(bank),
    "2026-08-22T08:05:05.000Z",
  );
  const completedProgress: StudySessionProgressV1 = {
    ...startingProgress(bank),
    currentQuestionIndex: 1,
    answers: [{ exerciseId: "exercise-checkpoint-1", correct: true }],
    currentInput: null,
  };
  const completed = updateStudySessionCheckpoint(
    active,
    completedProgress,
    "2026-08-22T08:05:50.000Z",
  );
  const merging = markStudySessionCheckpointMerging(completed, {
    id: completed.sessionId,
    startedAt: completed.startedAt,
    finishedAt: "2026-08-22T08:06:00.000Z",
    answers: completed.answers,
    bankRevisionAtStart: 0,
    exerciseCountAtStart: 1,
    orderedExerciseIds: ["exercise-checkpoint-1"],
  });
  const summary = createSessionSummary(
    checkpointBankSnapshot(merging),
    finishedSessionFromCheckpoint(merging),
  );
  const regenerated: PracticeBankV2 = {
    ...bank,
    revision: 2,
    updatedAt: "2026-08-22T08:05:30.000Z",
  };
  const first = mergeSessionSummary(regenerated, summary, { expectedRevision: 0 });
  assert.equal(
    first.status,
    "rebased",
    first.status === "invalid-session" || first.status === "conflict"
      ? first.message
      : undefined,
  );
  assert.equal(first.bank.sessions.length, 1);
  const second = mergeSessionSummary(first.bank, summary, { expectedRevision: 0 });
  assert.equal(second.status, "unchanged");
  assert.equal(second.bank.sessions.length, 1);
});

test("checkpoint parser rejects an input state for a different exercise", () => {
  const bank = checkpointBank();
  const checkpoint = createStudySessionCheckpoint(
    "Notes/Practice/Synthetic - Practice.md",
    bank,
    startingProgress(bank),
    "2026-08-22T08:05:05.000Z",
  );
  const malformed = {
    ...checkpoint,
    currentInput: {
      ...checkpoint.currentInput,
      exerciseId: "exercise-other",
    },
  };
  const parsed = parseStudySessionCheckpoint(malformed);
  assert.equal(parsed.status, "invalid");
});

test("guided checkpoint restores path position, tutor input, and progressive reveals", () => {
  const bank = guidedCheckpointBank();
  const lesson = tutorLesson(bank);
  const initial = createGuidedLessonState(lesson, lesson.guidedExerciseId);
  const revealed = revealNextTeachingBlock(lesson, initial);
  const progress = withLearningProgress(
    startingProgress(bank),
    learningProgress(lesson, revealed, "draft causal explanation"),
  );
  const checkpoint = createStudySessionCheckpoint(
    progress.bankPath,
    bank,
    progress,
    "2026-08-22T08:05:05.000Z",
  );

  assert.equal(checkpoint.learningProgress?.pathStepIndex, 0);
  assert.equal(checkpoint.learningProgress?.activeLesson?.currentInput, "draft causal explanation");
  assert.deepEqual(
    checkpoint.learningProgress?.activeLesson?.state.revealedTeachingBlockIds,
    ["block-checkpoint-why"],
  );
  const roundTrip = parseStudySessionCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
  assert.equal(roundTrip.status, "ok");

  const secondBlock = revealNextTeachingBlock(lesson, revealed);
  const thirdBlock = revealNextTeachingBlock(lesson, secondBlock);
  const explained = submitSelfExplanation(lesson, thirdBlock, "Alpha points to beta.");
  const updatedProgress = withLearningProgress(
    startingProgress(bank),
    learningProgress(lesson, explained, "Alpha points to beta."),
  );
  const updated = updateStudySessionCheckpoint(
    checkpoint,
    updatedProgress,
    "2026-08-22T08:05:15.000Z",
  );
  assert.equal(updated.learningProgress?.activeLesson?.state.phase, "self-explanation");
  assert.equal(
    checkpoint.learningProgress?.activeLesson?.state.revealedTeachingBlockIds.length,
    1,
  );
});

test("guided checkpoint locks the complete approved learning context for offline recovery", () => {
  const bank = guidedCheckpointBank();
  const lesson = tutorLesson(bank);
  const progress = withLearningProgress(
    startingProgress(bank),
    learningProgress(lesson, createGuidedLessonState(lesson, lesson.guidedExerciseId), ""),
  );
  const checkpoint = createStudySessionCheckpoint(progress.bankPath, bank, progress);
  const context = checkpoint.learningProgress?.context;
  assert.ok(context);
  assert.deepEqual(context.aspects, bank.aspects);
  assert.deepEqual(context.practiceSets, bank.practiceSets);
  assert.deepEqual(context.tutorLessons, bank.tutorLessons);
  assert.deepEqual(context.learningPath, bank.learningPath);

  bank.aspects = [];
  bank.practiceSets = [];
  bank.tutorLessons = [];
  bank.learningPath = null;
  bank.exercises[0] = { ...bank.exercises[0]!, prompt: "Regenerated prompt" };

  const restored = checkpointBankSnapshot(checkpoint);
  assert.equal(restored.schemaVersion, 3);
  const restoredV3 = restored as PracticeBankV3;
  assert.equal(restoredV3.learningPath?.id, "path-checkpoint");
  assert.equal(restoredV3.tutorLessons[0]?.id, lesson.id);
  assert.equal(restoredV3.exercises[0]?.prompt, "What does alpha cause?");

  const legacyCompatible = structuredClone(checkpoint) as {
    learningProgress?: { context?: unknown };
  };
  if (legacyCompatible.learningProgress !== undefined) {
    delete legacyCompatible.learningProgress.context;
  }
  assert.equal(parseStudySessionCheckpoint(legacyCompatible).status, "ok");
});

test("guided checkpoint makes the first attempt and recovery trail append-only", () => {
  const bank = guidedCheckpointBank();
  const lesson = tutorLesson(bank);
  let state = createGuidedLessonState(lesson, lesson.guidedExerciseId);
  state = revealNextTeachingBlock(lesson, state);
  state = revealNextTeachingBlock(lesson, state);
  state = revealNextTeachingBlock(lesson, state);
  state = submitSelfExplanation(lesson, state, "Alpha causes beta.");
  state = revealSelfExplanationAnswer(lesson, state);
  state = recordIndependentAttempt(state, {
    exerciseId: lesson.guidedExerciseId,
    outcome: "incorrect",
    submittedAnswer: "Gamma",
  });
  state = revealNextTutorHint(lesson, state);
  const progress = withLearningProgress(
    startingProgress(bank),
    learningProgress(lesson, state, "retry draft"),
  );
  const checkpoint = createStudySessionCheckpoint(progress.bankPath, bank, progress);

  let advanced = recordRecoveryAttempt(state, {
    exerciseId: lesson.guidedExerciseId,
    outcome: "partial",
    submittedAnswer: "Alpha relates to beta",
  });
  advanced = revealNextTutorHint(lesson, advanced);
  const updated = updateStudySessionCheckpoint(
    checkpoint,
    withLearningProgress(
      startingProgress(bank),
      learningProgress(lesson, advanced, "second retry"),
    ),
  );
  assert.equal(updated.learningProgress?.activeLesson?.state.recoveryAttempts.length, 1);
  assert.deepEqual(
    updated.learningProgress?.activeLesson?.state.revealedHintIds,
    ["hint-checkpoint-1", "hint-checkpoint-2"],
  );

  const rewritten: GuidedLessonStudyState = {
    ...structuredClone(advanced),
    originalIndependentAttempt: {
      exerciseId: lesson.guidedExerciseId,
      outcome: "partial",
      submittedAnswer: "rewritten first attempt",
    },
  };
  assert.throws(
    () => updateStudySessionCheckpoint(
      updated,
      withLearningProgress(
        startingProgress(bank),
        learningProgress(lesson, rewritten, "second retry"),
      ),
    ),
    /rewrite earlier progress|immutable/iu,
  );
});

test("leaving a completed tutor lesson requires an appended completion snapshot", () => {
  const bank = guidedCheckpointBank();
  const lesson = tutorLesson(bank);
  let state = createGuidedLessonState(lesson, lesson.guidedExerciseId);
  for (let index = 0; index < lesson.teachingBlocks.length; index += 1) {
    state = revealNextTeachingBlock(lesson, state);
  }
  state = submitSelfExplanation(lesson, state, "Alpha causes beta.");
  state = revealSelfExplanationAnswer(lesson, state);
  state = recordIndependentAttempt(state, {
    exerciseId: lesson.guidedExerciseId,
    outcome: "correct",
    submittedAnswer: "Beta",
  });
  assert.equal(state.phase, "complete");
  const active = createStudySessionCheckpoint(
    startingProgress(bank).bankPath,
    bank,
    withLearningProgress(
      startingProgress(bank),
      learningProgress(lesson, state, ""),
    ),
  );

  assert.throws(
    () => updateStudySessionCheckpoint(
      active,
      withLearningProgress(
        startingProgress(bank),
        learningProgress(lesson, null, ""),
      ),
    ),
    /must append its immutable completion snapshot/iu,
  );

  const completed = [{
    lesson: { id: lesson.id, title: lesson.title },
    aspects: [{ id: "aspect-checkpoint", title: "Causal direction" }],
  }];
  const advanced = updateStudySessionCheckpoint(
    active,
    withLearningProgress(
      startingProgress(bank),
      learningProgress(lesson, null, "", [], completed),
    ),
  );
  assert.deepEqual(advanced.learningProgress?.completedTutorLessons, completed);
});

test("pending final merge preserves exact set/path evidence and lesson completion", () => {
  const bank = guidedCheckpointBank();
  const lesson = tutorLesson(bank);
  const completedProgress: StudySessionProgressV1 = {
    ...startingProgress(bank),
    currentQuestionIndex: 1,
    answers: [{ exerciseId: lesson.guidedExerciseId, correct: true }],
    currentInput: null,
  };
  const evidence = [{
    exerciseId: lesson.guidedExerciseId,
    set: { id: "set-checkpoint", title: "Synthetic set" },
    aspects: [{ id: "aspect-checkpoint", title: "Causal direction" }],
    instructionalRole: "guided-check" as const,
    independent: false,
    hintsRevealed: 2,
    retries: 1,
    recoveryOutcome: "recovered" as const,
  }];
  const completedLessons = [{
    lesson: { id: lesson.id, title: lesson.title },
    aspects: [{ id: "aspect-checkpoint", title: "Causal direction" }],
  }];
  const progress = withLearningProgress(
    completedProgress,
    learningProgress(lesson, null, "", evidence, completedLessons),
  );
  const active = createStudySessionCheckpoint(progress.bankPath, bank, progress);
  const merging = markStudySessionCheckpointMerging(active, {
    id: active.sessionId,
    startedAt: active.startedAt,
    finishedAt: "2026-08-22T08:06:00.000Z",
    answers: completedProgress.answers,
    bankRevisionAtStart: bank.revision,
    exerciseCountAtStart: 1,
    orderedExerciseIds: [lesson.guidedExerciseId],
    learning: {
      scope: progress.learningProgress.scope,
      evidence,
      completedTutorLessons: completedLessons,
    },
  });
  assert.equal(parseStudySessionCheckpoint(merging).status, "ok");
  const restored = finishedSessionFromCheckpoint(merging);
  assert.deepEqual(restored.learning, {
    scope: progress.learningProgress.scope,
    evidence,
    completedTutorLessons: completedLessons,
  });
  const summary = createSessionSummary(checkpointBankSnapshot(merging), restored);
  assert.equal(summary.scope.learningPath?.id, "path-checkpoint");
  assert.equal(summary.evidence[0]?.independent, false);
  assert.equal(summary.evidence[0]?.hintsRevealed, 2);
  assert.equal(summary.completedTutorLessons[0]?.lesson.id, lesson.id);
});
