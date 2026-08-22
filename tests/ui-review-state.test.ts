import assert from "node:assert/strict";
import test from "node:test";

import type { EditableDraftExercise } from "../src/ui/contracts";
import {
  acceptAllValidOcclusions,
  getReviewGateState,
  reviewFingerprint,
} from "../src/ui/review-state";

function occlusionDraft(): EditableDraftExercise {
  return {
    id: "exercise-1",
    type: "image-occlusion",
    prompt: "Name the hidden node.",
    groundedAnswer: "Node A",
    sourceSegmentIds: ["segment-1"],
    visualUrl: "app://local/visual.png",
    masks: [
      {
        id: "mask-1",
        label: "Node",
        answer: "Node A",
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
      },
    ],
    grading: {
      kind: "occlusion",
      acceptedAnswers: { "mask-1": ["Node A"] },
    },
    rejected: false,
    occlusionReviewed: true,
  };
}

function shortAnswerDraft(id: string): EditableDraftExercise {
  return {
    id,
    type: "short-answer",
    prompt: `Prompt ${id}`,
    groundedAnswer: `Answer ${id}`,
    sourceSegmentIds: ["segment-1"],
    grading: { kind: "self", groundedAnswer: `Answer ${id}` },
    rejected: false,
    occlusionReviewed: true,
  };
}

test("editing an accepted mask requires reacceptance and another save", () => {
  const acceptedDraft = occlusionDraft();
  const accepted = [acceptedDraft];
  const savedFingerprint = reviewFingerprint(accepted);
  assert.equal(
    getReviewGateState(accepted, savedFingerprint).canStartPractice,
    true,
  );

  const editedDraft: EditableDraftExercise = {
    ...acceptedDraft,
    masks: (acceptedDraft.masks ?? []).map((mask) => ({
      ...mask,
      answer: "Node B",
    })),
    occlusionReviewed: false,
  };
  const edited = [editedDraft];
  const afterEdit = getReviewGateState(edited, savedFingerprint);
  assert.equal(afterEdit.hasUnreviewedOcclusion, true);
  assert.equal(afterEdit.canSave, false);
  assert.equal(afterEdit.canStartPractice, false);

  const reaccepted: readonly EditableDraftExercise[] = [
    { ...editedDraft, occlusionReviewed: true },
  ];
  const afterReacceptance = getReviewGateState(reaccepted, savedFingerprint);
  assert.equal(afterReacceptance.canSave, true);
  assert.equal(afterReacceptance.savedCurrent, false);
  assert.equal(afterReacceptance.canStartPractice, false);

  const resaved = getReviewGateState(
    reaccepted,
    reviewFingerprint(reaccepted),
  );
  assert.equal(resaved.canStartPractice, true);
});

test("review edits, reorder, and rejection invalidate saved-current state", () => {
  const original = [shortAnswerDraft("one"), shortAnswerDraft("two")];
  const savedFingerprint = reviewFingerprint(original);
  assert.equal(
    getReviewGateState(original, savedFingerprint).canStartPractice,
    true,
  );

  const edited = [{ ...original[0]!, prompt: "Edited prompt" }, original[1]!];
  assert.equal(
    getReviewGateState(edited, savedFingerprint).canStartPractice,
    false,
  );

  const reordered = [original[1]!, original[0]!];
  assert.equal(
    getReviewGateState(reordered, savedFingerprint).canStartPractice,
    false,
  );

  const rejected = [{ ...original[0]!, rejected: true }, original[1]!];
  const rejectedGate = getReviewGateState(rejected, savedFingerprint);
  assert.equal(rejectedGate.acceptedCount, 1);
  assert.equal(rejectedGate.canStartPractice, false);

  assert.equal(
    getReviewGateState(original, null).canStartPractice,
    false,
    "an invalidated save marker stays gated even if content is later reverted",
  );
});

test("a review cannot save or start with no kept exercises", () => {
  const rejected = [{ ...shortAnswerDraft("one"), rejected: true }];
  const gate = getReviewGateState(rejected, reviewFingerprint(rejected));
  assert.equal(gate.canSave, false);
  assert.equal(gate.canStartPractice, false);
});

test("blank edited prompts and grounded answers are blocked before persistence", () => {
  const blankPrompt = { ...shortAnswerDraft("prompt"), prompt: "   " };
  const blankAnswer = {
    ...shortAnswerDraft("answer"),
    groundedAnswer: "\n\t",
  };
  const gate = getReviewGateState([blankPrompt, blankAnswer], null);

  assert.equal(gate.invalidContentCount, 2);
  assert.equal(gate.canSave, false);
  assert.equal(gate.canStartPractice, false);

  const rejectedInvalid = getReviewGateState([
    { ...blankPrompt, rejected: true },
    shortAnswerDraft("valid"),
  ], null);
  assert.equal(rejectedInvalid.invalidContentCount, 0);
  assert.equal(rejectedInvalid.canSave, true);
});

test("malformed edited LaTeX is blocked while rejected drafts remain irrelevant", () => {
  const malformed = {
    ...shortAnswerDraft("latex-problem"),
    prompt: "Calculate $V=IR.",
  };
  const gate = getReviewGateState([malformed], null);
  assert.equal(gate.invalidLatexCount, 1);
  assert.equal(gate.canSave, false);

  const rejected = getReviewGateState([
    { ...malformed, rejected: true },
  ], null);
  assert.equal(rejected.invalidLatexCount, 0);
});

test("accept all reviews every valid kept occlusion without touching rejected exercises", () => {
  const validOne = { ...occlusionDraft(), id: "valid-one", occlusionReviewed: false };
  const validTwo = { ...occlusionDraft(), id: "valid-two", occlusionReviewed: false };
  const alreadyAccepted = { ...occlusionDraft(), id: "already-accepted" };
  const rejected = {
    ...occlusionDraft(),
    id: "rejected",
    rejected: true,
    occlusionReviewed: false,
  };
  const result = acceptAllValidOcclusions([
    validOne,
    shortAnswerDraft("text"),
    validTwo,
    alreadyAccepted,
    rejected,
  ]);

  assert.equal(result.keptOcclusionCount, 3);
  assert.equal(result.newlyAcceptedCount, 2);
  assert.equal(result.alreadyAcceptedCount, 1);
  assert.deepEqual(result.invalid, []);
  assert.equal(result.changed, true);
  assert.equal(result.drafts.find((draft) => draft.id === "valid-one")?.occlusionReviewed, true);
  assert.equal(result.drafts.find((draft) => draft.id === "valid-two")?.occlusionReviewed, true);
  assert.equal(result.drafts.find((draft) => draft.id === "rejected")?.occlusionReviewed, false);
  assert.equal(getReviewGateState(result.drafts, null).canSave, true);
});

test("accept all leaves incomplete occlusions unreviewed and keeps saving blocked", () => {
  const incomplete: EditableDraftExercise = {
    ...occlusionDraft(),
    id: "incomplete",
    occlusionReviewed: false,
    masks: [],
  };
  const blankAnswer: EditableDraftExercise = {
    ...occlusionDraft(),
    id: "blank-answer",
    occlusionReviewed: false,
    masks: [{ ...(occlusionDraft().masks?.[0]!), answer: "" }],
  };
  const result = acceptAllValidOcclusions([
    { ...occlusionDraft(), id: "valid", occlusionReviewed: false },
    incomplete,
    blankAnswer,
  ]);

  assert.equal(result.newlyAcceptedCount, 1);
  assert.equal(result.invalid.length, 2);
  assert.match(result.invalid[0]?.reason ?? "", /at least one mask/iu);
  assert.match(result.invalid[1]?.reason ?? "", /no answer/iu);
  assert.equal(result.drafts.find((draft) => draft.id === "incomplete")?.occlusionReviewed, false);
  assert.equal(result.drafts.find((draft) => draft.id === "blank-answer")?.occlusionReviewed, false);
  const gate = getReviewGateState(result.drafts, null);
  assert.equal(gate.hasUnreviewedOcclusion, true);
  assert.equal(gate.canSave, false);
});

test("accept all defensively revokes an invalid preaccepted occlusion", () => {
  const invalidAccepted: EditableDraftExercise = {
    ...occlusionDraft(),
    masks: [],
  };
  const result = acceptAllValidOcclusions([invalidAccepted]);

  assert.equal(result.changed, true);
  assert.equal(result.newlyAcceptedCount, 0);
  assert.equal(result.alreadyAcceptedCount, 0);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.drafts[0]?.occlusionReviewed, false);
  assert.equal(getReviewGateState(result.drafts, null).canSave, false);
});
