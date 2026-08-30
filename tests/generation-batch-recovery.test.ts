import assert from "node:assert/strict";
import test from "node:test";

import { balanceExerciseTypes } from "../src/exercise-distribution";
import {
  completeGenerationBatchSet,
  completedUnsavedBatchDrafts,
  createGenerationBatchRecovery,
  failGenerationBatchSet,
  generationBatchIsFinished,
  markGenerationBatchSetSaved,
  nextGenerationBatchSet,
  parseGenerationBatchRecovery,
  retryGenerationBatchSet,
  saveGenerationBatchReviewSnapshot,
  serializeGenerationBatchRecovery,
  skipGenerationBatchSet,
  startGenerationBatchSet,
} from "../src/generation-batch-recovery";
import {
  createPracticeSetPayloads,
  type LearningBlueprintDraftV1,
  type LearningBlueprintPlanningInputV1,
  type PracticeSetDraftV1,
} from "../src/learning-path-generation";
import type { DurableProcessHandle } from "../src/cli/contracts";
import type { GenerationConfiguration } from "../src/ui/contracts";

const planningInput: LearningBlueprintPlanningInputV1 = {
  startingLevel: "exam-review",
  desiredSetCount: 2,
  globalFocusInstructions: "Keep the two sets distinct.",
  aiContextCompletionPolicy: "selected-sources-only",
  sources: [
    {
      id: "primary",
      role: "primary",
      title: "Synthetic source",
      mode: "selection",
      scope: "explicit selection only",
      hash: `sha256:${"c".repeat(64)}`,
      segments: [
        {
          id: "seg-one",
          kind: "paragraph",
          ordinal: 0,
          headingPath: ["Topic"],
          text: "Alpha causes beta under the submitted condition.",
        },
      ],
      visuals: [],
    },
  ],
};

const blueprint: LearningBlueprintDraftV1 = {
  schemaVersion: 1,
  blueprintId: "blueprint-recovery",
  title: "Recovery path",
  overview: "Two independently recoverable sets.",
  aspects: [
    {
      id: "aspect-one",
      title: "Causal relation",
      purpose: "Explain the submitted causal relation.",
      status: "supported",
      prerequisiteAspectIds: [],
      sourceSegmentIds: ["seg-one"],
    },
  ],
  tutorLessonBriefs: [],
  sets: [
    {
      id: "set-one",
      title: "First set",
      purpose: "First distinct retrieval set.",
      instructionalRole: "foundations",
      order: 0,
      aspectIds: ["aspect-one"],
      tutorLessonBriefIds: [],
      recommendedQuantity: 1,
      recommendedDifficulty: "foundational",
    },
    {
      id: "set-two",
      title: "Second set",
      purpose: "Second distinct transfer set.",
      instructionalRole: "independent-transfer",
      order: 1,
      aspectIds: ["aspect-one"],
      tutorLessonBriefIds: [],
      recommendedQuantity: 1,
      recommendedDifficulty: "challenge",
    },
  ],
};

const configuration: GenerationConfiguration = {
  provider: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "ultra",
  focusInstructions: "Use the exact set purpose.",
  quantity: 1,
  difficulty: "deep-exam",
  exerciseTypes: ["short-answer"],
  exerciseTypePercentages: balanceExerciseTypes(["short-answer"]),
  selectedVisualIds: [],
  aiContextCompletionPolicy: "selected-sources-only",
};

const payloads = createPracticeSetPayloads({
  batchId: "batch-recovery",
  planningInput,
  blueprint,
  setConfigurations: blueprint.sets.map((set) => ({
    setId: set.id,
    configuration,
  })),
});

function draft(setId: string): PracticeSetDraftV1 {
  const exerciseId = `${setId}-exercise`;
  return {
    schemaVersion: 1,
    setId,
    exercises: [
      {
        id: exerciseId,
        type: "short-answer",
        title: `Question for ${setId}`,
        prompt: `Explain the relation for ${setId}.`,
        difficulty: "medium",
        sourceSegmentIds: ["seg-one"],
        groundedAnswer: "Alpha causes beta under the submitted condition.",
        acceptableAnswers: ["Alpha causes beta"],
        keyPoints: ["Alpha", "beta", "condition"],
      },
    ],
    assignments: [
      { exerciseId, aspectIds: ["aspect-one"], role: "independent" },
    ],
    tutorLessons: [],
  };
}

function handle(index: number): DurableProcessHandle {
  return {
    version: 1,
    jobId: `generation-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    workspacePath: `C:\\Temp\\practice-lab-job-${index}`,
    startedAt: `2026-08-22T10:0${index}:00.000Z`,
  };
}

test("batch recovery round-trips exact approved payloads and hashes", () => {
  const state = createGenerationBatchRecovery({
    batchId: "batch-recovery",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads,
  });
  assert.deepEqual(parseGenerationBatchRecovery(serializeGenerationBatchRecovery(state)), state);
  assert.equal(state.queuePosition, 0);
  assert.deepEqual(state.queue.map((entry) => entry.status), ["queued", "queued"]);
  assert.equal(state.approvedPayloads[0]!.payload.targetSet.id, "set-one");
  assert.match(state.approvedPayloads[0]!.payloadHash, /^sha256:[a-f0-9]{64}$/u);

  const approvedPayloads = createPracticeSetPayloads({
    batchId: "batch-approved-context",
    planningInput: {
      ...planningInput,
      aiContextCompletionPolicy: "approved-general-context",
    },
    blueprint,
    setConfigurations: blueprint.sets.map((set) => ({
      setId: set.id,
      configuration: {
        ...configuration,
        aiContextCompletionPolicy: "approved-general-context",
      },
    })),
  });
  const approved = createGenerationBatchRecovery({
    batchId: "batch-approved-context",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads: approvedPayloads,
  });
  assert.notEqual(approved.sourceBundleHash, state.sourceBundleHash);
});

test("batch helpers enforce one active job and exact sequential order", () => {
  const initial = createGenerationBatchRecovery({
    batchId: "batch-recovery",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads,
  });
  assert.equal(nextGenerationBatchSet(initial)?.setId, "set-one");
  assert.throws(
    () => startGenerationBatchSet(
      initial,
      "set-two",
      handle(1),
      "2026-08-22T10:01:00.000Z",
    ),
    /sequential order/iu,
  );
  const running = startGenerationBatchSet(
    initial,
    "set-one",
    handle(1),
    "2026-08-22T10:01:00.000Z",
  );
  assert.equal(running.active?.setId, "set-one");
  assert.equal(running.queue[0]!.status, "running");
  assert.throws(
    () => startGenerationBatchSet(
      running,
      "set-one",
      handle(2),
      "2026-08-22T10:02:00.000Z",
    ),
    /already active/iu,
  );
});

test("completed drafts survive later failure, retry, save, and final completion", () => {
  let state = createGenerationBatchRecovery({
    batchId: "batch-recovery",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads,
  });
  state = startGenerationBatchSet(
    state,
    "set-one",
    handle(1),
    "2026-08-22T10:01:00.000Z",
  );
  state = completeGenerationBatchSet(state, {
    setId: "set-one",
    draft: draft("set-one"),
    attempts: 1,
    telemetry: {
      schemaVersion: 1,
      durationMs: 4_500,
      attempts: 1,
      tokenUsage: {
        inputTokens: 800,
        outputTokens: 160,
        source: "provider-reported",
        inputEstimateExcludesMedia: false,
      },
      reportedCostUsd: 0.02,
    },
    completedAt: "2026-08-22T10:02:00.000Z",
  });
  assert.equal(nextGenerationBatchSet(state)?.setId, "set-two");
  assert.equal(completedUnsavedBatchDrafts(state).length, 1);

  state = startGenerationBatchSet(
    state,
    "set-two",
    handle(2),
    "2026-08-22T10:03:00.000Z",
  );
  state = failGenerationBatchSet(state, {
    setId: "set-two",
    message: "Synthetic provider interruption",
    failedAt: "2026-08-22T10:04:00.000Z",
  });
  assert.equal(state.completedDrafts[0]!.setId, "set-one");
  assert.equal(state.completedDrafts[0]!.telemetry?.reportedCostUsd, 0.02);
  assert.equal(state.queue[1]!.status, "failed");
  state = retryGenerationBatchSet(state, "set-two", "2026-08-22T10:05:00.000Z");
  state = startGenerationBatchSet(
    state,
    "set-two",
    handle(3),
    "2026-08-22T10:06:00.000Z",
  );
  state = completeGenerationBatchSet(state, {
    setId: "set-two",
    draft: draft("set-two"),
    attempts: 2,
    completedAt: "2026-08-22T10:07:00.000Z",
  });
  assert.equal(generationBatchIsFinished(state), true);
  assert.equal(completedUnsavedBatchDrafts(state).length, 2);
  state = markGenerationBatchSetSaved(
    state,
    "set-one",
    "2026-08-22T10:08:00.000Z",
  );
  assert.deepEqual(completedUnsavedBatchDrafts(state).map((item) => item.setId), ["set-two"]);
});

test("failed sets may be skipped without discarding prior completed work", () => {
  let state = createGenerationBatchRecovery({
    batchId: "batch-recovery",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads,
  });
  state = skipGenerationBatchSet(
    state,
    "set-one",
    "2026-08-22T10:01:00.000Z",
  );
  assert.equal(state.queue[0]!.status, "cancelled");
  assert.equal(nextGenerationBatchSet(state)?.setId, "set-two");
});

test("review snapshots reopen with exact edits, rejections, acceptance, and approvals", () => {
  let state = createGenerationBatchRecovery({
    batchId: "batch-recovery",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads,
  });
  state = startGenerationBatchSet(state, "set-one", handle(1), "2026-08-22T10:01:00.000Z");
  state = completeGenerationBatchSet(state, {
    setId: "set-one",
    draft: draft("set-one"),
    attempts: 1,
    completedAt: "2026-08-22T10:02:00.000Z",
  });
  state = startGenerationBatchSet(state, "set-two", handle(2), "2026-08-22T10:03:00.000Z");
  state = completeGenerationBatchSet(state, {
    setId: "set-two",
    draft: draft("set-two"),
    attempts: 1,
    completedAt: "2026-08-22T10:04:00.000Z",
  });
  const firstPayloadHash = state.completedDrafts[0]!.payloadHash;
  const secondPayloadHash = state.completedDrafts[1]!.payloadHash;
  state = saveGenerationBatchReviewSnapshot(state, {
    setId: "set-one",
    payloadHash: firstPayloadHash,
    updatedAt: "2026-08-22T10:05:00.000Z",
    exercises: [{
      id: "set-one-exercise",
      type: "short-answer",
      prompt: "A partially edited prompt",
      groundedAnswer: "A partially edited answer",
      rejected: true,
      occlusionReviewed: true,
    }],
    approvedExerciseIds: [],
  });
  state = saveGenerationBatchReviewSnapshot(state, {
    setId: "set-two",
    payloadHash: secondPayloadHash,
    updatedAt: "2026-08-22T10:06:00.000Z",
    exercises: [{
      id: "set-two-exercise",
      type: "short-answer",
      prompt: "An approved edited prompt",
      groundedAnswer: "An approved edited answer",
      rejected: false,
      occlusionReviewed: true,
    }],
    approvedExerciseIds: ["set-two-exercise"],
  });

  const serialized = serializeGenerationBatchRecovery(state);
  const reopened = parseGenerationBatchRecovery(serialized);
  assert.deepEqual(reopened.reviewSnapshots, state.reviewSnapshots);
  assert.equal(reopened.reviewSnapshots?.[0]?.exercises[0]?.rejected, true);
  assert.equal(reopened.reviewSnapshots?.[1]?.exercises[0]?.prompt, "An approved edited prompt");
  assert.deepEqual(reopened.reviewSnapshots?.[1]?.approvedExerciseIds, ["set-two-exercise"]);
  assert.doesNotMatch(serialized, /visualUrl/u);
});

test("a cross-set collision leaves the active set fail-able and retryable", () => {
  let state = createGenerationBatchRecovery({
    batchId: "batch-recovery",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads,
  });
  state = startGenerationBatchSet(state, "set-one", handle(1), "2026-08-22T10:01:00.000Z");
  state = completeGenerationBatchSet(state, {
    setId: "set-one",
    draft: draft("set-one"),
    attempts: 1,
    completedAt: "2026-08-22T10:02:00.000Z",
  });
  state = startGenerationBatchSet(state, "set-two", handle(2), "2026-08-22T10:03:00.000Z");
  const colliding = structuredClone(draft("set-two"));
  colliding.exercises[0]!.prompt = draft("set-one").exercises[0]!.prompt;
  assert.throws(
    () => completeGenerationBatchSet(state, {
      setId: "set-two",
      draft: colliding,
      attempts: 1,
      completedAt: "2026-08-22T10:04:00.000Z",
    }),
    /prompt is duplicated/iu,
  );
  assert.equal(state.queue[1]?.status, "running");
  state = failGenerationBatchSet(state, {
    setId: "set-two",
    message: "Cross-set validation failed.",
    failedAt: "2026-08-22T10:04:00.000Z",
  });
  assert.equal(state.queue[1]?.status, "failed");
  assert.doesNotThrow(() => retryGenerationBatchSet(
    state,
    "set-two",
    "2026-08-22T10:05:00.000Z",
  ));
});

test("recovery parsing rejects payload tampering and missing durable handles", () => {
  const state = createGenerationBatchRecovery({
    batchId: "batch-recovery",
    blueprintId: "blueprint-recovery",
    createdAt: "2026-08-22T10:00:00.000Z",
    payloads,
  });
  const tampered = {
    ...state,
    approvedPayloads: state.approvedPayloads.map((approved, index) => index === 0
      ? { ...approved, payloadHash: `sha256:${"0".repeat(64)}` }
      : approved),
  };
  assert.throws(
    () => parseGenerationBatchRecovery(JSON.stringify(tampered)),
    /no longer matches its hash|queue entry/iu,
  );

  const running = startGenerationBatchSet(
    state,
    "set-one",
    handle(1),
    "2026-08-22T10:01:00.000Z",
  );
  const missingHandle = structuredClone(running) as { active?: unknown };
  delete missingHandle.active;
  assert.throws(
    () => parseGenerationBatchRecovery(JSON.stringify(missingHandle)),
    /missing its durable provider handle/iu,
  );
});
