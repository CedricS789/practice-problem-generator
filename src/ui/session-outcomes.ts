import type {
  AnswerReviewRequest,
  AnswerReviewStatus,
  AnswerReviewVerdict,
  SelfRating,
  StudyAnswerRecord,
} from "./contracts";

export interface FreeResponseOutcome {
  readonly rating: SelfRating;
  readonly label: string;
  readonly description: string;
}

/**
 * These are one-session answer outcomes, not spaced-repetition ratings. The
 * stored keys remain compatible with existing PracticeBankV1 files.
 */
export const FREE_RESPONSE_OUTCOMES = [
  {
    rating: "again",
    label: "Incorrect",
    description: "The submitted answer missed the required idea or relation.",
  },
  {
    rating: "hard",
    label: "Partially correct",
    description: "The submitted answer was directionally right but incomplete or imprecise.",
  },
  {
    rating: "good",
    label: "Correct",
    description: "The submitted answer covered the required grounded answer.",
  },
] as const satisfies readonly FreeResponseOutcome[];

export function summarizeFreeResponseOutcomes(
  ratings: readonly (SelfRating | undefined)[],
): string {
  const incorrect = ratings.filter((rating) => rating === "again").length;
  const partial = ratings.filter((rating) => rating === "hard").length;
  const correct = ratings.filter(
    (rating) => rating === "good" || rating === "easy",
  ).length;
  return `${correct} correct, ${partial} partially correct, ${incorrect} incorrect`;
}

export function answerReviewVerdictRating(
  verdict: AnswerReviewVerdict,
): SelfRating {
  switch (verdict) {
    case "incorrect":
      return "again";
    case "partial":
      return "hard";
    case "correct":
      return "good";
  }
}

export interface AnswerReviewCounts {
  readonly pending: number;
  readonly reviewed: number;
  readonly failed: number;
}

export function countAnswerReviews(
  answers: readonly StudyAnswerRecord[],
): AnswerReviewCounts {
  const counts = { pending: 0, reviewed: 0, failed: 0 };
  for (const answer of answers) {
    const state = answer.aiReview?.status.state;
    if (state !== undefined) counts[state] += 1;
  }
  return counts;
}

/**
 * Freeze the exact answer-review payload before it enters the background queue.
 * A defensive segment-ID filter prevents unrelated source content from being
 * added by a stale or overly broad presentation object.
 */
export function lockAnswerReviewRequest(
  request: AnswerReviewRequest,
): AnswerReviewRequest {
  const citedIds = new Set(request.sourceSegmentIds);
  const seenSegments = new Set<string>();
  const sourceSegments = request.sourceSegments.flatMap((segment) => {
    if (!citedIds.has(segment.id) || seenSegments.has(segment.id)) return [];
    seenSegments.add(segment.id);
    return [Object.freeze({
      id: segment.id,
      headingPath: Object.freeze([...segment.headingPath]),
      text: segment.text,
      ...(segment.classification === undefined
        ? {}
        : { classification: segment.classification }),
      ...(segment.sourceTitle === undefined
        ? {}
        : { sourceTitle: segment.sourceTitle }),
    })];
  });
  return Object.freeze({
    ...request,
    keyPoints: Object.freeze([...request.keyPoints]),
    sourceSegmentIds: Object.freeze([...request.sourceSegmentIds]),
    sourceSegments: Object.freeze(sourceSegments),
  });
}

export function createPendingAnswerReviewRecord(
  request: AnswerReviewRequest,
): StudyAnswerRecord {
  return {
    exerciseId: request.exerciseId,
    submittedAnswer: request.submittedAnswer,
    aiReview: {
      request,
      status: {
        requestId: request.requestId,
        sessionId: request.sessionId,
        exerciseId: request.exerciseId,
        state: "pending",
        queuedAt: request.requestedAt,
        attempts: 0,
      },
    },
  };
}

export function applyAnswerReviewStatus(
  answers: readonly StudyAnswerRecord[],
  status: AnswerReviewStatus,
): { readonly answers: readonly StudyAnswerRecord[]; readonly updated: boolean } {
  const index = answers.findIndex(
    (answer) => answer.aiReview?.request.requestId === status.requestId,
  );
  const answer = answers[index];
  if (
    answer?.aiReview === undefined ||
    answer.exerciseId !== status.exerciseId ||
    answer.aiReview.request.sessionId !== status.sessionId
  ) {
    return { answers, updated: false };
  }
  const next: StudyAnswerRecord = {
    exerciseId: answer.exerciseId,
    ...(answer.submittedAnswer === undefined
      ? {}
      : { submittedAnswer: answer.submittedAnswer }),
    aiReview: { request: answer.aiReview.request, status },
  };
  return {
    answers: answers.map((candidate, candidateIndex) =>
      candidateIndex === index ? next : candidate,
    ),
    updated: true,
  };
}
