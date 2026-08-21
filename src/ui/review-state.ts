import type { EditableDraftExercise } from "./contracts";
import { validateOcclusionMasks } from "../visuals";

export interface ReviewGateState {
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly invalidContentCount: number;
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
    && !hasUnreviewedOcclusion;
  return {
    acceptedCount,
    rejectedCount: drafts.length - acceptedCount,
    invalidContentCount,
    hasUnreviewedOcclusion,
    currentFingerprint,
    savedCurrent,
    canSave,
    canStartPractice: canSave && savedCurrent,
  };
}
