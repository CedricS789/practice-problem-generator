import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewSource = await readFile(
  new URL("../src/ui/learning-path-view.ts", import.meta.url),
  "utf8",
);
const occlusionSource = await readFile(
  new URL("../src/ui/occlusion-editor.ts", import.meta.url),
  "utf8",
);

test("guided review bulk approval is batch-wide and exposes exact progress", () => {
  assert.match(viewSource, /Approve all ready exercises/u);
  assert.match(viewSource, /approveReadyLearningPathExercises\(this\.reviewSetInputs\(blueprint\)\)/u);
  assert.match(viewSource, /approved.*kept exercises approved in this set/iu);
  assert.match(viewSource, /Review still required/u);
  assert.match(viewSource, /reviewSetInputs/u);
});

test("bulk review feedback moves to the next blocker or the save action", () => {
  assert.match(viewSource, /this\.activeReviewSetId = blocker\.setId/u);
  assert.match(viewSource, /renderAndFocusReviewFeedback\(result\.blockers\.length === 0\)/u);
  assert.match(viewSource, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/u);
  assert.match(viewSource, /\.practice-learning-path-save-actions/u);
});

test("an accepted occlusion visibly changes and disables its acceptance button", () => {
  assert.match(occlusionSource, /Masks accepted/u);
  assert.match(occlusionSource, /setDisabled\(this\.reviewed\)/u);
  assert.match(occlusionSource, /Editing any mask will require another review/u);
});

test("large final validation errors are summarized behind an expandable detail list", () => {
  assert.match(viewSource, /learningPathErrorPresentation\(this\.error\)/u);
  assert.match(viewSource, /technical validation/u);
  assert.match(viewSource, /Nothing was written/u);
});
