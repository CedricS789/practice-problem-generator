import type { DashboardRecentSession } from "./dashboard-model";

export type ActivityRangeWeeks = 13 | 26 | 52;
export type ActivityMetric = "answers" | "sessions" | "minutes";
export type WeekStart = "monday" | "sunday";

export interface PracticeActivityDay {
  readonly dateKey: string;
  readonly timestamp: number;
  readonly future: boolean;
  readonly sessionCount: number;
  readonly answerCount: number;
  readonly durationMs: number;
  readonly scoredAnswerCount: number;
  readonly earnedPoints: number;
  readonly provisionalSessionCount: number;
  readonly performancePercent: number | null;
  readonly intensity: 0 | 1 | 2 | 3 | 4;
}

export interface PracticeActivityWeek {
  readonly startDateKey: string;
  readonly days: readonly PracticeActivityDay[];
  readonly sessionCount: number;
  readonly answerCount: number;
  readonly durationMs: number;
  readonly scoredAnswerCount: number;
  readonly earnedPoints: number;
  readonly performancePercent: number | null;
  readonly provisionalSessionCount: number;
}

export interface PracticeActivitySummary {
  readonly rangeWeeks: ActivityRangeWeeks;
  readonly weekStart: WeekStart;
  readonly startDateKey: string;
  readonly endDateKey: string;
  readonly activeDayCount: number;
  readonly sessionCount: number;
  readonly answerCount: number;
  readonly durationMs: number;
  readonly scoredAnswerCount: number;
  readonly earnedPoints: number;
  readonly performancePercent: number | null;
  readonly provisionalSessionCount: number;
  readonly busiestDay: PracticeActivityDay | null;
  readonly days: readonly PracticeActivityDay[];
  readonly weeks: readonly PracticeActivityWeek[];
}

export interface PracticeActivityOptions {
  readonly now?: Date;
  readonly rangeWeeks: ActivityRangeWeeks;
  readonly weekStart?: WeekStart;
}

interface MutableActivity {
  sessionCount: number;
  answerCount: number;
  durationMs: number;
  scoredAnswerCount: number;
  earnedPoints: number;
  provisionalSessionCount: number;
}

function emptyActivity(): MutableActivity {
  return {
    sessionCount: 0,
    answerCount: 0,
    durationMs: 0,
    scoredAnswerCount: 0,
    earnedPoints: 0,
    provisionalSessionCount: 0,
  };
}

function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfWeek(value: Date, weekStart: WeekStart): Date {
  const date = startOfLocalDay(value);
  const startDay = weekStart === "monday" ? 1 : 0;
  const delta = (date.getDay() - startDay + 7) % 7;
  return addLocalDays(date, -delta);
}

function percent(earnedPoints: number, scoredAnswerCount: number): number | null {
  return scoredAnswerCount === 0
    ? null
    : Math.round(earnedPoints / scoredAnswerCount * 100);
}

function intensity(answerCount: number, maximum: number): 0 | 1 | 2 | 3 | 4 {
  if (answerCount <= 0 || maximum <= 0) return 0;
  const level = Math.ceil(Math.sqrt(answerCount / maximum) * 4);
  return Math.min(4, Math.max(1, level)) as 1 | 2 | 3 | 4;
}

function sumActivity(items: readonly MutableActivity[]): MutableActivity {
  return items.reduce((total, item) => ({
    sessionCount: total.sessionCount + item.sessionCount,
    answerCount: total.answerCount + item.answerCount,
    durationMs: total.durationMs + item.durationMs,
    scoredAnswerCount: total.scoredAnswerCount + item.scoredAnswerCount,
    earnedPoints: total.earnedPoints + item.earnedPoints,
    provisionalSessionCount:
      total.provisionalSessionCount + item.provisionalSessionCount,
  }), emptyActivity());
}

export function activityMetricValue(
  week: PracticeActivityWeek,
  metric: ActivityMetric,
): number {
  if (metric === "sessions") return week.sessionCount;
  if (metric === "minutes") return week.durationMs / 60_000;
  return week.answerCount;
}

export function buildPracticeActivity(
  sessions: readonly DashboardRecentSession[],
  options: PracticeActivityOptions,
): PracticeActivitySummary {
  const now = startOfLocalDay(options.now ?? new Date());
  const weekStart = options.weekStart ?? "monday";
  const currentWeekStart = startOfWeek(now, weekStart);
  const rangeStart = addLocalDays(
    currentWeekStart,
    -(options.rangeWeeks - 1) * 7,
  );
  const rangeEnd = addLocalDays(rangeStart, options.rangeWeeks * 7 - 1);
  const activityByDate = new Map<string, MutableActivity>();

  for (const item of sessions) {
    const finished = new Date(item.session.finishedAt);
    if (!Number.isFinite(finished.getTime())) continue;
    const day = startOfLocalDay(finished);
    if (day < rangeStart || day > now) continue;
    const key = localDateKey(day);
    const activity = activityByDate.get(key) ?? emptyActivity();
    activity.sessionCount += 1;
    activity.answerCount += item.session.completedCount;
    activity.durationMs += Math.max(0, item.session.durationMs);
    activity.scoredAnswerCount += item.session.performance.totalPoints;
    activity.earnedPoints += item.session.performance.earnedPoints;
    if (item.session.provisional) activity.provisionalSessionCount += 1;
    activityByDate.set(key, activity);
  }

  const maximumAnswers = Math.max(
    0,
    ...[...activityByDate.values()].map((activity) => activity.answerCount),
  );
  const days: PracticeActivityDay[] = [];
  for (let offset = 0; offset < options.rangeWeeks * 7; offset += 1) {
    const date = addLocalDays(rangeStart, offset);
    const key = localDateKey(date);
    const activity = activityByDate.get(key) ?? emptyActivity();
    days.push({
      dateKey: key,
      timestamp: date.getTime(),
      future: date > now,
      ...activity,
      performancePercent: percent(
        activity.earnedPoints,
        activity.scoredAnswerCount,
      ),
      intensity: date > now
        ? 0
        : intensity(activity.answerCount, maximumAnswers),
    });
  }

  const weeks: PracticeActivityWeek[] = [];
  for (let index = 0; index < options.rangeWeeks; index += 1) {
    const weekDays = days.slice(index * 7, index * 7 + 7);
    const total = sumActivity(weekDays);
    weeks.push({
      startDateKey: weekDays[0]?.dateKey ?? localDateKey(rangeStart),
      days: weekDays,
      ...total,
      performancePercent: percent(total.earnedPoints, total.scoredAnswerCount),
    });
  }
  const pastDays = days.filter((day) => !day.future);
  const total = sumActivity(pastDays);
  const busiestDay = pastDays.reduce<PracticeActivityDay | null>(
    (busiest, day) => {
      if (day.answerCount === 0) return busiest;
      if (busiest === null || day.answerCount > busiest.answerCount) return day;
      return day.answerCount === busiest.answerCount && day.timestamp > busiest.timestamp
        ? day
        : busiest;
    },
    null,
  );
  return {
    rangeWeeks: options.rangeWeeks,
    weekStart,
    startDateKey: days[0]?.dateKey ?? localDateKey(rangeStart),
    endDateKey: localDateKey(now < rangeEnd ? now : rangeEnd),
    activeDayCount: pastDays.filter((day) => day.sessionCount > 0).length,
    ...total,
    performancePercent: percent(total.earnedPoints, total.scoredAnswerCount),
    busiestDay,
    days,
    weeks,
  };
}
