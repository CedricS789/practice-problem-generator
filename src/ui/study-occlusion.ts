import type { OcclusionMaskCandidate } from "../visuals";
import type { DraftExercisePresentation } from "./contracts";

export interface StudyOcclusionVisualPresentation {
  readonly imageUrl: string;
  readonly masks: readonly OcclusionMaskCandidate[];
  readonly revealed: boolean;
}

/**
 * Keep the source image visible after submission while removing every mask.
 */
export function presentStudyOcclusionVisual(
  exercise: DraftExercisePresentation,
  answered: boolean,
): StudyOcclusionVisualPresentation | null {
  if (
    exercise.type !== "image-occlusion" ||
    exercise.grading.kind !== "occlusion" ||
    exercise.visualUrl === undefined
  ) {
    return null;
  }
  return {
    imageUrl: exercise.visualUrl,
    masks: answered ? [] : (exercise.masks ?? []),
    revealed: answered,
  };
}
