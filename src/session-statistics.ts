import type {
  ExerciseV1,
  PracticeBankV2,
  SelfRatingV1,
  SessionItemResultV2,
  SessionSummaryV2,
} from "./model";
import {
  calculatePracticeRun,
  type PracticeRunScore,
} from "./practice-run";

export type PerformanceOutcome =
  | {
      readonly grading: "objective";
      readonly correct: boolean;
    }
  | {
      readonly grading: "self-rated";
      readonly rating: SelfRatingV1;
    }
  | {
      readonly grading: "ai-review";
      readonly verdict: "incorrect" | "partial" | "correct";
    };

export interface PerformanceScore {
  readonly earnedPoints: number;
  readonly totalPoints: number;
  readonly percent: number | null;
  readonly correct: number;
  readonly partial: number;
  readonly incorrect: number;
}

export interface SessionStatistic {
  readonly id: string;
  readonly bankRevisionAtStart: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly completedCount: number;
  readonly exerciseCount: number;
  readonly skippedCount: number;
  readonly completionPercent: number;
  readonly performance: PerformanceScore;
  readonly practiceRun: PracticeRunScore;
  readonly objectiveCorrect: number;
  readonly objectiveTotal: number;
  readonly freeResponseCorrect: number;
  readonly freeResponsePartial: number;
  readonly freeResponseIncorrect: number;
  readonly reviewedAiResponseCount: number;
  readonly pendingAiReviewCount: number;
  readonly failedAiReviewCount: number;
  readonly provisional: boolean;
}

export interface ExerciseTypeStatistic {
  readonly type: ExerciseV1["type"];
  readonly attempts: number;
  readonly performance: PerformanceScore;
}

export interface PracticeBankStatistics {
  readonly sessionCount: number;
  readonly totalAnswered: number;
  readonly completionPercent: number | null;
  readonly performance: PerformanceScore;
  readonly objectiveCorrect: number;
  readonly objectiveTotal: number;
  readonly freeResponseCorrect: number;
  readonly freeResponsePartial: number;
  readonly freeResponseIncorrect: number;
  readonly reviewedAiResponseCount: number;
  readonly pendingAiReviewCount: number;
  readonly failedAiReviewCount: number;
  readonly provisional: boolean;
  readonly latestScorePercent: number | null;
  readonly bestScorePercent: number | null;
  readonly bestAnswerStreak: number;
  readonly typeBreakdown: readonly ExerciseTypeStatistic[];
  readonly unmappedAttempts: number;
  readonly history: readonly SessionStatistic[];
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round(numerator / denominator * 100);
}

function outcomePoints(outcome: PerformanceOutcome): number {
  if (outcome.grading === "objective") return outcome.correct ? 1 : 0;
  if (outcome.grading === "ai-review") {
    return outcome.verdict === "correct" ? 1 : outcome.verdict === "partial" ? 0.5 : 0;
  }
  if (outcome.rating === "hard") return 0.5;
  return outcome.rating === "good" || outcome.rating === "easy" ? 1 : 0;
}

function isCorrect(outcome: PerformanceOutcome): boolean {
  if (outcome.grading === "objective") return outcome.correct;
  if (outcome.grading === "ai-review") return outcome.verdict === "correct";
  return outcome.rating === "good" || outcome.rating === "easy";
}

function isPartial(outcome: PerformanceOutcome): boolean {
  return outcome.grading === "ai-review"
    ? outcome.verdict === "partial"
    : outcome.grading === "self-rated" && outcome.rating === "hard";
}

export function calculatePerformanceScore(
  outcomes: readonly PerformanceOutcome[],
): PerformanceScore {
  const earnedPoints = outcomes.reduce(
    (total, outcome) => total + outcomePoints(outcome),
    0,
  );
  const correct = outcomes.filter(isCorrect).length;
  const partial = outcomes.filter(isPartial).length;
  return {
    earnedPoints,
    totalPoints: outcomes.length,
    percent: percentage(earnedPoints, outcomes.length),
    correct,
    partial,
    incorrect: outcomes.length - correct - partial,
  };
}

export function performanceOutcomeForResult(
  result: SessionItemResultV2,
): PerformanceOutcome | null {
  if (result.grading === "objective") {
    return { grading: "objective", correct: result.correct };
  }
  if (result.grading === "self-rated") {
    return { grading: "self-rated", rating: result.rating };
  }
  return result.state.status === "reviewed"
    ? { grading: "ai-review", verdict: result.state.verdict }
    : null;
}

function sessionOutcomes(session: SessionSummaryV2): PerformanceOutcome[] {
  return session.results.flatMap((result) => {
    const outcome = performanceOutcomeForResult(result);
    return outcome === null ? [] : [outcome];
  });
}

function sessionStatistic(session: SessionSummaryV2): SessionStatistic {
  const outcomes = sessionOutcomes(session);
  const reviewed = session.results.filter((result) =>
    result.grading === "ai-review" && result.state.status === "reviewed",
  );
  const pendingAiReviewCount = session.results.filter((result) =>
    result.grading === "ai-review" && result.state.status === "pending",
  ).length;
  const failedAiReviewCount = session.results.filter((result) =>
    result.grading === "ai-review" && result.state.status === "failed",
  ).length;
  const reviewedCorrect = reviewed.filter((result) =>
    result.grading === "ai-review"
      && result.state.status === "reviewed"
      && result.state.verdict === "correct",
  ).length;
  const reviewedPartial = reviewed.filter((result) =>
    result.grading === "ai-review"
      && result.state.status === "reviewed"
      && result.state.verdict === "partial",
  ).length;
  const reviewedIncorrect = reviewed.length - reviewedCorrect - reviewedPartial;
  const freeResponseCorrect = session.ratings.good + session.ratings.easy + reviewedCorrect;
  const started = Date.parse(session.startedAt);
  const finished = Date.parse(session.finishedAt);
  return {
    id: session.id,
    bankRevisionAtStart: session.bankRevisionAtStart,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    durationMs: Math.max(0, finished - started),
    completedCount: session.completedCount,
    exerciseCount: session.exerciseCount,
    skippedCount: Math.max(0, session.exerciseCount - session.completedCount),
    completionPercent: percentage(
      session.completedCount,
      session.exerciseCount,
    ) ?? 0,
    performance: calculatePerformanceScore(outcomes),
    practiceRun: calculatePracticeRun(session.results),
    objectiveCorrect: session.score.correct,
    objectiveTotal: session.score.total,
    freeResponseCorrect,
    freeResponsePartial: session.ratings.hard + reviewedPartial,
    freeResponseIncorrect: session.ratings.again + reviewedIncorrect,
    reviewedAiResponseCount: reviewed.length,
    pendingAiReviewCount,
    failedAiReviewCount,
    provisional: pendingAiReviewCount + failedAiReviewCount > 0,
  };
}

export function calculatePracticeBankStatistics(
  bank: PracticeBankV2,
): PracticeBankStatistics {
  const history = bank.sessions
    .map(sessionStatistic)
    .sort((left, right) => (
      Date.parse(right.finishedAt) - Date.parse(left.finishedAt)
      || right.id.localeCompare(left.id)
    ));
  const allOutcomes = bank.sessions.flatMap(sessionOutcomes);
  const performance = calculatePerformanceScore(allOutcomes);
  const totalAnswered = bank.sessions.reduce(
    (total, session) => total + session.completedCount,
    0,
  );
  const totalAvailable = bank.sessions.reduce(
    (total, session) => total + session.exerciseCount,
    0,
  );
  const typeByExerciseId = new Map(
    bank.exercises.map((exercise) => [exercise.id, exercise.type]),
  );
  const outcomesByType = new Map<
    ExerciseV1["type"],
    PerformanceOutcome[]
  >();
  let unmappedAttempts = 0;
  for (const session of bank.sessions) {
    for (const result of session.results) {
      const type = typeByExerciseId.get(result.exerciseId);
      if (type === undefined) {
        unmappedAttempts += 1;
        continue;
      }
      const outcome = performanceOutcomeForResult(result);
      if (outcome !== null) {
        const outcomes = outcomesByType.get(type) ?? [];
        outcomes.push(outcome);
        outcomesByType.set(type, outcomes);
      }
    }
  }
  const typeOrder = [...new Set(bank.exercises.map((exercise) => exercise.type))];
  const typeBreakdown = typeOrder.flatMap((type) => {
    const outcomes = outcomesByType.get(type);
    return outcomes === undefined || outcomes.length === 0
      ? []
      : [{
          type,
          attempts: outcomes.length,
          performance: calculatePerformanceScore(outcomes),
        }];
  });
  const settledScoreValues = history.flatMap((session) => (
    session.provisional || session.performance.percent === null
      ? []
      : [session.performance.percent]
  ));
  return {
    sessionCount: bank.sessions.length,
    totalAnswered,
    completionPercent: percentage(totalAnswered, totalAvailable),
    performance,
    objectiveCorrect: bank.sessions.reduce(
      (total, session) => total + session.score.correct,
      0,
    ),
    objectiveTotal: bank.sessions.reduce(
      (total, session) => total + session.score.total,
      0,
    ),
    freeResponseCorrect: history.reduce((total, session) => total + session.freeResponseCorrect, 0),
    freeResponsePartial: history.reduce((total, session) => total + session.freeResponsePartial, 0),
    freeResponseIncorrect: history.reduce((total, session) => total + session.freeResponseIncorrect, 0),
    reviewedAiResponseCount: history.reduce((total, session) => total + session.reviewedAiResponseCount, 0),
    pendingAiReviewCount: history.reduce((total, session) => total + session.pendingAiReviewCount, 0),
    failedAiReviewCount: history.reduce((total, session) => total + session.failedAiReviewCount, 0),
    provisional: history.some((session) => session.provisional),
    latestScorePercent: history[0]?.performance.percent ?? null,
    bestScorePercent: settledScoreValues.length === 0
      ? null
      : Math.max(...settledScoreValues),
    bestAnswerStreak: history.reduce(
      (best, session) => Math.max(best, session.practiceRun.bestStreak),
      0,
    ),
    typeBreakdown,
    unmappedAttempts,
    history,
  };
}
