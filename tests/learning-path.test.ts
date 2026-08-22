import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  type PracticeBankV2,
  type PracticeBankV3,
} from "../src/model";
import {
  defaultSessionLearningMetadataV3,
  GENERAL_ASPECT_ID,
  GENERAL_PRACTICE_SET_ID,
  migratePracticeBankV2ToV3,
  replacePracticeSetContent,
} from "../src/learning-path";
import { createSessionSummary } from "../src/bank-repository";
import { validatePracticeBankV3 } from "../src/schema";
import { createSourceHash, segmentSource } from "../src/segmenter";

function v2Bank(): PracticeBankV2 {
  const text = "# Foundations\nAlpha is the input.\n\n# Mechanisms\nAlpha causes beta.";
  const segments = segmentSource(text);
  const paragraphs = segments.filter((segment) => segment.kind === "paragraph");
  assert.equal(paragraphs.length, 2);
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-learning-path",
    revision: 2,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:10:00.000Z",
    source: {
      vaultPath: "Notes/Term/Course/Learning.md",
      wikilink: "[[Notes/Term/Course/Learning]]",
      title: "Learning",
      scope: "note",
      hash: createSourceHash(text),
    },
    segments,
    visuals: [],
    exercises: [{
      id: "exercise-guided",
      type: "short-answer",
      title: "Identify the input",
      prompt: "What is $\\alpha$?",
      difficulty: "easy",
      sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      groundedAnswer: "$\\alpha$ is the input.",
      acceptableAnswers: ["input"],
      keyPoints: ["input"],
    }, {
      id: "exercise-transfer",
      type: "causal-explanation",
      title: "Trace the mechanism",
      prompt: "Explain why $\\alpha$ causes $\\beta$.",
      difficulty: "hard",
      sourceSegmentIds: [paragraphs[1]?.id ?? "missing"],
      groundedAnswer: "$\\alpha$ causes $\\beta$.",
      keyPoints: ["cause", "effect"],
    }],
    sessions: [{
      schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
      id: "session-before-path",
      startedAt: "2026-08-22T08:01:00.000Z",
      finishedAt: "2026-08-22T08:02:00.000Z",
      bankRevisionAtStart: 1,
      exerciseCount: 2,
      completedCount: 1,
      score: { correct: 1, total: 1 },
      ratings: { again: 0, hard: 0, good: 0, easy: 0 },
      results: [{ exerciseId: "exercise-guided", grading: "objective", correct: true }],
    }],
    generation: {
      provider: "codex",
      generatedAt: "2026-08-22T08:00:00.000Z",
      promptVersion: "practice-lab-v3.4",
      reasoningEffort: "high",
    },
  };
}

function guidedBank(): PracticeBankV3 {
  const migrated = migratePracticeBankV2ToV3(v2Bank());
  const paragraphs = migrated.segments.filter((segment) => segment.kind === "paragraph");
  return {
    ...migrated,
    aspects: [{
      id: "aspect-foundations",
      title: "Foundations",
      purpose: "Establish the input.",
      prerequisiteAspectIds: [],
      sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      status: "supported",
    }, {
      id: "aspect-mechanism",
      title: "Mechanism",
      purpose: "Trace the causal relationship.",
      prerequisiteAspectIds: ["aspect-foundations"],
      sourceSegmentIds: [paragraphs[1]?.id ?? "missing"],
      status: "supported",
    }],
    practiceSets: [{
      id: "set-foundations",
      title: "Foundations",
      purpose: "Guided foundation check.",
      instructionalRole: "foundations",
      order: 0,
      assignments: [{
        exerciseId: "exercise-guided",
        aspectIds: ["aspect-foundations"],
        role: "guided-check",
      }],
    }, {
      id: "set-transfer",
      title: "Transfer",
      purpose: "Independent causal transfer.",
      instructionalRole: "independent-transfer",
      order: 1,
      assignments: [{
        exerciseId: "exercise-transfer",
        aspectIds: ["aspect-mechanism"],
        role: "transfer",
      }],
    }],
    tutorLessons: [{
      id: "lesson-foundations",
      title: "Build the foundation",
      objective: "Identify $\\alpha$ from the approved source.",
      aspectIds: ["aspect-foundations"],
      prerequisiteAspectIds: [],
      guidedExerciseId: "exercise-guided",
      teachingBlocks: [{
        id: "block-why",
        kind: "why",
        title: "Why it matters",
        content: "The role of $\\alpha$ anchors the later mechanism.",
        sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      }, {
        id: "block-prerequisite",
        kind: "prerequisite",
        title: "Required premise",
        content: "$\\alpha$ is the named input in the approved source.",
        sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      }, {
        id: "block-explanation",
        kind: "explanation",
        title: "Connected explanation",
        content: "The named input establishes the premise used by the mechanism.",
        sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      }],
      selfExplanationCheck: {
        prompt: "Explain the role of $\\alpha$.",
        groundedAnswer: "$\\alpha$ is the input.",
        keyPoints: ["input"],
        sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      },
      hints: [{
        id: "hint-1",
        level: 1,
        text: "Look for the named input.",
        sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      }, {
        id: "hint-2",
        level: 2,
        text: "The source explicitly labels $\\alpha$ as the input.",
        sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      }],
      repairExplanation: {
        text: "$\\alpha$ is explicitly identified as the input.",
        sourceSegmentIds: [paragraphs[0]?.id ?? "missing"],
      },
    }],
    learningPath: {
      id: "path-learning",
      title: "Learning path",
      startingLevel: "new-to-topic",
      aspectIds: ["aspect-foundations", "aspect-mechanism"],
      steps: [{ kind: "lesson", lessonId: "lesson-foundations", order: 0 }, {
        kind: "practice-set",
        setId: "set-foundations",
        order: 1,
      }, {
        kind: "practice-set",
        setId: "set-transfer",
        order: 2,
      }],
    },
  };
}

test("v2 migration preserves flat content and history in one General practice set", () => {
  const before = v2Bank();
  const migrated = migratePracticeBankV2ToV3(before);

  assert.equal(migrated.schemaVersion, CURRENT_PRACTICE_BANK_SCHEMA_VERSION);
  assert.deepEqual(migrated.segments, before.segments);
  assert.deepEqual(migrated.visuals, before.visuals);
  assert.deepEqual(migrated.exercises, before.exercises);
  assert.deepEqual(migrated.generation, before.generation);
  assert.equal(migrated.practiceSets[0]?.id, GENERAL_PRACTICE_SET_ID);
  assert.deepEqual(
    migrated.practiceSets[0]?.assignments.map((assignment) => assignment.exerciseId),
    before.exercises.map((exercise) => exercise.id),
  );
  assert.ok(migrated.practiceSets[0]?.assignments.every((assignment) =>
    assignment.role === "independent"
    && assignment.aspectIds[0] === GENERAL_ASPECT_ID,
  ));
  assert.deepEqual(migrated.sessions[0]?.results, before.sessions[0]?.results);
  assert.equal(migrated.sessions[0]?.scope.sets[0]?.id, GENERAL_PRACTICE_SET_ID);
  assert.equal(migrated.sessions[0]?.evidence[0]?.independent, true);
  assert.equal(validatePracticeBankV3(migrated).ok, true);
});

test("accepts a fully grounded learning path with linked guided support", () => {
  const result = validatePracticeBankV3(guidedBank());
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.issues));
});

test("rejects forward prerequisites, source gaps, and duplicate cross-set exercises", () => {
  const bank = guidedBank();
  bank.aspects[0] = {
    ...bank.aspects[0]!,
    prerequisiteAspectIds: ["aspect-mechanism"],
  };
  bank.aspects[1] = { ...bank.aspects[1]!, status: "source-gap" };
  bank.practiceSets[1]?.assignments.push({
    exerciseId: "exercise-guided",
    aspectIds: ["aspect-foundations"],
    role: "independent",
  });

  const result = validatePracticeBankV3(bank);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((item) => /must appear before/u.test(item.message)));
  assert.ok(result.issues.some((item) => /source-gap/u.test(item.message)));
  assert.ok(result.issues.some((item) => /more than one set/u.test(item.message)));
});

test("rejects unsupported tutor citations, broken guided links, and malformed LaTeX", () => {
  const bank = guidedBank();
  const secondSegment = bank.aspects[1]?.sourceSegmentIds[0] ?? "missing";
  const lesson = bank.tutorLessons[0];
  assert.ok(lesson);
  lesson.guidedExerciseId = "exercise-transfer";
  lesson.teachingBlocks[0] = {
    ...lesson.teachingBlocks[0]!,
    content: "Broken $\\alpha",
    sourceSegmentIds: [secondSegment],
  };

  const result = validatePracticeBankV3(bank);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((item) => /guided-check/u.test(item.message)));
  assert.ok(result.issues.some((item) => /supported aspects/u.test(item.message)));
  assert.ok(result.issues.some((item) => /malformed LaTeX/u.test(item.message)));
});

test("rejects tutor teaching blocks outside the required instructional order", () => {
  const bank = guidedBank();
  const lesson = bank.tutorLessons[0];
  assert.ok(lesson);
  lesson.teachingBlocks = [
    lesson.teachingBlocks[2]!,
    lesson.teachingBlocks[0]!,
    lesson.teachingBlocks[1]!,
  ];

  const result = validatePracticeBankV3(bank);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((item) => /must follow why, prerequisite, explanation/iu.test(item.message)));
  }
});

test("rejects a learning path that introduces a dependent aspect before its prerequisite", () => {
  const bank = guidedBank();
  bank.learningPath = {
    ...bank.learningPath!,
    steps: [{ kind: "practice-set", setId: "set-transfer", order: 0 }, {
      kind: "lesson",
      lessonId: "lesson-foundations",
      order: 1,
    }, {
      kind: "practice-set",
      setId: "set-foundations",
      order: 2,
    }],
  };

  const result = validatePracticeBankV3(bank);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((item) =>
      /prerequisite aspect aspect-foundations must be introduced before dependent aspect aspect-mechanism/iu.test(item.message),
    ));
  }
});

test("rejects reordered tutor delivery, duplicate support IDs, and inconsistent session scope", () => {
  const bank = guidedBank();
  const lesson = bank.tutorLessons[0];
  const session = bank.sessions[0];
  assert.ok(lesson);
  assert.ok(session);
  lesson.teachingBlocks[1] = {
    ...lesson.teachingBlocks[1]!,
    id: lesson.teachingBlocks[0]?.id ?? "missing",
  };
  lesson.hints[1] = {
    ...lesson.hints[1]!,
    id: lesson.hints[0]?.id ?? "missing",
  };
  bank.learningPath = {
    ...bank.learningPath!,
    steps: [{ kind: "practice-set", setId: "set-foundations", order: 0 }, {
      kind: "lesson",
      lessonId: "lesson-foundations",
      order: 1,
    }, {
      kind: "practice-set",
      setId: "set-transfer",
      order: 2,
    }],
  };
  session.scope = {
    ...session.scope,
    learningPath: { id: "historical-path", title: "Historical path" },
  };
  session.evidence[0] = {
    ...session.evidence[0]!,
    set: { id: "set-outside-scope", title: "Outside scope" },
  };

  const result = validatePracticeBankV3(bank);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((item) => /teaching-block IDs must be unique/u.test(item.message)));
  assert.ok(result.issues.some((item) => /hint IDs must be unique/u.test(item.message)));
  assert.ok(result.issues.some((item) => /must precede its guided practice set/u.test(item.message)));
  assert.ok(result.issues.some((item) => /only learning-path sessions/u.test(item.message)));
  assert.ok(result.issues.some((item) => /must appear in the session scope/u.test(item.message)));
});

test("historical session evidence remains valid after its live set is renamed or removed", () => {
  const bank = migratePracticeBankV2ToV3(v2Bank());
  bank.practiceSets[0] = {
    ...bank.practiceSets[0]!,
    id: "set-current",
    title: "Current set",
  };
  assert.equal(validatePracticeBankV3(bank).ok, true);
  assert.equal(bank.sessions[0]?.scope.sets[0]?.id, GENERAL_PRACTICE_SET_ID);
});

test("historical session scope has exact mode cardinality, contributors, and titles", () => {
  const setMode = guidedBank();
  const setModeSession = setMode.sessions[0];
  assert.ok(setModeSession);
  setModeSession.scope = {
    mode: "set",
    sets: [
      { id: "set-general", title: "General practice" },
      { id: "set-extra", title: "Extra" },
    ],
  };
  let result = validatePracticeBankV3(setMode);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((item) => /set sessions require exactly one scoped practice set/iu.test(item.message)));
  }

  const mixedMode = guidedBank();
  const mixedModeSession = mixedMode.sessions[0];
  assert.ok(mixedModeSession);
  mixedModeSession.scope = {
    mode: "mixed",
    sets: [{ id: "set-general", title: "General practice" }],
  };
  result = validatePracticeBankV3(mixedMode);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((item) => /mixed sessions require at least two/iu.test(item.message)));
  }

  const incomplete = guidedBank();
  const incompleteSession = incomplete.sessions[0];
  assert.ok(incompleteSession);
  incompleteSession.scope = {
    mode: "mixed",
    sets: [
      { id: "set-general", title: "General practice" },
      { id: "set-extra", title: "Extra" },
    ],
  };
  result = validatePracticeBankV3(incomplete);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((item) => /every scoped practice set must contribute/iu.test(item.message)));
  }

  const mismatchedTitle = guidedBank();
  const titleSession = mismatchedTitle.sessions[0];
  assert.ok(titleSession);
  titleSession.evidence[0] = {
    ...titleSession.evidence[0]!,
    set: { id: "set-general", title: "Wrong historical title" },
  };
  result = validatePracticeBankV3(mismatchedTitle);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((item) => /title must match its scoped snapshot/iu.test(item.message)));
  }
});

test("session construction snapshots set/aspect evidence and preserves explicit tutor recovery", () => {
  const bank = guidedBank();
  const defaults = defaultSessionLearningMetadataV3(bank, ["exercise-guided"]);
  assert.equal(defaults.evidence[0]?.set.id, "set-foundations");
  assert.equal(defaults.evidence[0]?.instructionalRole, "guided-check");
  assert.equal(defaults.evidence[0]?.independent, false);
  const explicit = {
    scope: {
      mode: "learning-path" as const,
      learningPath: { id: "path-learning", title: "Learning path" },
      sets: [{ id: "set-foundations", title: "Foundations" }],
    },
    evidence: [{
      ...defaults.evidence[0]!,
      hintsRevealed: 2,
      retries: 1,
      recoveryOutcome: "recovered" as const,
    }],
    completedTutorLessons: [{
      lesson: { id: "lesson-foundations", title: "Build the foundation" },
      aspects: [{ id: "aspect-foundations", title: "Foundations" }],
    }],
  };
  const summary = createSessionSummary(bank, {
    id: "session-guided",
    startedAt: "2026-08-22T09:00:00.000Z",
    finishedAt: "2026-08-22T09:05:00.000Z",
    orderedExerciseIds: ["exercise-guided"],
    exerciseCountAtStart: 1,
    bankRevisionAtStart: bank.revision,
    answers: [{ exerciseId: "exercise-guided", rating: "good" }],
  }, { learning: explicit });

  assert.equal(summary.schemaVersion, CURRENT_PRACTICE_BANK_SCHEMA_VERSION);
  assert.deepEqual(summary.scope, explicit.scope);
  assert.equal(summary.evidence[0]?.hintsRevealed, 2);
  assert.equal(summary.evidence[0]?.recoveryOutcome, "recovered");
  assert.deepEqual(summary.completedTutorLessons, explicit.completedTutorLessons);
});

test("session construction rejects an inexact set scope before persistence", () => {
  const bank = guidedBank();
  const defaults = defaultSessionLearningMetadataV3(bank, ["exercise-guided"]);
  const finished = {
    id: "session-inexact-scope",
    startedAt: "2026-08-22T09:00:00.000Z",
    finishedAt: "2026-08-22T09:05:00.000Z",
    orderedExerciseIds: ["exercise-guided"],
    exerciseCountAtStart: 1,
    bankRevisionAtStart: bank.revision,
    answers: [{ exerciseId: "exercise-guided", rating: "good" as const }],
  };

  assert.throws(
    () => createSessionSummary(bank, finished, {
      learning: {
        ...defaults,
        scope: {
          mode: "set",
          sets: [
            { id: "set-foundations", title: "Foundations" },
            { id: "set-transfer", title: "Transfer" },
          ],
        },
      },
    }),
    /exactly one scoped practice set/iu,
  );
  assert.throws(
    () => createSessionSummary(bank, finished, {
      learning: {
        ...defaults,
        scope: {
          mode: "mixed",
          sets: [
            { id: "set-foundations", title: "Foundations" },
            { id: "set-transfer", title: "Transfer" },
          ],
        },
      },
    }),
    /every scoped practice set must contribute/iu,
  );
});

test("set regeneration replaces only owned exercises and tutor links", () => {
  const bank = guidedBank();
  const historicalSessions = structuredClone(bank.sessions);
  const replacementExercise = {
    ...structuredClone(bank.exercises[0]!),
    id: "exercise-guided-new",
    title: "New guided check",
  };
  const replacementLesson = {
    ...structuredClone(bank.tutorLessons[0]!),
    id: "lesson-foundations-new",
    guidedExerciseId: replacementExercise.id,
  };
  const replaced = replacePracticeSetContent(bank, "set-foundations", {
    set: {
      ...structuredClone(bank.practiceSets[0]!),
      title: "Foundations revised",
      assignments: [{
        exerciseId: replacementExercise.id,
        aspectIds: ["aspect-foundations"],
        role: "guided-check",
      }],
    },
    exercises: [replacementExercise],
    tutorLessons: [replacementLesson],
  }, "2026-08-22T10:00:00.000Z");

  assert.equal(replaced.revision, bank.revision + 1);
  assert.deepEqual(replaced.sessions, historicalSessions);
  assert.ok(replaced.exercises.some((exercise) => exercise.id === "exercise-transfer"));
  assert.ok(!replaced.exercises.some((exercise) => exercise.id === "exercise-guided"));
  assert.equal(replaced.practiceSets[1]?.title, bank.practiceSets[1]?.title);
  assert.deepEqual(
    replaced.learningPath?.steps.map((step) => step.kind === "lesson" ? step.lessonId : step.setId),
    ["lesson-foundations-new", "set-foundations", "set-transfer"],
  );
  assert.equal(validatePracticeBankV3(replaced).ok, true);
  assert.throws(
    () => replacePracticeSetContent(bank, "set-foundations", {
      set: replaced.practiceSets[0]!,
      exercises: [replacementExercise],
      tutorLessons: [replacementLesson],
    }, "2026-08-22T07:59:00.000Z"),
    /non-decreasing timestamp/iu,
  );
});

test("multi-source bundles allow a bundle hash and enforce supporting ID namespaces", () => {
  const bank = guidedBank();
  const supportingSegment = {
    id: "material-support:seg-1",
    kind: "paragraph" as const,
    ordinal: bank.segments.length,
    headingPath: ["Supporting"],
    text: "Supporting approved evidence.",
  };
  bank.segments.push(supportingSegment);
  bank.source = {
    ...bank.source,
    title: "Learning + 1 supporting source",
    hash: createSourceHash("synthetic-bundle-identity"),
  };
  bank.sourceMaterials.push({
    id: "material-support",
    role: "supporting",
    vaultPath: "Notes/Term/Course/Supporting.md",
    wikilink: "[[Notes/Term/Course/Supporting]]",
    title: "Supporting",
    sourceHash: createSourceHash("Supporting approved evidence."),
    scope: { kind: "note" },
    segmentIds: [supportingSegment.id],
    visualIds: [],
  });

  assert.equal(validatePracticeBankV3(bank).ok, true);
  bank.segments[bank.segments.length - 1] = {
    ...supportingSegment,
    id: "unscoped-segment",
  };
  bank.sourceMaterials[1] = {
    ...bank.sourceMaterials[1]!,
    segmentIds: ["unscoped-segment"],
  };
  const invalid = validatePracticeBankV3(bank);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.issues.some((item) => /namespaced/u.test(item.message)));
});

test("PDF migration embeds the exact approved page range without changing flat content", () => {
  const before = v2Bank();
  before.source = {
    ...before.source,
    vaultPath: "Library/Learning.pdf",
    wikilink: "[[Library/Learning.pdf]]",
    scope: "selection",
  };
  const migrated = migratePracticeBankV2ToV3(before, {
    sourceHash: before.source.hash,
    pdfContentHash: `sha256:${"d".repeat(64)}`,
    firstPage: 12,
    lastPage: 18,
    pageCount: 80,
  });
  assert.deepEqual(migrated.sourceMaterials[0]?.scope, {
    kind: "pdf-pages",
    firstPage: 12,
    lastPage: 18,
    pageCount: 80,
    pdfContentHash: `sha256:${"d".repeat(64)}`,
  });
  assert.deepEqual(migrated.exercises, before.exercises);
  assert.deepEqual(migrated.sessions[0]?.results, before.sessions[0]?.results);
  assert.equal(validatePracticeBankV3(migrated).ok, true);
});
