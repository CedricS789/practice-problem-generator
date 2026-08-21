import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATION_DRAFT_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BLOCK_LANGUAGE,
  type ExerciseV1,
  type SessionItemResultV1,
  type SessionItemResultV2,
} from "../src/model";

test("core format constants are stable", () => {
  assert.equal(GENERATION_DRAFT_SCHEMA_VERSION, 1);
  assert.equal(PRACTICE_BANK_SCHEMA_VERSION, 2);
  assert.equal(PRACTICE_BLOCK_LANGUAGE, "practice-lab");
});

test("exercise and result discriminants remain exhaustive", () => {
  const exerciseTypes: ExerciseV1["type"][] = [
    "short-answer",
    "causal-explanation",
    "application",
    "calculation",
    "cloze",
    "single-select",
    "multi-select",
    "matching",
    "ordering",
    "image-occlusion",
  ];
  const gradingTypes: SessionItemResultV1["grading"][] = [
    "objective",
    "self-rated",
  ];
  const currentGradingTypes: SessionItemResultV2["grading"][] = [
    "objective",
    "self-rated",
    "ai-review",
  ];
  assert.equal(new Set(exerciseTypes).size, 10);
  assert.deepEqual(gradingTypes, ["objective", "self-rated"]);
  assert.deepEqual(currentGradingTypes, ["objective", "self-rated", "ai-review"]);
});
