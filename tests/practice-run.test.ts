import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePracticeRun,
  formatPracticeRunPoints,
  practiceRunOutcome,
  practiceRunRankText,
} from "../src/practice-run";

test("practice run derives points, streaks, and rank from mixed outcomes", () => {
  const run = calculatePracticeRun([
    { correct: true },
    { rating: "good" },
    { rating: "hard" },
    { correct: true },
    { correct: false },
    { rating: "easy" },
  ]);

  assert.deepEqual(run, {
    earnedPoints: 4.5,
    totalPoints: 6,
    percent: 75,
    currentStreak: 1,
    bestStreak: 2,
    correct: 4,
    partial: 1,
    incorrect: 1,
    rank: {
      id: "b",
      mark: "B",
      label: "Solid",
      description: "A solid run with clear progress.",
    },
  });
});

test("rank thresholds are deterministic and a perfect run earns S rank", () => {
  const cases = [
    [[], "unranked"],
    [[{ correct: false }], "d"],
    [[{ correct: true }, { correct: false }], "c"],
    [[{ correct: true }, { correct: true }, { correct: false }], "c"],
    [[{ correct: true }, { correct: true }, { rating: "hard" }], "b"],
    [[{ correct: true }, { correct: true }, { correct: true }, { rating: "hard" }], "a"],
    [[{ correct: true }, { correct: true }], "s"],
  ] as const;
  for (const [answers, expected] of cases) {
    assert.equal(calculatePracticeRun(answers).rank.id, expected);
  }
});

test("malformed or ambiguous answer records are ignored", () => {
  assert.equal(practiceRunOutcome({}), null);
  assert.equal(practiceRunOutcome({ correct: true, rating: "good" }), null);
  const run = calculatePracticeRun([
    {},
    { correct: true, rating: "good" },
    { correct: true },
  ]);
  assert.equal(run.totalPoints, 1);
  assert.equal(run.earnedPoints, 1);
});

test("a pending objective answer updates feedback once without mutating history", () => {
  const completed = [{ correct: true }] as const;
  const correctFeedback = calculatePracticeRun(completed, { correct: true });
  assert.equal(correctFeedback.totalPoints, 2);
  assert.equal(correctFeedback.currentStreak, 2);
  assert.equal(completed.length, 1);

  const incorrectFeedback = calculatePracticeRun(completed, { correct: false });
  assert.equal(incorrectFeedback.totalPoints, 2);
  assert.equal(incorrectFeedback.currentStreak, 0);
  assert.equal(incorrectFeedback.bestStreak, 1);
});

test("unresolved AI reviews break streaks without entering the score", () => {
  const pendingRun = calculatePracticeRun([
    { correct: true },
    { grading: "ai-review", state: { status: "pending" } },
    { correct: true },
  ]);
  assert.equal(pendingRun.earnedPoints, 2);
  assert.equal(pendingRun.totalPoints, 2);
  assert.equal(pendingRun.currentStreak, 1);
  assert.equal(pendingRun.bestStreak, 1);

  const failedRun = calculatePracticeRun([
    { correct: true },
    { aiReview: { status: { state: "failed" } } },
    { correct: true },
  ]);
  assert.equal(failedRun.earnedPoints, 2);
  assert.equal(failedRun.totalPoints, 2);
  assert.equal(failedRun.currentStreak, 1);
  assert.equal(failedRun.bestStreak, 1);
});

test("run display helpers keep half points and ranks readable", () => {
  assert.equal(formatPracticeRunPoints(2), "2");
  assert.equal(formatPracticeRunPoints(2.5), "2.5");
  assert.equal(
    practiceRunRankText(calculatePracticeRun([{ correct: true }]).rank),
    "S rank · Flawless",
  );
  assert.equal(practiceRunRankText(calculatePracticeRun([]).rank), "Unranked");
});
