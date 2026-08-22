import assert from "node:assert/strict";
import test from "node:test";

import type { PracticeBankV2, SessionSummaryV2 } from "../src/model";
import {
  calculatePerformanceScore,
  calculatePracticeBankStatistics,
} from "../src/session-statistics";

function session(
  id: string,
  startedAt: string,
  finishedAt: string,
  results: SessionSummaryV2["results"],
  exerciseCount = results.length,
): SessionSummaryV2 {
  const objective = results.filter((result) => result.grading === "objective");
  const ratings = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const result of results) {
    if (result.grading === "self-rated") ratings[result.rating] += 1;
  }
  return {
    schemaVersion: 2,
    id,
    startedAt,
    finishedAt,
    bankRevisionAtStart: 0,
    exerciseCount,
    completedCount: results.length,
    score: {
      correct: objective.filter((result) => result.correct).length,
      total: objective.length,
    },
    ratings,
    results,
  };
}

function bank(sessions: SessionSummaryV2[]): PracticeBankV2 {
  return {
    schemaVersion: 2,
    bankId: "bank-statistics",
    revision: sessions.length,
    createdAt: "2026-08-20T08:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    source: {
      vaultPath: "Notes/Course/Topic.md",
      wikilink: "[[Notes/Course/Topic]]",
      title: "Topic",
      scope: "note",
      hash: `sha256:${"a".repeat(64)}`,
    },
    segments: [{
      id: "segment-1",
      kind: "paragraph",
      ordinal: 1,
      headingPath: ["Topic"],
      text: "Synthetic source evidence.",
    }],
    visuals: [],
    exercises: [
      {
        id: "objective-1",
        type: "single-select",
        title: "Objective",
        prompt: "Choose the supported answer.",
        difficulty: "medium",
        sourceSegmentIds: ["segment-1"],
        choices: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correctChoiceIds: ["a"],
        groundedAnswer: "A is supported.",
      },
      {
        id: "free-1",
        type: "short-answer",
        title: "Free response",
        prompt: "Explain the evidence.",
        difficulty: "medium",
        sourceSegmentIds: ["segment-1"],
        groundedAnswer: "Synthetic source evidence.",
        acceptableAnswers: ["Synthetic source evidence."],
        keyPoints: ["Use the supplied evidence."],
      },
    ],
    sessions,
  };
}

test("performance scoring gives partial free responses half credit", () => {
  assert.deepEqual(calculatePerformanceScore([
    { grading: "objective", correct: true },
    { grading: "objective", correct: false },
    { grading: "self-rated", rating: "hard" },
    { grading: "self-rated", rating: "good" },
    { grading: "self-rated", rating: "again" },
  ]), {
    earnedPoints: 2.5,
    totalPoints: 5,
    percent: 50,
    correct: 2,
    partial: 1,
    incorrect: 2,
  });
});

test("bank statistics aggregate history, outcomes, and current exercise types", () => {
  const earlier = session(
    "session-earlier",
    "2026-08-20T10:00:00.000Z",
    "2026-08-20T10:05:00.000Z",
    [
      { exerciseId: "objective-1", grading: "objective", correct: true },
      { exerciseId: "free-1", grading: "self-rated", rating: "hard" },
    ],
  );
  const latest = session(
    "session-latest",
    "2026-08-20T11:00:00.000Z",
    "2026-08-20T11:04:00.000Z",
    [
      { exerciseId: "objective-1", grading: "objective", correct: false },
      { exerciseId: "free-1", grading: "self-rated", rating: "good" },
      { exerciseId: "removed-1", grading: "objective", correct: true },
    ],
  );
  const statistics = calculatePracticeBankStatistics(bank([earlier, latest]));
  assert.equal(statistics.sessionCount, 2);
  assert.equal(statistics.totalAnswered, 5);
  assert.equal(statistics.completionPercent, 100);
  assert.equal(statistics.performance.percent, 70);
  assert.equal(statistics.latestScorePercent, 67);
  assert.equal(statistics.bestScorePercent, 75);
  assert.equal(statistics.bestAnswerStreak, 2);
  assert.equal(statistics.objectiveCorrect, 2);
  assert.equal(statistics.objectiveTotal, 3);
  assert.equal(statistics.freeResponseCorrect, 1);
  assert.equal(statistics.freeResponsePartial, 1);
  assert.equal(statistics.freeResponseIncorrect, 0);
  assert.equal(statistics.unmappedAttempts, 1);
  assert.equal(statistics.history[0]?.id, "session-latest");
  assert.equal(statistics.history[0]?.durationMs, 4 * 60 * 1_000);
  assert.equal(statistics.history[0]?.practiceRun.earnedPoints, 2);
  assert.equal(statistics.history[0]?.practiceRun.bestStreak, 2);
  assert.equal(statistics.history[0]?.practiceRun.rank.id, "c");
  assert.deepEqual(
    statistics.typeBreakdown.map((entry) => [
      entry.type,
      entry.attempts,
      entry.performance.percent,
    ]),
    [
      ["single-select", 2, 50],
      ["short-answer", 2, 75],
    ],
  );
});

test("a bank without completed sessions reports neutral statistics", () => {
  const statistics = calculatePracticeBankStatistics(bank([]));
  assert.equal(statistics.sessionCount, 0);
  assert.equal(statistics.performance.percent, null);
  assert.equal(statistics.latestScorePercent, null);
  assert.equal(statistics.bestScorePercent, null);
  assert.equal(statistics.bestAnswerStreak, 0);
  assert.deepEqual(statistics.history, []);
});

test("skipped questions are visible in history and excluded from performance", () => {
  const withSkips = session(
    "session-with-skips",
    "2026-08-20T11:00:00.000Z",
    "2026-08-20T11:02:00.000Z",
    [{ exerciseId: "objective-1", grading: "objective", correct: true }],
    3,
  );
  const statistics = calculatePracticeBankStatistics(bank([withSkips]));
  const latest = statistics.history[0];
  assert.equal(latest?.completedCount, 1);
  assert.equal(latest?.skippedCount, 2);
  assert.equal(latest?.completionPercent, 33);
  assert.equal(latest?.performance.totalPoints, 1);
  assert.equal(latest?.performance.percent, 100);
  assert.equal(latest?.practiceRun.totalPoints, 1);
});

test("pending AI reviews count as completed but stay outside provisional scoring", () => {
  const pending = session(
    "session-pending",
    "2026-08-20T12:00:00.000Z",
    "2026-08-20T12:01:00.000Z",
    [{
      exerciseId: "free-1",
      grading: "ai-review",
      request: {
        requestId: "review-pending",
        requestHash: `sha256:${"b".repeat(64)}`,
        sessionId: "session-pending",
        exerciseId: "free-1",
        provider: "codex",
        reasoningEffort: "high",
        promptVersion: "answer-review-v1",
        requestedAt: "2026-08-20T12:00:30.000Z",
        submittedAnswer: "My answer.",
        context: {
          exerciseTitle: "Free response",
          exerciseType: "short-answer",
          prompt: "Explain the evidence.",
          groundedAnswer: "Synthetic source evidence.",
          keyPoints: ["Use the supplied evidence."],
          sourceSegments: [{ id: "segment-1", headingPath: ["Topic"], text: "Synthetic source evidence." }],
        },
      },
      state: { status: "pending", queuedAt: "2026-08-20T12:00:30.000Z", attempts: 0 },
    }],
  );
  const reviewed = session(
    "session-reviewed",
    "2026-08-20T13:00:00.000Z",
    "2026-08-20T13:01:00.000Z",
    [{
      exerciseId: "free-1",
      grading: "ai-review",
      request: {
        requestId: "review-complete",
        requestHash: `sha256:${"c".repeat(64)}`,
        sessionId: "session-reviewed",
        exerciseId: "free-1",
        provider: "claude",
        reasoningEffort: "medium",
        promptVersion: "answer-review-v1",
        requestedAt: "2026-08-20T13:00:30.000Z",
        submittedAnswer: "A partly complete answer.",
        context: {
          exerciseTitle: "Free response",
          exerciseType: "short-answer",
          prompt: "Explain the evidence.",
          groundedAnswer: "Synthetic source evidence.",
          keyPoints: ["Use the supplied evidence."],
          sourceSegments: [{ id: "segment-1", headingPath: ["Topic"], text: "Synthetic source evidence." }],
        },
      },
      state: {
        status: "reviewed",
        reviewedAt: "2026-08-20T13:02:00.000Z",
        attempts: 1,
        verdict: "partial",
        feedback: "The core direction is right, but one required point is missing.",
        criteria: [{
          criterion: "Use the supplied evidence.",
          outcome: "partial",
          feedback: "Name the evidence explicitly.",
          sourceSegmentIds: ["segment-1"],
        }],
      },
    }],
  );

  const statistics = calculatePracticeBankStatistics(bank([pending, reviewed]));
  assert.equal(statistics.totalAnswered, 2);
  assert.equal(statistics.performance.totalPoints, 1);
  assert.equal(statistics.performance.percent, 50);
  assert.equal(statistics.reviewedAiResponseCount, 1);
  assert.equal(statistics.pendingAiReviewCount, 1);
  assert.equal(statistics.failedAiReviewCount, 0);
  assert.equal(statistics.freeResponsePartial, 1);
  assert.equal(statistics.provisional, true);
  const pendingStatistic = statistics.history.find((entry) => entry.id === "session-pending");
  assert.equal(pendingStatistic?.completedCount, 1);
  assert.equal(pendingStatistic?.performance.percent, null);
  assert.equal(pendingStatistic?.practiceRun.totalPoints, 0);
  assert.equal(pendingStatistic?.provisional, true);
});

test("a provisional partial-denominator score cannot become the all-time best", () => {
  const settled = session(
    "session-settled",
    "2026-08-20T10:00:00.000Z",
    "2026-08-20T10:01:00.000Z",
    [
      { exerciseId: "objective-1", grading: "objective", correct: true },
      { exerciseId: "free-1", grading: "self-rated", rating: "hard" },
    ],
  );
  const provisional = session(
    "session-provisional",
    "2026-08-20T11:00:00.000Z",
    "2026-08-20T11:01:00.000Z",
    [
      { exerciseId: "objective-1", grading: "objective", correct: true },
      {
        exerciseId: "free-1",
        grading: "ai-review",
        request: {
          requestId: "review-provisional-best",
          requestHash: `sha256:${"d".repeat(64)}`,
          sessionId: "session-provisional",
          exerciseId: "free-1",
          provider: "codex",
          reasoningEffort: "high",
          promptVersion: "answer-review-v1",
          requestedAt: "2026-08-20T11:00:30.000Z",
          submittedAnswer: "My answer.",
          context: {
            exerciseTitle: "Free response",
            exerciseType: "short-answer",
            prompt: "Explain the evidence.",
            groundedAnswer: "Synthetic source evidence.",
            keyPoints: ["Use the supplied evidence."],
            sourceSegments: [{
              id: "segment-1",
              headingPath: ["Topic"],
              text: "Synthetic source evidence.",
            }],
          },
        },
        state: {
          status: "pending",
          queuedAt: "2026-08-20T11:00:30.000Z",
          attempts: 0,
        },
      },
    ],
  );

  const statistics = calculatePracticeBankStatistics(bank([settled, provisional]));
  assert.equal(statistics.history[0]?.performance.percent, 100);
  assert.equal(statistics.history[0]?.provisional, true);
  assert.equal(statistics.bestScorePercent, 75);
});
