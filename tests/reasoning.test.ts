import assert from "node:assert/strict";
import test from "node:test";

import {
  displayReasoningEffort,
  normalizeReasoningEffort,
  reasoningEffortDescription,
  reasoningEffortsForProvider,
} from "../src/reasoning";

test("reasoning choices match each installed provider's supported ceiling", () => {
  assert.deepEqual(reasoningEffortsForProvider("codex"), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ]);
  assert.deepEqual(reasoningEffortsForProvider("claude"), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultracode",
  ]);
  assert.deepEqual(reasoningEffortsForProvider("agy"), [
    "low",
    "medium",
    "high",
  ]);
});

test("unsupported saved efforts fall back safely for the selected provider", () => {
  assert.equal(normalizeReasoningEffort("claude", "max"), "max");
  assert.equal(normalizeReasoningEffort("codex", "max"), "max");
  assert.equal(normalizeReasoningEffort("codex", "ultra"), "ultra");
  assert.equal(normalizeReasoningEffort("claude", "ultra"), "medium");
  assert.equal(normalizeReasoningEffort("claude", "ultracode"), "ultracode");
  assert.equal(normalizeReasoningEffort("agy", "xhigh"), "medium");
  assert.equal(normalizeReasoningEffort("codex", "unexpected"), "medium");
});

test("extended effort labels are readable", () => {
  assert.equal(displayReasoningEffort("xhigh"), "Extra high");
  assert.equal(displayReasoningEffort("max"), "Maximum");
  assert.equal(displayReasoningEffort("ultra"), "Ultra");
  assert.equal(displayReasoningEffort("ultracode"), "Ultracode");
});

test("reasoning descriptions enumerate every supported level for each provider", () => {
  assert.match(
    reasoningEffortDescription("codex"),
    /Low, Medium, High, Extra high, Maximum, Ultra/u,
  );
  assert.match(
    reasoningEffortDescription("claude"),
    /Low, Medium, High, Extra high, Maximum, Ultracode/u,
  );
  assert.match(
    reasoningEffortDescription("agy"),
    /Low, Medium, High/u,
  );
});
