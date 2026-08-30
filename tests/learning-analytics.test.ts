import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveLearningAnalytics,
  recommendNextLearningStep,
} from "../src/learning-analytics";
import type {
  PracticeBankV4,
  SessionSummaryV4,
} from "../src/model";
import { emptySourceAlignmentLedger } from "../src/source-alignment";

function session(
  id: string,
  finishedAt: string,
  results: Array<{ readonly exerciseId: string; readonly correct: boolean }>,
): SessionSummaryV4 {
  return {
    schemaVersion: 4,
    id,
    startedAt: finishedAt,
    finishedAt,
    bankRevisionAtStart: 0,
    exerciseCount: results.length,
    completedCount: results.length,
    score: { correct: results.filter((result) => result.correct).length, total: results.length },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    results: results.map((result) => ({ exerciseId: result.exerciseId, grading: "objective", correct: result.correct })),
    scope: { mode: "learning-path", learningPath: { id: "path-a", title: "Path" }, sets: [{ id: "set-a", title: "Set A" }] },
    evidence: results.map((result) => ({
      exerciseId: result.exerciseId,
      set: { id: "set-a", title: "Set A" },
      aspects: [{ id: "aspect-a", title: "Aspect A" }],
      instructionalRole: "independent",
      independent: true,
      hintsRevealed: 0,
      retries: 0,
      recoveryOutcome: "not-needed",
    })),
    completedTutorLessons: [],
  };
}

function bank(sessions: SessionSummaryV4[]): PracticeBankV4 {
  return {
    schemaVersion: 4,
    bankId: "bank-a",
    revision: 0,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    source: { vaultPath: "Notes/A.md", wikilink: "[[Notes/A]]", title: "A", scope: "note", hash: "sha256:a" },
    segments: [{ id: "seg-a", kind: "paragraph", ordinal: 0, headingPath: [], text: "Evidence" }],
    visuals: [],
    exercises: [],
    sessions,
    sourceMaterials: [{ id: "source-a", role: "primary", classification: "unclassified", classificationState: "migration-default", vaultPath: "Notes/A.md", wikilink: "[[Notes/A]]", title: "A", sourceHash: "sha256:a", scope: { kind: "note" }, segmentIds: ["seg-a"], visualIds: [] }],
    sourceAlignment: emptySourceAlignmentLedger(),
    aspects: [{ id: "aspect-a", title: "Aspect A", purpose: "Learn A", prerequisiteAspectIds: [], sourceSegmentIds: ["seg-a"], status: "supported" }],
    practiceSets: [{ id: "set-a", title: "Set A", purpose: "Practice A", instructionalRole: "foundations", order: 0, assignments: [] }],
    tutorLessons: [],
    learningPath: { id: "path-a", title: "Path", startingLevel: "new-to-topic", aspectIds: ["aspect-a"], steps: [{ kind: "practice-set", setId: "set-a", order: 0 }] },
  };
}

test("consistent evidence requires three independent attempts across two sessions at 80 percent", () => {
  const twoInOne = deriveLearningAnalytics(bank([
    session("s1", "2026-08-20T10:00:00.000Z", [
      { exerciseId: "e1", correct: true },
      { exerciseId: "e2", correct: true },
      { exerciseId: "e3", correct: true },
    ]),
  ])).aspects[0];
  assert.equal(twoInOne?.state, "Developing");

  const acrossTwo = deriveLearningAnalytics(bank([
    session("s1", "2026-08-20T10:00:00.000Z", [
      { exerciseId: "e1", correct: true },
      { exerciseId: "e2", correct: true },
    ]),
    session("s2", "2026-08-21T10:00:00.000Z", [
      { exerciseId: "e3", correct: true },
    ]),
  ])).aspects[0];
  assert.equal(acrossTwo?.state, "Consistent evidence");
  assert.equal(acrossTwo?.independentSessionCount, 2);
  assert.equal(acrossTwo?.weightedPercent, 100);
});

test("guided evidence records assistance without inflating independent performance", () => {
  const current = bank([session("s1", "2026-08-20T10:00:00.000Z", [{ exerciseId: "e1", correct: true }])]);
  current.sessions[0]!.evidence[0] = {
    ...current.sessions[0]!.evidence[0]!,
    instructionalRole: "guided-check",
    independent: false,
    hintsRevealed: 2,
    retries: 1,
    recoveryOutcome: "recovered",
  };
  const summary = deriveLearningAnalytics(current).aspects[0];
  assert.equal(summary?.state, "Unpracticed");
  assert.equal(summary?.independentAttempts, 0);
  assert.equal(summary?.guidedAttempts, 1);
  assert.equal(summary?.hintsRevealed, 2);
  assert.equal(summary?.recoveredCount, 1);
});

test("recommendations are explanatory, prerequisite-aware, and ignorable", () => {
  const current = bank([]);
  current.aspects.unshift({
    id: "aspect-prerequisite",
    title: "Prerequisite",
    purpose: "Required first",
    prerequisiteAspectIds: [],
    sourceSegmentIds: ["seg-a"],
    status: "supported",
  });
  current.aspects[1]!.prerequisiteAspectIds = ["aspect-prerequisite"];
  current.learningPath!.aspectIds = ["aspect-prerequisite", "aspect-a"];
  current.practiceSets[0]!.assignments = [{ exerciseId: "e1", aspectIds: ["aspect-a"], role: "independent" }];
  const recommendation = recommendNextLearningStep(current);
  assert.equal(recommendation?.canIgnore, true);
  assert.equal(recommendation?.advisory, true);
  assert.ok(recommendation?.reasonCodes.includes("unmet-prerequisite"));
  assert.match(recommendation?.reasons.join(" ") ?? "", /required before/iu);
});
