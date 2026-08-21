import type { ExerciseV1, SourceSegmentV1 } from "../model";
import type {
  ChoicePresentation,
  DraftExercisePresentation,
  EditableDraftExercise,
} from "./contracts";

export type VisualUrlResolver = (visualId: string) => string | undefined;

function keyPointRationale(points: readonly string[]): string | undefined {
  return points.length === 0 ? undefined : `Key points: ${points.join("; ")}`;
}

function choices(
  values: readonly { readonly id: string; readonly text: string }[],
): readonly ChoicePresentation[] {
  return values.map((choice) => ({ id: choice.id, text: choice.text }));
}

function answerReviewContext(
  exercise: ExerciseV1,
  sourceSegments: readonly SourceSegmentV1[],
) {
  const keyPoints =
    exercise.type === "short-answer" ||
    exercise.type === "causal-explanation" ||
    exercise.type === "application"
      ? [...exercise.keyPoints]
      : [];
  const citedIds = new Set(exercise.sourceSegmentIds);
  return {
    keyPoints,
    sourceSegments: sourceSegments
      .filter((segment) => citedIds.has(segment.id))
      .map((segment) => ({
        id: segment.id,
        headingPath: [...segment.headingPath],
        text: segment.text,
      })),
  } as const;
}

/** Map a validated persisted exercise to the presentation-only study contract. */
export function presentExercise(
  exercise: ExerciseV1,
  resolveVisualUrl: VisualUrlResolver = () => undefined,
  sourceSegments: readonly SourceSegmentV1[] = [],
): DraftExercisePresentation {
  const base = {
    id: exercise.id,
    title: exercise.title,
    type: exercise.type,
    prompt: exercise.prompt,
    groundedAnswer: exercise.groundedAnswer,
    sourceSegmentIds: exercise.sourceSegmentIds,
    answerReviewContext: answerReviewContext(exercise, sourceSegments),
  } as const;

  switch (exercise.type) {
    case "short-answer": {
      const rationale = keyPointRationale(exercise.keyPoints);
      return {
        ...base,
        ...(rationale === undefined ? {} : { rationale }),
        grading: { kind: "self", groundedAnswer: exercise.groundedAnswer },
      };
    }
    case "causal-explanation": {
      const rationale = keyPointRationale(exercise.keyPoints);
      return {
        ...base,
        ...(rationale === undefined ? {} : { rationale }),
        grading: { kind: "self", groundedAnswer: exercise.groundedAnswer },
      };
    }
    case "application": {
      const rationale = keyPointRationale(exercise.keyPoints);
      return {
        ...base,
        prompt: `${exercise.scenario}\n\n${exercise.prompt}`,
        ...(rationale === undefined ? {} : { rationale }),
        grading: { kind: "self", groundedAnswer: exercise.groundedAnswer },
      };
    }
    case "calculation":
      return {
        ...base,
        rationale: exercise.working,
        grading: {
          kind: "calculation",
          numericAnswer: exercise.numericAnswer,
          tolerance: exercise.tolerance,
          ...(exercise.unit === undefined ? {} : { unit: exercise.unit }),
        },
      };
    case "cloze":
      return {
        ...base,
        prompt: exercise.clozeText,
        grading: {
          kind: "cloze",
          blanks: exercise.blanks.map((blank) => ({
            id: blank.id,
            acceptedAnswers: blank.answers,
            caseSensitive: blank.caseSensitive,
          })),
        },
      };
    case "single-select":
      return {
        ...base,
        choices: choices(exercise.choices),
        grading: {
          kind: "single-select",
          correctChoiceId: exercise.correctChoiceIds[0],
        },
      };
    case "multi-select":
      return {
        ...base,
        choices: choices(exercise.choices),
        grading: {
          kind: "multi-select",
          correctChoiceIds: exercise.correctChoiceIds,
        },
      };
    case "matching": {
      const matchingLeft = exercise.pairs.map((pair) => ({
        id: pair.id,
        text: pair.left,
      }));
      const matchingRight = exercise.pairs.map((pair) => ({
        id: pair.id,
        text: pair.right,
      }));
      return {
        ...base,
        matchingLeft,
        matchingRight,
        grading: {
          kind: "matching",
          correctPairs: Object.fromEntries(
            exercise.pairs.map((pair) => [pair.id, pair.id]),
          ),
        },
      };
    }
    case "ordering":
      return {
        ...base,
        orderingItems: choices(exercise.items),
        grading: { kind: "ordering", correctOrder: exercise.correctOrder },
      };
    case "image-occlusion": {
      const visualUrl = resolveVisualUrl(exercise.visualId);
      return {
        ...base,
        ...(visualUrl === undefined ? {} : { visualUrl }),
        masks: exercise.masks,
        grading: {
          kind: "occlusion",
          acceptedAnswers: Object.fromEntries(
            exercise.masks.map((mask) => [mask.id, [mask.answer]]),
          ),
        },
      };
    }
  }
}

export function presentExercises(
  exercises: readonly ExerciseV1[],
  resolveVisualUrl: VisualUrlResolver = () => undefined,
  sourceSegments: readonly SourceSegmentV1[] = [],
): readonly DraftExercisePresentation[] {
  return exercises.map((exercise) =>
    presentExercise(exercise, resolveVisualUrl, sourceSegments),
  );
}

/**
 * Apply review edits, rejection, and ordering back to validated exercises.
 * Provider-only fields stay intact; only fields exposed by the review UI move.
 */
export function applyDraftEdits(
  originals: readonly ExerciseV1[],
  drafts: readonly EditableDraftExercise[],
): readonly ExerciseV1[] {
  const byId = new Map(originals.map((exercise) => [exercise.id, exercise]));
  const updated: ExerciseV1[] = [];
  for (const draft of drafts) {
    if (draft.rejected) continue;
    const original = byId.get(draft.id);
    if (original === undefined || original.type !== draft.type) continue;
    switch (original.type) {
      case "short-answer":
      case "causal-explanation":
      case "calculation":
      case "single-select":
      case "multi-select":
      case "matching":
      case "ordering":
        updated.push({
          ...original,
          prompt: draft.prompt,
          groundedAnswer: draft.groundedAnswer,
        });
        break;
      case "application": {
        const prefix = `${original.scenario}\n\n`;
        updated.push({
          ...original,
          prompt: draft.prompt.startsWith(prefix)
            ? draft.prompt.slice(prefix.length)
            : draft.prompt,
          groundedAnswer: draft.groundedAnswer,
        });
        break;
      }
      case "cloze":
        updated.push({
          ...original,
          clozeText: draft.prompt,
          groundedAnswer: draft.groundedAnswer,
        });
        break;
      case "image-occlusion":
        updated.push({
          ...original,
          prompt: draft.prompt,
          groundedAnswer: draft.groundedAnswer,
          masks: draft.masks?.map((mask) => ({ ...mask })) ?? original.masks,
        });
        break;
    }
  }
  return updated;
}
