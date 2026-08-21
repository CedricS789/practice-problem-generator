import type { SelfRatingV1 } from "./model";

export interface PracticeRunAnswer {
  readonly grading?: "objective" | "self-rated" | "ai-review";
  readonly correct?: boolean;
  readonly rating?: SelfRatingV1;
  readonly state?:
    | { readonly status: "pending" }
    | {
        readonly status: "reviewed";
        readonly verdict: "incorrect" | "partial" | "correct";
      }
    | { readonly status: "failed" };
  readonly aiReview?: {
    readonly status:
      | { readonly state: "pending" }
      | {
          readonly state: "reviewed";
          readonly verdict: "incorrect" | "partial" | "correct";
        }
      | { readonly state: "failed" };
  };
}

export type PracticeRunOutcome = "correct" | "partial" | "incorrect";
export type PracticeRunRankId = "unranked" | "d" | "c" | "b" | "a" | "s";

export interface PracticeRunRank {
  readonly id: PracticeRunRankId;
  readonly mark: string;
  readonly label: string;
  readonly description: string;
}

export interface PracticeRunScore {
  readonly earnedPoints: number;
  readonly totalPoints: number;
  readonly percent: number | null;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly correct: number;
  readonly partial: number;
  readonly incorrect: number;
  readonly rank: PracticeRunRank;
}

const UNRANKED: PracticeRunRank = {
  id: "unranked",
  mark: "—",
  label: "Unranked",
  description: "Complete an answer to start this practice run.",
};

const RANKS: readonly (PracticeRunRank & { readonly minimumPercent: number })[] = [
  {
    id: "s",
    mark: "S",
    label: "Flawless",
    description: "Every answer earned full credit.",
    minimumPercent: 100,
  },
  {
    id: "a",
    mark: "A",
    label: "Strong",
    description: "A high-scoring practice run.",
    minimumPercent: 85,
  },
  {
    id: "b",
    mark: "B",
    label: "Solid",
    description: "A solid run with clear progress.",
    minimumPercent: 70,
  },
  {
    id: "c",
    mark: "C",
    label: "Building",
    description: "Momentum is building; review the missed ideas.",
    minimumPercent: 50,
  },
  {
    id: "d",
    mark: "D",
    label: "Starting point",
    description: "Use the feedback to strengthen the next run.",
    minimumPercent: 0,
  },
];

export function practiceRunOutcome(
  answer: PracticeRunAnswer,
): PracticeRunOutcome | null {
  const hasCorrect = typeof answer.correct === "boolean";
  const hasRating = answer.rating !== undefined;
  if (hasCorrect && hasRating) return null;
  if (hasCorrect) return answer.correct === true ? "correct" : "incorrect";
  if (hasRating) {
    switch (answer.rating) {
      case "good":
      case "easy":
        return "correct";
      case "hard":
        return "partial";
      case "again":
        return "incorrect";
    }
  }
  const status = answer.aiReview?.status;
  const reviewedVerdict = status?.state === "reviewed"
    ? status.verdict
    : answer.state?.status === "reviewed"
      ? answer.state.verdict
      : undefined;
  if (reviewedVerdict === undefined) return null;
  if (reviewedVerdict === "correct") return "correct";
  return reviewedVerdict === "partial" ? "partial" : "incorrect";
}

function rankForPercent(percent: number | null): PracticeRunRank {
  if (percent === null) return UNRANKED;
  const candidate = RANKS.find(
    (entry) => percent >= entry.minimumPercent,
  ) ?? RANKS.at(-1);
  if (candidate === undefined) return UNRANKED;
  const { minimumPercent: _minimumPercent, ...rank } = candidate;
  void _minimumPercent;
  return rank;
}

function isUnscoredAiReview(answer: PracticeRunAnswer): boolean {
  const uiState = answer.aiReview?.status.state;
  const persistedState = answer.state?.status;
  return uiState === "pending" ||
    uiState === "failed" ||
    persistedState === "pending" ||
    persistedState === "failed";
}

export function calculatePracticeRun(
  answers: readonly PracticeRunAnswer[],
  pending?: PracticeRunAnswer,
): PracticeRunScore {
  const candidates = pending === undefined ? answers : [...answers, pending];
  let earnedPoints = 0;
  let totalPoints = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let correct = 0;
  let partial = 0;
  let incorrect = 0;
  for (const answer of candidates) {
    const outcome = practiceRunOutcome(answer);
    if (outcome === null) {
      if (isUnscoredAiReview(answer)) currentStreak = 0;
      continue;
    }
    totalPoints += 1;
    if (outcome === "correct") {
      earnedPoints += 1;
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
      correct += 1;
      continue;
    }
    currentStreak = 0;
    if (outcome === "partial") {
      earnedPoints += 0.5;
      partial += 1;
    } else {
      incorrect += 1;
    }
  }
  const percent = totalPoints === 0
    ? null
    : Math.round(earnedPoints / totalPoints * 100);
  return {
    earnedPoints,
    totalPoints,
    percent,
    currentStreak,
    bestStreak,
    correct,
    partial,
    incorrect,
    rank: rankForPercent(percent),
  };
}

export function formatPracticeRunPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export function practiceRunRankText(rank: PracticeRunRank): string {
  return rank.id === "unranked"
    ? rank.label
    : `${rank.mark} rank · ${rank.label}`;
}
