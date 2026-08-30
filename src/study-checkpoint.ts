import { createSessionSummary } from "./bank-repository";
import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  type CompletedTutorLessonSnapshotV3,
  type ExerciseV1,
  type ExerciseAlignmentSnapshotV1,
  type LearningAspectV1,
  type LearningPathV1,
  type PracticeBankV2,
  type PracticeBankV4,
  type PracticeSetV1,
  type PracticeSourceV1,
  type SessionExerciseEvidenceV3,
  type SessionLearningScopeV3,
  type SourceAlignmentLedgerV1,
  type SourceMaterialV2,
  type SourceSegmentV1,
  type TutorLessonV1,
  type VisualSourceV1,
} from "./model";
import type { GuidedAttemptRecord, GuidedLessonStudyState } from "./learning-study";
import type { SessionLearningMetadataV3 } from "./learning-path";
import { isReasoningEffort } from "./reasoning";
import { validatePracticeBank } from "./schema";
import { isAiContextCompletionPolicy } from "./ai-context-completion";
import {
  createExerciseAlignmentSnapshots,
  emptySourceAlignmentLedger,
} from "./source-alignment";
import { tutorTeachingBlocksAreOrdered } from "./tutor-teaching-blocks";
import type {
  AnswerReviewMode,
  FinishedStudySession,
  ProviderId,
  StudyAnswerRecord,
  StudyCurrentInputStateV1,
  StudySessionProgressV1,
} from "./ui/contracts";

export const STUDY_SESSION_CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const MAX_STUDY_CHECKPOINT_BYTES = 12 * 1024 * 1024;

export interface StudyGuidedLessonCheckpointV1 {
  /** Exact lesson content needed to resume even if the live bank changes. */
  readonly lesson: TutorLessonV1;
  /** Transition state includes revealed blocks/hints and immutable attempts. */
  readonly state: GuidedLessonStudyState;
  /** Unsaved text in the currently visible tutor input. */
  readonly currentInput: string;
}

/** Complete approved learning workspace, excluding mutable history/provenance. */
export interface StudyLearningContextSnapshotV1 {
  readonly sourceMaterials: readonly SourceMaterialV2[];
  readonly sourceAlignment: SourceAlignmentLedgerV1;
  readonly segments: readonly SourceSegmentV1[];
  readonly visuals: readonly VisualSourceV1[];
  readonly exercises: readonly ExerciseV1[];
  readonly aspects: readonly LearningAspectV1[];
  readonly practiceSets: readonly PracticeSetV1[];
  readonly tutorLessons: readonly TutorLessonV1[];
  readonly learningPath: LearningPathV1 | null;
}

export interface StudySessionLearningProgressV1 {
  readonly schemaVersion: 1;
  /** Immutable named set/path scope for the eventual historical session. */
  readonly scope: SessionLearningScopeV3;
  /** Null outside a learning path; otherwise the next/current path step. */
  readonly pathStepIndex: number | null;
  /** Current set within set, mixed, or path study. */
  readonly activeSetId: string | null;
  readonly activeLesson: StudyGuidedLessonCheckpointV1 | null;
  /** Append-only historical snapshots, one per completed answer. */
  readonly evidence: readonly SessionExerciseEvidenceV3[];
  /** Append-only lesson completion snapshots. */
  readonly completedTutorLessons: readonly CompletedTutorLessonSnapshotV3[];
  /** Added to new checkpoints; optional keeps already-saved v1 progress readable. */
  readonly context?: StudyLearningContextSnapshotV1;
}

export interface StudySessionCheckpointV1 {
  readonly schemaVersion: typeof STUDY_SESSION_CHECKPOINT_SCHEMA_VERSION;
  readonly phase: "active" | "merging";
  readonly bankPath: string;
  readonly bankId: string;
  readonly bankRevisionAtStart: number;
  readonly exerciseCountAtStart: number;
  readonly source: PracticeSourceV1;
  readonly segments: readonly SourceSegmentV1[];
  readonly visuals: readonly VisualSourceV1[];
  /** Exact bank exercises, locked in the order selected for this session. */
  readonly exercises: readonly ExerciseV1[];
  /** Immutable post-answer course-alignment evidence for offline recovery. */
  readonly alignmentSnapshots?: readonly ExerciseAlignmentSnapshotV1[];
  readonly sessionId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt?: string;
  readonly currentQuestionIndex: number;
  readonly answers: readonly StudyAnswerRecord[];
  /** Added after the original v1 contract; absence means no skipped questions. */
  readonly skippedExerciseIds?: readonly string[];
  readonly currentInput: StudyCurrentInputStateV1 | null;
  readonly answerReviewMode: AnswerReviewMode;
  readonly answerReviewProvider: ProviderId;
  readonly answerReviewReasoningEffort: StudySessionProgressV1["answerReviewReasoningEffort"];
  /** Optional so every pre-learning-path v1 checkpoint remains readable. */
  readonly learningProgress?: StudySessionLearningProgressV1;
}

export type StudySessionCheckpointParseResult =
  | { readonly status: "ok"; readonly checkpoint: StudySessionCheckpointV1 }
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "unsupported-version"; readonly schemaVersion: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "codex" || value === "claude" || value === "agy";
}

function isAnswerReviewMode(value: unknown): value is AnswerReviewMode {
  return value === "self" || value === "ai";
}

function safeVaultPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) {
    return false;
  }
  const normalized = value.replace(/\\/gu, "/");
  return !normalized.startsWith("/")
    && !/^[A-Za-z]:\//u.test(normalized)
    && normalized.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function safeId(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
}

function isCheckpointExerciseArray(value: unknown): value is readonly ExerciseV1[] {
  return Array.isArray(value)
    && value.every((exercise) => isRecord(exercise) && safeId(exercise.id));
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function inputStateProblem(
  value: unknown,
  expectedExerciseId: string | undefined,
): string | null {
  if (expectedExerciseId === undefined) {
    return value === null ? null : "currentInput must be empty after the last question";
  }
  if (!isRecord(value) || value.exerciseId !== expectedExerciseId) {
    return "currentInput must match the current exercise";
  }
  if (!isRecord(value.fields)) return "currentInput.fields must be an object";
  const fields = Object.entries(value.fields);
  if (fields.length > 256) return "currentInput has too many fields";
  for (const [key, fieldValue] of fields) {
    if (key.length === 0 || key.length > 240 || typeof fieldValue !== "string" || fieldValue.length > 50_000) {
      return "currentInput contains an invalid field";
    }
  }
  if (
    !Array.isArray(value.selectedIds)
    || value.selectedIds.length > 256
    || value.selectedIds.some((id) => !safeId(id))
    || new Set(value.selectedIds).size !== value.selectedIds.length
  ) {
    return "currentInput.selectedIds is invalid";
  }
  if (
    !Array.isArray(value.ordering)
    || value.ordering.length > 512
    || value.ordering.some((id) => !safeId(id))
    || new Set(value.ordering).size !== value.ordering.length
  ) {
    return "currentInput.ordering is invalid";
  }
  if (value.submitted !== null) {
    if (
      !isRecord(value.submitted)
      || typeof value.submitted.answer !== "string"
      || value.submitted.answer.length > 100_000
      || (
        value.submitted.correct !== undefined
        && typeof value.submitted.correct !== "boolean"
      )
    ) {
      return "currentInput.submitted is invalid";
    }
  }
  return null;
}

function nonEmptyText(value: unknown, maximum = 100_000): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum;
}

function uniqueSafeIds(value: unknown, minimum = 0, maximum = 512): value is readonly string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every((id) => safeId(id))
    && new Set(value).size === value.length;
}

function namedReferenceProblem(value: unknown): string | null {
  return !isRecord(value) || !safeId(value.id) || !nonEmptyText(value.title, 2_000)
    ? "named reference is invalid"
    : null;
}

function learningScopeProblem(value: unknown): string | null {
  if (!isRecord(value)) return "learning scope must be an object";
  if (
    value.mode !== "quick"
    && value.mode !== "set"
    && value.mode !== "mixed"
    && value.mode !== "learning-path"
  ) return "learning scope mode is invalid";
  if (
    !Array.isArray(value.sets)
    || value.sets.length < 1
    || value.sets.length > 6
    || value.sets.some((entry) => namedReferenceProblem(entry) !== null)
    || new Set(value.sets.map((entry) => (entry as { id: string }).id)).size !== value.sets.length
  ) return "learning scope sets are invalid";
  if (
    (value.mode === "quick" || value.mode === "set")
    && value.sets.length !== 1
  ) return `${value.mode} learning scope requires exactly one practice set`;
  if (value.mode === "mixed" && value.sets.length < 2) {
    return "mixed learning scope requires at least two practice sets";
  }
  if (value.mode === "learning-path") {
    if (namedReferenceProblem(value.learningPath) !== null) {
      return "learning-path scope requires a named path";
    }
  } else if (value.learningPath !== undefined) {
    return "only learning-path scope may identify a path";
  }
  return null;
}

function sourceReferencesProblem(
  value: unknown,
  segmentIds: ReadonlySet<string>,
): string | null {
  return !uniqueSafeIds(value, 1)
    || value.some((id) => !segmentIds.has(id))
    ? "source references are invalid or absent from the locked snapshot"
    : null;
}

function tutorLessonProblem(
  value: unknown,
  exerciseIds: ReadonlySet<string>,
  segmentIds: ReadonlySet<string>,
): string | null {
  if (!isRecord(value)) return "active tutor lesson must be an object";
  if (
    !safeId(value.id)
    || !nonEmptyText(value.title, 2_000)
    || !nonEmptyText(value.objective)
    || !uniqueSafeIds(value.aspectIds, 1)
    || !uniqueSafeIds(value.prerequisiteAspectIds)
    || value.prerequisiteAspectIds.some((id) =>
      (value.aspectIds as readonly string[]).includes(id)
    )
    || !safeId(value.guidedExerciseId)
    || !exerciseIds.has(value.guidedExerciseId)
  ) return "active tutor lesson identity, aspects, or guided exercise is invalid";

  if (
    !Array.isArray(value.teachingBlocks)
    || value.teachingBlocks.length < 1
    || value.teachingBlocks.length > 128
  ) return "active tutor lesson teaching blocks are invalid";
  const blockIds: string[] = [];
  for (const block of value.teachingBlocks) {
    if (
      !isRecord(block)
      || !safeId(block.id)
      || (
        block.kind !== "why"
        && block.kind !== "prerequisite"
        && block.kind !== "explanation"
        && block.kind !== "worked-example"
        && block.kind !== "causal-walkthrough"
      )
      || !nonEmptyText(block.title, 2_000)
      || !nonEmptyText(block.content)
      || sourceReferencesProblem(block.sourceSegmentIds, segmentIds) !== null
    ) return "active tutor lesson contains an invalid teaching block";
    blockIds.push(block.id);
  }
  if (new Set(blockIds).size !== blockIds.length) {
    return "active tutor lesson teaching-block IDs are duplicated";
  }
  const blockKinds = new Set(value.teachingBlocks.map((block) =>
    (block as { kind: TutorLessonV1["teachingBlocks"][number]["kind"] }).kind
  ));
  if (!blockKinds.has("why") || !blockKinds.has("prerequisite") || !blockKinds.has("explanation")) {
    return "active tutor lesson requires why, prerequisite, and explanation blocks";
  }
  if (!tutorTeachingBlocksAreOrdered(
    value.teachingBlocks as TutorLessonV1["teachingBlocks"],
  )) {
    return "active tutor lesson teaching blocks must follow why, prerequisite, explanation, then optional walkthrough order";
  }

  const check = value.selfExplanationCheck;
  if (
    !isRecord(check)
    || !nonEmptyText(check.prompt)
    || !nonEmptyText(check.groundedAnswer)
    || !Array.isArray(check.keyPoints)
    || check.keyPoints.length < 1
    || check.keyPoints.length > 128
    || check.keyPoints.some((point) => !nonEmptyText(point, 10_000))
    || sourceReferencesProblem(check.sourceSegmentIds, segmentIds) !== null
  ) return "active tutor lesson self-explanation check is invalid";

  if (!Array.isArray(value.hints) || value.hints.length < 2 || value.hints.length > 3) {
    return "active tutor lesson must contain two or three hints";
  }
  const hintIds: string[] = [];
  for (const [index, hint] of value.hints.entries()) {
    if (
      !isRecord(hint)
      || !safeId(hint.id)
      || hint.level !== index + 1
      || !nonEmptyText(hint.text)
      || sourceReferencesProblem(hint.sourceSegmentIds, segmentIds) !== null
    ) return "active tutor lesson contains an invalid hint";
    hintIds.push(hint.id);
  }
  if (new Set(hintIds).size !== hintIds.length) {
    return "active tutor lesson hint IDs are duplicated";
  }
  const repair = value.repairExplanation;
  if (
    !isRecord(repair)
    || !nonEmptyText(repair.text)
    || sourceReferencesProblem(repair.sourceSegmentIds, segmentIds) !== null
  ) return "active tutor lesson repair explanation is invalid";
  return null;
}

function attemptProblem(value: unknown, exerciseId: string): string | null {
  if (
    !isRecord(value)
    || value.exerciseId !== exerciseId
    || (
      value.outcome !== "incorrect"
      && value.outcome !== "partial"
      && value.outcome !== "correct"
    )
    || (
      value.submittedAnswer !== undefined
      && (typeof value.submittedAnswer !== "string" || value.submittedAnswer.length > 100_000)
    )
  ) return "guided attempt is invalid";
  return null;
}

function guidedLessonStateProblem(
  value: unknown,
  lesson: TutorLessonV1,
): string | null {
  if (!isRecord(value)) return "guided lesson state must be an object";
  if (
    value.schemaVersion !== 1
    || value.lessonId !== lesson.id
    || value.independentExerciseId !== lesson.guidedExerciseId
    || (
      value.phase !== "teaching"
      && value.phase !== "self-explanation"
      && value.phase !== "independent"
      && value.phase !== "recovery"
      && value.phase !== "complete"
    )
  ) return "guided lesson state identity or phase is invalid";

  const blockIds = lesson.teachingBlocks.map((block) => block.id);
  if (
    !uniqueSafeIds(value.revealedTeachingBlockIds)
    || value.revealedTeachingBlockIds.some((id, index) => id !== blockIds[index])
  ) return "revealed teaching blocks must be a source-order prefix";
  const allBlocksRevealed = value.revealedTeachingBlockIds.length === blockIds.length;
  if ((value.phase === "teaching") === allBlocksRevealed) {
    return "guided lesson phase does not match its revealed teaching blocks";
  }

  if (
    value.selfExplanationAnswer !== null
    && (typeof value.selfExplanationAnswer !== "string" || value.selfExplanationAnswer.length > 100_000)
  ) return "guided self-explanation answer is invalid";
  if (typeof value.selfExplanationAnswerRevealed !== "boolean") {
    return "guided self-explanation reveal state is invalid";
  }
  if (
    value.selfExplanationAnswerRevealed
    && (value.selfExplanationAnswer === null || value.selfExplanationAnswer.trim().length === 0)
  ) return "the grounded self-explanation cannot be revealed before an answer";
  if (
    (value.phase === "teaching" || value.phase === "self-explanation")
    && value.selfExplanationAnswerRevealed
  ) return "guided lesson phase precedes the grounded self-explanation reveal";
  if (
    (value.phase === "independent" || value.phase === "recovery" || value.phase === "complete")
    && !value.selfExplanationAnswerRevealed
  ) return "guided lesson phase requires the grounded self-explanation reveal";

  if (
    !Array.isArray(value.recoveryAttempts)
    || value.recoveryAttempts.length > 128
    || value.recoveryAttempts.some((attempt) =>
      attemptProblem(attempt, lesson.guidedExerciseId) !== null
    )
  ) return "guided recovery attempts are invalid";
  if (
    value.originalIndependentAttempt !== null
    && attemptProblem(value.originalIndependentAttempt, lesson.guidedExerciseId) !== null
  ) return "the original guided attempt is invalid";

  const hintIds = lesson.hints.map((hint) => hint.id);
  if (
    !uniqueSafeIds(value.revealedHintIds)
    || value.revealedHintIds.some((id, index) => id !== hintIds[index])
  ) return "revealed hints must be a strength-ordered prefix";
  if (typeof value.repairExplanationRevealed !== "boolean") {
    return "guided repair reveal state is invalid";
  }
  if (value.repairExplanationRevealed && value.revealedHintIds.length !== hintIds.length) {
    return "the repair explanation cannot precede every staged hint";
  }
  if (
    value.recoveryOutcome !== "not-recorded"
    && value.recoveryOutcome !== "not-needed"
    && value.recoveryOutcome !== "recovered"
    && value.recoveryOutcome !== "unresolved"
  ) return "guided recovery outcome is invalid";

  const original = value.originalIndependentAttempt as GuidedAttemptRecord | null;
  const recoveryHasCorrect = value.recoveryAttempts.some((attempt) =>
    (attempt as { outcome?: unknown }).outcome === "correct"
  );
  if (original === null) {
    if (
      value.phase === "recovery"
      || value.phase === "complete"
      || value.recoveryAttempts.length > 0
      || value.revealedHintIds.length > 0
      || value.repairExplanationRevealed
      || value.recoveryOutcome !== "not-recorded"
    ) return "guided assistance cannot precede the original attempt";
  } else if (original.outcome === "correct") {
    if (
      value.phase !== "complete"
      || value.recoveryAttempts.length > 0
      || value.revealedHintIds.length > 0
      || value.repairExplanationRevealed
      || value.recoveryOutcome !== "not-needed"
    ) return "a correct original attempt must complete without recovery";
  } else if (value.phase === "recovery") {
    if (recoveryHasCorrect || value.recoveryOutcome !== "not-recorded") {
      return "an active recovery cannot already contain a successful retry";
    }
  } else if (value.phase === "complete") {
    if (
      recoveryHasCorrect !== (value.recoveryOutcome === "recovered")
      || (!recoveryHasCorrect && value.recoveryOutcome !== "unresolved")
    ) return "completed guided recovery outcome does not match its retries";
  } else {
    return "an original failed attempt must enter recovery or complete unresolved";
  }
  return null;
}

function sessionEvidenceProblem(value: unknown): string | null {
  if (!isRecord(value) || !safeId(value.exerciseId)) return "learning evidence identity is invalid";
  if (namedReferenceProblem(value.set) !== null) return "learning evidence set is invalid";
  if (
    !Array.isArray(value.aspects)
    || value.aspects.length < 1
    || value.aspects.length > 128
    || value.aspects.some((entry) => namedReferenceProblem(entry) !== null)
    || new Set(value.aspects.map((entry) => (entry as { id: string }).id)).size !== value.aspects.length
  ) return "learning evidence aspects are invalid";
  if (
    value.instructionalRole !== "guided-check"
    && value.instructionalRole !== "independent"
    && value.instructionalRole !== "transfer"
    && value.instructionalRole !== "diagnostic"
  ) return "learning evidence instructional role is invalid";
  if (
    typeof value.independent !== "boolean"
    || value.independent !== (value.instructionalRole !== "guided-check")
    || !Number.isInteger(value.hintsRevealed)
    || (value.hintsRevealed as number) < 0
    || !Number.isInteger(value.retries)
    || (value.retries as number) < 0
    || (
      value.recoveryOutcome !== "not-recorded"
      && value.recoveryOutcome !== "not-needed"
      && value.recoveryOutcome !== "recovered"
      && value.recoveryOutcome !== "unresolved"
    )
  ) return "learning evidence assistance snapshot is invalid";
  return null;
}

function completedLessonProblem(value: unknown): string | null {
  if (!isRecord(value) || namedReferenceProblem(value.lesson) !== null) {
    return "completed tutor lesson identity is invalid";
  }
  if (
    !Array.isArray(value.aspects)
    || value.aspects.length < 1
    || value.aspects.length > 128
    || value.aspects.some((entry) => namedReferenceProblem(entry) !== null)
    || new Set(value.aspects.map((entry) => (entry as { id: string }).id)).size !== value.aspects.length
  ) return "completed tutor lesson aspects are invalid";
  return null;
}

function learningContextFromBank(bank: PracticeBankV2): StudyLearningContextSnapshotV1 {
  if (bank.schemaVersion !== CURRENT_PRACTICE_BANK_SCHEMA_VERSION) {
    throw new Error("Guided study checkpoints require a current PracticeBankV4 workspace.");
  }
  const current = bank as PracticeBankV4;
  return {
    sourceMaterials: current.sourceMaterials.map((entry) => structuredClone(entry)),
    sourceAlignment: structuredClone(current.sourceAlignment),
    segments: current.segments.map((entry) => structuredClone(entry)),
    visuals: current.visuals.map((entry) => structuredClone(entry)),
    exercises: current.exercises.map((entry) => structuredClone(entry)),
    aspects: current.aspects.map((entry) => structuredClone(entry)),
    practiceSets: current.practiceSets.map((entry) => structuredClone(entry)),
    tutorLessons: current.tutorLessons.map((entry) => structuredClone(entry)),
    learningPath: current.learningPath === null
      ? null
      : structuredClone(current.learningPath),
  };
}

function syntheticLearningBank(
  checkpoint: Pick<
    StudySessionCheckpointV1,
    "bankId" | "bankRevisionAtStart" | "source" | "startedAt" | "updatedAt"
  >,
  context: StudyLearningContextSnapshotV1,
): PracticeBankV4 {
  return {
    schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
    bankId: checkpoint.bankId,
    revision: checkpoint.bankRevisionAtStart,
    createdAt: checkpoint.startedAt,
    updatedAt: checkpoint.updatedAt,
    source: structuredClone(checkpoint.source),
    segments: context.segments.map((entry) => structuredClone(entry)),
    visuals: context.visuals.map((entry) => structuredClone(entry)),
    exercises: context.exercises.map((entry) => structuredClone(entry)),
    sessions: [],
    sourceMaterials: context.sourceMaterials.map((entry) => structuredClone(entry)),
    sourceAlignment: structuredClone(context.sourceAlignment),
    aspects: context.aspects.map((entry) => structuredClone(entry)),
    practiceSets: context.practiceSets.map((entry) => structuredClone(entry)),
    tutorLessons: context.tutorLessons.map((entry) => structuredClone(entry)),
    learningPath: context.learningPath === null
      ? null
      : structuredClone(context.learningPath),
  };
}

function learningContextProblem(
  value: unknown,
  checkpoint: Pick<
    StudySessionCheckpointV1,
    "bankId" | "bankRevisionAtStart" | "source" | "startedAt" | "updatedAt"
  >,
): string | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.sourceMaterials)
    || !isRecord(value.sourceAlignment)
    || !Array.isArray(value.segments)
    || !Array.isArray(value.visuals)
    || !Array.isArray(value.exercises)
    || !Array.isArray(value.aspects)
    || !Array.isArray(value.practiceSets)
    || !Array.isArray(value.tutorLessons)
    || (value.learningPath !== null && !isRecord(value.learningPath))
  ) return "the approved learning context snapshot is incomplete";
  const context = value as unknown as StudyLearningContextSnapshotV1;
  const bank = syntheticLearningBank(checkpoint, context);
  const validation = validatePracticeBank(bank);
  if (validation.ok) return null;
  const first = validation.issues[0];
  return `approved learning context is invalid: ${first?.path ?? "/"}: ${first?.message ?? "unknown error"}`;
}

function lockLearningProgress(
  bank: PracticeBankV2,
  progress: StudySessionLearningProgressV1,
): StudySessionLearningProgressV1 {
  const context = learningContextFromBank(bank);
  if (
    progress.context !== undefined
    && canonicalJson(progress.context) !== canonicalJson(context)
  ) {
    throw new Error("The supplied learning context no longer matches the bank that started the session.");
  }
  return { ...structuredClone(progress), context };
}

function learningProgressProblem(
  value: unknown,
  checkpoint: Pick<
    StudySessionCheckpointV1,
    | "phase"
    | "answers"
    | "skippedExerciseIds"
    | "exercises"
    | "segments"
    | "bankId"
    | "bankRevisionAtStart"
    | "source"
    | "startedAt"
    | "updatedAt"
  >,
): string | null {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return "learningProgress version or shape is invalid";
  }
  const scopeProblem = learningScopeProblem(value.scope);
  if (scopeProblem !== null) return scopeProblem;
  const scope = value.scope as SessionLearningScopeV3;
  if (
    value.pathStepIndex !== null
    && (
      !Number.isInteger(value.pathStepIndex)
      || (value.pathStepIndex as number) < 0
      || (value.pathStepIndex as number) > 10_000
    )
  ) return "learning-path step position is invalid";
  if ((scope.mode === "learning-path") !== (value.pathStepIndex !== null)) {
    return "learning-path scope and step position are inconsistent";
  }
  const setIds = new Set(scope.sets.map((set) => set.id));
  const scopedSets = new Map(scope.sets.map((set) => [set.id, set]));
  let context: StudyLearningContextSnapshotV1 | undefined;
  if (value.context !== undefined) {
    const contextProblem = learningContextProblem(value.context, checkpoint);
    if (contextProblem !== null) return contextProblem;
    context = value.context as StudyLearningContextSnapshotV1;
    const contextSets = new Map(context.practiceSets.map((set) => [set.id, set]));
    if (scope.sets.some((reference) => {
      const set = contextSets.get(reference.id);
      return set === undefined || set.title !== reference.title;
    })) return "learning scope set snapshots do not match the approved context";
    if (scope.mode === "learning-path") {
      if (
        context.learningPath === null
        || context.learningPath.id !== scope.learningPath?.id
        || context.learningPath.title !== scope.learningPath.title
        || (value.pathStepIndex as number) > context.learningPath.steps.length
      ) return "learning-path scope or position does not match the approved context";
    }
    const contextExerciseIds = new Set(context.exercises.map((exercise) => exercise.id));
    if (checkpoint.exercises.some((exercise) => !contextExerciseIds.has(exercise.id))) {
      return "the locked session exercises are outside the approved learning context";
    }
  }
  if (
    value.activeSetId !== null
    && (!safeId(value.activeSetId) || !setIds.has(value.activeSetId))
  ) return "active practice set is outside the locked learning scope";

  if (!Array.isArray(value.evidence) || value.evidence.length !== checkpoint.answers.length) {
    return "learning evidence must contain one snapshot per completed answer";
  }
  const answerIds = checkpoint.answers.map((answer) => answer.exerciseId);
  if (value.evidence.some((entry, index) =>
    sessionEvidenceProblem(entry) !== null
    || (entry as { exerciseId?: unknown }).exerciseId !== answerIds[index]
    || !setIds.has((entry as { set: { id: string } }).set.id)
    || scopedSets.get((entry as { set: { id: string } }).set.id)?.title
      !== (entry as { set: { title: string } }).set.title
  )) return "learning evidence must match completed answers and their locked set scope";
  if (
    checkpoint.phase === "merging"
    && value.evidence.length > 0
    && (checkpoint.skippedExerciseIds ?? []).length === 0
  ) {
    const contributingSetIds = new Set(value.evidence.map((entry) =>
      (entry as SessionExerciseEvidenceV3).set.id
    ));
    if (
      contributingSetIds.size !== setIds.size
      || scope.sets.some((set) => !contributingSetIds.has(set.id))
    ) return "every locked practice set must contribute evidence before the final merge";
  }
  if (context !== undefined) {
    const contextSets = new Map(context.practiceSets.map((set) => [set.id, set]));
    const contextAspects = new Map(context.aspects.map((aspect) => [aspect.id, aspect]));
    if (value.evidence.some((entry) => {
      const evidence = entry as SessionExerciseEvidenceV3;
      const set = contextSets.get(evidence.set.id);
      return set?.title !== evidence.set.title
        || evidence.aspects.some((reference) =>
          contextAspects.get(reference.id)?.title !== reference.title
        );
    })) return "learning evidence names do not match the approved context";
  }

  if (
    !Array.isArray(value.completedTutorLessons)
    || value.completedTutorLessons.length > 1_024
    || value.completedTutorLessons.some((entry) => completedLessonProblem(entry) !== null)
    || new Set(value.completedTutorLessons.map((entry) =>
      (entry as { lesson: { id: string } }).lesson.id
    )).size !== value.completedTutorLessons.length
  ) return "completed tutor-lesson snapshots are invalid";
  if (context !== undefined) {
    const contextLessons = new Map(context.tutorLessons.map((lesson) => [lesson.id, lesson]));
    if (value.completedTutorLessons.some((entry) => {
      const completed = entry as CompletedTutorLessonSnapshotV3;
      const lesson = contextLessons.get(completed.lesson.id);
      return lesson === undefined || !completedLessonMatches(completed, lesson, context);
    })) return "completed tutor-lesson names do not match the approved context";
  }

  if (value.activeLesson !== null) {
    if (scope.mode !== "learning-path" || !isRecord(value.activeLesson)) {
      return "an active tutor lesson requires learning-path scope";
    }
    const exerciseIds = new Set(checkpoint.exercises.map((exercise) => exercise.id));
    const segmentIds = new Set(checkpoint.segments.map((segment) => segment.id));
    const lessonProblem = tutorLessonProblem(value.activeLesson.lesson, exerciseIds, segmentIds);
    if (lessonProblem !== null) return lessonProblem;
    const lesson = value.activeLesson.lesson as TutorLessonV1;
    if (context !== undefined) {
      const approvedLesson = context.tutorLessons.find((entry) => entry.id === lesson.id);
      if (canonicalJson(approvedLesson) !== canonicalJson(lesson)) {
        return "the active tutor lesson does not match the approved learning context";
      }
      const path = context.learningPath;
      const step = path?.steps.find((entry) => entry.order === value.pathStepIndex);
      if (step?.kind !== "lesson" || step.lessonId !== lesson.id) {
        return "the active tutor lesson does not match the locked path position";
      }
    }
    const stateProblem = guidedLessonStateProblem(value.activeLesson.state, lesson);
    if (stateProblem !== null) return stateProblem;
    if (typeof value.activeLesson.currentInput !== "string" || value.activeLesson.currentInput.length > 100_000) {
      return "active tutor input is invalid";
    }
    if (value.completedTutorLessons.some((entry) =>
      (entry as { lesson: { id: string } }).lesson.id === lesson.id
    )) return "the active tutor lesson is already recorded as completed";
    if (checkpoint.phase === "merging") {
      return "a pending final merge cannot retain an active tutor lesson; completion must be appended first";
    }
  }
  return null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function immutablePrefix(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return next.length >= previous.length
    && previous.every((entry, index) => canonicalJson(entry) === canonicalJson(next[index]));
}

function completedLessonMatches(
  entry: CompletedTutorLessonSnapshotV3,
  lesson: TutorLessonV1,
  context?: StudyLearningContextSnapshotV1,
): boolean {
  if (entry.lesson.id !== lesson.id || entry.lesson.title !== lesson.title) return false;
  return entry.aspects.length > 0 && entry.aspects.every((reference) => {
    if (!lesson.aspectIds.includes(reference.id)) return false;
    const approved = context?.aspects.find((aspect) => aspect.id === reference.id);
    return approved === undefined || reference.title === approved.title;
  });
}

function guidedStateTransitionProblem(
  previous: GuidedLessonStudyState,
  next: GuidedLessonStudyState,
): string | null {
  const phaseOrder = new Map([
    ["teaching", 0],
    ["self-explanation", 1],
    ["independent", 2],
    ["recovery", 3],
    ["complete", 4],
  ] as const);
  if (
    previous.lessonId !== next.lessonId
    || previous.independentExerciseId !== next.independentExerciseId
    || (phaseOrder.get(next.phase) ?? -1) < (phaseOrder.get(previous.phase) ?? -1)
    || !immutablePrefix(previous.revealedTeachingBlockIds, next.revealedTeachingBlockIds)
    || !immutablePrefix(previous.revealedHintIds, next.revealedHintIds)
    || !immutablePrefix(previous.recoveryAttempts, next.recoveryAttempts)
    || (previous.selfExplanationAnswer !== null
      && previous.selfExplanationAnswer !== next.selfExplanationAnswer)
    || (previous.selfExplanationAnswerRevealed && !next.selfExplanationAnswerRevealed)
    || (previous.originalIndependentAttempt !== null
      && canonicalJson(previous.originalIndependentAttempt)
        !== canonicalJson(next.originalIndependentAttempt))
    || (previous.repairExplanationRevealed && !next.repairExplanationRevealed)
    || (previous.recoveryOutcome !== "not-recorded"
      && previous.recoveryOutcome !== next.recoveryOutcome)
  ) return "guided lesson recovery state attempted to rewrite earlier progress";
  return null;
}

function learningProgressTransitionProblem(
  previous: StudySessionLearningProgressV1,
  next: StudySessionLearningProgressV1,
  previousSkippedExerciseIds: readonly string[] = [],
  nextSkippedExerciseIds: readonly string[] = [],
): string | null {
  if (canonicalJson(previous.scope) !== canonicalJson(next.scope)) {
    return "the locked learning set/path scope cannot change during a session";
  }
  if (
    previous.context !== undefined
    && canonicalJson(previous.context) !== canonicalJson(next.context)
  ) return "the approved learning context snapshot is immutable";
  if (
    previous.pathStepIndex !== null
    && next.pathStepIndex !== null
    && next.pathStepIndex < previous.pathStepIndex
  ) return "the learning-path position cannot move backward";
  if (!immutablePrefix(previous.evidence, next.evidence)) {
    return "completed independent-attempt evidence is immutable";
  }
  if (!immutablePrefix(previous.completedTutorLessons, next.completedTutorLessons)) {
    return "completed tutor-lesson evidence is immutable";
  }

  const oldLesson = previous.activeLesson;
  const newLesson = next.activeLesson;
  if (oldLesson === null) return null;
  const leavesCompletedLesson = oldLesson.state.phase === "complete"
    && (newLesson === null || oldLesson.lesson.id !== newLesson.lesson.id);
  if (
    leavesCompletedLesson
    && !next.completedTutorLessons
      .slice(previous.completedTutorLessons.length)
      .some((entry) => completedLessonMatches(
        entry,
        oldLesson.lesson,
        previous.context ?? next.context,
      ))
  ) {
    return "a completed tutor lesson must append its immutable completion snapshot before the path advances";
  }
  if (newLesson === null) {
    const guidedExerciseWasSkipped = !previousSkippedExerciseIds.includes(
      oldLesson.lesson.guidedExerciseId,
    ) && nextSkippedExerciseIds.includes(oldLesson.lesson.guidedExerciseId);
    return oldLesson.state.phase === "complete" || guidedExerciseWasSkipped
      ? null
      : "an unfinished tutor lesson cannot be discarded";
  }
  if (oldLesson.lesson.id !== newLesson.lesson.id) {
    return oldLesson.state.phase === "complete"
      && previous.pathStepIndex !== null
      && next.pathStepIndex !== null
      && next.pathStepIndex > previous.pathStepIndex
      ? null
      : "a tutor lesson can change only after completing and advancing the path";
  }
  if (canonicalJson(oldLesson.lesson) !== canonicalJson(newLesson.lesson)) {
    return "the active tutor lesson snapshot is immutable";
  }
  return guidedStateTransitionProblem(oldLesson.state, newLesson.state);
}

function progressLearningProgress(
  progress: StudySessionProgressV1,
): StudySessionLearningProgressV1 | undefined {
  if (!isRecord(progress)) return undefined;
  const value = progress.learningProgress;
  return value === undefined
    ? undefined
    : structuredClone(value);
}

function syntheticBank(
  value: Pick<
    StudySessionCheckpointV1,
    | "bankId"
    | "bankRevisionAtStart"
    | "source"
    | "segments"
    | "visuals"
    | "exercises"
    | "startedAt"
    | "updatedAt"
  >,
): PracticeBankV2 {
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: value.bankId,
    revision: value.bankRevisionAtStart,
    createdAt: value.startedAt,
    updatedAt: value.updatedAt,
    source: structuredClone(value.source),
    segments: value.segments.map((segment) => structuredClone(segment)),
    visuals: value.visuals.map((visual) => structuredClone(visual)),
    exercises: value.exercises.map((exercise) => structuredClone(exercise)),
    sessions: [],
  };
}

function alignmentSnapshotsProblem(
  value: unknown,
  exerciseIds: readonly string[],
): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > exerciseIds.length) {
    return "alignment snapshots must be a bounded array";
  }
  const allowed = new Set(exerciseIds);
  const seen = new Set<string>();
  for (const snapshot of value) {
    if (
      !isRecord(snapshot)
      || typeof snapshot.exerciseId !== "string"
      || !allowed.has(snapshot.exerciseId)
      || seen.has(snapshot.exerciseId)
      || !Array.isArray(snapshot.records)
      || (
        snapshot.aiContextCompletionPolicy !== undefined
        && !isAiContextCompletionPolicy(snapshot.aiContextCompletionPolicy)
      )
      || (
        snapshot.state !== "course-aligned"
        && snapshot.state !== "notes-differ"
        && snapshot.state !== "notes-incomplete"
        && snapshot.state !== "notes-grounded-unverified"
        && snapshot.state !== "school-sources-disagree"
        && snapshot.state !== "insufficient-evidence"
      )
    ) return "alignment snapshots are invalid or reference the wrong exercise";
    seen.add(snapshot.exerciseId);
  }
  return null;
}

function checkpointProblem(value: StudySessionCheckpointV1): string | null {
  if (!safeVaultPath(value.bankPath)) return "bankPath is not a safe vault-relative path";
  if (!safeId(value.bankId) || !safeId(value.sessionId)) return "bank or session identity is invalid";
  if (
    !Number.isInteger(value.bankRevisionAtStart)
    || value.bankRevisionAtStart < 0
    || !Number.isInteger(value.exerciseCountAtStart)
    || value.exerciseCountAtStart < 1
  ) {
    return "bank revision or exercise count is invalid";
  }
  if (!validDate(value.startedAt) || !validDate(value.updatedAt)) {
    return "checkpoint timestamps are invalid";
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.startedAt)) {
    return "checkpoint update precedes its start";
  }
  if (value.phase === "merging") {
    if (!validDate(value.finishedAt) || Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
      return "a merging checkpoint needs a valid finish time";
    }
  } else if (value.finishedAt !== undefined) {
    return "an active checkpoint cannot have a finish time";
  }
  if (
    !isCheckpointExerciseArray(value.exercises)
    || value.exercises.length !== value.exerciseCountAtStart
    || value.exercises.length === 0
  ) {
    return "the locked exercise count does not match the checkpoint";
  }
  const exercises = value.exercises;
  const exerciseIds = exercises.map((exercise) => exercise.id);
  if (new Set(exerciseIds).size !== exerciseIds.length) {
    return "the locked exercise order contains duplicate IDs";
  }
  const alignmentProblem = alignmentSnapshotsProblem(
    value.alignmentSnapshots,
    exerciseIds,
  );
  if (alignmentProblem !== null) return alignmentProblem;
  if (
    !Number.isInteger(value.currentQuestionIndex)
    || value.currentQuestionIndex < 0
    || value.currentQuestionIndex > exercises.length
  ) {
    return "currentQuestionIndex is outside the locked session";
  }
  if (!Array.isArray(value.answers)) {
    return "completed answers must be an array";
  }
  const skippedExerciseIds = value.skippedExerciseIds ?? [];
  if (
    !Array.isArray(skippedExerciseIds)
    || skippedExerciseIds.some((id) => !safeId(id))
    || new Set(skippedExerciseIds).size !== skippedExerciseIds.length
  ) {
    return "skipped exercise IDs are invalid or duplicated";
  }
  const answers = value.answers as readonly StudyAnswerRecord[];
  const validatedSkippedExerciseIds = skippedExerciseIds as readonly string[];
  const answerIds = answers.map((answer) => answer.exerciseId);
  const completedIds = [...answerIds, ...validatedSkippedExerciseIds];
  if (new Set(completedIds).size !== completedIds.length) {
    return "an exercise cannot be both answered and skipped";
  }
  if (completedIds.length !== value.currentQuestionIndex) {
    return "answered and skipped questions must match the current question index";
  }
  const completedPrefix = exerciseIds.slice(0, value.currentQuestionIndex);
  const completedIdSet = new Set(completedIds);
  if (
    completedPrefix.some((id) => !completedIdSet.has(id))
    || completedIds.some((id) => !completedPrefix.includes(id))
  ) {
    return "answered and skipped questions must exactly match the completed question prefix";
  }
  const inputProblem = inputStateProblem(
    value.currentInput,
    exercises[value.currentQuestionIndex]?.id,
  );
  if (inputProblem !== null) return inputProblem;
  if (!isAnswerReviewMode(value.answerReviewMode)) return "answerReviewMode is invalid";
  if (!isProviderId(value.answerReviewProvider)) return "answerReviewProvider is invalid";
  if (!isReasoningEffort(value.answerReviewReasoningEffort)) {
    return "answerReviewReasoningEffort is invalid";
  }
  if (value.learningProgress !== undefined) {
    const learningProblem = learningProgressProblem(value.learningProgress, value);
    if (learningProblem !== null) return learningProblem;
  }

  const bank = syntheticBank(value);
  const bankValidation = validatePracticeBank(bank);
  if (!bankValidation.ok) {
    const first = bankValidation.issues[0];
    return `locked bank snapshot is invalid: ${first?.path ?? "/"}: ${first?.message ?? "unknown error"}`;
  }
  try {
    createSessionSummary(bank, {
      id: value.sessionId,
      startedAt: value.startedAt,
      finishedAt: value.finishedAt ?? value.updatedAt,
      answers,
      skippedExerciseIds: validatedSkippedExerciseIds,
      bankRevisionAtStart: value.bankRevisionAtStart,
      exerciseCountAtStart: value.exerciseCountAtStart,
      orderedExerciseIds: exerciseIds,
    });
  } catch (error) {
    return `completed answer snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

export function parseStudySessionCheckpoint(
  value: unknown,
): StudySessionCheckpointParseResult {
  if (value === undefined || value === null) return { status: "missing" };
  if (!isRecord(value)) return { status: "invalid", message: "checkpoint must be an object" };
  if (value.schemaVersion !== STUDY_SESSION_CHECKPOINT_SCHEMA_VERSION) {
    return { status: "unsupported-version", schemaVersion: value.schemaVersion };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { status: "invalid", message: "checkpoint cannot be serialized" };
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_STUDY_CHECKPOINT_BYTES) {
    return { status: "invalid", message: "checkpoint exceeds the 12 MB safety limit" };
  }
  const checkpoint = migrateLegacyCheckpointContext(
    structuredClone(value) as unknown as StudySessionCheckpointV1,
  );
  const problem = checkpointProblem(checkpoint);
  return problem === null
    ? { status: "ok", checkpoint }
    : { status: "invalid", message: problem };
}

function migrateLegacyCheckpointContext(
  checkpoint: StudySessionCheckpointV1,
): StudySessionCheckpointV1 {
  const legacyExerciseIds = safeCheckpointExerciseIds(checkpoint.exercises);
  const alignmentSnapshots = checkpoint.alignmentSnapshots === undefined
    && legacyExerciseIds !== null
    ? legacyExerciseIds.map((exerciseId) => ({
        exerciseId,
        state: "notes-grounded-unverified" as const,
        records: [],
      }))
    : checkpoint.alignmentSnapshots;
  const migratedCheckpoint: StudySessionCheckpointV1 = {
    ...checkpoint,
    ...(alignmentSnapshots === undefined ? {} : { alignmentSnapshots }),
  };
  const progress = migratedCheckpoint.learningProgress;
  if (progress === undefined) return migratedCheckpoint;
  const context = progress.context;
  if (context === undefined) return migratedCheckpoint;
  const raw = context as unknown as {
    readonly sourceMaterials: readonly Record<string, unknown>[];
    readonly sourceAlignment?: unknown;
  };
  const sourceMaterials = raw.sourceMaterials.map((material) => ({
    ...material,
    classification: material.classification ?? "unclassified",
    classificationState: material.classificationState ?? "migration-default",
  })) as unknown as StudyLearningContextSnapshotV1["sourceMaterials"];
  return {
    ...migratedCheckpoint,
    learningProgress: {
      ...progress,
      context: {
        ...context,
        sourceMaterials,
        sourceAlignment: raw.sourceAlignment === undefined
          ? emptySourceAlignmentLedger()
          : raw.sourceAlignment as SourceAlignmentLedgerV1,
      },
    },
  };
}

function safeCheckpointExerciseIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const exerciseIds: string[] = [];
  for (const exercise of value as unknown[]) {
    if (!isRecord(exercise) || typeof exercise.id !== "string") return null;
    exerciseIds.push(exercise.id);
  }
  return exerciseIds;
}

function citedSnapshot(
  bank: PracticeBankV2,
  orderedExerciseIds: readonly string[],
  learningProgress?: StudySessionLearningProgressV1,
): {
  readonly exercises: readonly ExerciseV1[];
  readonly segments: readonly SourceSegmentV1[];
  readonly visuals: readonly VisualSourceV1[];
} {
  const exercisesById = new Map(bank.exercises.map((exercise) => [exercise.id, exercise]));
  const exercises = orderedExerciseIds.map((id) => {
    const exercise = exercisesById.get(id);
    if (exercise === undefined) throw new Error(`Unknown locked exercise: ${id}`);
    return structuredClone(exercise);
  });
  if (new Set(orderedExerciseIds).size !== orderedExerciseIds.length) {
    throw new Error("The locked exercise order contains duplicate IDs.");
  }
  const segmentIds = new Set(exercises.flatMap((exercise) => exercise.sourceSegmentIds));
  const tutorLessons = learningProgress === undefined
    ? []
    : bank.schemaVersion === CURRENT_PRACTICE_BANK_SCHEMA_VERSION
      ? (bank as PracticeBankV4).tutorLessons
      : learningProgress.activeLesson === null
        ? []
        : [learningProgress.activeLesson.lesson];
  for (const lesson of tutorLessons) {
    for (const id of lesson.teachingBlocks.flatMap((block) => block.sourceSegmentIds)) {
      segmentIds.add(id);
    }
    for (const id of lesson.selfExplanationCheck.sourceSegmentIds) segmentIds.add(id);
    for (const id of lesson.hints.flatMap((hint) => hint.sourceSegmentIds)) segmentIds.add(id);
    for (const id of lesson.repairExplanation.sourceSegmentIds) segmentIds.add(id);
  }
  const segments = bank.segments
    .filter((segment) => segmentIds.has(segment.id))
    .map((segment, ordinal) => ({
      ...structuredClone(segment),
      ordinal,
    }));
  const visualIds = new Set(exercises.flatMap((exercise) =>
    exercise.type === "image-occlusion" ? [exercise.visualId] : [],
  ));
  const visuals = bank.visuals
    .filter((visual) => visualIds.has(visual.id))
    .map((visual) => structuredClone(visual));
  return { exercises, segments, visuals };
}

export function createStudySessionCheckpoint(
  bankPath: string,
  bank: PracticeBankV2,
  progress: StudySessionProgressV1,
  updatedAt = new Date().toISOString(),
): StudySessionCheckpointV1 {
  if (
    progress.bankPath !== bankPath
    || progress.bankId !== bank.bankId
    || progress.bankRevisionAtStart !== bank.revision
  ) {
    throw new Error("The study checkpoint no longer matches the bank that started it.");
  }
  if (progress.exerciseCountAtStart !== progress.orderedExerciseIds.length) {
    throw new Error("The study checkpoint exercise count is inconsistent.");
  }
  const suppliedLearningProgress = progressLearningProgress(progress);
  const learningProgress = suppliedLearningProgress === undefined
    ? undefined
    : lockLearningProgress(bank, suppliedLearningProgress);
  const snapshot = citedSnapshot(bank, progress.orderedExerciseIds, learningProgress);
  const alignmentSnapshots = bank.schemaVersion === CURRENT_PRACTICE_BANK_SCHEMA_VERSION
    ? createExerciseAlignmentSnapshots(
        bank as PracticeBankV4,
        progress.orderedExerciseIds,
      )
    : [...(progress.alignmentSnapshots ?? [])].map((entry) => structuredClone(entry));
  if (
    progress.alignmentSnapshots !== undefined
    && canonicalJson(progress.alignmentSnapshots) !== canonicalJson(alignmentSnapshots)
  ) {
    throw new Error("The study alignment evidence no longer matches the bank that started it.");
  }
  const checkpoint: StudySessionCheckpointV1 = {
    schemaVersion: STUDY_SESSION_CHECKPOINT_SCHEMA_VERSION,
    phase: "active",
    bankPath,
    bankId: bank.bankId,
    bankRevisionAtStart: bank.revision,
    exerciseCountAtStart: progress.exerciseCountAtStart,
    source: structuredClone(bank.source),
    segments: snapshot.segments,
    visuals: snapshot.visuals,
    exercises: snapshot.exercises,
    alignmentSnapshots,
    sessionId: progress.sessionId,
    startedAt: progress.startedAt,
    updatedAt,
    currentQuestionIndex: progress.currentQuestionIndex,
    answers: structuredClone(progress.answers),
    skippedExerciseIds: [...(progress.skippedExerciseIds ?? [])],
    currentInput: structuredClone(progress.currentInput),
    answerReviewMode: progress.answerReviewMode,
    answerReviewProvider: progress.answerReviewProvider,
    answerReviewReasoningEffort: progress.answerReviewReasoningEffort,
    ...(learningProgress === undefined ? {} : { learningProgress }),
  };
  const parsed = parseStudySessionCheckpoint(checkpoint);
  if (parsed.status !== "ok") {
    throw new Error(
      parsed.status === "invalid"
        ? parsed.message
        : "The new study checkpoint could not be validated.",
    );
  }
  return parsed.checkpoint;
}

export function updateStudySessionCheckpoint(
  checkpoint: StudySessionCheckpointV1,
  progress: StudySessionProgressV1,
  updatedAt = new Date().toISOString(),
): StudySessionCheckpointV1 {
  const expectedIds = checkpoint.exercises.map((exercise) => exercise.id);
  if (
    checkpoint.phase !== "active"
    || progress.bankPath !== checkpoint.bankPath
    || progress.bankId !== checkpoint.bankId
    || progress.bankRevisionAtStart !== checkpoint.bankRevisionAtStart
    || progress.sessionId !== checkpoint.sessionId
    || JSON.stringify(progress.orderedExerciseIds) !== JSON.stringify(expectedIds)
  ) {
    throw new Error("The active study progress does not match its locked checkpoint.");
  }
  if (
    progress.alignmentSnapshots !== undefined
    && canonicalJson(progress.alignmentSnapshots)
      !== canonicalJson(checkpoint.alignmentSnapshots ?? [])
  ) {
    throw new Error("The active study progress attempted to replace its locked alignment evidence.");
  }
  const rawSuppliedLearningProgress = progressLearningProgress(progress);
  let suppliedLearningProgress = rawSuppliedLearningProgress;
  if (
    rawSuppliedLearningProgress !== undefined
    && checkpoint.learningProgress?.context !== undefined
  ) {
    if (
      rawSuppliedLearningProgress.context !== undefined
      && canonicalJson(rawSuppliedLearningProgress.context)
        !== canonicalJson(checkpoint.learningProgress.context)
    ) {
      throw new Error("The active study progress attempted to replace its approved learning context.");
    }
    suppliedLearningProgress = {
      ...rawSuppliedLearningProgress,
      context: structuredClone(checkpoint.learningProgress.context),
    };
  }
  const learningProgress = suppliedLearningProgress ?? checkpoint.learningProgress;
  if (checkpoint.learningProgress !== undefined && suppliedLearningProgress !== undefined) {
    const transitionProblem = learningProgressTransitionProblem(
      checkpoint.learningProgress,
      suppliedLearningProgress,
      checkpoint.skippedExerciseIds ?? [],
      progress.skippedExerciseIds ?? [],
    );
    if (transitionProblem !== null) throw new Error(transitionProblem);
  }
  const next: StudySessionCheckpointV1 = {
    ...checkpoint,
    updatedAt,
    currentQuestionIndex: progress.currentQuestionIndex,
    answers: structuredClone(progress.answers),
    skippedExerciseIds: [...(progress.skippedExerciseIds ?? [])],
    currentInput: structuredClone(progress.currentInput),
    alignmentSnapshots: checkpoint.alignmentSnapshots?.map((entry) =>
      structuredClone(entry)
    ) ?? [],
    answerReviewMode: progress.answerReviewMode,
    answerReviewProvider: progress.answerReviewProvider,
    answerReviewReasoningEffort: progress.answerReviewReasoningEffort,
    ...(learningProgress === undefined ? {} : { learningProgress }),
  };
  const parsed = parseStudySessionCheckpoint(next);
  if (parsed.status !== "ok") {
    throw new Error(parsed.status === "invalid" ? parsed.message : "Updated checkpoint is invalid.");
  }
  return parsed.checkpoint;
}

export function markStudySessionCheckpointMerging(
  checkpoint: StudySessionCheckpointV1,
  session: FinishedStudySession,
): StudySessionCheckpointV1 {
  if (checkpoint.phase !== "active" || session.id !== checkpoint.sessionId) {
    throw new Error("The finished session does not match its active checkpoint.");
  }
  const lockedLearning = checkpoint.learningProgress === undefined
    ? undefined
    : {
        scope: checkpoint.learningProgress.scope,
        evidence: checkpoint.learningProgress.evidence,
        completedTutorLessons: checkpoint.learningProgress.completedTutorLessons,
      };
  if (canonicalJson(lockedLearning) !== canonicalJson(session.learning)) {
    throw new Error("The finished session learning evidence does not match its locked checkpoint.");
  }
  if (
    canonicalJson(checkpoint.skippedExerciseIds ?? [])
      !== canonicalJson(session.skippedExerciseIds ?? [])
  ) {
    throw new Error("The finished session skipped questions do not match its locked checkpoint.");
  }
  const finishedAt = session.finishedAt;
  const next: StudySessionCheckpointV1 = {
    ...checkpoint,
    phase: "merging",
    updatedAt: finishedAt,
    finishedAt,
    currentQuestionIndex: checkpoint.exercises.length,
    answers: structuredClone(session.answers),
    skippedExerciseIds: [...(session.skippedExerciseIds ?? [])],
    currentInput: null,
  };
  const parsed = parseStudySessionCheckpoint(next);
  if (parsed.status !== "ok") {
    throw new Error(parsed.status === "invalid" ? parsed.message : "Finished checkpoint is invalid.");
  }
  return parsed.checkpoint;
}

export type FinishedStudySessionWithLearningV1 = FinishedStudySession & {
  readonly learning?: SessionLearningMetadataV3;
};

export function finishedSessionFromCheckpoint(
  checkpoint: StudySessionCheckpointV1,
): FinishedStudySessionWithLearningV1 {
  if (checkpoint.phase !== "merging" || checkpoint.finishedAt === undefined) {
    throw new Error("Only a merging checkpoint can be converted to a finished session.");
  }
  const learning = checkpoint.learningProgress === undefined
    ? undefined
    : {
        scope: structuredClone(checkpoint.learningProgress.scope),
        evidence: checkpoint.learningProgress.evidence.map((entry) => structuredClone(entry)),
        completedTutorLessons: checkpoint.learningProgress.completedTutorLessons.map((entry) =>
          structuredClone(entry)
        ),
      } satisfies SessionLearningMetadataV3;
  return {
    id: checkpoint.sessionId,
    startedAt: checkpoint.startedAt,
    finishedAt: checkpoint.finishedAt,
    answers: structuredClone(checkpoint.answers),
    skippedExerciseIds: [...(checkpoint.skippedExerciseIds ?? [])],
    bankRevisionAtStart: checkpoint.bankRevisionAtStart,
    exerciseCountAtStart: checkpoint.exerciseCountAtStart,
    orderedExerciseIds: checkpoint.exercises.map((exercise) => exercise.id),
    ...(learning === undefined ? {} : { learning }),
  };
}

export function checkpointBankSnapshot(
  checkpoint: StudySessionCheckpointV1,
): PracticeBankV2 {
  if (checkpoint.learningProgress?.context !== undefined) {
    return syntheticLearningBank(checkpoint, checkpoint.learningProgress.context);
  }
  return syntheticBank(checkpoint);
}
