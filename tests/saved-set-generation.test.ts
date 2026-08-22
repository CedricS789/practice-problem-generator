import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { balanceExerciseTypes } from "../src/exercise-distribution";
import {
  PRACTICE_SET_DRAFT_VERSION,
  createPracticeSetPayload,
  validatePracticeSetReplacement,
  type PracticeSetDraftV1,
} from "../src/learning-path-generation";
import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  type AiReviewSessionItemResultV2,
  type ExerciseV1,
  type PracticeBankV3,
  type SessionExerciseEvidenceV3,
  type SessionSummaryV3,
} from "../src/model";
import {
  createSavedSetPayloadContext,
  deriveRepairSetSeed,
  repairFocusInstructions,
} from "../src/saved-set-generation";
import type { GenerationRecipeCatalogV1 } from "../src/regeneration";
import type {
  FinishedStudySession,
  GenerationConfiguration,
} from "../src/ui/contracts";

const PRIMARY_HASH = `sha256:${"a".repeat(64)}`;
const SUPPORT_HASH = `sha256:${"b".repeat(64)}`;

function shortAnswer(
  id: string,
  title: string,
  prompt: string,
  segmentId: string,
): ExerciseV1 {
  return {
    id,
    type: "short-answer",
    title,
    prompt,
    difficulty: "medium",
    sourceSegmentIds: [segmentId],
    groundedAnswer: "The approved source states the supported relation.",
    acceptableAnswers: ["supported relation"],
    keyPoints: ["Use only the approved relation"],
  };
}

function workspace(): PracticeBankV3 {
  const primaryExercise = shortAnswer(
    "exercise-foundation",
    "Foundation relation",
    "Explain the primary supported relation.",
    "seg-primary",
  );
  const siblingExercise = shortAnswer(
    "exercise-transfer",
    "Transfer relation",
    "Apply the supporting relation to the transfer case.",
    "material-support:seg-transfer",
  );
  return {
    schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-saved-set",
    revision: 4,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T09:00:00.000Z",
    source: {
      vaultPath: "Notes/Synthetic.md",
      wikilink: "[[Notes/Synthetic]]",
      title: "Synthetic",
      scope: "note",
      hash: PRIMARY_HASH,
    },
    segments: [{
      id: "seg-primary",
      kind: "paragraph",
      ordinal: 0,
      headingPath: ["Foundation"],
      text: "A wider region lowers the supported quantity.",
    }, {
      id: "material-support:seg-transfer",
      kind: "paragraph",
      ordinal: 1,
      headingPath: ["Transfer"],
      text: "The lower quantity changes the transfer response.",
    }],
    visuals: [],
    exercises: [primaryExercise, siblingExercise],
    sessions: [],
    sourceMaterials: [{
      id: "material-primary",
      role: "primary",
      vaultPath: "Notes/Synthetic.md",
      wikilink: "[[Notes/Synthetic]]",
      title: "Synthetic primary",
      sourceHash: PRIMARY_HASH,
      scope: { kind: "note" },
      segmentIds: ["seg-primary"],
      visualIds: [],
    }, {
      id: "material-support",
      role: "supporting",
      vaultPath: "Sources/Synthetic.pdf",
      wikilink: "[[Sources/Synthetic.pdf]]",
      title: "Synthetic support",
      sourceHash: SUPPORT_HASH,
      scope: {
        kind: "pdf-pages",
        firstPage: 3,
        lastPage: 4,
        pageCount: 12,
        pdfContentHash: `sha256:${"c".repeat(64)}`,
      },
      segmentIds: ["material-support:seg-transfer"],
      visualIds: [],
    }],
    aspects: [{
      id: "aspect-foundation",
      title: "Foundation",
      purpose: "Explain the primary relation.",
      prerequisiteAspectIds: [],
      sourceSegmentIds: ["seg-primary"],
      status: "supported",
    }, {
      id: "aspect-transfer",
      title: "Transfer",
      purpose: "Apply the supported consequence.",
      prerequisiteAspectIds: ["aspect-foundation"],
      sourceSegmentIds: ["material-support:seg-transfer"],
      status: "supported",
    }],
    practiceSets: [{
      id: "set-foundation",
      title: "Foundations",
      purpose: "Establish the exact primary relation.",
      instructionalRole: "foundations",
      order: 0,
      assignments: [{
        exerciseId: primaryExercise.id,
        aspectIds: ["aspect-foundation"],
        role: "independent",
      }],
    }, {
      id: "set-transfer",
      title: "Transfer",
      purpose: "Use the relation in a distinct transfer task.",
      instructionalRole: "independent-transfer",
      order: 1,
      assignments: [{
        exerciseId: siblingExercise.id,
        aspectIds: ["aspect-transfer"],
        role: "transfer",
      }],
    }],
    tutorLessons: [],
    learningPath: {
      id: "path-synthetic",
      title: "Synthetic path",
      startingLevel: "new-to-topic",
      aspectIds: ["aspect-foundation", "aspect-transfer"],
      steps: [{ kind: "practice-set", setId: "set-foundation", order: 0 }, {
        kind: "practice-set",
        setId: "set-transfer",
        order: 1,
      }],
    },
  };
}

function configuration(): GenerationConfiguration {
  return {
    provider: "codex",
    model: "target-model",
    reasoningEffort: "xhigh",
    focusInstructions: "TARGET_ONLY_FOCUS",
    quantity: 1,
    difficulty: "deep-exam",
    exerciseTypes: ["short-answer"],
    exerciseTypePercentages: balanceExerciseTypes(["short-answer"]),
    selectedVisualIds: [],
  };
}

function recipeCatalog(): GenerationRecipeCatalogV1 {
  return {
    schemaVersion: 1,
    recipesBySetId: {
      "set-foundation": {
        schemaVersion: 2,
        sourceHash: PRIMARY_HASH,
        provider: "claude",
        model: "SIBLING_PRIVATE_MODEL",
        reasoningEffort: "high",
        quantity: 1,
        difficulty: "foundational",
        focusInstructions: "SIBLING_PRIVATE_FOCUS",
        exerciseTypePercentages: balanceExerciseTypes(["short-answer"]),
      },
      "set-transfer": {
        schemaVersion: 2,
        sourceHash: PRIMARY_HASH,
        provider: "agy",
        model: "SIBLING_TRANSFER_MODEL",
        reasoningEffort: "medium",
        quantity: 1,
        difficulty: "challenge",
        focusInstructions: "SIBLING_TRANSFER_FOCUS",
        exerciseTypePercentages: balanceExerciseTypes(["short-answer"]),
      },
    },
  };
}

function replacementDraft(
  id = "exercise-foundation-new",
  prompt = "Explain a fresh version of the primary relation.",
): PracticeSetDraftV1 {
  return {
    schemaVersion: PRACTICE_SET_DRAFT_VERSION,
    setId: "set-foundation",
    exercises: [shortAnswer(id, "Fresh foundation", prompt, "seg-primary")],
    assignments: [{
      exerciseId: id,
      aspectIds: ["aspect-foundation"],
      role: "independent",
    }],
    tutorLessons: [],
  };
}

test("set-only payload retains complete source and sibling context but only the target configuration", () => {
  const bank = workspace();
  const targetSet = bank.practiceSets[0];
  assert.ok(targetSet);
  const context = createSavedSetPayloadContext({
    bank,
    targetSet,
    configuration: configuration(),
    recipeCatalog: recipeCatalog(),
    batchId: "saved-set-batch",
  });

  assert.deepEqual(context.payload.sources.map((source) => source.id), [
    "material-primary",
    "material-support",
  ]);
  assert.deepEqual(
    context.payload.sources.flatMap((source) => source.segments.map((segment) => segment.id)),
    ["seg-primary", "material-support:seg-transfer"],
  );
  assert.deepEqual(context.payload.aspects.map((aspect) => aspect.id), [
    "aspect-foundation",
    "aspect-transfer",
  ]);
  assert.deepEqual(context.payload.siblingSets.map((set) => set.id), [
    "set-foundation",
    "set-transfer",
  ]);
  assert.deepEqual(context.payload.configuration, configuration());
  assert.deepEqual(context.siblingDrafts.map((draft) => draft.setId), ["set-transfer"]);
  assert.equal(context.siblingDrafts[0]?.exercises[0]?.id, "exercise-transfer");

  const serialized = JSON.stringify(context.payload);
  assert.match(serialized, /TARGET_ONLY_FOCUS/u);
  assert.doesNotMatch(serialized, /SIBLING_PRIVATE_MODEL|SIBLING_PRIVATE_FOCUS|SIBLING_TRANSFER_MODEL|SIBLING_TRANSFER_FOCUS/u);
  assert.ok(context.payload.siblingSets.every((set) => !("configuration" in set)));

  const rebuilt = createPracticeSetPayload({
    batchId: context.payload.batchId,
    planningInput: context.planningInput,
    blueprint: context.blueprint,
    targetSetId: targetSet.id,
    configuration: configuration(),
  });
  assert.deepEqual(rebuilt, context.payload);
});

test("replacement validation rejects exercise ID and normalized prompt collisions with untouched siblings", () => {
  const bank = workspace();
  const targetSet = bank.practiceSets[0];
  assert.ok(targetSet);
  const context = createSavedSetPayloadContext({
    bank,
    targetSet,
    configuration: configuration(),
    batchId: "replacement-batch",
  });
  const valid = validatePracticeSetReplacement({
    payload: context.payload,
    replacement: replacementDraft(),
    siblingDrafts: context.siblingDrafts,
  });
  assert.equal(valid.valid, true, valid.errors?.join("; "));

  const siblingExercise = context.siblingDrafts[0]?.exercises[0];
  assert.ok(siblingExercise);
  const duplicateId = validatePracticeSetReplacement({
    payload: context.payload,
    replacement: replacementDraft(siblingExercise.id),
    siblingDrafts: context.siblingDrafts,
  });
  assert.equal(duplicateId.valid, false);
  assert.match(duplicateId.errors?.join(" ") ?? "", /Exercise ID .* duplicated across/iu);

  const duplicatePrompt = validatePracticeSetReplacement({
    payload: context.payload,
    replacement: replacementDraft(
      "exercise-distinct-id",
      `  ${siblingExercise.prompt.toUpperCase()}  `,
    ),
    siblingDrafts: context.siblingDrafts,
  });
  assert.equal(duplicatePrompt.valid, false);
  assert.match(duplicatePrompt.errors?.join(" ") ?? "", /prompt is duplicated across/iu);
});

function evidence(
  exerciseId: string,
  independent: boolean,
  recoveryOutcome: SessionExerciseEvidenceV3["recoveryOutcome"] = "not-needed",
): SessionExerciseEvidenceV3 {
  return {
    exerciseId,
    set: { id: "set-foundation", title: "Foundations" },
    aspects: [{ id: "aspect-foundation", title: "Foundation" }],
    instructionalRole: independent ? "independent" : "guided-check",
    independent,
    hintsRevealed: recoveryOutcome === "not-needed" ? 0 : 2,
    retries: recoveryOutcome === "not-needed" ? 0 : 1,
    recoveryOutcome,
  };
}

function reviewedAiResult(
  exerciseId: string,
  verdict: "incorrect" | "partial" | "correct",
  feedback: string,
): AiReviewSessionItemResultV2 {
  return {
    exerciseId,
    grading: "ai-review",
    request: {
      requestId: `request-${exerciseId}`,
      requestHash: `sha256:${"d".repeat(64)}`,
      sessionId: "session-repair",
      exerciseId,
      provider: "codex",
      reasoningEffort: "high",
      promptVersion: "synthetic-v1",
      requestedAt: "2026-08-22T09:01:00.000Z",
      submittedAnswer: "PRIVATE_AI_REQUEST_ANSWER",
      context: {
        exerciseTitle: "AI-reviewed outcome",
        exerciseType: "short-answer",
        prompt: "Explain the approved relation.",
        groundedAnswer: "Approved relation.",
        keyPoints: ["Approved relation"],
        sourceSegments: [{
          id: "seg-primary",
          headingPath: ["Foundation"],
          text: "A wider region lowers the supported quantity.",
        }],
      },
    },
    state: {
      status: "reviewed",
      reviewedAt: "2026-08-22T09:02:00.000Z",
      attempts: 1,
      verdict,
      feedback,
      criteria: [],
    },
  };
}

function repairSession(): {
  readonly bank: PracticeBankV3;
  readonly session: SessionSummaryV3;
  readonly finished: FinishedStudySession;
} {
  const bank = workspace();
  const repairExercises = [
    shortAnswer("repair-incorrect", "Incorrect outcome", "Incorrect prompt.", "seg-primary"),
    shortAnswer("repair-partial", "Partial outcome", "Partial prompt.", "seg-primary"),
    shortAnswer("repair-guided", "Guided outcome", "Guided prompt.", "seg-primary"),
    shortAnswer("repair-correct", "Correct outcome", "Correct prompt.", "seg-primary"),
    shortAnswer("repair-ai-partial", "AI partial outcome", "AI partial prompt.", "seg-primary"),
    shortAnswer("repair-ai-pending", "AI pending outcome", "AI pending prompt.", "seg-primary"),
    shortAnswer("repair-ai-failed", "AI failed outcome", "AI failed prompt.", "seg-primary"),
    shortAnswer("repair-missing", "Missing result", "Missing prompt.", "seg-primary"),
  ];
  bank.exercises.push(...repairExercises);

  const partialAi = reviewedAiResult(
    "repair-ai-partial",
    "partial",
    "PRIVATE_REVIEW_FEEDBACK",
  );
  const pendingAi = reviewedAiResult("repair-ai-pending", "partial", "unused");
  pendingAi.state = {
    status: "pending",
    queuedAt: "2026-08-22T09:02:00.000Z",
    attempts: 0,
  };
  const failedAi = reviewedAiResult("repair-ai-failed", "incorrect", "unused");
  failedAi.state = {
    status: "failed",
    failedAt: "2026-08-22T09:02:00.000Z",
    attempts: 1,
    error: { code: "synthetic", message: "Synthetic failure", retryable: true },
  };
  const session: SessionSummaryV3 = {
    schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
    id: "session-repair",
    startedAt: "2026-08-22T09:00:00.000Z",
    finishedAt: "2026-08-22T09:10:00.000Z",
    bankRevisionAtStart: bank.revision,
    exerciseCount: 8,
    completedCount: 7,
    score: { correct: 1, total: 3 },
    ratings: { again: 0, hard: 1, good: 0, easy: 0 },
    results: [{ exerciseId: "repair-incorrect", grading: "objective", correct: false }, {
      exerciseId: "repair-partial",
      grading: "self-rated",
      rating: "hard",
    }, {
      exerciseId: "repair-guided",
      grading: "objective",
      correct: false,
    }, {
      exerciseId: "repair-correct",
      grading: "objective",
      correct: true,
    }, partialAi, pendingAi, failedAi],
    scope: {
      mode: "learning-path",
      learningPath: { id: "path-synthetic", title: "Synthetic path" },
      sets: [{ id: "set-foundation", title: "Foundations" }],
    },
    evidence: [
      evidence("repair-incorrect", true),
      evidence("repair-partial", true),
      evidence("repair-guided", false, "unresolved"),
      evidence("repair-correct", true, "unresolved"),
      evidence("repair-ai-partial", true, "unresolved"),
      evidence("repair-ai-pending", true, "unresolved"),
      evidence("repair-ai-failed", true, "unresolved"),
      evidence("repair-missing", true, "unresolved"),
    ],
    completedTutorLessons: [],
  };
  const finished: FinishedStudySession = {
    id: session.id,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    answers: session.evidence.map((entry) => ({
      exerciseId: entry.exerciseId,
      submittedAnswer: `PRIVATE_ANSWER_${entry.exerciseId}`,
    })),
  };
  return { bank, session, finished };
}

test("repair seed uses only known incorrect or partial independent outcomes", () => {
  const { bank, session, finished } = repairSession();
  const seed = deriveRepairSetSeed(bank, session, finished);
  assert.ok(seed);
  assert.deepEqual(seed.entries.map((entry) => [entry.exerciseId, entry.outcome]), [
    ["repair-incorrect", "incorrect"],
    ["repair-partial", "partial"],
    ["repair-ai-partial", "partial"],
  ]);
  assert.doesNotMatch(
    JSON.stringify(seed.entries),
    /repair-guided|repair-correct|repair-ai-pending|repair-ai-failed|repair-missing/u,
  );
});

test("repair payload excludes authored answers and AI feedback until each disclosure is explicit", () => {
  const { bank, session, finished } = repairSession();
  const seed = deriveRepairSetSeed(bank, session, finished);
  assert.ok(seed);

  const privateAnswers = seed.entries.flatMap((entry) => (
    entry.submittedAnswer === undefined ? [] : [entry.submittedAnswer]
  ));
  assert.ok(privateAnswers.length > 0);
  const defaultText = repairFocusInstructions(seed, {
    includeSubmittedAnswers: false,
    includeReviewFeedback: false,
  });
  for (const answer of privateAnswers) assert.doesNotMatch(defaultText, new RegExp(answer, "u"));
  assert.doesNotMatch(defaultText, /PRIVATE_REVIEW_FEEDBACK/u);

  const answersOnly = repairFocusInstructions(seed, {
    includeSubmittedAnswers: true,
    includeReviewFeedback: false,
  });
  for (const answer of privateAnswers) assert.match(answersOnly, new RegExp(answer, "u"));
  assert.doesNotMatch(answersOnly, /PRIVATE_REVIEW_FEEDBACK/u);

  const feedbackOnly = repairFocusInstructions(seed, {
    includeSubmittedAnswers: false,
    includeReviewFeedback: true,
  });
  for (const answer of privateAnswers) assert.doesNotMatch(feedbackOnly, new RegExp(answer, "u"));
  assert.match(feedbackOnly, /PRIVATE_REVIEW_FEEDBACK/u);

  const completeDisclosure = repairFocusInstructions(seed, {
    includeSubmittedAnswers: true,
    includeReviewFeedback: true,
  });
  for (const answer of privateAnswers) assert.match(completeDisclosure, new RegExp(answer, "u"));
  assert.match(completeDisclosure, /PRIVATE_REVIEW_FEEDBACK/u);

  bank.sessions = [session];
  const targetSet = bank.practiceSets[0];
  assert.ok(targetSet);
  const context = createSavedSetPayloadContext({
    bank,
    targetSet,
    configuration: configuration(),
    batchId: "privacy-batch",
  });
  assert.doesNotMatch(
    JSON.stringify(context.payload),
    /PRIVATE_ANSWER_|PRIVATE_AI_REQUEST_ANSWER|PRIVATE_REVIEW_FEEDBACK/u,
  );
});

test("saved-set UI exposes regenerate, repair, exact-preview, consent, and narrow-save contracts", async () => {
  const [mainSource, practiceView, modalSource] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/saved-set-generation-modal.ts", import.meta.url), "utf8"),
  ]);
  assert.match(mainSource, /text: "Regenerate \/ tweak"/u);
  assert.match(mainSource, /openSavedSetGenerator/u);
  assert.match(practiceView, /Save and build repair set/u);
  assert.match(modalSource, /Build repair set/u);
  assert.match(modalSource, /Preview exact AI payload/u);
  assert.match(modalSource, /Inspect complete payload/u);
  assert.match(modalSource, /I approve this exact payload/u);
  assert.match(modalSource, /includeSubmittedAnswers: false/u);
  assert.match(modalSource, /includeReviewFeedback: false/u);
  assert.match(modalSource, /Include my submitted answers/u);
  assert.match(modalSource, /Include available AI feedback/u);
  assert.match(modalSource, /Add approved repair set/u);
  assert.match(modalSource, /Replace only this set/u);
  assert.match(modalSource, /Any later edit invalidates this consent/u);
});
