import {
  parseStudySessionCheckpoint,
  type StudySessionCheckpointV1,
} from "./study-checkpoint";

export interface StudyCheckpointBankCandidate {
  readonly bankPath: string;
  readonly bankId: string;
}

export type StudyCheckpointBankResolution<
  Candidate extends StudyCheckpointBankCandidate = StudyCheckpointBankCandidate,
> =
  | { readonly status: "exact"; readonly candidate: Candidate }
  | { readonly status: "relocated"; readonly candidate: Candidate }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous"; readonly candidates: readonly Candidate[] };

export interface StudyCheckpointProgressSummary {
  readonly phase: StudySessionCheckpointV1["phase"];
  readonly answeredCount: number;
  readonly skippedCount: number;
  readonly currentQuestionIndex: number;
  readonly totalQuestionCount: number;
  readonly hasDraft: boolean;
  readonly pendingFinalMerge: boolean;
  readonly pathStepIndex: number | null;
  readonly guidedEvidenceCount: number;
  readonly completedTutorLessonCount: number;
  readonly revealedTeachingBlockCount: number;
  readonly revealedHintCount: number;
  readonly guidedRetryCount: number;
  readonly guidedIndependentAttemptCount: number;
  readonly guidedAnswerRevealCount: number;
  readonly hasMeaningfulProgress: boolean;
}

export type LatestStudyCheckpointRebaseResult =
  | {
      readonly status: "current" | "rebased";
      readonly checkpoint: StudySessionCheckpointV1;
    }
  | { readonly status: "stale" };

function normalizedPathKey(path: string): string {
  return path
    .replace(/\\/gu, "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/^\.\//u, "")
    .toLocaleLowerCase();
}

/**
 * Finds the bank that owns a checkpoint without inferring identity from its
 * source note, title, filename, or location. A matching original path is
 * authoritative; otherwise relocation is safe only when the bank ID is
 * present at exactly one distinct path.
 */
export function resolveStudyCheckpointBankCandidate<
  Candidate extends StudyCheckpointBankCandidate,
>(
  checkpoint: Pick<StudySessionCheckpointV1, "bankId" | "bankPath">,
  candidates: readonly Candidate[],
): StudyCheckpointBankResolution<Candidate> {
  const byPath = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (candidate.bankId !== checkpoint.bankId) continue;
    const pathKey = normalizedPathKey(candidate.bankPath);
    if (!byPath.has(pathKey)) byPath.set(pathKey, candidate);
  }

  const expectedPathKey = normalizedPathKey(checkpoint.bankPath);
  const exact = byPath.get(expectedPathKey);
  if (exact !== undefined) return { status: "exact", candidate: exact };

  const matches = [...byPath.values()].sort((left, right) =>
    normalizedPathKey(left.bankPath).localeCompare(normalizedPathKey(right.bankPath))
  );
  if (matches.length === 0) return { status: "missing" };
  const relocated = matches[0];
  if (matches.length === 1 && relocated !== undefined) {
    return { status: "relocated", candidate: relocated };
  }
  return { status: "ambiguous", candidates: matches };
}

/**
 * Changes only the vault path in a valid checkpoint, then runs the complete
 * checkpoint parser again. In particular, this deliberately does not refresh
 * updatedAt: a relocation is not study activity.
 */
export function rebaseStudySessionCheckpointBankPath(
  checkpoint: StudySessionCheckpointV1,
  bankPath: string,
): StudySessionCheckpointV1 {
  const current = parseStudySessionCheckpoint(checkpoint);
  if (current.status !== "ok") {
    throw new Error(
      current.status === "invalid"
        ? `Cannot relocate an invalid study checkpoint: ${current.message}`
        : "Cannot relocate an unsupported study checkpoint.",
    );
  }
  const rebased = parseStudySessionCheckpoint({
    ...current.checkpoint,
    bankPath,
  });
  if (rebased.status !== "ok") {
    throw new Error(
      rebased.status === "invalid"
        ? `Cannot use the relocated practice-bank path: ${rebased.message}`
        : "Cannot use the relocated practice-bank path.",
    );
  }
  return rebased.checkpoint;
}

/**
 * Rebases the latest in-memory checkpoint after an asynchronous bank lookup.
 * The captured checkpoint identifies the lookup that just completed, while
 * current may contain newer answers or input flushed during that lookup.
 */
export function rebaseLatestStudySessionCheckpointBankPath(
  captured: Pick<StudySessionCheckpointV1, "sessionId" | "bankId" | "bankPath">,
  current: StudySessionCheckpointV1 | undefined,
  bankPath: string,
): LatestStudyCheckpointRebaseResult {
  if (
    current === undefined
    || current.sessionId !== captured.sessionId
    || current.bankId !== captured.bankId
  ) {
    return { status: "stale" };
  }
  const currentPath = normalizedPathKey(current.bankPath);
  const targetPath = normalizedPathKey(bankPath);
  if (currentPath === targetPath) {
    return { status: "current", checkpoint: current };
  }
  if (currentPath !== normalizedPathKey(captured.bankPath)) {
    return { status: "stale" };
  }
  return {
    status: "rebased",
    checkpoint: rebaseStudySessionCheckpointBankPath(current, bankPath),
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function currentQuestionHasDraft(checkpoint: StudySessionCheckpointV1): boolean {
  const input = checkpoint.currentInput;
  if (input === null) return false;
  if (input.submitted !== null || input.selectedIds.length > 0) return true;
  if (Object.values(input.fields).some((value) => value.length > 0)) return true;

  const exercise = checkpoint.exercises[checkpoint.currentQuestionIndex];
  const initialOrdering = exercise?.type === "ordering"
    ? exercise.items.map((item) => item.id)
    : [];
  return !arraysEqual(input.ordering, initialOrdering);
}

/** Returns the recovery facts used by notices and destructive-action warnings. */
export function summarizeStudyCheckpointProgress(
  checkpoint: StudySessionCheckpointV1,
): StudyCheckpointProgressSummary {
  const learning = checkpoint.learningProgress;
  const activeLesson = learning?.activeLesson;
  const guidedState = activeLesson?.state;
  const guidedDraft = (activeLesson?.currentInput.length ?? 0) > 0
    || (guidedState?.selfExplanationAnswer?.length ?? 0) > 0;
  const hasDraft = currentQuestionHasDraft(checkpoint) || guidedDraft;
  const guidedEvidenceCount = learning?.evidence.length ?? 0;
  const completedTutorLessonCount = learning?.completedTutorLessons.length ?? 0;
  const revealedTeachingBlockCount = guidedState?.revealedTeachingBlockIds.length ?? 0;
  const revealedHintCount = guidedState?.revealedHintIds.length ?? 0;
  const guidedRetryCount = guidedState?.recoveryAttempts.length ?? 0;
  const guidedIndependentAttemptCount = guidedState?.originalIndependentAttempt === null
    || guidedState?.originalIndependentAttempt === undefined
    ? 0
    : 1;
  const guidedAnswerRevealCount = (guidedState?.selfExplanationAnswerRevealed === true ? 1 : 0)
    + (guidedState?.repairExplanationRevealed === true ? 1 : 0);
  const answeredCount = checkpoint.answers.length;
  const skippedCount = checkpoint.skippedExerciseIds?.length ?? 0;
  const pathStepIndex = learning?.pathStepIndex ?? null;
  const pendingFinalMerge = checkpoint.phase === "merging";
  const hasMeaningfulProgress = pendingFinalMerge
    || answeredCount > 0
    || skippedCount > 0
    || hasDraft
    || (pathStepIndex ?? 0) > 0
    || guidedEvidenceCount > 0
    || completedTutorLessonCount > 0
    || revealedTeachingBlockCount > 0
    || revealedHintCount > 0
    || guidedRetryCount > 0
    || guidedIndependentAttemptCount > 0
    || guidedAnswerRevealCount > 0;

  return {
    phase: checkpoint.phase,
    answeredCount,
    skippedCount,
    currentQuestionIndex: checkpoint.currentQuestionIndex,
    totalQuestionCount: checkpoint.exercises.length,
    hasDraft,
    pendingFinalMerge,
    pathStepIndex,
    guidedEvidenceCount,
    completedTutorLessonCount,
    revealedTeachingBlockCount,
    revealedHintCount,
    guidedRetryCount,
    guidedIndependentAttemptCount,
    guidedAnswerRevealCount,
    hasMeaningfulProgress,
  };
}

export function hasMeaningfulStudyCheckpointProgress(
  checkpoint: StudySessionCheckpointV1,
): boolean {
  return summarizeStudyCheckpointProgress(checkpoint).hasMeaningfulProgress;
}
