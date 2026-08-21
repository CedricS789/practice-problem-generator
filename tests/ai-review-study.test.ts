import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ANSWER_REVIEW_PAYLOAD_DISCLOSURE } from "../src/answer-review";
import type { ExerciseV1, SourceSegmentV1 } from "../src/model";
import { calculatePracticeRun } from "../src/practice-run";
import type {
  AnswerReviewRequest,
  AnswerReviewStatus,
} from "../src/ui/contracts";
import { presentExercises } from "../src/ui/presenters";
import {
  applyAnswerReviewStatus,
  createPendingAnswerReviewRecord,
  lockAnswerReviewRequest,
} from "../src/ui/session-outcomes";

const [viewSource, bankStatisticsSource, contractsSource] = await Promise.all([
  readFile(
    new URL("../src/ui/practice-lab-view.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/bank-statistics-view.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/ui/contracts.ts", import.meta.url),
    "utf8",
  ),
]);

function request(): AnswerReviewRequest {
  return {
    requestId: "review-1",
    sessionId: "session-1",
    exerciseId: "exercise-1",
    exerciseTitle: "Explain the relation",
    exerciseType: "causal-explanation",
    prompt: "Why does alpha cause beta?",
    submittedAnswer: "Alpha changes the governing field.",
    groundedAnswer: "Alpha changes the field, which causes beta.",
    keyPoints: ["governing field", "causal link"],
    sourceSegmentIds: ["segment-cited"],
    sourceSegments: [
      {
        id: "segment-cited",
        headingPath: ["Mechanism"],
        text: "Alpha changes the field and therefore causes beta.",
      },
      {
        id: "segment-unrelated",
        headingPath: ["Unrelated"],
        text: "This must not enter the review request.",
      },
    ],
    provider: "claude",
    reasoningEffort: "high",
    requestedAt: "2026-08-21T10:00:00.000Z",
  };
}

function sourceBetween(start: string, end: string): string {
  const startIndex = viewSource.indexOf(start);
  const endIndex = viewSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return viewSource.slice(startIndex, endIndex);
}

test("locked review context preserves the chosen provider and only cited segments", () => {
  const locked = lockAnswerReviewRequest(request());

  assert.equal(locked.provider, "claude");
  assert.equal(locked.reasoningEffort, "high");
  assert.deepEqual(
    locked.sourceSegments.map((segment) => segment.id),
    ["segment-cited"],
  );
  assert.ok(Object.isFrozen(locked));
  assert.ok(Object.isFrozen(locked.keyPoints));
  assert.ok(Object.isFrozen(locked.sourceSegments));
  assert.ok(Object.isFrozen(locked.sourceSegments[0]?.headingPath));
});

test("pending and failed reviews remain unscored while reviewed verdicts earn points", () => {
  const pending = createPendingAnswerReviewRecord(
    lockAnswerReviewRequest(request()),
  );
  assert.deepEqual(calculatePracticeRun([pending]), {
    earnedPoints: 0,
    totalPoints: 0,
    percent: null,
    currentStreak: 0,
    bestStreak: 0,
    correct: 0,
    partial: 0,
    incorrect: 0,
    rank: {
      id: "unranked",
      mark: "—",
      label: "Unranked",
      description: "Complete an answer to start this practice run.",
    },
  });

  const reviewed: AnswerReviewStatus = {
    requestId: "review-1",
    sessionId: "session-1",
    exerciseId: "exercise-1",
    state: "reviewed",
    reviewedAt: "2026-08-21T10:00:05.000Z",
    attempts: 1,
    verdict: "partial",
    feedback: "The causal link is incomplete.",
    criterionResults: [],
  };
  const applied = applyAnswerReviewStatus([pending], reviewed);
  assert.equal(applied.updated, true);
  assert.equal(applied.answers[0]?.rating, undefined);
  assert.equal(applied.answers[0]?.aiReview?.status.state, "reviewed");
  assert.equal(calculatePracticeRun(applied.answers).earnedPoints, 0.5);
  assert.equal(calculatePracticeRun(applied.answers).totalPoints, 1);

  const failed: AnswerReviewStatus = {
    requestId: "review-1",
    sessionId: "session-1",
    exerciseId: "exercise-1",
    state: "failed",
    failedAt: "2026-08-21T10:00:06.000Z",
    attempts: 1,
    failureCode: "timeout",
    failure: "The provider timed out.",
    retryable: true,
  };
  const failedApplied = applyAnswerReviewStatus([pending], failed);
  assert.equal(calculatePracticeRun(failedApplied.answers).totalPoints, 0);
});

test("presenters attach key points and only referenced source snapshots", () => {
  const segments: SourceSegmentV1[] = [
    {
      id: "segment-cited",
      kind: "paragraph",
      ordinal: 0,
      headingPath: ["Mechanism"],
      text: "Alpha changes the field and causes beta.",
    },
    {
      id: "segment-unrelated",
      kind: "paragraph",
      ordinal: 1,
      headingPath: ["Appendix"],
      text: "Unrelated content.",
    },
  ];
  const exercise: ExerciseV1 = {
    id: "exercise-1",
    type: "causal-explanation",
    title: "Explain the relation",
    prompt: "Why does alpha cause beta?",
    difficulty: "medium",
    sourceSegmentIds: ["segment-cited"],
    groundedAnswer: "Alpha changes the field, which causes beta.",
    keyPoints: ["governing field", "causal link"],
  };

  const presentation = presentExercises(
    [exercise],
    () => undefined,
    segments,
  )[0];
  assert.deepEqual(presentation?.answerReviewContext, {
    keyPoints: ["governing field", "causal link"],
    sourceSegments: [{
      id: "segment-cited",
      headingPath: ["Mechanism"],
      text: "Alpha changes the field and causes beta.",
    }],
  });
});

test("AI submission registers synchronously and then advances without waiting", () => {
  const method = sourceBetween(
    "private queueAnswerReviewAndContinue(",
    "private selectedAnswerReviewProvider(",
  );
  const recordIndex = method.indexOf(
    "this.recordAndContinue(createPendingAnswerReviewRecord(request))",
  );
  const enqueueIndex = method.indexOf(
    "this.options.callbacks.enqueueAnswerReview?.(request)",
  );
  assert.ok(recordIndex >= 0);
  assert.ok(enqueueIndex >= 0);
  assert.ok(recordIndex > enqueueIndex);
  assert.doesNotMatch(method, /await/u);
  assert.match(viewSource, /studySessionId = `session-\$\{crypto\.randomUUID\(\)\}`/u);
  assert.match(viewSource, /requestId: `review-\$\{crypto\.randomUUID\(\)\}`/u);
});

test("late status publication is targeted and cannot rebuild the active textarea", () => {
  const method = sourceBetween(
    "public publishAnswerReviewStatus(",
    "public setConfigurationDefaults(",
  );
  assert.match(method, /updateAnswerReviewStatusDom\(\)/u);
  assert.match(method, /updatePracticeRunDom\(\)/u);
  assert.match(method, /updateStudyCompletionDom\(\)/u);
  assert.doesNotMatch(method, /this\.render\(/u);
  assert.match(viewSource, /cls: "practice-lab-free-response"/u);
});

test("completion feedback updates in place and exposes every AI review state", () => {
  const completionUpdate = sourceBetween(
    "private updateStudyCompletionDom(",
    "private renderStudyCompletionAiFeedback(",
  );
  const feedback = sourceBetween(
    "private renderStudyCompletionAiFeedback(",
    "private async requestSource(",
  );

  assert.match(completionUpdate, /renderStudyCompletionAiFeedback\(\)/u);
  assert.doesNotMatch(completionUpdate, /this\.render\(/u);
  assert.match(feedback, /"AI review feedback"/u);
  assert.match(feedback, /review\.status\.feedback/u);
  assert.match(feedback, /renderAnswerReviewCriteria/u);
  assert.match(feedback, /"The review is continuing in the background\."/u);
  assert.match(feedback, /review\.status\.failure/u);
  assert.match(feedback, /practice-lab-ai-review-history-item/u);
});

test("failed reviews retry the immutable original request without provider fallback", () => {
  const management = sourceBetween(
    "private renderAnswerReviewManagement(",
    "private answerReviewProviderLabel(",
  );
  const retry = sourceBetween(
    "private retryAnswerReview(",
    "private renderStudyOcclusionVisual(",
  );

  assert.match(contractsSource, /retryAnswerReview\?: \([\s\S]*request: AnswerReviewRequest,[\s\S]*\) => Promise<void> \| void/u);
  assert.match(management, /`Retry with \$\{providerLabel\}`/u);
  assert.match(management, /original locked request/u);
  assert.match(retry, /retry\(review\.request\)/u);
  assert.match(retry, /state: "pending"/u);
  assert.doesNotMatch(retry, /answerReviewProvider/u);
  assert.doesNotMatch(retry, /answerReviewReasoningEffort/u);
});

test("pending reviews can pause by exact request ID while remaining pending", () => {
  const pause = sourceBetween(
    "private pauseAnswerReview(",
    "private retryAnswerReview(",
  );

  assert.match(contractsSource, /pauseAnswerReview\?: \(requestId: string\) => void/u);
  assert.match(pause, /pause\(review\.request\.requestId\)/u);
  assert.match(pause, /pausedAnswerReviewIds\.add/u);
  assert.doesNotMatch(pause, /state: "failed"/u);
  assert.match(viewSource, /remains pending and can resume/u);
});

test("review disclosure covers provider transmission and durable Practice Markdown", () => {
  assert.match(viewSource, /ANSWER_REVIEW_PAYLOAD_DISCLOSURE/u);
  assert.match(ANSWER_REVIEW_PAYLOAD_DISCLOSURE, /review request ID; exercise title, type, and prompt/u);
  assert.match(ANSWER_REVIEW_PAYLOAD_DISCLOSURE, /key-point rubric with generated criterion IDs/u);
  assert.match(ANSWER_REVIEW_PAYLOAD_DISCLOSURE, /cited source segment IDs, heading labels, and text/u);
  assert.match(viewSource, /stored in the Practice Markdown/u);
  assert.match(viewSource, /resume after a restart and remain visible in history/u);
});

test("send is gated by the same strict provider-payload validator", () => {
  const problem = sourceBetween(
    "private answerReviewActionProblem(",
    "private renderLiveAnswerReviewActions(",
  );
  assert.match(problem, /createAnswerReviewInput/u);
  assert.match(problem, /validateAnswerReviewInput/u);
  assert.match(problem, /safe AI-review payload limits/u);
});

test("criterion feedback maps evidence IDs to locked headings and excerpts", () => {
  assert.match(viewSource, /"Criterion-level feedback"/u);
  assert.match(viewSource, /"Evidence segments:"/u);
  assert.match(viewSource, /result\.sourceSegmentIds/u);
  assert.match(viewSource, /segment\.headingPath\.join/u);
  assert.match(viewSource, /segment\.text\.slice/u);
  assert.match(bankStatisticsSource, /renderCriterionFeedback/u);
  assert.match(bankStatisticsSource, /review\.state\.criteria/u);
  assert.match(bankStatisticsSource, /result\.sourceSegmentIds/u);
  assert.match(bankStatisticsSource, /review\.request\.context\.sourceSegments/u);
  assert.match(bankStatisticsSource, /segment\.headingPath\.join/u);
});

test("persisted history exposes stable retry identity and exact-ID pause hooks", () => {
  assert.match(bankStatisticsSource, /retryAnswerReview\?:/u);
  assert.match(bankStatisticsSource, /pauseAnswerReview\?: \(requestId: string\)/u);
  assert.match(bankStatisticsSource, /bankId: bank\.bankId/u);
  assert.match(bankStatisticsSource, /sessionId: session\.id/u);
  assert.match(bankStatisticsSource, /requestId: review\.request\.requestId/u);
  assert.match(bankStatisticsSource, /requestHash: review\.request\.requestHash/u);
  assert.match(bankStatisticsSource, /Pause review/u);
  assert.match(bankStatisticsSource, /Retry with \$\{originalProvider\}/u);
});

test("review controls expose explicit choices without provider fallback", () => {
  assert.match(viewSource, /"Self-assess"/u);
  assert.match(viewSource, /"AI review \(background\)"/u);
  assert.match(viewSource, /"Answer-review provider"/u);
  assert.match(viewSource, /"Answer-review reasoning effort"/u);
  assert.match(viewSource, /"Assess myself instead"/u);
  assert.match(viewSource, /Send to \$\{provider\?\.label/u);
  assert.match(viewSource, /Practice Problem Generator will not switch providers automatically/u);
  assert.match(viewSource, /enqueueAnswerReview === undefined/u);
  assert.match(viewSource, /AI answer review is unavailable on this device/u);
  assert.match(viewSource, /Provisional result:/u);
  assert.match(viewSource, /Write an answer first/u);
  assert.match(viewSource, /This answer has no grounded review criteria/u);
});
