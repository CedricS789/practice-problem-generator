import type {
  ExerciseAssignmentV1,
  ExerciseV1,
  LearningAspectV1,
  LearningPathV1,
  PracticeSetV1,
  RecoveryOutcomeV1,
  SessionExerciseEvidenceV3,
  TutorLessonV1,
} from "./model";

export const GUIDED_LESSON_STUDY_VERSION = 1 as const;

export type GuidedAttemptOutcome = "incorrect" | "partial" | "correct";
export type GuidedLessonPhase =
  | "teaching"
  | "self-explanation"
  | "independent"
  | "recovery"
  | "complete";

export interface GuidedAttemptRecord {
  readonly exerciseId: string;
  readonly outcome: GuidedAttemptOutcome;
  readonly submittedAnswer?: string;
}

export interface GuidedLessonStudyState {
  readonly schemaVersion: typeof GUIDED_LESSON_STUDY_VERSION;
  readonly lessonId: string;
  readonly independentExerciseId: string;
  readonly phase: GuidedLessonPhase;
  readonly revealedTeachingBlockIds: readonly string[];
  readonly selfExplanationAnswer: string | null;
  readonly selfExplanationAnswerRevealed: boolean;
  /** Immutable first attempt; this alone remains the scored result. */
  readonly originalIndependentAttempt: GuidedAttemptRecord | null;
  /** Recovery attempts never replace originalIndependentAttempt. */
  readonly recoveryAttempts: readonly GuidedAttemptRecord[];
  readonly revealedHintIds: readonly string[];
  readonly repairExplanationRevealed: boolean;
  readonly recoveryOutcome: RecoveryOutcomeV1;
}

export interface GuidedAssistanceSummary {
  readonly originalIndependentAttempt: GuidedAttemptRecord | null;
  readonly hintsRevealed: number;
  readonly retries: number;
  readonly repairExplanationRevealed: boolean;
  readonly recoveryOutcome: RecoveryOutcomeV1;
}

export function createGuidedLessonState(
  lesson: TutorLessonV1,
  independentExerciseId: string,
): GuidedLessonStudyState {
  if (independentExerciseId.trim().length === 0) {
    throw new Error("A guided lesson requires an independent exercise ID.");
  }
  return {
    schemaVersion: GUIDED_LESSON_STUDY_VERSION,
    lessonId: lesson.id,
    independentExerciseId,
    phase: lesson.teachingBlocks.length === 0 ? "self-explanation" : "teaching",
    revealedTeachingBlockIds: [],
    selfExplanationAnswer: null,
    selfExplanationAnswerRevealed: false,
    originalIndependentAttempt: null,
    recoveryAttempts: [],
    revealedHintIds: [],
    repairExplanationRevealed: false,
    recoveryOutcome: "not-recorded",
  };
}

export function revealNextTeachingBlock(
  lesson: TutorLessonV1,
  state: GuidedLessonStudyState,
): GuidedLessonStudyState {
  assertLesson(lesson, state);
  if (state.phase !== "teaching") throw new Error("Teaching blocks are not active.");
  const next = lesson.teachingBlocks.find(
    (block) => !state.revealedTeachingBlockIds.includes(block.id),
  );
  if (next === undefined) throw new Error("Every teaching block is already revealed.");
  const revealedTeachingBlockIds = [...state.revealedTeachingBlockIds, next.id];
  return {
    ...state,
    revealedTeachingBlockIds,
    phase: revealedTeachingBlockIds.length === lesson.teachingBlocks.length
      ? "self-explanation"
      : "teaching",
  };
}

export function submitSelfExplanation(
  lesson: TutorLessonV1,
  state: GuidedLessonStudyState,
  answer: string,
): GuidedLessonStudyState {
  assertLesson(lesson, state);
  if (state.phase !== "self-explanation") {
    throw new Error("The self-explanation checkpoint is not active.");
  }
  if (answer.trim().length === 0) throw new Error("Write a self-explanation first.");
  return { ...state, selfExplanationAnswer: answer };
}

export function revealSelfExplanationAnswer(
  lesson: TutorLessonV1,
  state: GuidedLessonStudyState,
): GuidedLessonStudyState {
  assertLesson(lesson, state);
  if (state.phase !== "self-explanation" || state.selfExplanationAnswer === null) {
    throw new Error("Submit a self-explanation before revealing the grounded answer.");
  }
  return {
    ...state,
    selfExplanationAnswerRevealed: true,
    phase: "independent",
  };
}

export function recordIndependentAttempt(
  state: GuidedLessonStudyState,
  attempt: GuidedAttemptRecord,
): GuidedLessonStudyState {
  if (state.phase !== "independent") throw new Error("The independent attempt is not active.");
  if (state.originalIndependentAttempt !== null) {
    throw new Error("The original independent attempt is immutable and already recorded.");
  }
  assertAttempt(state, attempt);
  return attempt.outcome === "correct"
    ? {
        ...state,
        originalIndependentAttempt: cloneAttempt(attempt),
        phase: "complete",
        recoveryOutcome: "not-needed",
      }
    : {
        ...state,
        originalIndependentAttempt: cloneAttempt(attempt),
        phase: "recovery",
      };
}

export function revealNextTutorHint(
  lesson: TutorLessonV1,
  state: GuidedLessonStudyState,
): GuidedLessonStudyState {
  assertLesson(lesson, state);
  if (state.phase !== "recovery") throw new Error("Hints are available only during recovery.");
  const hints = [...lesson.hints].sort((left, right) => left.level - right.level);
  const next = hints.find((hint) => !state.revealedHintIds.includes(hint.id));
  if (next === undefined) throw new Error("Every available hint is already revealed.");
  return { ...state, revealedHintIds: [...state.revealedHintIds, next.id] };
}

export function recordRecoveryAttempt(
  state: GuidedLessonStudyState,
  attempt: GuidedAttemptRecord,
): GuidedLessonStudyState {
  if (state.phase !== "recovery") throw new Error("A recovery attempt is not active.");
  assertAttempt(state, attempt);
  const recoveryAttempts = [...state.recoveryAttempts, cloneAttempt(attempt)];
  return attempt.outcome === "correct"
    ? { ...state, recoveryAttempts, phase: "complete", recoveryOutcome: "recovered" }
    : { ...state, recoveryAttempts };
}

export function revealTutorRepairExplanation(
  lesson: TutorLessonV1,
  state: GuidedLessonStudyState,
): GuidedLessonStudyState {
  assertLesson(lesson, state);
  if (state.phase !== "recovery") throw new Error("Repair support is not active.");
  if (state.revealedHintIds.length < lesson.hints.length) {
    throw new Error("Reveal the progressively stronger hints before the repair explanation.");
  }
  return { ...state, repairExplanationRevealed: true };
}

export function completeGuidedLesson(
  state: GuidedLessonStudyState,
): GuidedLessonStudyState {
  if (state.phase === "complete") return structuredClone(state);
  if (state.phase !== "recovery") {
    throw new Error("The guided lesson cannot be completed before its independent attempt.");
  }
  return { ...state, phase: "complete", recoveryOutcome: "unresolved" };
}

export function guidedAssistanceSummary(
  state: GuidedLessonStudyState,
): GuidedAssistanceSummary {
  return {
    originalIndependentAttempt: state.originalIndependentAttempt === null
      ? null
      : cloneAttempt(state.originalIndependentAttempt),
    hintsRevealed: state.revealedHintIds.length,
    retries: state.recoveryAttempts.length,
    repairExplanationRevealed: state.repairExplanationRevealed,
    recoveryOutcome: state.recoveryOutcome,
  };
}

export function createSessionExerciseEvidence(input: {
  readonly assignment: ExerciseAssignmentV1;
  readonly set: Pick<PracticeSetV1, "id" | "title">;
  readonly aspects: readonly Pick<LearningAspectV1, "id" | "title">[];
  readonly assistance?: GuidedAssistanceSummary;
}): SessionExerciseEvidenceV3 {
  const expected = new Set(input.assignment.aspectIds);
  if (
    expected.size !== input.assignment.aspectIds.length
    || input.aspects.length !== expected.size
    || input.aspects.some((aspect) => !expected.has(aspect.id))
  ) {
    throw new Error("The evidence snapshot must resolve every assigned aspect exactly once.");
  }
  const assistance = input.assistance;
  return {
    exerciseId: input.assignment.exerciseId,
    set: { id: input.set.id, title: input.set.title },
    aspects: input.aspects.map((aspect) => ({ id: aspect.id, title: aspect.title })),
    instructionalRole: input.assignment.role,
    independent: input.assignment.role !== "guided-check",
    hintsRevealed: assistance?.hintsRevealed ?? 0,
    retries: assistance?.retries ?? 0,
    recoveryOutcome: assistance?.recoveryOutcome ?? "not-recorded",
  };
}

export type LearningItemOrderMode = "ordered" | "shuffle-types" | "shuffle-all";

export interface LearningSequenceOptions {
  readonly mode: LearningItemOrderMode;
  readonly seed: number;
  readonly typeOrder?: readonly ExerciseV1["type"][];
}

export interface LearningSequenceItem {
  readonly id: string;
  readonly type: ExerciseV1["type"];
}

export type LearningPathSequenceEntry<T> =
  | { readonly kind: "lesson"; readonly lesson: TutorLessonV1 }
  | { readonly kind: "practice-set"; readonly set: PracticeSetV1; readonly items: readonly T[] };

export function sequencePracticeSetItems<T extends LearningSequenceItem>(
  set: PracticeSetV1,
  exercises: readonly T[],
  options: LearningSequenceOptions,
): T[] {
  const byId = uniqueExerciseMap(exercises);
  const assignmentIds = set.assignments.map((assignment) => assignment.exerciseId);
  if (new Set(assignmentIds).size !== assignmentIds.length) {
    throw new Error(`Practice set ${set.id} contains duplicate assignments.`);
  }
  const selected = assignmentIds.map((id) => {
    const exercise = byId.get(id);
    if (exercise === undefined) throw new Error(`Practice set ${set.id} references missing exercise ${id}.`);
    return exercise;
  });
  if (options.mode === "ordered") return [...selected];
  const random = seededRandom(seedForSet(options.seed, set.id));
  if (options.mode === "shuffle-all") return shuffled(selected, random);
  const encountered = unique(selected.map((exercise) => exercise.type));
  const preferred = unique(options.typeOrder ?? []);
  const types = [
    ...preferred.filter((type) => encountered.includes(type)),
    ...encountered.filter((type) => !preferred.includes(type)),
  ];
  return shuffled(types, random).flatMap((type) => (
    selected.filter((exercise) => exercise.type === type)
  ));
}

export function sequenceMixedSetItems<T extends LearningSequenceItem>(
  sets: readonly PracticeSetV1[],
  exercises: readonly T[],
  options: LearningSequenceOptions,
): T[] {
  return [...sets]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .flatMap((set) => sequencePracticeSetItems(set, exercises, options));
}

export function sequenceLearningPathItems<T extends LearningSequenceItem>(
  path: LearningPathV1,
  sets: readonly PracticeSetV1[],
  lessons: readonly TutorLessonV1[],
  exercises: readonly T[],
  options: LearningSequenceOptions,
): LearningPathSequenceEntry<T>[] {
  const setById = new Map(sets.map((set) => [set.id, set]));
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  return [...path.steps]
    .sort((left, right) => left.order - right.order)
    .map((step) => {
      if (step.kind === "lesson") {
        const lesson = lessonById.get(step.lessonId);
        if (lesson === undefined) throw new Error(`Learning path references missing lesson ${step.lessonId}.`);
        return { kind: "lesson" as const, lesson };
      }
      const set = setById.get(step.setId);
      if (set === undefined) throw new Error(`Learning path references missing set ${step.setId}.`);
      return {
        kind: "practice-set" as const,
        set,
        items: sequencePracticeSetItems(set, exercises, options),
      };
    });
}

function assertLesson(lesson: TutorLessonV1, state: GuidedLessonStudyState): void {
  if (lesson.id !== state.lessonId) throw new Error("The tutor lesson does not match its study state.");
}

function assertAttempt(state: GuidedLessonStudyState, attempt: GuidedAttemptRecord): void {
  if (attempt.exerciseId !== state.independentExerciseId) {
    throw new Error("The attempt does not match the locked independent exercise.");
  }
}

function cloneAttempt(attempt: GuidedAttemptRecord): GuidedAttemptRecord {
  return { ...attempt };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueExerciseMap<T extends LearningSequenceItem>(exercises: readonly T[]): Map<string, T> {
  const byId = new Map<string, T>();
  for (const exercise of exercises) {
    if (byId.has(exercise.id)) throw new Error(`Duplicate exercise input ${exercise.id}.`);
    byId.set(exercise.id, exercise);
  }
  return byId;
}

function seedForSet(seed: number, id: string): number {
  let value = seed >>> 0;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16_777_619) >>> 0;
  return value;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = result[index];
    if (current === undefined) continue;
    result[index] = result[target] as T;
    result[target] = current;
  }
  return result;
}
