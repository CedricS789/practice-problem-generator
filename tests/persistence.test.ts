import assert from "node:assert/strict";
import test from "node:test";

import {
  derivePracticePath,
  getStaleSourceState,
  isPracticeBankStale,
  mergeSessionSummary,
  mergeAiReviewResolution,
  mergeAiReviewStateTransition,
  migratePracticeBankV1ToV3,
  parsePracticeBankMarkdown,
  serializePracticeBank,
} from "../src/persistence";
import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  LEGACY_PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  type PracticeBankV1,
  type PracticeBankV2,
  type SessionItemResultV1,
  type SessionSummaryV2,
} from "../src/model";
import { migratePracticeBankV2ToV3 } from "../src/learning-path";
import { createAiReviewRequest } from "../src/schema";
import { createSourceHash, segmentSource } from "../src/segmenter";
import {
  createPdfSourceImport,
  parseSourceImportMarkdown,
} from "../src/source-import";

const sourceText = "# Source\nEvidence supports the answer.";

function createBank(): PracticeBankV2 {
  const timestamp = "2026-08-20T10:00:00.000Z";
  const segments = segmentSource(sourceText);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-source",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: {
      vaultPath: "Notes/Term/Course/Source.md",
      wikilink: "[[Notes/Term/Course/Source]]",
      title: "Source",
      scope: "note",
      hash: createSourceHash(sourceText),
    },
    segments,
    visuals: [],
    exercises: [
      {
        id: "exercise-1",
        type: "short-answer",
        title: "Recall the evidence",
        prompt: "What does the evidence support?",
        difficulty: "hard",
        sourceSegmentIds: [paragraph.id],
        groundedAnswer: "It supports the answer.",
        acceptableAnswers: ["the answer"],
        keyPoints: ["evidence", "answer"],
      },
    ],
    sessions: [],
    generation: {
      provider: "codex",
      generatedAt: timestamp,
      promptVersion: "v1",
    },
  };
}

function createSession(id = "session-1"): SessionSummaryV2 {
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    id,
    startedAt: "2026-08-20T10:10:00.000Z",
    finishedAt: "2026-08-20T10:12:00.000Z",
    bankRevisionAtStart: 0,
    exerciseCount: 1,
    completedCount: 1,
    score: { correct: 0, total: 0 },
    ratings: { again: 0, hard: 0, good: 1, easy: 0 },
    results: [
      { exerciseId: "exercise-1", grading: "self-rated", rating: "good" },
    ],
  };
}

function createLegacyBank(): PracticeBankV1 {
  const current = createBank();
  return {
    ...structuredClone(current),
    schemaVersion: LEGACY_PRACTICE_BANK_SCHEMA_VERSION,
    sessions: current.sessions.map((session) => ({
      ...structuredClone(session),
      schemaVersion: LEGACY_PRACTICE_BANK_SCHEMA_VERSION,
      results: session.results.flatMap((result) =>
        result.grading === "ai-review" ? [] : [result],
      ),
    })),
  };
}

function legacyMarkdown(bank: PracticeBankV1): string {
  return [
    "---",
    "practice-lab: true",
    `practice-lab-version: ${LEGACY_PRACTICE_BANK_SCHEMA_VERSION}`,
    "---",
    "",
    "```practice-lab",
    JSON.stringify(bank, null, 2),
    "```",
    "",
  ].join("\n");
}

test("derives the fixed per-course Practice path", () => {
  assert.equal(
    derivePracticePath(
      "Notes/Term/Course/Chapters/Chapter 1/Topic basics.md",
    ),
    "Notes/Term/Course/Practice/Topic basics - Practice.md",
  );
  assert.equal(
    derivePracticePath("Notes\\Term\\Course\\Nested\\Source.MD"),
    "Notes/Term/Course/Practice/Source - Practice.md",
  );
  assert.match(
    derivePracticePath("Notes/Term/Course/Slides/Lecture 1.pdf"),
    /^Notes\/Term\/Course\/Practice\/Lecture 1 - [a-f0-9]{10} - Practice\.md$/u,
  );
  assert.match(
    derivePracticePath("Library/Lecture 1.pdf"),
    /^Notes\/Practice Sources\/Practice\/Lecture 1 - [a-f0-9]{10} - Practice\.md$/u,
  );
  assert.equal(
    derivePracticePath("Library/Lecture 1.pdf"),
    derivePracticePath("Library/Lecture 1.pdf"),
    "external PDF output must be deterministic",
  );
  assert.throws(
    () => derivePracticePath("Source.md"),
    /Notes\/<term>\/<course>/u,
  );
  assert.throws(
    () => derivePracticePath("C:/Vault/Notes/Term/Course/Source.md"),
    /vault-relative/u,
  );
  assert.throws(
    () => derivePracticePath("Notes/Term/Course/Practice/Bank.md"),
    /cannot be used as its own source/u,
  );
});

test("round-trips readable Markdown and its versioned fenced block", () => {
  const bank = createBank();
  const markdown = serializePracticeBank(bank);
  assert.match(markdown, /^---\npractice-lab: true/mu);
  assert.match(markdown, /source: "\[\[Notes\/Term\/Course\/Source\]\]"/u);
  assert.match(markdown, /```practice-lab\n\{/u);
  const parsed = parsePracticeBankMarkdown(markdown);
  assert.equal(parsed.status, "ok");
  if (parsed.status === "ok") {
    assert.deepEqual(parsed.bank, migratePracticeBankV2ToV3(bank));
    assert.deepEqual(parsed.warnings, []);
  }
  const windowsParsed = parsePracticeBankMarkdown(markdown.replace(/\n/gu, "\r\n"));
  assert.equal(windowsParsed.status, "ok");
});

test("PDF banks require and preserve matching page-range provenance", () => {
  const bank = createBank();
  const pdfBank: PracticeBankV2 = {
    ...bank,
    source: {
      ...bank.source,
      vaultPath: "Library/Source.pdf",
      wikilink: "[[Library/Source.pdf]]",
      scope: "selection",
    },
  };
  assert.throws(
    () => serializePracticeBank(pdfBank),
    /without its source-import metadata/u,
  );
  const sourceImport = createPdfSourceImport({
    sourceHash: pdfBank.source.hash,
    pdfContentHash: `sha256:${"c".repeat(64)}`,
    firstPage: 2,
    lastPage: 4,
    pageCount: 10,
    extractedAt: "2026-08-21T02:00:00.000Z",
  });
  const markdown = serializePracticeBank(pdfBank, undefined, undefined, sourceImport);
  assert.deepEqual(parseSourceImportMarkdown(markdown), {
    status: "ok",
    sourceImport,
  });
  assert.equal(parsePracticeBankMarkdown(markdown).status, "ok");
  assert.throws(
    () => serializePracticeBank(bank, undefined, undefined, sourceImport),
    /only for a PDF/u,
  );
});

test("validates legacy v1 strictly and migrates it losslessly in memory", () => {
  const legacy = createLegacyBank();
  const currentSession = createSession("legacy-session");
  legacy.sessions = [{
    ...currentSession,
    schemaVersion: LEGACY_PRACTICE_BANK_SCHEMA_VERSION,
    results: currentSession.results.filter(
      (result): result is SessionItemResultV1 => result.grading !== "ai-review",
    ),
  }];
  const parsed = parsePracticeBankMarkdown(legacyMarkdown(legacy));
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  assert.equal(parsed.storedSchemaVersion, LEGACY_PRACTICE_BANK_SCHEMA_VERSION);
  assert.equal(parsed.bank.schemaVersion, CURRENT_PRACTICE_BANK_SCHEMA_VERSION);
  assert.equal(parsed.bank.sessions[0]?.schemaVersion, CURRENT_PRACTICE_BANK_SCHEMA_VERSION);
  assert.match(parsed.warnings[0] ?? "", /migrated in memory/u);
  const expected = migratePracticeBankV1ToV3(legacy);
  assert.deepEqual(parsed.bank, expected);
  assert.match(serializePracticeBank(parsed.bank), /practice-lab-version: 3/u);
});

test("opens unknown versions read-only with recovery instructions", () => {
  const markdown = serializePracticeBank(createBank()).replace(
    '"schemaVersion": 3',
    '"schemaVersion": 99',
  );
  const parsed = parsePracticeBankMarkdown(markdown);
  assert.equal(parsed.status, "unsupported-version");
  if (parsed.status === "unsupported-version") {
    assert.equal(parsed.schemaVersion, 99);
    assert.match(parsed.recoveryMessage, /read-only/u);
    assert.ok(parsed.rawJson.includes('"schemaVersion": 99'));
  }
});

test("fails closed for missing, malformed, and structurally invalid blocks", () => {
  assert.equal(parsePracticeBankMarkdown("# ordinary note").status, "missing");
  const malformed = parsePracticeBankMarkdown("```practice-lab\n{broken\n```\n");
  assert.equal(malformed.status, "invalid");
  const invalid = parsePracticeBankMarkdown(
    "```practice-lab\n{\"schemaVersion\":2}\n```\n",
  );
  assert.equal(invalid.status, "invalid");
});

test("stale-source detection uses the canonical submitted-source hash", () => {
  const bank = createBank();
  assert.equal(isPracticeBankStale(bank, sourceText.replace(/\n/gu, "\r\n")), false);
  assert.equal(isPracticeBankStale(bank, `${sourceText}\nNew evidence.`), true);
  assert.deepEqual(getStaleSourceState(bank, sourceText), {
    stale: false,
    storedHash: bank.source.hash,
    currentHash: bank.source.hash,
  });
});

test("session merge is atomic-friendly, revision-aware, and idempotent", () => {
  const bank = createBank();
  const session = createSession();
  const first = mergeSessionSummary(bank, session, { expectedRevision: 0 });
  assert.equal(first.status, "merged");
  assert.equal(first.bank.revision, 1);
  assert.equal(first.bank.sessions.length, 1);
  assert.equal(bank.sessions.length, 0, "the input bank remains immutable");

  const repeated = mergeSessionSummary(first.bank, session, { expectedRevision: 0 });
  assert.equal(repeated.status, "unchanged");
  assert.equal(repeated.bank.revision, 1);

  const concurrentlyEdited: PracticeBankV2 = {
    ...bank,
    revision: 2,
    updatedAt: "2026-08-20T10:15:00.000Z",
  };
  const rebased = mergeSessionSummary(concurrentlyEdited, session, {
    expectedRevision: 0,
  });
  assert.equal(rebased.status, "rebased");
  assert.equal(rebased.bank.revision, 3);
  assert.equal(rebased.bank.updatedAt, concurrentlyEdited.updatedAt);
});

test("session merge rejects future revisions, conflicting IDs, and bad metrics", () => {
  const bank = createBank();
  const session = createSession();
  assert.equal(
    mergeSessionSummary(bank, session, { expectedRevision: 1 }).status,
    "conflict",
  );
  const mismatchedStart = createSession("session-mismatch");
  mismatchedStart.bankRevisionAtStart = 1;
  assert.equal(
    mergeSessionSummary(bank, mismatchedStart, { expectedRevision: 0 }).status,
    "conflict",
  );

  const first = mergeSessionSummary(bank, session, { expectedRevision: 0 });
  const changed = createSession();
  changed.ratings = { again: 1, hard: 0, good: 0, easy: 0 };
  changed.results = [
    { exerciseId: "exercise-1", grading: "self-rated", rating: "again" },
  ];
  assert.equal(
    mergeSessionSummary(first.bank, changed, { expectedRevision: 1 }).status,
    "conflict",
  );

  const invalid = createSession("session-invalid");
  invalid.score = { correct: 1, total: 1 };
  assert.equal(
    mergeSessionSummary(bank, invalid, { expectedRevision: 0 }).status,
    "invalid-session",
  );
});

function bankWithPendingAiReview(): {
  bank: PracticeBankV2;
  requestId: string;
  requestHash: string;
} {
  const bank = createBank();
  const exercise = bank.exercises[0];
  const segment = bank.segments.find((item) => item.kind === "paragraph");
  assert.ok(exercise?.type === "short-answer");
  assert.ok(segment);
  const request = createAiReviewRequest({
    requestId: "review-late-1",
    sessionId: "session-ai-1",
    exerciseId: exercise.id,
    provider: "codex",
    reasoningEffort: "high",
    promptVersion: "answer-review-v1",
    requestedAt: "2026-08-20T10:11:00.000Z",
    submittedAnswer: "The evidence supports the answer incompletely.",
    context: {
      exerciseTitle: exercise.title,
      exerciseType: exercise.type,
      prompt: exercise.prompt,
      groundedAnswer: exercise.groundedAnswer,
      keyPoints: [...exercise.keyPoints],
      sourceSegments: [{
        id: segment.id,
        headingPath: [...segment.headingPath],
        text: segment.text,
      }],
    },
  });
  bank.revision = 1;
  bank.updatedAt = "2026-08-20T10:12:00.000Z";
  bank.sessions = [{
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    id: "session-ai-1",
    startedAt: "2026-08-20T10:10:00.000Z",
    finishedAt: "2026-08-20T10:12:00.000Z",
    bankRevisionAtStart: 0,
    exerciseCount: 1,
    completedCount: 1,
    score: { correct: 0, total: 0 },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    results: [{
      exerciseId: exercise.id,
      grading: "ai-review",
      request,
      state: { status: "pending", queuedAt: request.requestedAt, attempts: 0 },
    }],
  }];
  return { bank, requestId: request.requestId, requestHash: request.requestHash };
}

test("late AI-review merge is atomic-friendly, revision-rebasing, and idempotent", () => {
  const { bank, requestId, requestHash } = bankWithPendingAiReview();
  const patch = {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash,
    state: {
      status: "reviewed" as const,
      reviewedAt: "2026-08-20T10:13:00.000Z",
      attempts: 1,
      verdict: "partial" as const,
      feedback: "The central idea is present but incomplete.",
      criteria: [{
        criterion: "evidence-answer",
        outcome: "partial" as const,
        feedback: "State the supported conclusion explicitly.",
        sourceSegmentIds: [bank.segments[1]?.id ?? bank.segments[0]?.id ?? "missing"],
      }],
    },
  };
  const first = mergeAiReviewResolution(bank, patch, { expectedRevision: 1 });
  assert.equal(first.status, "merged");
  assert.equal(first.bank.revision, 2);
  assert.equal(bank.sessions[0]?.results[0]?.grading, "ai-review");
  if (bank.sessions[0]?.results[0]?.grading === "ai-review") {
    assert.equal(bank.sessions[0].results[0].state.status, "pending");
  }

  const repeated = mergeAiReviewResolution(first.bank, patch, { expectedRevision: 1 });
  assert.equal(repeated.status, "unchanged");
  assert.equal(repeated.bank.revision, 2);

  const laterBank: PracticeBankV2 = {
    ...bank,
    revision: 4,
    updatedAt: "2026-08-20T10:14:00.000Z",
  };
  const rebased = mergeAiReviewResolution(laterBank, patch, { expectedRevision: 1 });
  assert.equal(rebased.status, "rebased");
  assert.equal(rebased.bank.revision, 5);
  assert.equal(rebased.bank.updatedAt, laterBank.updatedAt);
});

test("late AI-review merge fails closed for stale identity, hashes, and conflicting terminal states", () => {
  const { bank, requestId, requestHash } = bankWithPendingAiReview();
  const pending = bank.sessions[0]?.results[0];
  assert.ok(pending?.grading === "ai-review");
  const sourceSegmentId = pending.request.context.sourceSegments[0]?.id;
  assert.ok(sourceSegmentId);
  const reviewed = {
    status: "reviewed" as const,
    reviewedAt: "2026-08-20T10:13:00.000Z",
    attempts: 1,
    verdict: "correct" as const,
    feedback: "The answer covers the required idea.",
    criteria: [{
      criterion: "evidence-answer",
      outcome: "met" as const,
      feedback: "The required conclusion is present.",
      sourceSegmentIds: [sourceSegmentId],
    }],
  };
  assert.equal(mergeAiReviewResolution(bank, {
    bankId: "different-bank",
    sessionId: "session-ai-1",
    requestId,
    requestHash,
    state: reviewed,
  }).status, "conflict");
  assert.equal(mergeAiReviewResolution(bank, {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash: `sha256:${"f".repeat(64)}`,
    state: reviewed,
  }).status, "conflict");

  const first = mergeAiReviewResolution(bank, {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash,
    state: reviewed,
  });
  assert.equal(first.status, "merged");
  const conflicting = mergeAiReviewResolution(first.bank, {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash,
    state: { ...reviewed, verdict: "incorrect" },
  });
  assert.equal(conflicting.status, "conflict");
});

test("failed AI review requeues idempotently and then resolves from pending", () => {
  const { bank, requestId, requestHash } = bankWithPendingAiReview();
  const identity = {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash,
  };
  const failed = mergeAiReviewStateTransition(bank, {
    ...identity,
    state: {
      status: "failed",
      failedAt: "2026-08-20T10:13:00.000Z",
      attempts: 1,
      error: {
        code: "timeout",
        message: "The provider timed out.",
        retryable: true,
      },
    },
  }, { expectedRevision: 1 });
  assert.equal(failed.status, "merged");
  const failedResult = failed.bank.sessions[0]?.results[0];
  assert.ok(failedResult?.grading === "ai-review");
  const lockedRequest = structuredClone(failedResult.request);

  const requeuePatch = {
    ...identity,
    state: {
      status: "pending" as const,
      queuedAt: "2026-08-20T10:14:00.000Z",
      attempts: 1,
    },
  };
  const requeued = mergeAiReviewStateTransition(
    failed.bank,
    requeuePatch,
    { expectedRevision: 1 },
  );
  assert.equal(requeued.status, "rebased");
  assert.equal(requeued.bank.revision, 3);
  const pendingResult = requeued.bank.sessions[0]?.results[0];
  assert.ok(pendingResult?.grading === "ai-review");
  assert.equal(pendingResult.state.status, "pending");
  assert.deepEqual(pendingResult.request, lockedRequest);

  const repeated = mergeAiReviewStateTransition(
    requeued.bank,
    requeuePatch,
    { expectedRevision: 2 },
  );
  assert.equal(repeated.status, "unchanged");
  assert.equal(repeated.bank.revision, 3);

  const sourceSegmentId = lockedRequest.context.sourceSegments[0]?.id;
  assert.ok(sourceSegmentId);
  const reviewed = mergeAiReviewStateTransition(repeated.bank, {
    ...identity,
    state: {
      status: "reviewed",
      reviewedAt: "2026-08-20T10:15:00.000Z",
      attempts: 2,
      verdict: "correct",
      feedback: "The answer covers the required evidence.",
      criteria: [{
        criterion: "evidence-answer",
        outcome: "met",
        feedback: "The supported conclusion is present.",
        sourceSegmentIds: [sourceSegmentId],
      }],
    },
  }, { expectedRevision: 2 });
  assert.equal(reviewed.status, "rebased");
  assert.equal(reviewed.bank.revision, 4);
  const reviewedResult = reviewed.bank.sessions[0]?.results[0];
  assert.ok(reviewedResult?.grading === "ai-review");
  assert.equal(reviewedResult.state.status, "reviewed");
  assert.deepEqual(reviewedResult.request, lockedRequest);
});

test("AI-review retry rebases over unrelated revisions without losing them", () => {
  const { bank, requestId, requestHash } = bankWithPendingAiReview();
  const identity = {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash,
  };
  const failed = mergeAiReviewStateTransition(bank, {
    ...identity,
    state: {
      status: "failed",
      failedAt: "2026-08-20T10:13:00.000Z",
      attempts: 1,
      error: {
        code: "process-failed",
        message: "The provider process failed.",
        retryable: true,
      },
    },
  }, { expectedRevision: 1 });
  assert.equal(failed.status, "merged");
  const generation = failed.bank.generation;
  assert.ok(generation);
  const concurrentlyEdited: PracticeBankV2 = {
    ...failed.bank,
    revision: 7,
    updatedAt: "2026-08-20T10:20:00.000Z",
    generation: {
      ...generation,
      provider: "claude",
    },
  };

  const rebased = mergeAiReviewStateTransition(concurrentlyEdited, {
    ...identity,
    state: {
      status: "pending",
      queuedAt: "2026-08-20T10:21:00.000Z",
      attempts: 1,
    },
  }, { expectedRevision: 2 });

  assert.equal(rebased.status, "rebased");
  assert.equal(rebased.bank.revision, 8);
  assert.equal(rebased.bank.generation?.provider, "claude");
  assert.equal(rebased.bank.updatedAt, "2026-08-20T10:21:00.000Z");
});

test("reviewed AI requests are terminal and tampered retries fail closed", () => {
  const { bank, requestId, requestHash } = bankWithPendingAiReview();
  const pendingResult = bank.sessions[0]?.results[0];
  assert.ok(pendingResult?.grading === "ai-review");
  const sourceSegmentId = pendingResult.request.context.sourceSegments[0]?.id;
  assert.ok(sourceSegmentId);
  const identity = {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash,
  };
  const reviewedPatch = {
    ...identity,
    state: {
      status: "reviewed" as const,
      reviewedAt: "2026-08-20T10:13:00.000Z",
      attempts: 1,
      verdict: "correct" as const,
      feedback: "The answer covers the required evidence.",
      criteria: [{
        criterion: "evidence-answer",
        outcome: "met" as const,
        feedback: "The supported conclusion is present.",
        sourceSegmentIds: [sourceSegmentId],
      }],
    },
  };
  const reviewed = mergeAiReviewStateTransition(bank, reviewedPatch);
  assert.equal(reviewed.status, "merged");
  assert.equal(mergeAiReviewStateTransition(reviewed.bank, {
    ...identity,
    state: {
      status: "pending",
      queuedAt: "2026-08-20T10:14:00.000Z",
      attempts: 1,
    },
  }).status, "conflict");
  assert.equal(mergeAiReviewStateTransition(reviewed.bank, reviewedPatch).status, "unchanged");

  const tampered = structuredClone(bank);
  const tamperedResult = tampered.sessions[0]?.results[0];
  assert.ok(tamperedResult?.grading === "ai-review");
  tamperedResult.request.provider = "claude";
  const rejected = mergeAiReviewStateTransition(tampered, {
    ...identity,
    state: {
      status: "failed",
      failedAt: "2026-08-20T10:13:00.000Z",
      attempts: 1,
      error: {
        code: "timeout",
        message: "The provider timed out.",
        retryable: true,
      },
    },
  });
  assert.equal(rejected.status, "conflict");
  if (rejected.status === "conflict") assert.match(rejected.message, /tampered/u);
});

test("AI-review retry rejects state rewriting and skipped transitions", () => {
  const { bank, requestId, requestHash } = bankWithPendingAiReview();
  const identity = {
    bankId: bank.bankId,
    sessionId: "session-ai-1",
    requestId,
    requestHash,
  };
  assert.equal(mergeAiReviewStateTransition(bank, {
    ...identity,
    state: {
      status: "pending",
      queuedAt: "2026-08-20T10:14:00.000Z",
      attempts: 0,
    },
  }).status, "conflict");

  const failed = mergeAiReviewStateTransition(bank, {
    ...identity,
    state: {
      status: "failed",
      failedAt: "2026-08-20T10:13:00.000Z",
      attempts: 1,
      error: {
        code: "timeout",
        message: "The provider timed out.",
        retryable: true,
      },
    },
  });
  assert.equal(failed.status, "merged");
  const sourceSegmentId = bank.sessions[0]?.results[0];
  assert.ok(sourceSegmentId?.grading === "ai-review");
  assert.equal(mergeAiReviewStateTransition(failed.bank, {
    ...identity,
    state: {
      status: "reviewed",
      reviewedAt: "2026-08-20T10:14:00.000Z",
      attempts: 2,
      verdict: "correct",
      feedback: "The answer covers the required evidence.",
      criteria: [{
        criterion: "evidence-answer",
        outcome: "met",
        feedback: "The supported conclusion is present.",
        sourceSegmentIds: [sourceSegmentId.request.context.sourceSegments[0]?.id ?? "missing"],
      }],
    },
  }).status, "conflict");
  assert.equal(mergeAiReviewStateTransition(failed.bank, {
    ...identity,
    state: {
      status: "pending",
      queuedAt: "2026-08-20T10:14:00.000Z",
      attempts: 0,
    },
  }).status, "conflict");
});
