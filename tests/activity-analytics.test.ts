import assert from "node:assert/strict";
import test from "node:test";

import {
  activityMetricValue,
  buildPracticeActivity,
} from "../src/activity-analytics";
import type { DashboardRecentSession } from "../src/dashboard-model";
import type { SessionStatistic } from "../src/session-statistics";

function recent(
  id: string,
  finishedAt: string,
  options: {
    readonly answers: number;
    readonly durationMinutes: number;
    readonly earned: number;
    readonly scored: number;
    readonly provisional?: boolean;
  },
): DashboardRecentSession {
  const finished = Date.parse(finishedAt);
  const statistic: SessionStatistic = {
    id,
    bankRevisionAtStart: 0,
    startedAt: new Date(finished - options.durationMinutes * 60_000).toISOString(),
    finishedAt,
    durationMs: options.durationMinutes * 60_000,
    completedCount: options.answers,
    exerciseCount: options.answers,
    completionPercent: 100,
    performance: {
      earnedPoints: options.earned,
      totalPoints: options.scored,
      percent: options.scored === 0
        ? null
        : Math.round(options.earned / options.scored * 100),
      correct: Math.floor(options.earned),
      partial: options.earned % 1 === 0 ? 0 : 1,
      incorrect: Math.max(0, options.scored - Math.ceil(options.earned)),
    },
    practiceRun: {
      earnedPoints: options.earned,
      totalPoints: options.scored,
      percent: options.scored === 0
        ? null
        : Math.round(options.earned / options.scored * 100),
      currentStreak: 0,
      bestStreak: 0,
      correct: 0,
      partial: 0,
      incorrect: 0,
      rank: {
        id: "unranked",
        mark: "—",
        label: "Unranked",
        description: "Synthetic test rank.",
      },
    },
    objectiveCorrect: 0,
    objectiveTotal: 0,
    freeResponseCorrect: 0,
    freeResponsePartial: 0,
    freeResponseIncorrect: 0,
    reviewedAiResponseCount: 0,
    pendingAiReviewCount: options.provisional === true ? 1 : 0,
    failedAiReviewCount: 0,
    provisional: options.provisional === true,
  };
  return {
    bankPath: "Notes/Term/Course/Practice/Test - Practice.md",
    bankId: "bank-test",
    sourcePath: "Notes/Term/Course/Test.md",
    sourceTitle: "Test",
    session: statistic,
  };
}

test("activity heatmap groups sessions by local completion day and range", () => {
  const now = new Date("2026-08-21T12:00:00");
  const activity = buildPracticeActivity([
    recent("today-a", "2026-08-21T09:00:00", {
      answers: 8,
      durationMinutes: 20,
      earned: 6,
      scored: 8,
    }),
    recent("today-b", "2026-08-21T11:00:00", {
      answers: 4,
      durationMinutes: 10,
      earned: 4,
      scored: 4,
      provisional: true,
    }),
    recent("prior-week", "2026-08-12T10:00:00", {
      answers: 3,
      durationMinutes: 15,
      earned: 1.5,
      scored: 3,
    }),
    recent("outside", "2026-01-01T10:00:00", {
      answers: 99,
      durationMinutes: 90,
      earned: 99,
      scored: 99,
    }),
    recent("future", "2026-08-23T10:00:00", {
      answers: 20,
      durationMinutes: 30,
      earned: 20,
      scored: 20,
    }),
  ], { now, rangeWeeks: 13, weekStart: "monday" });

  assert.equal(activity.days.length, 91);
  assert.equal(new Date(activity.days[0]?.timestamp ?? 0).getDay(), 1);
  assert.equal(activity.sessionCount, 3);
  assert.equal(activity.answerCount, 15);
  assert.equal(activity.durationMs, 45 * 60_000);
  assert.equal(activity.activeDayCount, 2);
  assert.equal(activity.provisionalSessionCount, 1);
  assert.equal(activity.scoredAnswerCount, 15);
  assert.equal(activity.earnedPoints, 11.5);
  assert.equal(activity.performancePercent, 77);
  assert.equal(activity.busiestDay?.dateKey, "2026-08-21");
  assert.equal(activity.busiestDay?.answerCount, 12);
  assert.equal(activity.busiestDay?.intensity, 4);
  assert.equal(
    activity.days.find((day) => day.dateKey === "2026-08-23")?.future,
    true,
  );
});

test("weekly buckets expose answer, session, and duration graph metrics", () => {
  const activity = buildPracticeActivity([
    recent("one", "2026-08-20T09:00:00", {
      answers: 5,
      durationMinutes: 12,
      earned: 2.5,
      scored: 5,
    }),
  ], {
    now: new Date("2026-08-21T12:00:00"),
    rangeWeeks: 13,
    weekStart: "sunday",
  });
  const current = activity.weeks.at(-1);
  assert.ok(current);
  assert.equal(new Date(`${current.startDateKey}T00:00:00`).getDay(), 0);
  assert.equal(activityMetricValue(current, "answers"), 5);
  assert.equal(activityMetricValue(current, "sessions"), 1);
  assert.equal(activityMetricValue(current, "minutes"), 12);
  assert.equal(current.performancePercent, 50);
});

test("empty activity stays neutral and preserves future calendar cells", () => {
  const activity = buildPracticeActivity([], {
    now: new Date("2026-08-21T12:00:00"),
    rangeWeeks: 26,
  });
  assert.equal(activity.days.length, 182);
  assert.equal(activity.weeks.length, 26);
  assert.equal(activity.sessionCount, 0);
  assert.equal(activity.performancePercent, null);
  assert.equal(activity.busiestDay, null);
  assert.ok(activity.days.some((day) => day.future));
  assert.ok(activity.days.every((day) => day.intensity === 0));
});
