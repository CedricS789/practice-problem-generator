import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregatePracticeDashboard,
  countDashboardBanks,
  getDashboardScopeOptions,
  type DashboardBankRecord,
  type DashboardScope,
} from "../src/dashboard-model";
import { migratePracticeBankV2ToV3 } from "../src/learning-path";
import type {
  ExerciseV1,
  PracticeBankV2,
  AiReviewStateV2,
  SessionItemResultV2,
  SessionSummaryV2,
  SessionSummaryV3,
} from "../src/model";

function shortAnswer(id: string): ExerciseV1 {
  return {
    id,
    type: "short-answer",
    title: id,
    prompt: "Explain the source.",
    difficulty: "medium",
    sourceSegmentIds: ["segment-1"],
    groundedAnswer: "Grounded answer.",
    acceptableAnswers: ["Grounded answer."],
    keyPoints: ["Grounded answer."],
  };
}

function singleSelect(id: string): ExerciseV1 {
  return {
    id,
    type: "single-select",
    title: id,
    prompt: "Select the supported answer.",
    difficulty: "medium",
    sourceSegmentIds: ["segment-1"],
    choices: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correctChoiceIds: ["a"],
    groundedAnswer: "A.",
  };
}

function session(
  id: string,
  finishedAt: string,
  results: SessionSummaryV2["results"],
  exerciseCount = results.length,
): SessionSummaryV2 {
  const finished = Date.parse(finishedAt);
  const ratings = { again: 0, hard: 0, good: 0, easy: 0 };
  const objective = results.filter((result) => result.grading === "objective");
  for (const result of results) {
    if (result.grading === "self-rated") ratings[result.rating] += 1;
  }
  return {
    schemaVersion: 2,
    id,
    startedAt: new Date(finished - 60_000).toISOString(),
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

interface RecordOptions {
  readonly bankId: string;
  readonly sourcePath: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly exercises?: readonly ExerciseV1[];
  readonly sessions?: readonly SessionSummaryV2[];
  readonly sourceExists?: boolean;
  readonly bankPath?: string;
}

function record(options: RecordOptions): DashboardBankRecord {
  const bank: PracticeBankV2 = {
    schemaVersion: 2,
    bankId: options.bankId,
    revision: options.sessions?.length ?? 0,
    createdAt: "2026-08-20T08:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    source: {
      vaultPath: options.sourcePath,
      wikilink: `[[${options.sourcePath.replace(/\.md$/u, "")}]]`,
      title: options.title ?? options.sourcePath.split("/").at(-1)?.replace(/\.md$/u, "") ?? "Source",
      scope: "note",
      hash: `sha256:${"a".repeat(64)}`,
    },
    segments: [{
      id: "segment-1",
      kind: "paragraph",
      ordinal: 1,
      headingPath: ["Source"],
      text: "Synthetic source evidence.",
    }],
    visuals: [],
    exercises: [...(options.exercises ?? [shortAnswer(`${options.bankId}-exercise`)])],
    sessions: [...(options.sessions ?? [])],
  };
  return {
    bankPath: options.bankPath ?? `Practice/${options.bankId}.md`,
    bank: migratePracticeBankV2ToV3(bank),
    sourceTags: options.tags ?? [],
    sourceExists: options.sourceExists ?? true,
  };
}

function bankCount(
  records: readonly DashboardBankRecord[],
  scope: DashboardScope,
): number {
  return aggregatePracticeDashboard(records, scope).bankCount;
}

function aiReviewResult(
  requestId: string,
  sessionId: string,
  state: AiReviewStateV2,
): Extract<SessionItemResultV2, { grading: "ai-review" }> {
  return {
    exerciseId: "free-1",
    grading: "ai-review",
    request: {
      requestId,
      requestHash: `sha256:${requestId.endsWith("pending") ? "b".repeat(64) : "c".repeat(64)}`,
      sessionId,
      exerciseId: "free-1",
      provider: "codex",
      reasoningEffort: "high",
      promptVersion: "answer-review-v1",
      requestedAt: "2026-08-21T12:00:30.000Z",
      submittedAnswer: "Synthetic submitted answer.",
      context: {
        exerciseTitle: "Free response",
        exerciseType: "short-answer",
        prompt: "Explain the source.",
        groundedAnswer: "Grounded answer.",
        keyPoints: ["Grounded answer."],
        sourceSegments: [{ id: "segment-1", headingPath: ["Source"], text: "Synthetic source evidence." }],
      },
    },
    state,
  };
}

test("scope options cover every folder level, tag ancestor, and source note", () => {
  const records = [
    record({
      bankId: "a",
      sourcePath: "Notes/Term/Course/Topic A.md",
      title: "Topic A",
      tags: ["#Course/AI", "exam/closed-book"],
    }),
    record({
      bankId: "b",
      sourcePath: "Notes/Term/Course/Sub/Topic B.md",
      title: "Topic B",
      tags: ["course", "#Exam/Open-Book"],
    }),
    record({
      bankId: "c",
      sourcePath: "Archive/Topic C.md",
      title: "Topic C",
    }),
  ];

  const options = getDashboardScopeOptions(records);
  assert.deepEqual(options.all, {
    scope: { kind: "all" },
    label: "All practice",
    count: 3,
  });
  assert.deepEqual(
    options.folders.map((option) => [option.scope.kind === "folder" ? option.scope.path : "", option.count]),
    [
      ["Archive", 1],
      ["Notes", 2],
      ["Notes/Term", 2],
      ["Notes/Term/Course", 2],
      ["Notes/Term/Course/Sub", 1],
    ],
  );
  assert.deepEqual(
    options.tags.map((option) => [option.label, option.count]),
    [
      ["#course", 2],
      ["#course/ai", 1],
      ["#exam", 2],
      ["#exam/closed-book", 1],
      ["#exam/open-book", 1],
    ],
  );
  assert.deepEqual(
    options.sources.map((option) => [option.label, option.count]),
    [["Topic A", 1], ["Topic B", 1], ["Topic C", 1]],
  );

  assert.equal(bankCount(records, { kind: "all" }), 3);
  assert.equal(bankCount(records, { kind: "folder", path: "Notes/Term" }), 2);
  assert.equal(bankCount(records, { kind: "folder", path: "Notes/Term/Course/Sub" }), 1);
  assert.equal(bankCount(records, { kind: "tag", tag: "#COURSE" }), 2);
  assert.equal(bankCount(records, { kind: "tag", tag: "course/ai" }), 1);
  assert.equal(bankCount(records, { kind: "source", path: "Notes\\Term\\Course\\Topic A.md" }), 1);
});

test("a tag facet combines with a folder and includes nested tags", () => {
  const records = [
    record({
      bankId: "inside-match",
      sourcePath: "Notes/Course/One.md",
      tags: ["exam/closed-book/calculation"],
    }),
    record({
      bankId: "inside-other-tag",
      sourcePath: "Notes/Course/Two.md",
      tags: ["exam/open-book"],
    }),
    record({
      bankId: "outside-match",
      sourcePath: "Archive/Three.md",
      tags: ["exam/closed-book"],
    }),
  ];

  const summary = aggregatePracticeDashboard(records, {
    primary: { kind: "folder", path: "Notes/Course" },
    tagPrefix: "#EXAM/CLOSED-BOOK",
  });
  assert.equal(summary.bankCount, 1);
  assert.equal(countDashboardBanks(records, {
    primary: { kind: "folder", path: "Notes/Course" },
    tagPrefix: "#EXAM/CLOSED-BOOK",
  }), 1);
  assert.equal(summary.banks[0]?.bankId, "inside-match");
  assert.deepEqual(summary.filter, {
    primary: { kind: "folder", path: "Notes/Course" },
    tagPrefix: "exam/closed-book",
  });
});

test("dashboard totals weight individual answers and completion opportunities", () => {
  const records = [
    record({
      bankId: "bank-a",
      sourcePath: "Notes/Course/A.md",
      exercises: [singleSelect("a-objective"), shortAnswer("a-unpracticed")],
      sessions: [session(
        "a-session",
        "2026-08-20T10:00:00.000Z",
        [{ exerciseId: "a-objective", grading: "objective", correct: true }],
        2,
      )],
    }),
    record({
      bankId: "bank-b",
      sourcePath: "Notes/Course/B.md",
      exercises: [
        singleSelect("b-objective"),
        shortAnswer("b-free-1"),
        shortAnswer("b-free-2"),
      ],
      sessions: [session(
        "b-session",
        "2026-08-20T11:00:00.000Z",
        [
          { exerciseId: "b-objective", grading: "objective", correct: false },
          { exerciseId: "b-free-1", grading: "self-rated", rating: "hard" },
          { exerciseId: "b-free-2", grading: "self-rated", rating: "good" },
        ],
      )],
    }),
    record({
      bankId: "bank-c",
      sourcePath: "Notes/Course/C.md",
      exercises: [shortAnswer("c-unpracticed")],
      sourceExists: false,
    }),
  ];

  const summary = aggregatePracticeDashboard(records, { kind: "all" });
  assert.equal(summary.bankCount, 3);
  assert.equal(summary.problemCount, 6);
  assert.equal(summary.sessionCount, 2);
  assert.equal(summary.answerCount, 4);
  assert.equal(summary.practicedBankCount, 2);
  assert.equal(summary.unpracticedBankCount, 1);
  assert.equal(summary.practicedProblemCount, 4);
  assert.equal(summary.unpracticedProblemCount, 2);
  assert.equal(summary.completionPercent, 80);
  assert.deepEqual(summary.performance, {
    earnedPoints: 2.5,
    totalPoints: 4,
    percent: 63,
    correct: 2,
    partial: 1,
    incorrect: 1,
  });
  assert.equal(summary.bestAnswerStreak, 1);
  assert.equal(summary.objectiveCorrect, 1);
  assert.equal(summary.objectiveTotal, 2);
  assert.equal(summary.freeResponseCorrect, 1);
  assert.equal(summary.freeResponsePartial, 1);
  assert.equal(summary.freeResponseIncorrect, 0);
  assert.equal(summary.missingSourceCount, 1);
  assert.deepEqual(
    summary.typeBreakdown.map((entry) => ({
      type: entry.type,
      problems: entry.problemCount,
      practiced: entry.practicedProblemCount,
      answers: entry.answerCount,
      percent: entry.performance.percent,
    })),
    [
      { type: "short-answer", problems: 4, practiced: 2, answers: 2, percent: 75 },
      { type: "single-select", problems: 2, practiced: 2, answers: 2, percent: 50 },
    ],
  );
});

test("recent sessions are globally ordered and historical unmapped answers stay in totals", () => {
  const tiedTime = "2026-08-20T12:00:00.000Z";
  const records = [
    record({
      bankId: "a",
      sourcePath: "Notes/A.md",
      exercises: [shortAnswer("a-current")],
      sessions: [
        session("session-a", "2026-08-20T11:00:00.000Z", [
          { exerciseId: "a-current", grading: "self-rated", rating: "good" },
          { exerciseId: "a-removed", grading: "objective", correct: false },
        ]),
        session("session-z", tiedTime, [
          { exerciseId: "a-current", grading: "self-rated", rating: "easy" },
        ]),
      ],
    }),
    record({
      bankId: "b",
      sourcePath: "Notes/B.md",
      exercises: [shortAnswer("b-current")],
      sessions: [session("session-y", tiedTime, [
        { exerciseId: "b-current", grading: "self-rated", rating: "again" },
      ])],
    }),
  ];

  const summary = aggregatePracticeDashboard(records, { kind: "all" });
  assert.equal(summary.answerCount, 4);
  assert.equal(summary.unmappedAnswerCount, 1);
  assert.equal(summary.performance.percent, 50);
  assert.deepEqual(
    summary.recentSessions.map((entry) => entry.session.id),
    ["session-z", "session-y", "session-a"],
  );
  assert.equal(summary.typeBreakdown[0]?.answerCount, 3);
  assert.equal(summary.typeBreakdown[0]?.performance.percent, 67);
  assert.equal(summary.banks.find((bank) => bank.bankId === "a")?.unmappedAnswerCount, 1);
});

test("duplicate bank IDs are excluded instead of inflating dashboard totals", () => {
  const duplicateSession = session("dup-session", "2026-08-20T10:00:00.000Z", [
    { exerciseId: "dup-exercise", grading: "self-rated", rating: "good" },
  ]);
  const records = [
    record({
      bankId: "duplicate",
      bankPath: "Practice/Copy A.md",
      sourcePath: "Notes/A/Copy.md",
      exercises: [shortAnswer("dup-exercise")],
      sessions: [duplicateSession],
    }),
    record({
      bankId: "duplicate",
      bankPath: "Practice/Copy B.md",
      sourcePath: "Notes/B/Copy.md",
      exercises: [shortAnswer("dup-exercise")],
      sessions: [duplicateSession],
    }),
    record({
      bankId: "unique",
      sourcePath: "Notes/C/Unique.md",
      exercises: [shortAnswer("unique-exercise")],
      sessions: [session("unique-session", "2026-08-20T11:00:00.000Z", [
        { exerciseId: "unique-exercise", grading: "self-rated", rating: "hard" },
      ])],
    }),
  ];

  const summary = aggregatePracticeDashboard(records, { kind: "all" });
  assert.equal(summary.bankCount, 1);
  assert.equal(summary.answerCount, 1);
  assert.equal(summary.performance.earnedPoints, 0.5);
  assert.equal(summary.duplicateBankIdCount, 1);
  assert.equal(summary.excludedDuplicateRecordCount, 2);
  assert.deepEqual(summary.excludedDuplicateRecords, [
    {
      bankId: "duplicate",
      bankPath: "Practice/Copy A.md",
      sourcePath: "Notes/A/Copy.md",
      sourceTitle: "Copy",
    },
    {
      bankId: "duplicate",
      bankPath: "Practice/Copy B.md",
      sourcePath: "Notes/B/Copy.md",
      sourceTitle: "Copy",
    },
  ]);
  assert.deepEqual(summary.banks.map((bank) => bank.bankId), ["unique"]);
  assert.equal(getDashboardScopeOptions(records).all.count, 1);

  const folderSummary = aggregatePracticeDashboard(records, {
    kind: "folder",
    path: "Notes/A",
  });
  assert.equal(folderSummary.bankCount, 0);
  assert.equal(folderSummary.duplicateBankIdCount, 1);
  assert.equal(folderSummary.excludedDuplicateRecordCount, 1);
  assert.deepEqual(folderSummary.excludedDuplicateRecords, [
    {
      bankId: "duplicate",
      bankPath: "Practice/Copy A.md",
      sourcePath: "Notes/A/Copy.md",
      sourceTitle: "Copy",
    },
    {
      bankId: "duplicate",
      bankPath: "Practice/Copy B.md",
      sourcePath: "Notes/B/Copy.md",
      sourceTitle: "Copy",
    },
  ]);
});

test("duplicate diagnostics stay scoped and deterministic across split collisions", () => {
  const records = [
    record({
      bankId: "shared-z",
      bankPath: "Practice/Z Copy.md",
      sourcePath: "Notes/Course B/Z.md",
      title: "Z source",
      tags: ["exam"],
    }),
    record({
      bankId: "shared-a",
      bankPath: "Practice/B Copy.md",
      sourcePath: "Notes/Course A/B.md",
      title: "B source",
      tags: ["exam/closed-book"],
    }),
    record({
      bankId: "shared-z",
      bankPath: "Practice/A Copy.md",
      sourcePath: "Notes/Course A/A.md",
      title: "A source",
      tags: ["exam/closed-book"],
    }),
    record({
      bankId: "shared-a",
      bankPath: "Practice/C Copy.md",
      sourcePath: "Notes/Course C/C.md",
      title: "C source",
      tags: ["other"],
    }),
    record({
      bankId: "unique",
      bankPath: "Practice/Unique.md",
      sourcePath: "Notes/Course A/Unique.md",
      tags: ["exam/closed-book"],
    }),
  ];

  const all = aggregatePracticeDashboard(records, { kind: "all" });
  assert.equal(all.duplicateBankIdCount, 2);
  assert.equal(all.excludedDuplicateRecordCount, 4);
  assert.deepEqual(
    all.excludedDuplicateRecords.map((entry) => [entry.bankId, entry.bankPath]),
    [
      ["shared-a", "Practice/B Copy.md"],
      ["shared-a", "Practice/C Copy.md"],
      ["shared-z", "Practice/A Copy.md"],
      ["shared-z", "Practice/Z Copy.md"],
    ],
  );

  const courseA = aggregatePracticeDashboard(records, {
    kind: "folder",
    path: "Notes/Course A",
  });
  assert.equal(courseA.bankCount, 1);
  assert.equal(courseA.duplicateBankIdCount, 2);
  assert.equal(courseA.excludedDuplicateRecordCount, 2);
  assert.deepEqual(courseA.excludedDuplicateRecords, [
    {
      bankId: "shared-a",
      bankPath: "Practice/B Copy.md",
      sourcePath: "Notes/Course A/B.md",
      sourceTitle: "B source",
    },
    {
      bankId: "shared-a",
      bankPath: "Practice/C Copy.md",
      sourcePath: "Notes/Course C/C.md",
      sourceTitle: "C source",
    },
    {
      bankId: "shared-z",
      bankPath: "Practice/A Copy.md",
      sourcePath: "Notes/Course A/A.md",
      sourceTitle: "A source",
    },
    {
      bankId: "shared-z",
      bankPath: "Practice/Z Copy.md",
      sourcePath: "Notes/Course B/Z.md",
      sourceTitle: "Z source",
    },
  ]);

  const courseAExam = aggregatePracticeDashboard(records, {
    primary: { kind: "folder", path: "Notes/Course A" },
    tagPrefix: "exam",
  });
  assert.deepEqual(courseAExam.excludedDuplicateRecords, courseA.excludedDuplicateRecords);

  const courseB = aggregatePracticeDashboard(records, {
    kind: "folder",
    path: "Notes/Course B",
  });
  assert.equal(courseB.duplicateBankIdCount, 1);
  assert.equal(courseB.excludedDuplicateRecordCount, 1);
  assert.deepEqual(courseB.excludedDuplicateRecords, [
    {
      bankId: "shared-z",
      bankPath: "Practice/A Copy.md",
      sourcePath: "Notes/Course A/A.md",
      sourceTitle: "A source",
    },
    {
      bankId: "shared-z",
      bankPath: "Practice/Z Copy.md",
      sourcePath: "Notes/Course B/Z.md",
      sourceTitle: "Z source",
    },
  ]);
});

test("an empty record set returns neutral, usable dashboard data", () => {
  const options = getDashboardScopeOptions([]);
  assert.deepEqual(options, {
    all: { scope: { kind: "all" }, label: "All practice", count: 0 },
    folders: [],
    tags: [],
    sources: [],
  });

  const summary = aggregatePracticeDashboard([], { kind: "all" });
  assert.equal(summary.bankCount, 0);
  assert.equal(summary.problemCount, 0);
  assert.equal(summary.sessionCount, 0);
  assert.equal(summary.answerCount, 0);
  assert.equal(summary.completionPercent, null);
  assert.equal(summary.performance.percent, null);
  assert.equal(summary.bestAnswerStreak, 0);
  assert.equal(summary.duplicateBankIdCount, 0);
  assert.equal(summary.excludedDuplicateRecordCount, 0);
  assert.deepEqual(summary.excludedDuplicateRecords, []);
  assert.deepEqual(summary.typeBreakdown, []);
  assert.deepEqual(summary.recentSessions, []);
  assert.deepEqual(summary.banks, []);
});

test("dashboard keeps pending AI reviews completed but outside provisional performance", () => {
  const exercise = shortAnswer("free-1");
  const pendingSession = session(
    "session-pending",
    "2026-08-21T12:01:00.000Z",
    [aiReviewResult("review-pending", "session-pending", {
      status: "pending",
      queuedAt: "2026-08-21T12:00:30.000Z",
      attempts: 0,
    })],
  );
  const reviewedSession = session(
    "session-reviewed",
    "2026-08-21T13:01:00.000Z",
    [aiReviewResult("review-reviewed", "session-reviewed", {
      status: "reviewed",
      reviewedAt: "2026-08-21T13:02:00.000Z",
      attempts: 1,
      verdict: "partial",
      feedback: "One required point is missing.",
      criteria: [{
        criterion: "Grounded answer.",
        outcome: "partial",
        feedback: "State the relation explicitly.",
        sourceSegmentIds: ["segment-1"],
      }],
    })],
  );
  const summary = aggregatePracticeDashboard([
    record({
      bankId: "ai-bank",
      sourcePath: "Notes/Term/Course/AI.md",
      exercises: [exercise],
      sessions: [pendingSession, reviewedSession],
    }),
  ], { kind: "all" });

  assert.equal(summary.answerCount, 2);
  assert.equal(summary.performance.totalPoints, 1);
  assert.equal(summary.performance.percent, 50);
  assert.equal(summary.reviewedAiResponseCount, 1);
  assert.equal(summary.pendingAiReviewCount, 1);
  assert.equal(summary.failedAiReviewCount, 0);
  assert.equal(summary.freeResponsePartial, 1);
  assert.equal(summary.provisional, true);
  assert.equal(summary.typeBreakdown[0]?.answerCount, 1);
  assert.equal(summary.banks[0]?.pendingAiReviewCount, 1);
});

function guidedLearningRecord(): DashboardBankRecord {
  const current = record({
    bankId: "guided-bank",
    sourcePath: "Notes/Guided source.md",
    exercises: [
      singleSelect("independent-1"),
      singleSelect("guided-1"),
    ],
  });
  current.bank.segments = [
    {
      id: "segment-1",
      kind: "paragraph",
      ordinal: 1,
      headingPath: ["Supported"],
      text: "Synthetic supported evidence.",
    },
    {
      id: "segment-2",
      kind: "paragraph",
      ordinal: 2,
      headingPath: ["Gap"],
      text: "Synthetic boundary evidence.",
    },
  ];
  current.bank.sourceMaterials = [{
    id: "source-primary",
    role: "primary",
    vaultPath: current.bank.source.vaultPath,
    wikilink: current.bank.source.wikilink,
    title: current.bank.source.title,
    sourceHash: current.bank.source.hash,
    scope: { kind: "note" },
    segmentIds: ["segment-1", "segment-2"],
    visualIds: [],
  }];
  current.bank.aspects = [
    {
      id: "aspect-supported",
      title: "Supported mechanism",
      purpose: "Practice the supported mechanism.",
      prerequisiteAspectIds: [],
      sourceSegmentIds: ["segment-1"],
      status: "supported",
    },
    {
      id: "aspect-gap",
      title: "Missing boundary condition",
      purpose: "Requires another source.",
      prerequisiteAspectIds: [],
      sourceSegmentIds: ["segment-2"],
      status: "source-gap",
    },
  ];
  current.bank.practiceSets = [{
    id: "set-foundations",
    title: "Foundations",
    purpose: "Establish the supported mechanism.",
    instructionalRole: "foundations",
    order: 0,
    assignments: [
      { exerciseId: "independent-1", aspectIds: ["aspect-supported"], role: "independent" },
      { exerciseId: "guided-1", aspectIds: ["aspect-supported"], role: "guided-check" },
    ],
  }];
  current.bank.tutorLessons = [{
    id: "lesson-foundations",
    title: "Build the mechanism",
    objective: "Explain the mechanism from source evidence.",
    aspectIds: ["aspect-supported"],
    prerequisiteAspectIds: [],
    guidedExerciseId: "guided-1",
    teachingBlocks: [{
      id: "block-why",
      kind: "why",
      title: "Why it matters",
      content: "The mechanism connects the premise to the consequence.",
      sourceSegmentIds: ["segment-1"],
    }],
    selfExplanationCheck: {
      prompt: "Explain the mechanism.",
      groundedAnswer: "The premise produces the consequence.",
      keyPoints: ["Premise", "Consequence"],
      sourceSegmentIds: ["segment-1"],
    },
    hints: [{
      id: "hint-1",
      level: 1,
      text: "Start from the premise.",
      sourceSegmentIds: ["segment-1"],
    }],
    repairExplanation: {
      text: "Reconnect the premise to the consequence.",
      sourceSegmentIds: ["segment-1"],
    },
  }];
  current.bank.learningPath = {
    id: "path-guided",
    title: "Mechanism learning path",
    startingLevel: "new-to-topic",
    aspectIds: ["aspect-supported"],
    steps: [
      { kind: "lesson", lessonId: "lesson-foundations", order: 0 },
      { kind: "practice-set", setId: "set-foundations", order: 1 },
    ],
  };
  const learningSession: SessionSummaryV3 = {
    schemaVersion: 3,
    id: "session-guided",
    startedAt: "2026-08-22T10:00:00.000Z",
    finishedAt: "2026-08-22T10:05:00.000Z",
    bankRevisionAtStart: 0,
    exerciseCount: 2,
    completedCount: 2,
    score: { correct: 0, total: 2 },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    results: [
      { exerciseId: "independent-1", grading: "objective", correct: false },
      { exerciseId: "guided-1", grading: "objective", correct: false },
    ],
    scope: {
      mode: "learning-path",
      learningPath: { id: "path-guided", title: "Mechanism learning path" },
      sets: [{ id: "set-foundations", title: "Foundations" }],
    },
    evidence: [
      {
        exerciseId: "independent-1",
        set: { id: "set-foundations", title: "Foundations" },
        aspects: [{ id: "aspect-supported", title: "Supported mechanism" }],
        instructionalRole: "independent",
        independent: true,
        hintsRevealed: 0,
        retries: 0,
        recoveryOutcome: "not-needed",
      },
      {
        exerciseId: "guided-1",
        set: { id: "set-foundations", title: "Foundations" },
        aspects: [{ id: "aspect-supported", title: "Supported mechanism" }],
        instructionalRole: "guided-check",
        independent: false,
        hintsRevealed: 2,
        retries: 1,
        recoveryOutcome: "recovered",
      },
    ],
    completedTutorLessons: [{
      lesson: { id: "lesson-foundations", title: "Build the mechanism" },
      aspects: [{ id: "aspect-supported", title: "Supported mechanism" }],
    }],
  };
  current.bank.sessions = [learningSession];
  return current;
}

test("dashboard reports transparent guided-path evidence, support, gaps, and recommendations", () => {
  const summary = aggregatePracticeDashboard([guidedLearningRecord()], { kind: "all" });
  const path = summary.banks[0]?.learningPath;
  assert.ok(path !== null && path !== undefined);
  assert.equal(path.independentAttempts, 1);
  assert.equal(path.independentPerformancePercent, 0);
  assert.equal(path.guidedAttempts, 1);
  assert.equal(path.assistedGuidedAttemptCount, 1);
  assert.equal(path.assistanceRatePercent, 100);
  assert.equal(path.recoveredCount, 1);
  assert.equal(path.unresolvedCount, 0);
  assert.equal(path.recoveryRatePercent, 100);
  assert.equal(path.lessonCompletionPercent, 100);
  assert.equal(path.sourceCoveragePercent, 50);
  assert.equal(path.unresolvedSourceGapCount, 1);
  assert.deepEqual(path.unresolvedSourceGapTitles, ["Missing boundary condition"]);
  assert.equal(path.aspects.length, 1, "source gaps are reported separately from evidence");
  assert.equal(path.aspects[0]?.state, "Developing");
  assert.equal(path.sets[0]?.weightedPercent, 0);
  assert.equal(path.recommendation?.canIgnore, true);
  assert.ok(path.recommendation?.reasonCodes.includes("repair"));

  assert.equal(summary.learning.pathBankCount, 1);
  assert.equal(summary.learning.developingAspectCount, 1);
  assert.equal(summary.learning.consistentAspectCount, 0);
  assert.equal(summary.learning.sourceCoveragePercent, 50);
  assert.equal(summary.learning.assistanceRatePercent, 100);
  assert.equal(summary.learning.recoveryRatePercent, 100);
});

test("migrated General practice banks keep rendering without guided-path analytics", () => {
  const summary = aggregatePracticeDashboard([
    record({ bankId: "legacy-general", sourcePath: "Notes/Legacy.md" }),
  ], { kind: "all" });
  assert.equal(summary.bankCount, 1);
  assert.equal(summary.banks[0]?.problemCount, 1);
  assert.equal(summary.banks[0]?.learningPath, null);
  assert.deepEqual(summary.learning, {
    pathBankCount: 0,
    supportedAspectCount: 0,
    unresolvedSourceGapCount: 0,
    unpracticedAspectCount: 0,
    developingAspectCount: 0,
    consistentAspectCount: 0,
    independentAttempts: 0,
    independentEarnedPoints: 0,
    independentPerformancePercent: null,
    lessonCount: 0,
    completedLessonCount: 0,
    lessonCompletionPercent: null,
    sourceSegmentCount: 0,
    coveredSourceSegmentCount: 0,
    sourceCoveragePercent: null,
    guidedAttempts: 0,
    assistedGuidedAttemptCount: 0,
    assistanceRatePercent: null,
    hintsRevealed: 0,
    retries: 0,
    recoveredCount: 0,
    unresolvedCount: 0,
    recoveryRatePercent: null,
  });
});
