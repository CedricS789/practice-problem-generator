import type { EditableDraftExercise } from "./contracts";
import { validateOcclusionMasks } from "../visuals";
import { latexMarkupProblem } from "../latex";

export interface ReviewGateState {
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly invalidContentCount: number;
  readonly invalidLatexCount: number;
  readonly hasUnreviewedOcclusion: boolean;
  readonly currentFingerprint: string;
  readonly savedCurrent: boolean;
  readonly canSave: boolean;
  readonly canStartPractice: boolean;
}

export interface InvalidOcclusionReview {
  readonly exerciseId: string;
  readonly reason: string;
}

export interface AcceptAllOcclusionsResult {
  readonly drafts: readonly EditableDraftExercise[];
  readonly keptOcclusionCount: number;
  readonly newlyAcceptedCount: number;
  readonly alreadyAcceptedCount: number;
  readonly invalid: readonly InvalidOcclusionReview[];
  readonly changed: boolean;
}

export interface LearningPathReviewSetInput {
  readonly setId: string;
  readonly setTitle: string;
  readonly exercises: readonly EditableDraftExercise[];
  readonly approvedExerciseIds: ReadonlySet<string>;
}

export interface LearningPathReviewBlocker {
  readonly setId: string;
  readonly setTitle: string;
  readonly exerciseId?: string;
  readonly reason: string;
}

export interface LearningPathSetReviewState {
  readonly setId: string;
  readonly setTitle: string;
  readonly keptCount: number;
  readonly approvedCount: number;
  readonly pendingApprovalCount: number;
  readonly blockers: readonly LearningPathReviewBlocker[];
}

export interface LearningPathBulkApprovalResult {
  readonly approvedBySet: ReadonlyMap<string, ReadonlySet<string>>;
  readonly newlyApprovedCount: number;
  readonly totalKeptCount: number;
  readonly totalApprovedCount: number;
  readonly blockers: readonly LearningPathReviewBlocker[];
}

function exerciseReviewProblem(draft: EditableDraftExercise): string | null {
  if (draft.prompt.trim().length === 0 || draft.groundedAnswer.trim().length === 0) {
    return "Add both a prompt and a grounded answer.";
  }
  const latexProblem = latexMarkupProblem(draft.prompt)
    ?? latexMarkupProblem(draft.groundedAnswer);
  if (latexProblem !== null) return `Fix the malformed LaTeX: ${latexProblem}`;
  if (draft.type !== "image-occlusion") return null;
  if (draft.visualUrl === undefined) return "Restore the visual or reject this image occlusion.";
  const validation = validateOcclusionMasks(draft.masks ?? []);
  if (!validation.valid || (draft.masks ?? []).length === 0) {
    return validation.errors[0] ?? "Add at least one valid occlusion mask.";
  }
  if (!draft.occlusionReviewed) return "Review and accept its occlusion masks.";
  return null;
}

export function learningPathSetReviewState(
  input: LearningPathReviewSetInput,
): LearningPathSetReviewState {
  const kept = input.exercises.filter((exercise) => !exercise.rejected);
  const blockers: LearningPathReviewBlocker[] = [];
  if (kept.length === 0) {
    blockers.push({
      setId: input.setId,
      setTitle: input.setTitle,
      reason: "Keep at least one exercise in this set.",
    });
  }
  let approvedCount = 0;
  let pendingApprovalCount = 0;
  for (const exercise of kept) {
    const problem = exerciseReviewProblem(exercise);
    if (problem !== null) {
      blockers.push({
        setId: input.setId,
        setTitle: input.setTitle,
        exerciseId: exercise.id,
        reason: problem,
      });
      continue;
    }
    if (input.approvedExerciseIds.has(exercise.id)) approvedCount += 1;
    else pendingApprovalCount += 1;
  }
  return {
    setId: input.setId,
    setTitle: input.setTitle,
    keptCount: kept.length,
    approvedCount,
    pendingApprovalCount,
    blockers,
  };
}

/** Approve every ready exercise across the complete guided batch. */
export function approveReadyLearningPathExercises(
  inputs: readonly LearningPathReviewSetInput[],
): LearningPathBulkApprovalResult {
  const approvedBySet = new Map<string, ReadonlySet<string>>();
  const blockers: LearningPathReviewBlocker[] = [];
  let newlyApprovedCount = 0;
  let totalKeptCount = 0;
  let totalApprovedCount = 0;
  for (const input of inputs) {
    const approved = new Set<string>();
    for (const exercise of input.exercises) {
      if (exercise.rejected) continue;
      totalKeptCount += 1;
      const problem = exerciseReviewProblem(exercise);
      if (problem !== null) {
        blockers.push({
          setId: input.setId,
          setTitle: input.setTitle,
          exerciseId: exercise.id,
          reason: problem,
        });
        continue;
      }
      approved.add(exercise.id);
      totalApprovedCount += 1;
      if (!input.approvedExerciseIds.has(exercise.id)) newlyApprovedCount += 1;
    }
    approvedBySet.set(input.setId, approved);
  }
  return {
    approvedBySet,
    newlyApprovedCount,
    totalKeptCount,
    totalApprovedCount,
    blockers,
  };
}

/**
 * Accept every kept occlusion whose current masks are complete and valid.
 * Invalid exercises remain unreviewed so the normal save gate stays closed.
 */
export function acceptAllValidOcclusions(
  drafts: readonly EditableDraftExercise[],
): AcceptAllOcclusionsResult {
  let keptOcclusionCount = 0;
  let newlyAcceptedCount = 0;
  let alreadyAcceptedCount = 0;
  let changed = false;
  const invalid: InvalidOcclusionReview[] = [];
  const next = drafts.map((draft) => {
    if (draft.rejected || draft.type !== "image-occlusion") return draft;
    keptOcclusionCount += 1;
    const masks = draft.masks ?? [];
    const validation = validateOcclusionMasks(masks);
    const reason =
      masks.length === 0
        ? "Add at least one mask."
        : validation.errors[0];
    if (reason !== undefined) {
      invalid.push({ exerciseId: draft.id, reason });
      if (!draft.occlusionReviewed) return draft;
      changed = true;
      return { ...draft, occlusionReviewed: false };
    }
    if (draft.occlusionReviewed) {
      alreadyAcceptedCount += 1;
      return draft;
    }
    newlyAcceptedCount += 1;
    changed = true;
    return { ...draft, occlusionReviewed: true };
  });

  return {
    drafts: changed ? next : drafts,
    keptOcclusionCount,
    newlyAcceptedCount,
    alreadyAcceptedCount,
    invalid,
    changed,
  };
}

/**
 * Fingerprint the exact ordered review state. This intentionally includes
 * rejection and occlusion-review flags, in addition to editable content.
 */
export function reviewFingerprint(
  drafts: readonly EditableDraftExercise[],
): string {
  return JSON.stringify(drafts);
}

export function getReviewGateState(
  drafts: readonly EditableDraftExercise[],
  savedFingerprint: string | null,
): ReviewGateState {
  const acceptedCount = drafts.filter((draft) => !draft.rejected).length;
  const invalidContentCount = drafts.filter(
    (draft) =>
      !draft.rejected
      && (draft.prompt.trim().length === 0
        || draft.groundedAnswer.trim().length === 0),
  ).length;
  const invalidLatexCount = drafts.filter(
    (draft) =>
      !draft.rejected
      && (latexMarkupProblem(draft.prompt) !== null
        || latexMarkupProblem(draft.groundedAnswer) !== null),
  ).length;
  const hasUnreviewedOcclusion = drafts.some(
    (draft) =>
      !draft.rejected &&
      draft.type === "image-occlusion" &&
      !draft.occlusionReviewed,
  );
  const currentFingerprint = reviewFingerprint(drafts);
  const savedCurrent =
    savedFingerprint !== null && savedFingerprint === currentFingerprint;
  const canSave =
    acceptedCount > 0
    && invalidContentCount === 0
    && invalidLatexCount === 0
    && !hasUnreviewedOcclusion;
  return {
    acceptedCount,
    rejectedCount: drafts.length - acceptedCount,
    invalidContentCount,
    invalidLatexCount,
    hasUnreviewedOcclusion,
    currentFingerprint,
    savedCurrent,
    canSave,
    canStartPractice: canSave && savedCurrent,
  };
}
