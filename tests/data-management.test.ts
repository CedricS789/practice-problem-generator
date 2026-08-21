import assert from "node:assert/strict";
import test from "node:test";

import {
  CLEAR_HISTORY_CONFIRMATION,
  DELETE_BANK_CONFIRMATION,
  DELETE_SESSION_CONFIRMATION,
  RESET_SETTINGS_CONFIRMATION,
  clearPracticeSessions,
  practiceBankBackupPath,
  removePracticeSession,
} from "../src/data-management";
import {
  PRACTICE_BANK_SCHEMA_VERSION,
  type PracticeBankV2,
  type SessionSummaryV2,
} from "../src/model";
import { validatePracticeBank } from "../src/schema";
import { createSourceHash, segmentSource } from "../src/segmenter";

function session(id: string, finishedAt: string): SessionSummaryV2 {
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    id,
    startedAt: "2026-08-20T10:00:00.000Z",
    finishedAt,
    bankRevisionAtStart: 0,
    exerciseCount: 1,
    completedCount: 1,
    score: { correct: 1, total: 1 },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    results: [{ exerciseId: "exercise-1", grading: "objective", correct: true }],
  };
}

function bank(): PracticeBankV2 {
  const source = "# Evidence\nAlpha supports beta.";
  const segments = segmentSource(source);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-data-management",
    revision: 2,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T10:30:00.000Z",
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
      id: "exercise-1",
      type: "short-answer",
      title: "Evidence relation",
      prompt: "What supports beta?",
      difficulty: "medium",
      sourceSegmentIds: [paragraph.id],
      groundedAnswer: "Alpha supports beta.",
      acceptableAnswers: ["Alpha"],
      keyPoints: ["Alpha", "beta"],
    }],
    sessions: [
      session("session-one", "2026-08-20T10:10:00.000Z"),
      session("session-two", "2026-08-20T10:20:00.000Z"),
    ],
  };
}

test("removes exactly one session and keeps the resulting bank valid", () => {
  const original = bank();
  const result = removePracticeSession(
    original,
    "session-one",
    "2026-08-20T11:00:00.000Z",
  );
  assert.equal(result.status, "removed");
  assert.deepEqual(result.removed.map((item) => item.id), ["session-one"]);
  assert.deepEqual(result.bank.sessions.map((item) => item.id), ["session-two"]);
  assert.equal(result.bank.revision, 3);
  assert.equal(result.bank.updatedAt, "2026-08-20T11:00:00.000Z");
  assert.equal(validatePracticeBank(result.bank).ok, true);
  assert.equal(original.sessions.length, 2, "the input bank stays immutable");
});

test("a missing session is a no-op and never rewrites the bank", () => {
  const original = bank();
  const result = removePracticeSession(
    original,
    "missing-session",
    "2026-08-20T11:00:00.000Z",
  );
  assert.equal(result.status, "unchanged");
  assert.equal(result.bank, original);
  assert.equal(result.removed.length, 0);
});

test("clears all sessions while preserving exercises and monotonic metadata", () => {
  const original = bank();
  const result = clearPracticeSessions(
    original,
    "2026-08-20T09:30:00.000Z",
  );
  assert.equal(result.status, "removed");
  assert.equal(result.removed.length, 2);
  assert.equal(result.bank.sessions.length, 0);
  assert.equal(result.bank.exercises.length, original.exercises.length);
  assert.equal(result.bank.revision, original.revision + 1);
  assert.equal(
    result.bank.updatedAt,
    original.updatedAt,
    "an earlier reset timestamp cannot move updatedAt backwards",
  );
  assert.equal(validatePracticeBank(result.bank).ok, true);
});

test("backup paths stay isolated and confirmation phrases are explicit", () => {
  assert.equal(
    practiceBankBackupPath(
      ".tmp/practice-lab-ai/data-management/run",
      "Notes/Term/Course/Practice/Evidence - Practice.md",
    ),
    ".tmp/practice-lab-ai/data-management/run/Notes/Term/Course/Practice/Evidence - Practice.md.bak",
  );
  assert.throws(
    () => practiceBankBackupPath(".tmp/run", "../Evidence.md"),
    /safe Grounded Problems backup path/u,
  );
  assert.deepEqual([
    RESET_SETTINGS_CONFIRMATION,
    CLEAR_HISTORY_CONFIRMATION,
    DELETE_BANK_CONFIRMATION,
    DELETE_SESSION_CONFIRMATION,
  ], ["RESET SETTINGS", "CLEAR HISTORY", "DELETE BANK", "DELETE"]);
});
