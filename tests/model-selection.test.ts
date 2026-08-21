import assert from "node:assert/strict";
import test from "node:test";

import {
  agyModelForReasoning,
  agyModelReasoningProblem,
  DEFAULT_AGY_MODEL,
  displayModelSelection,
  modelIdProblem,
  normalizeModelId,
} from "../src/model-selection";

test("model selection preserves safe CLI identifiers and labels unpinned defaults", () => {
  assert.equal(normalizeModelId("  gpt-5.6  "), "gpt-5.6");
  assert.equal(normalizeModelId("claude-opus-4-6"), "claude-opus-4-6");
  assert.equal(displayModelSelection(""), "Provider default (not pinned)");
  assert.equal(displayModelSelection(DEFAULT_AGY_MODEL), DEFAULT_AGY_MODEL);
  assert.equal(DEFAULT_AGY_MODEL, "gemini-3.6-flash-medium");
  assert.equal(
    agyModelForReasoning("gemini-3.6-flash-medium", "high"),
    "gemini-3.6-flash-high",
  );
  assert.equal(
    agyModelForReasoning("", "low"),
    "gemini-3.6-flash-low",
  );
  assert.equal(
    agyModelReasoningProblem("gemini-3.6-flash-low", "high"),
    "The selected agy model pins low reasoning. Choose low reasoning or use gemini-3.6-flash-high for high reasoning.",
  );
  assert.equal(
    agyModelReasoningProblem("gemini-3.6-flash-high", "high"),
    null,
  );
});

test("model selection rejects shell-like or control-bearing values", () => {
  for (const unsafe of [
    "gpt-5.6;whoami",
    "$(whoami)",
    "gpt model",
    "model\nnext",
  ]) {
    assert.notEqual(modelIdProblem(unsafe), null);
    assert.equal(normalizeModelId(unsafe), "");
  }
  assert.equal(normalizeModelId(undefined, DEFAULT_AGY_MODEL), DEFAULT_AGY_MODEL);
});
