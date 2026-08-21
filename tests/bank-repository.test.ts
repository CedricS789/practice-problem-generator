import assert from "node:assert/strict";
import test from "node:test";

import type { App, TFile } from "obsidian";

import {
  PracticeBankRepository,
  createSessionSummary,
} from "../src/bank-repository";
import {
  PRACTICE_BANK_SCHEMA_VERSION,
  type PracticeBankV2,
} from "../src/model";
import {
  parsePracticeBankMarkdown,
  serializePracticeBank,
} from "../src/persistence";
import { createSourceHash, segmentSource } from "../src/segmenter";
import {
  parseGenerationRecipeMarkdown,
  type GenerationRecipeV2,
} from "../src/regeneration";
import type {
  AnswerReviewStatus,
  FinishedStudySession,
} from "../src/ui/contracts";
import {
  appendGenerationHistory,
  emptyGenerationHistory,
  parseGenerationHistoryMarkdown,
} from "../src/generation-history";
import {
  createPdfSourceImport,
  parseSourceImportMarkdown,
  recordPdfSourceRevision,
} from "../src/source-import";

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

function createBank(): PracticeBankV2 {
  const source = "# Evidence\nAlpha causes beta.";
  const segments = segmentSource(source);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-repository-ai",
    revision: 0,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    source: {
      vaultPath: "Notes/Term/Course/Evidence.md",
      wikilink: "[[Notes/Term/Course/Evidence]]",
      title: "Evidence",
      scope: "note",
      hash: createSourceHash(source),
    },
    segments,
    visuals: [],
    exercises: [{
      id: "exercise-ai",
      type: "short-answer",
      title: "Causal result",
      prompt: "What does alpha cause?",
      difficulty: "medium",
      sourceSegmentIds: [paragraph.id],
      groundedAnswer: "Alpha causes beta.",
      acceptableAnswers: ["beta"],
      keyPoints: ["alpha", "beta"],
    }],
    sessions: [],
  };
}

function aiReviewFinishedSession(
  bank: PracticeBankV2,
  state: "pending" | "reviewed" | "failed",
): FinishedStudySession {
  const exercise = bank.exercises[0];
  const paragraph = bank.segments.find((segment) => segment.kind === "paragraph");
  assert.ok(exercise?.type === "short-answer");
  assert.ok(paragraph);
  const status: AnswerReviewStatus = state === "reviewed"
    ? {
        requestId: "request-stable-ai",
        sessionId: "session-stable-ai",
        exerciseId: exercise.id,
        state: "reviewed",
        reviewedAt: "2026-08-20T10:05:50.000Z",
        attempts: 1,
        verdict: "correct",
        feedback: "Correct before the session finished.",
        criterionResults: [{
          criterion: "criterion-001",
          outcome: "met",
          feedback: "The causal result is stated.",
          sourceSegmentIds: [paragraph.id],
        }],
      }
    : state === "failed"
      ? {
          requestId: "request-stable-ai",
          sessionId: "session-stable-ai",
          exerciseId: exercise.id,
          state: "failed",
          failedAt: "2026-08-20T10:05:50.000Z",
          attempts: 1,
          failureCode: "timeout",
          failure: "The provider timed out.",
          retryable: true,
        }
      : {
          requestId: "request-stable-ai",
          sessionId: "session-stable-ai",
          exerciseId: exercise.id,
          state: "pending",
          queuedAt: "2026-08-20T10:05:30.000Z",
          attempts: 0,
        };
  return {
    id: "session-stable-ai",
    startedAt: "2026-08-20T10:05:00.000Z",
    finishedAt: "2026-08-20T10:06:00.000Z",
    answers: [{
      exerciseId: exercise.id,
      submittedAnswer: "Alpha causes beta.",
      aiReview: {
        request: {
          requestId: "request-stable-ai",
          sessionId: "session-stable-ai",
          exerciseId: exercise.id,
          exerciseTitle: exercise.title,
          exerciseType: exercise.type,
          prompt: exercise.prompt,
          submittedAnswer: "Alpha causes beta.",
          groundedAnswer: exercise.groundedAnswer,
          keyPoints: [...exercise.keyPoints],
          sourceSegmentIds: [paragraph.id],
          sourceSegments: [{
            id: paragraph.id,
            headingPath: [...paragraph.headingPath],
            text: paragraph.text,
          }],
          provider: "codex",
          reasoningEffort: "high",
          requestedAt: "2026-08-20T10:05:30.000Z",
        },
        status,
      },
    }],
  };
}

test("session construction preserves pending, reviewed, and failed AI states exactly", () => {
  const bank = createBank();
  for (const state of ["pending", "reviewed", "failed"] as const) {
    const finished = aiReviewFinishedSession(bank, state);
    const summary = createSessionSummary(bank, finished);
    assert.equal(summary.id, "session-stable-ai");
    assert.equal(summary.completedCount, 1);
    assert.deepEqual(summary.score, { correct: 0, total: 0 });
    assert.deepEqual(summary.ratings, { again: 0, hard: 0, good: 0, easy: 0 });
    const result = summary.results[0];
    assert.equal(result?.grading, "ai-review");
    if (result?.grading !== "ai-review") continue;
    assert.equal(result.state.status, state);
    assert.equal(result.request.sessionId, summary.id);
    assert.equal(result.request.requestId, "request-stable-ai");
    assert.match(result.request.requestHash, /^sha256:[0-9a-f]{64}$/u);
    if (state === "reviewed" && result.state.status === "reviewed") {
      assert.deepEqual(result.state.criteria, [{
        criterion: "criterion-001",
        outcome: "met",
        feedback: "The causal result is stated.",
        sourceSegmentIds: [result.request.context.sourceSegments[0]?.id],
      }]);
    }
    if (state === "failed" && result.state.status === "failed") {
      assert.deepEqual(result.state.error, {
        code: "timeout",
        message: "The provider timed out.",
        retryable: true,
      });
    }
  }
});

test("repository appends a terminal-before-finish AI review in one Vault.process batch", async () => {
  const bank = createBank();
  const summary = createSessionSummary(bank, aiReviewFinishedSession(bank, "reviewed"));
  const bankPath = "Notes/Term/Course/Practice/Evidence - Practice.md";
  const recipe: GenerationRecipeV2 = {
    schemaVersion: 2,
    sourceHash: bank.source.hash,
    provider: "codex",
    model: "gpt-5.6",
    reasoningEffort: "high",
    quantity: 1,
    difficulty: "deep-exam",
    focusInstructions: "Keep the causal chain explicit.",
    exerciseTypePercentages: {
      "short-answer": 100,
      "causal-explanation": 0,
      application: 0,
      calculation: 0,
      cloze: 0,
      "single-select": 0,
      "multi-select": 0,
      matching: 0,
      ordering: 0,
      "image-occlusion": 0,
    },
  };
  const history = appendGenerationHistory(emptyGenerationHistory(), {
    id: "generation-repository-test",
    generatedAt: "2026-08-20T10:00:00.000Z",
    provider: "codex",
    providerVersion: "codex-cli 0.146.0",
    model: "gpt-5.6",
    reasoningEffort: "high",
    promptVersion: "practice-lab-v3.1",
    sourceHash: bank.source.hash,
    sourceScope: "note",
    requestedQuantity: 1,
    draftExerciseCount: 1,
    savedExerciseCount: 1,
    difficulty: "deep-exam",
    focusInstructions: "Keep the causal chain explicit.",
    exerciseTypePercentages: recipe.exerciseTypePercentages,
    selectedVisualCount: 0,
    attempts: 1,
  }, 0);
  const file = {
    path: bankPath,
    name: "Evidence - Practice.md",
    basename: "Evidence - Practice",
    extension: "md",
    content: serializePracticeBank(bank, recipe, history),
  } as FakeFile;
  const vault = new FakeVault();
  vault.files.set(bankPath, file);
  const repository = new PracticeBankRepository({ vault } as unknown as App);

  const saved = await repository.appendFinishedSession(bankPath, summary, 0);

  assert.equal(vault.processCalls, 1);
  assert.equal(saved.revision, 1);
  const result = saved.sessions[0]?.results[0];
  assert.equal(result?.grading, "ai-review");
  if (result?.grading !== "ai-review") return;
  assert.equal(result.state.status, "reviewed");
  if (result.state.status === "reviewed") {
    assert.equal(result.state.verdict, "correct");
    assert.equal(result.state.criteria.length, 1);
  }
  const persisted = parsePracticeBankMarkdown(file.content);
  assert.equal(persisted.status, "ok");
  assert.deepEqual(parseGenerationRecipeMarkdown(file.content), {
    status: "ok",
    recipe,
    storedSchemaVersion: 2,
  });
  assert.deepEqual(parseGenerationHistoryMarkdown(file.content), {
    status: "ok",
    history,
  });
});

test("repository removes one history entry atomically and rejects stale identity", async () => {
  const bank = createBank();
  bank.sessions = [{
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    id: "session-remove-me",
    startedAt: "2026-08-20T10:05:00.000Z",
    finishedAt: "2026-08-20T10:06:00.000Z",
    bankRevisionAtStart: bank.revision,
    exerciseCount: 1,
    completedCount: 1,
    score: { correct: 1, total: 1 },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    results: [{ exerciseId: "exercise-ai", grading: "objective", correct: true }],
  }];
  const bankPath = "Notes/Term/Course/Practice/Evidence - Practice.md";
  const file = {
    path: bankPath,
    name: "Evidence - Practice.md",
    basename: "Evidence - Practice",
    extension: "md",
    content: serializePracticeBank(bank),
  } as FakeFile;
  const vault = new FakeVault();
  vault.files.set(bankPath, file);
  const repository = new PracticeBankRepository({ vault } as unknown as App);

  await assert.rejects(
    repository.removeSession(bankPath, "wrong-bank", "session-remove-me"),
    /changed identity/u,
  );
  const result = await repository.removeSession(
    bankPath,
    bank.bankId,
    "session-remove-me",
  );
  assert.equal(result.removedSessions, 1);
  assert.equal(result.bank.sessions.length, 0);
  assert.equal(result.bank.exercises.length, 1);
  assert.equal(result.bank.revision, bank.revision + 1);
  assert.equal(vault.processCalls, 2);
  const parsed = parsePracticeBankMarkdown(file.content);
  assert.equal(parsed.status, "ok");
  if (parsed.status === "ok") assert.equal(parsed.bank.sessions.length, 0);
});

test("a finished PDF practice session preserves exact page-range provenance", async () => {
  const original = createBank();
  const bank: PracticeBankV2 = {
    ...original,
    source: {
      ...original.source,
      vaultPath: "Library/Evidence.pdf",
      wikilink: "[[Library/Evidence.pdf]]",
      scope: "selection",
    },
  };
  const sourceImport = recordPdfSourceRevision(createPdfSourceImport({
    sourceHash: bank.source.hash,
    pdfContentHash: `sha256:${"d".repeat(64)}`,
    firstPage: 4,
    lastPage: 9,
    pageCount: 80,
    extractedAt: "2026-08-21T02:00:00.000Z",
  }), undefined, 0, "generation-pdf");
  const finished: FinishedStudySession = {
    id: "session-pdf",
    startedAt: "2026-08-21T02:05:00.000Z",
    finishedAt: "2026-08-21T02:06:00.000Z",
    answers: [{ exerciseId: "exercise-ai", rating: "good" }],
  };
  const summary = createSessionSummary(bank, finished);
  const bankPath = "Notes/Practice Sources/Practice/Evidence - abc - Practice.md";
  const file = {
    path: bankPath,
    name: "Evidence - Practice.md",
    basename: "Evidence - Practice",
    extension: "md",
    content: serializePracticeBank(bank, undefined, undefined, sourceImport),
  } as FakeFile;
  const vault = new FakeVault();
  vault.files.set(bankPath, file);
  const repository = new PracticeBankRepository({ vault } as unknown as App);

  await repository.appendFinishedSession(bankPath, summary, 0);

  assert.deepEqual(parseSourceImportMarkdown(file.content), {
    status: "ok",
    sourceImport,
  });
  const parsed = parsePracticeBankMarkdown(file.content);
  assert.equal(parsed.status, "ok");
  if (parsed.status === "ok") assert.equal(parsed.bank.sessions.length, 1);
});

test("repository applies a late AI review in one Vault.process update", async () => {
  const bank = createBank();
  const summary = createSessionSummary(bank, aiReviewFinishedSession(bank, "pending"));
  const stored: PracticeBankV2 = {
    ...bank,
    revision: 1,
    updatedAt: summary.finishedAt,
    sessions: [summary],
  };
  const bankPath = "Notes/Term/Course/Practice/Evidence - Practice.md";
  const file = {
    path: bankPath,
    name: "Evidence - Practice.md",
    basename: "Evidence - Practice",
    extension: "md",
    content: serializePracticeBank(stored),
  } as FakeFile;
  const vault = new FakeVault();
  vault.files.set(bankPath, file);
  const repository = new PracticeBankRepository({ vault } as unknown as App);
  const reviewResult = summary.results[0];
  assert.ok(reviewResult?.grading === "ai-review");

  const saved = await repository.applyAiReviewResolution(bankPath, {
    bankId: stored.bankId,
    sessionId: summary.id,
    requestId: reviewResult.request.requestId,
    requestHash: reviewResult.request.requestHash,
    state: {
      status: "reviewed",
      reviewedAt: "2026-08-20T10:07:00.000Z",
      attempts: 1,
      verdict: "correct",
      feedback: "The answer states the required causal result.",
      criteria: [{
        criterion: "alpha",
        outcome: "met",
        feedback: "Alpha is identified as the cause.",
        sourceSegmentIds: [reviewResult.request.context.sourceSegments[0]?.id ?? "missing"],
      }],
    },
  }, 1);

  assert.equal(vault.processCalls, 1);
  assert.equal(saved.revision, 2);
  const persisted = parsePracticeBankMarkdown(file.content);
  assert.equal(persisted.status, "ok");
  if (persisted.status !== "ok") return;
  const result = persisted.bank.sessions[0]?.results[0];
  assert.equal(result?.grading, "ai-review");
  if (result?.grading === "ai-review") assert.equal(result.state.status, "reviewed");
});

test("repository durably requeues a failed review without replacing its locked request", async () => {
  const bank = createBank();
  const summary = createSessionSummary(bank, aiReviewFinishedSession(bank, "failed"));
  const stored: PracticeBankV2 = {
    ...bank,
    revision: 1,
    updatedAt: summary.finishedAt,
    sessions: [summary],
  };
  const reviewResult = summary.results[0];
  assert.ok(reviewResult?.grading === "ai-review");
  const lockedRequest = structuredClone(reviewResult.request);
  const bankPath = "Notes/Term/Course/Practice/Evidence - Practice.md";
  const file = {
    path: bankPath,
    name: "Evidence - Practice.md",
    basename: "Evidence - Practice",
    extension: "md",
    content: serializePracticeBank(stored),
  } as FakeFile;
  const vault = new FakeVault();
  vault.files.set(bankPath, file);
  const repository = new PracticeBankRepository({ vault } as unknown as App);

  const saved = await repository.applyAiReviewStateTransition(bankPath, {
    bankId: stored.bankId,
    sessionId: summary.id,
    requestId: lockedRequest.requestId,
    requestHash: lockedRequest.requestHash,
    state: {
      status: "pending",
      queuedAt: "2026-08-20T10:07:00.000Z",
      attempts: 1,
    },
  }, 1);

  assert.equal(vault.processCalls, 1);
  assert.equal(saved.revision, 2);
  const result = saved.sessions[0]?.results[0];
  assert.ok(result?.grading === "ai-review");
  assert.equal(result.state.status, "pending");
  assert.deepEqual(result.request, lockedRequest);

  const repeated = await repository.applyAiReviewStateTransition(bankPath, {
    bankId: stored.bankId,
    sessionId: summary.id,
    requestId: lockedRequest.requestId,
    requestHash: lockedRequest.requestHash,
    state: {
      status: "pending",
      queuedAt: "2026-08-20T10:07:00.000Z",
      attempts: 1,
    },
  }, 1);
  assert.equal(vault.processCalls, 2);
  assert.equal(repeated.revision, 2);
  assert.deepEqual(repeated.sessions[0]?.results[0], result);
});
