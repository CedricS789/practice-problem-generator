import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATION_DRAFT_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  type ExerciseV1,
  type GenerationDraftV1,
  type AiReviewStateV2,
  type PracticeBankV2,
} from "../src/model";
import {
  createAiReviewRequest,
  generationDraftV1JsonSchema,
  validateGenerationDraft,
  validatePracticeBank,
} from "../src/schema";
import { createSourceHash } from "../src/segmenter";

const common = {
  title: "Grounded question",
  prompt: "Use the source evidence to answer.",
  difficulty: "hard" as const,
  sourceSegmentIds: ["seg-1"],
};

function allExerciseTypes(): ExerciseV1[] {
  return [
    {
      ...common,
      id: "ex-short",
      type: "short-answer",
      prompt: "State the governing relation.",
      groundedAnswer: "The relation is source-grounded.",
      acceptableAnswers: ["source-grounded relation"],
      keyPoints: ["governing relation"],
    },
    {
      ...common,
      id: "ex-causal",
      type: "causal-explanation",
      prompt: "Explain the causal chain.",
      groundedAnswer: "Cause produces effect through the stated mechanism.",
      keyPoints: ["cause", "mechanism", "effect"],
    },
    {
      ...common,
      id: "ex-application",
      type: "application",
      prompt: "Apply the principle to the scenario.",
      scenario: "A parameter is doubled while the other terms remain fixed.",
      groundedAnswer: "The dependent quantity follows the relation.",
      keyPoints: ["identify fixed terms", "apply relation"],
    },
    {
      ...common,
      id: "ex-calculation",
      type: "calculation",
      prompt: "Calculate the value.",
      groundedAnswer: "The value is 4 V.",
      working: "2 × 2 = 4",
      numericAnswer: 4,
      tolerance: 0.05,
      unit: "V",
    },
    {
      ...common,
      id: "ex-cloze",
      type: "cloze",
      prompt: "Complete the statement.",
      clozeText: "The {{input}} produces the {{output}}.",
      blanks: [
        { id: "input", answers: ["cause"], caseSensitive: false },
        { id: "output", answers: ["effect"], caseSensitive: false },
      ],
      groundedAnswer: "The cause produces the effect.",
    },
    {
      ...common,
      id: "ex-single",
      type: "single-select",
      prompt: "Select the only supported statement.",
      choices: [
        { id: "a", text: "Supported" },
        { id: "b", text: "Unsupported" },
      ],
      correctChoiceIds: ["a"],
      groundedAnswer: "A is explicitly supported.",
    },
    {
      ...common,
      id: "ex-multi",
      type: "multi-select",
      prompt: "Select every supported consequence.",
      choices: [
        { id: "a", text: "First consequence" },
        { id: "b", text: "Second consequence" },
        { id: "c", text: "Distractor" },
      ],
      correctChoiceIds: ["a", "b"],
      groundedAnswer: "A and B follow from the source.",
    },
    {
      ...common,
      id: "ex-match",
      type: "matching",
      prompt: "Match each quantity to its meaning.",
      pairs: [
        { id: "p1", left: "A", right: "Alpha" },
        { id: "p2", left: "B", right: "Beta" },
      ],
      groundedAnswer: "A–Alpha; B–Beta.",
    },
    {
      ...common,
      id: "ex-order",
      type: "ordering",
      prompt: "Order the mechanism.",
      items: [
        { id: "step-1", text: "Cause" },
        { id: "step-2", text: "Mechanism" },
        { id: "step-3", text: "Effect" },
      ],
      correctOrder: ["step-1", "step-2", "step-3"],
      groundedAnswer: "Cause, then mechanism, then effect.",
    },
    {
      ...common,
      id: "ex-occlusion",
      type: "image-occlusion",
      prompt: "Identify the covered label.",
      visualId: "vis-1",
      masks: [
        {
          id: "mask-1",
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.25,
          label: "Node A",
          answer: "Input node",
        },
      ],
      groundedAnswer: "The covered label is the input node.",
    },
  ];
}

function validDraft(): GenerationDraftV1 {
  return {
    schemaVersion: GENERATION_DRAFT_SCHEMA_VERSION,
    exercises: allExerciseTypes(),
  };
}

function validBank(): PracticeBankV2 {
  const createdAt = "2026-08-20T12:00:00.000Z";
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-1",
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    source: {
      vaultPath: "Notes/Term/Course/Source.md",
      wikilink: "[[Notes/Term/Course/Source]]",
      title: "Source",
      scope: "note",
      hash: createSourceHash("Evidence."),
    },
    segments: [
      {
        id: "seg-1",
        kind: "paragraph",
        ordinal: 0,
        headingPath: [],
        text: "Evidence.",
      },
    ],
    visuals: [
      {
        id: "vis-1",
        kind: "image",
        vaultPath: "_Vault/Attachments/diagram.png",
        storage: "source",
        mimeType: "image/png",
        contentHash: createSourceHash("synthetic-pixels"),
        width: 800,
        height: 600,
      },
    ],
    exercises: allExerciseTypes(),
    sessions: [],
  };
}

test("exports a provider-neutral draft-07 schema covering every exercise", () => {
  assert.equal(
    generationDraftV1JsonSchema.$schema,
    "http://json-schema.org/draft-07/schema#",
  );
  assert.equal(
    Object.hasOwn(generationDraftV1JsonSchema, "definitions"),
    false,
    "provider schema must not expose unrelated persisted-bank definitions",
  );
  const result = validateGenerationDraft(validDraft(), {
    segmentIds: ["seg-1"],
    visualIds: ["vis-1"],
  });
  assert.equal(result.ok, true);
});

test("rejects additional fields before trusting generated output", () => {
  const draft = validDraft() as unknown as Record<string, unknown>;
  draft.unrequested = "data";
  const result = validateGenerationDraft(draft, {
    segmentIds: ["seg-1"],
    visualIds: ["vis-1"],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "schema"));
});

test("rejects unknown grounding references and duplicate prompts", () => {
  const draft = validDraft();
  draft.exercises[0] = {
    ...(draft.exercises[0] as Extract<ExerciseV1, { type: "short-answer" }>),
    sourceSegmentIds: ["made-up"],
  };
  draft.exercises[1] = {
    ...(draft.exercises[1] as Extract<ExerciseV1, { type: "causal-explanation" }>),
    type: "causal-explanation",
    prompt: draft.exercises[0]?.prompt ?? "",
  };
  const result = validateGenerationDraft(draft, {
    segmentIds: ["seg-1"],
    visualIds: ["vis-1"],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((issue) => issue.code === "source-reference"));
    assert.ok(result.issues.some((issue) => issue.code === "duplicate"));
  }

  const duplicate = validDraft();
  duplicate.exercises.push({
    ...(duplicate.exercises[0] as Extract<ExerciseV1, { type: "short-answer" }>),
    id: "ex-short-copy",
  });
  const duplicateResult = validateGenerationDraft(duplicate, {
    segmentIds: ["seg-1"],
    visualIds: ["vis-1"],
  });
  assert.equal(duplicateResult.ok, false);
  if (!duplicateResult.ok) {
    assert.ok(duplicateResult.issues.some((issue) => issue.code === "duplicate"));
  }
});

test("rejects malformed choices, cloze placeholders, calculations, and ordering", () => {
  const draft = validDraft();
  const calculation = draft.exercises[3] as Extract<ExerciseV1, { type: "calculation" }>;
  calculation.unit = " ";
  const cloze = draft.exercises[4] as Extract<ExerciseV1, { type: "cloze" }>;
  cloze.clozeText = "Only {{input}} appears.";
  const single = draft.exercises[5] as Extract<ExerciseV1, { type: "single-select" }>;
  single.correctChoiceIds = ["missing"];
  const ordering = draft.exercises[8] as Extract<ExerciseV1, { type: "ordering" }>;
  ordering.correctOrder = ["step-1", "step-2"];

  const result = validateGenerationDraft(draft, {
    segmentIds: ["seg-1"],
    visualIds: ["vis-1"],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    const codes = new Set(result.issues.map((issue) => issue.code));
    assert.ok(codes.has("calculation"));
    assert.ok(codes.has("cloze"));
    assert.ok(codes.has("choice"));
    assert.ok(codes.has("ordering"));
  }
});

test("rejects repeated multi-select correct-choice IDs", () => {
  const draft = validDraft();
  const multi = draft.exercises.find(
    (exercise): exercise is Extract<ExerciseV1, { type: "multi-select" }> =>
      exercise.type === "multi-select",
  );
  assert.ok(multi);
  multi.correctChoiceIds = ["a", "a"];

  const result = validateGenerationDraft(draft, {
    segmentIds: ["seg-1"],
    visualIds: ["vis-1"],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.code === "choice" &&
          issue.path.endsWith("/correctChoiceIds") &&
          issue.message.includes("unique"),
      ),
    );
  }
});

test("rejects unknown visual references and out-of-bounds masks", () => {
  const draft = validDraft();
  const occlusion = draft.exercises.at(-1) as Extract<
    ExerciseV1,
    { type: "image-occlusion" }
  >;
  occlusion.visualId = "invented-visual";
  if (occlusion.masks[0] !== undefined) {
    occlusion.masks[0].x = 0.9;
    occlusion.masks[0].width = 0.2;
  }
  const result = validateGenerationDraft(draft, {
    segmentIds: ["seg-1"],
    visualIds: ["vis-1"],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((issue) => issue.code === "visual-reference"));
    assert.ok(result.issues.some((issue) => issue.code === "mask"));
  }
});

test("validates full banks and durable visual invariants", () => {
  assert.equal(validatePracticeBank(validBank()).ok, true);
  const bank = validBank();
  bank.visuals[0] = {
    ...(bank.visuals[0] as NonNullable<(typeof bank.visuals)[number]>),
    kind: "remote-snapshot",
    storage: "source",
  };
  const result = validatePracticeBank(bank);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "visual"));
});

test("persists extended reasoning effort and explicit GIF frame position", () => {
  const bank = validBank();
  bank.generation = {
    provider: "codex",
    generatedAt: "2026-08-20T12:00:00.000Z",
    promptVersion: "practice-lab-v1",
    reasoningEffort: "ultra",
  };
  bank.visuals[0] = {
    ...(bank.visuals[0] as NonNullable<(typeof bank.visuals)[number]>),
    kind: "gif-frame",
    vaultPath: "_Vault/Attachments/Grounded Problems/frame.png",
    storage: "practice-snapshot",
    frameTimeSeconds: 0.6,
    framePosition: "middle",
  };
  assert.equal(validatePracticeBank(bank).ok, true);

  const invalid = validBank();
  invalid.visuals[0] = {
    ...(invalid.visuals[0] as NonNullable<(typeof invalid.visuals)[number]>),
    framePosition: "first",
  };
  const result = validatePracticeBank(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((issue) => issue.path.endsWith("/framePosition")));
  }
});

test("keeps legacy Practice Lab snapshot paths readable after the public rename", () => {
  const bank = validBank();
  bank.visuals[0] = {
    ...(bank.visuals[0] as NonNullable<(typeof bank.visuals)[number]>),
    kind: "gif-frame",
    vaultPath: "_Vault/Attachments/Practice Lab/frame.png",
    storage: "practice-snapshot",
    frameTimeSeconds: 0.6,
    framePosition: "middle",
  };
  assert.equal(validatePracticeBank(bank).ok, true);
});

test("session scores and ratings must match item results", () => {
  const bank = validBank();
  bank.revision = 1;
  bank.sessions.push({
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    id: "session-1",
    startedAt: "2026-08-20T12:01:00.000Z",
    finishedAt: "2026-08-20T12:02:00.000Z",
    bankRevisionAtStart: 0,
    exerciseCount: 2,
    completedCount: 2,
    score: { correct: 0, total: 1 },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    results: [
      { exerciseId: "ex-single", grading: "objective", correct: true },
      { exerciseId: "ex-short", grading: "self-rated", rating: "good" },
    ],
  });
  const result = validatePracticeBank(bank);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.filter((issue) => issue.code === "session").length >= 2);
  }
});

test("validates pending, reviewed, and failed AI-review states without treating them as self-ratings", () => {
  const states: AiReviewStateV2[] = [
    { status: "pending", queuedAt: "2026-08-20T12:01:10.000Z", attempts: 0 },
    {
      status: "reviewed",
      reviewedAt: "2026-08-20T12:03:00.000Z",
      attempts: 1,
      verdict: "partial",
      feedback: "The governing relation is present but incomplete.",
      criteria: [{
        criterion: "governing-relation",
        outcome: "partial",
        feedback: "State the dependent term explicitly.",
        sourceSegmentIds: ["seg-1"],
      }],
    },
    {
      status: "failed",
      failedAt: "2026-08-20T12:03:00.000Z",
      attempts: 1,
      error: {
        code: "timeout",
        message: "The review timed out.",
        retryable: true,
      },
    },
  ];

  for (const state of states) {
    const bank = validBank();
    bank.revision = 1;
    const request = createAiReviewRequest({
      requestId: `review-${state.status}`,
      sessionId: `session-${state.status}`,
      exerciseId: "ex-short",
      provider: "codex",
      reasoningEffort: "high",
      promptVersion: "answer-review-v1",
      requestedAt: "2026-08-20T12:01:00.000Z",
      submittedAnswer: "The source contains a governing relation.",
      context: {
        exerciseTitle: "Grounded question",
        exerciseType: "short-answer",
        prompt: "State the governing relation.",
        groundedAnswer: "The relation is source-grounded.",
        keyPoints: ["governing relation"],
        sourceSegments: [{ id: "seg-1", headingPath: [], text: "Evidence." }],
      },
    });
    bank.sessions.push({
      schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
      id: `session-${state.status}`,
      startedAt: "2026-08-20T12:00:30.000Z",
      finishedAt: "2026-08-20T12:02:00.000Z",
      bankRevisionAtStart: 0,
      exerciseCount: 1,
      completedCount: 1,
      score: { correct: 0, total: 0 },
      ratings: { again: 0, hard: 0, good: 0, easy: 0 },
      results: [{ exerciseId: "ex-short", grading: "ai-review", request, state }],
    });
    assert.equal(validatePracticeBank(bank).ok, true, state.status);
  }
});

test("AI review request IDs are unique across every session in a bank", () => {
  const bank = validBank();
  bank.revision = 2;
  for (const [index, sessionId] of ["session-first", "session-second"].entries()) {
    const requestedAt = `2026-08-20T12:0${index + 1}:00.000Z`;
    const request = createAiReviewRequest({
      requestId: "review-bank-global",
      sessionId,
      exerciseId: "ex-short",
      provider: "codex",
      reasoningEffort: "high",
      promptVersion: "answer-review-v1",
      requestedAt,
      submittedAnswer: "The source contains a governing relation.",
      context: {
        exerciseTitle: "Grounded question",
        exerciseType: "short-answer",
        prompt: "State the governing relation.",
        groundedAnswer: "The relation is source-grounded.",
        keyPoints: ["governing relation"],
        sourceSegments: [{ id: "seg-1", headingPath: [], text: "Evidence." }],
      },
    });
    bank.sessions.push({
      schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
      id: sessionId,
      startedAt: "2026-08-20T12:00:00.000Z",
      finishedAt: "2026-08-20T12:05:00.000Z",
      bankRevisionAtStart: index,
      exerciseCount: 1,
      completedCount: 1,
      score: { correct: 0, total: 0 },
      ratings: { again: 0, hard: 0, good: 0, easy: 0 },
      results: [{
        exerciseId: "ex-short",
        grading: "ai-review",
        request,
        state: { status: "pending", queuedAt: requestedAt, attempts: 0 },
      }],
    });
  }

  const validation = validatePracticeBank(bank);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.issues.some((issue) =>
      issue.path === "/sessions" && issue.message.includes("across the practice bank"),
    ));
  }
});

test("rejects a changed AI-review snapshot and evidence outside its locked context", () => {
  const bank = validBank();
  bank.revision = 1;
  const request = createAiReviewRequest({
    requestId: "review-tampered",
    sessionId: "session-tampered",
    exerciseId: "ex-short",
    provider: "claude",
    reasoningEffort: "medium",
    promptVersion: "answer-review-v1",
    requestedAt: "2026-08-20T12:01:00.000Z",
    submittedAnswer: "Original answer.",
    context: {
      exerciseTitle: "Grounded question",
      exerciseType: "short-answer",
      prompt: "State the governing relation.",
      groundedAnswer: "The relation is source-grounded.",
      keyPoints: ["governing relation"],
      sourceSegments: [{ id: "seg-1", headingPath: [], text: "Evidence." }],
    },
  });
  request.submittedAnswer = "Changed after hashing.";
  bank.sessions.push({
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    id: "session-tampered",
    startedAt: "2026-08-20T12:00:30.000Z",
    finishedAt: "2026-08-20T12:02:00.000Z",
    bankRevisionAtStart: 0,
    exerciseCount: 1,
    completedCount: 1,
    score: { correct: 0, total: 0 },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    results: [{
      exerciseId: "ex-short",
      grading: "ai-review",
      request,
      state: {
        status: "reviewed",
        reviewedAt: "2026-08-20T12:03:00.000Z",
        attempts: 1,
        verdict: "correct",
        feedback: "Correct.",
        criteria: [{
          criterion: "governing-relation",
          outcome: "met",
          feedback: "Covered.",
          sourceSegmentIds: ["outside-context"],
        }],
      },
    }],
  });
  const validation = validatePracticeBank(bank);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.issues.some((issue) => issue.message.includes("requestHash")));
    assert.ok(validation.issues.some((issue) => issue.message.includes("locked context")));
  }
});
