import type {
  LearningBlueprintDraftV1,
  PracticeSetDraftV1,
} from "./learning-path-generation";
import type {
  LearningAspectV1,
  TutorLessonV1,
} from "./model";
import {
  orderTutorTeachingBlocks,
  tutorTeachingBlocksAreOrdered,
} from "./tutor-teaching-blocks";

export interface LearningWorkspaceReconciliationV1 {
  readonly aspects: readonly LearningAspectV1[];
  readonly drafts: readonly PracticeSetDraftV1[];
  readonly reconciledLinkCount: number;
  readonly reconciledTutorBlockOrderCount: number;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function lessonSourceSegmentIds(lesson: TutorLessonV1): string[] {
  return unique([
    ...lesson.teachingBlocks.flatMap((block) => block.sourceSegmentIds),
    ...lesson.selfExplanationCheck.sourceSegmentIds,
    ...lesson.hints.flatMap((hint) => hint.sourceSegmentIds),
    ...lesson.repairExplanation.sourceSegmentIds,
  ]);
}

/**
 * Reconcile AI-authored relationship arrays against the already approved
 * blueprint without changing any learner-visible exercise or tutor content.
 * This exists for recoverable batches created before the stronger relational
 * generation validator was introduced.
 */
export function reconcileLearningWorkspaceDrafts(
  blueprint: LearningBlueprintDraftV1,
  drafts: readonly PracticeSetDraftV1[],
): LearningWorkspaceReconciliationV1 {
  let reconciledLinkCount = 0;
  let reconciledTutorBlockOrderCount = 0;
  const aspects: LearningAspectV1[] = blueprint.aspects
    .filter((aspect) => aspect.status === "supported")
    .map((aspect) => ({
      id: aspect.id,
      title: aspect.title,
      purpose: aspect.purpose,
      prerequisiteAspectIds: [...aspect.prerequisiteAspectIds],
      sourceSegmentIds: [...aspect.sourceSegmentIds],
      status: "supported",
    }));
  const aspectById = new Map(aspects.map((aspect) => [aspect.id, aspect]));
  const aspectOrder = new Map(aspects.map((aspect, index) => [aspect.id, index]));
  const setById = new Map(blueprint.sets.map((set) => [set.id, set]));
  const sortAspectIds = (ids: readonly string[]): string[] => unique(ids).sort(
    (left, right) => (aspectOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (aspectOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
  const addEvidence = (aspectId: string, segmentId: string): void => {
    const aspect = aspectById.get(aspectId);
    if (aspect === undefined || aspect.sourceSegmentIds.includes(segmentId)) return;
    aspect.sourceSegmentIds.push(segmentId);
    reconciledLinkCount += 1;
  };

  const assignmentReconciled = drafts.map((draft) => {
    const target = setById.get(draft.setId);
    if (target === undefined) return structuredClone(draft);
    const targetAspectIds = new Set(target.aspectIds);
    const exerciseById = new Map(draft.exercises.map((exercise) => [exercise.id, exercise]));
    const assignments = draft.assignments.map((assignment) => {
      const exercise = exerciseById.get(assignment.exerciseId);
      if (exercise === undefined) return structuredClone(assignment);
      const assigned = [...assignment.aspectIds];
      for (const segmentId of exercise.sourceSegmentIds) {
        const covered = assigned.some((aspectId) => (
          aspectById.get(aspectId)?.sourceSegmentIds.includes(segmentId) ?? false
        ));
        if (covered) continue;
        const owner = aspects.find((aspect) => (
          targetAspectIds.has(aspect.id) && aspect.sourceSegmentIds.includes(segmentId)
        ));
        if (owner !== undefined) {
          assigned.push(owner.id);
          reconciledLinkCount += 1;
          continue;
        }
        const fallbackAspectId = assigned.find((aspectId) => targetAspectIds.has(aspectId));
        if (fallbackAspectId !== undefined) addEvidence(fallbackAspectId, segmentId);
      }
      return {
        ...structuredClone(assignment),
        aspectIds: sortAspectIds(assigned),
      };
    });
    return {
      ...structuredClone(draft),
      assignments,
    };
  });

  const reconciledDrafts = assignmentReconciled.map((draft) => {
    const target = setById.get(draft.setId);
    if (target === undefined) return draft;
    const targetAspectIds = new Set(target.aspectIds);
    const assignmentByExercise = new Map(
      draft.assignments.map((assignment) => [assignment.exerciseId, assignment]),
    );
    const tutorLessons = draft.tutorLessons.map((lesson) => {
      const clonedLesson = structuredClone(lesson);
      const teachingBlocks = orderTutorTeachingBlocks(clonedLesson.teachingBlocks);
      if (!tutorTeachingBlocksAreOrdered(clonedLesson.teachingBlocks)) {
        reconciledTutorBlockOrderCount += 1;
      }
      const taught = [...lesson.aspectIds];
      const guidedAssignment = assignmentByExercise.get(lesson.guidedExerciseId);
      for (const aspectId of guidedAssignment?.aspectIds ?? []) {
        if (!taught.includes(aspectId)) {
          taught.push(aspectId);
          reconciledLinkCount += 1;
        }
      }
      let prerequisites = unique(
        lesson.prerequisiteAspectIds.filter((aspectId) => !taught.includes(aspectId)),
      );
      reconciledLinkCount += lesson.prerequisiteAspectIds.length - prerequisites.length;

      for (const segmentId of lessonSourceSegmentIds(lesson)) {
        const citedAspectIds = [...taught, ...prerequisites];
        const covered = citedAspectIds.some((aspectId) => (
          aspectById.get(aspectId)?.sourceSegmentIds.includes(segmentId) ?? false
        ));
        if (covered) continue;
        const owner = aspects.find((aspect) => (
          targetAspectIds.has(aspect.id) && aspect.sourceSegmentIds.includes(segmentId)
        ));
        if (owner !== undefined) {
          taught.push(owner.id);
          prerequisites = prerequisites.filter((aspectId) => aspectId !== owner.id);
          reconciledLinkCount += 1;
          continue;
        }
        const fallbackAspectId = taught.find((aspectId) => targetAspectIds.has(aspectId));
        if (fallbackAspectId !== undefined) addEvidence(fallbackAspectId, segmentId);
      }

      const normalizedTaught = sortAspectIds(taught);
      prerequisites = prerequisites.filter((aspectId) => !normalizedTaught.includes(aspectId));
      for (const aspectId of normalizedTaught) {
        for (const prerequisiteId of aspectById.get(aspectId)?.prerequisiteAspectIds ?? []) {
          if (
            !normalizedTaught.includes(prerequisiteId)
            && !prerequisites.includes(prerequisiteId)
          ) {
            prerequisites.push(prerequisiteId);
            reconciledLinkCount += 1;
          }
        }
      }
      return {
        ...clonedLesson,
        aspectIds: normalizedTaught,
        prerequisiteAspectIds: sortAspectIds(prerequisites),
        teachingBlocks,
      };
    });
    return {
      ...draft,
      tutorLessons,
    };
  });

  return {
    aspects,
    drafts: reconciledDrafts,
    reconciledLinkCount,
    reconciledTutorBlockOrderCount,
  };
}
