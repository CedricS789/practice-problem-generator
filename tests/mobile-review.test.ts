import assert from "node:assert/strict";
import test from "node:test";

import type { App, TFile } from "obsidian";
import {
  PracticeBankRepository,
  createSessionSummary,
} from "../src/bank-repository";
import type {
  AiReviewStateV2,
  PracticeBankV2,
  SessionSummaryV2,
} from "../src/model";
import {
  parsePracticeBankMarkdown,
  serializePracticeBank,
} from "../src/persistence";
import { createSourceHash, segmentSource } from "../src/segmenter";
import { calculatePracticeBankStatistics } from "../src/session-statistics";
import { createAiReviewRequest } from "../src/schema";
import type { FinishedStudySession } from "../src/ui/contracts";
import { presentExercises } from "../src/ui/presenters";

interface FakeFile extends TFile {
  content: string;
}

class FakeVault {
  readonly files = new Map<string, FakeFile>();
  processCalls = 0;

  getAbstractFileByPath(path: string): FakeFile | null {
    return this.files.get(path.replace(/\\/gu, "/")) ?? null;
  }

  async process(
    file: FakeFile,
    processor: (markdown: string) => string,
  ): Promise<void> {
    this.processCalls += 1;
    file.content = processor(file.content);
  }
}

function createMobileBank(): PracticeBankV2 {
  const sourceText = "# Synthetic source\nAlpha causes beta.";
  const segments = segmentSource(sourceText);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: 2,
    bankId: "bank-mobile-synthetic",
    revision: 0,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    source: {
      vaultPath: "Notes/Term/Course/Synthetic source.md",
      wikilink: "[[Notes/Term/Course/Synthetic source]]",
      title: "Synthetic source",
      scope: "note",
      hash: createSourceHash(sourceText),
    },
    segments,
    visuals: [],
    exercises: [
      {
        id: "exercise-mobile-1",
        type: "single-select",
        title: "Synthetic effect",
        prompt: "What does alpha cause?",
        difficulty: "easy",
        sourceSegmentIds: [paragraph.id],
        choices: [
          { id: "choice-beta", text: "Beta" },
          { id: "choice-gamma", text: "Gamma" },
        ],
        correctChoiceIds: ["choice-beta"],
        groundedAnswer: "Alpha causes beta.",
      },
    ],
    sessions: [],
    generation: {
      provider: "codex",
      generatedAt: "2026-08-20T10:00:00.000Z",
      promptVersion: "v1",
    },
  };
}

test("mobile review renders a saved bank and batches one finished-session write", async () => {
  const bank = createMobileBank();
  const bankPath = "Notes/Term/Course/Practice/Synthetic source - Practice.md";
  const markdown = serializePracticeBank(bank);
  const parsed = parsePracticeBankMarkdown(markdown);
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;

  const rendered = presentExercises(parsed.bank.exercises);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0]?.prompt, "What does alpha cause?");
  assert.deepEqual(rendered[0]?.grading, {
    kind: "single-select",
    correctChoiceId: "choice-beta",
  });

  const finished: FinishedStudySession = {
    id: "session-mobile-synthetic",
    startedAt: "2026-08-20T10:05:00.000Z",
    finishedAt: "2026-08-20T10:06:00.000Z",
    answers: [{ exerciseId: "exercise-mobile-1", correct: true }],
  };
  const summary = createSessionSummary(parsed.bank, finished);

  const vault = new FakeVault();
  const file = {
    path: bankPath,
    name: "Synthetic source - Practice.md",
    basename: "Synthetic source - Practice",
    extension: "md",
    content: markdown,
  } as FakeFile;
  vault.files.set(bankPath, file);
  const repository = new PracticeBankRepository({ vault } as unknown as App);
  const saved = await repository.appendFinishedSession(bankPath, summary, 0);

  assert.equal(vault.processCalls, 1, "session history is written in one Vault.process batch");
  assert.equal(saved.revision, 1);
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0]?.results[0]?.exerciseId, "exercise-mobile-1");
  const statistics = calculatePracticeBankStatistics(saved);
  assert.equal(statistics.sessionCount, 1);
  assert.equal(statistics.performance.percent, 100);
  assert.equal(statistics.latestScorePercent, 100);
  assert.equal(statistics.typeBreakdown[0]?.type, "single-select");
  const persisted = parsePracticeBankMarkdown(file.content);
  assert.equal(persisted.status, "ok");
  if (persisted.status === "ok") {
    assert.equal(persisted.bank.sessions.length, 1);
    assert.equal(persisted.bank.sessions[0]?.score.correct, 1);
  }
});

test("mobile parsing and statistics preserve pending, reviewed, and failed AI reviews", () => {
  const base = createMobileBank();
  const paragraph = base.segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  const freeExercise = {
    id: "exercise-mobile-free",
    type: "short-answer" as const,
    title: "Explain the causal link",
    prompt: "Explain what alpha causes.",
    difficulty: "medium" as const,
    sourceSegmentIds: [paragraph.id],
    groundedAnswer: "Alpha causes beta.",
    acceptableAnswers: ["Alpha causes beta."],
    keyPoints: ["Identify beta as the effect."],
  };
  const states: readonly AiReviewStateV2[] = [
    {
      status: "pending",
      queuedAt: "2026-08-20T11:00:30.000Z",
      attempts: 0,
    },
    {
      status: "reviewed",
      reviewedAt: "2026-08-20T12:01:00.000Z",
      attempts: 1,
      verdict: "correct",
      feedback: "The effect is identified correctly.",
      criteria: [{
        criterion: "Identify beta as the effect.",
        outcome: "met",
        feedback: "Beta is named as the effect.",
        sourceSegmentIds: [paragraph.id],
      }],
    },
    {
      status: "failed",
      failedAt: "2026-08-20T13:01:00.000Z",
      attempts: 2,
      error: {
        code: "timeout",
        message: "The local provider timed out.",
        retryable: true,
      },
    },
  ];
  const sessions: SessionSummaryV2[] = states.map((state, index) => {
    const sessionId = `session-mobile-ai-${index + 1}`;
    const request = createAiReviewRequest({
      requestId: `request-mobile-ai-${index + 1}`,
      sessionId,
      exerciseId: freeExercise.id,
      provider: "codex",
      reasoningEffort: "high",
      promptVersion: "answer-review-v1",
      requestedAt: `2026-08-20T1${index + 1}:00:30.000Z`,
      submittedAnswer: "Alpha causes beta.",
      context: {
        exerciseTitle: freeExercise.title,
        exerciseType: freeExercise.type,
        prompt: freeExercise.prompt,
        groundedAnswer: freeExercise.groundedAnswer,
        keyPoints: [...freeExercise.keyPoints],
        sourceSegments: [{
          id: paragraph.id,
          headingPath: [...paragraph.headingPath],
          text: paragraph.text,
        }],
      },
    });
    return {
      schemaVersion: 2,
      id: sessionId,
      startedAt: `2026-08-20T1${index + 1}:00:00.000Z`,
      finishedAt: `2026-08-20T1${index + 1}:02:00.000Z`,
      bankRevisionAtStart: index,
      exerciseCount: 2,
      completedCount: 1,
      score: { correct: 0, total: 0 },
      ratings: { again: 0, hard: 0, good: 0, easy: 0 },
      results: [{
        exerciseId: freeExercise.id,
        grading: "ai-review",
        request,
        state,
      }],
    };
  });
  const bank: PracticeBankV2 = {
    ...base,
    revision: 3,
    exercises: [...base.exercises, freeExercise],
    sessions,
  };

  const parsed = parsePracticeBankMarkdown(serializePracticeBank(bank));
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  const rendered = presentExercises(parsed.bank.exercises, undefined, parsed.bank.segments);
  assert.equal(rendered.find((exercise) => exercise.id === freeExercise.id)?.grading.kind, "self");
  const persistedStates = parsed.bank.sessions.map((session) => {
    const result = session.results[0];
    return result?.grading === "ai-review" ? result.state.status : "missing";
  });
  assert.deepEqual(persistedStates, ["pending", "reviewed", "failed"]);
  const statistics = calculatePracticeBankStatistics(parsed.bank);
  assert.equal(statistics.pendingAiReviewCount, 1);
  assert.equal(statistics.reviewedAiResponseCount, 1);
  assert.equal(statistics.failedAiReviewCount, 1);
  assert.equal(statistics.performance.percent, 100);
  assert.equal(statistics.provisional, true);
});
