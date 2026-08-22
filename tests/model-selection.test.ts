import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATIC_MODEL_CHOICE,
  agyModelForReasoning,
  agyModelReasoningProblem,
  automaticModelForProvider,
  CUSTOM_MODEL_CHOICE,
  DEFAULT_AGY_MODEL,
  displayModelSelection,
  modelPickerChoice,
  modelIdProblem,
  modelsForProvider,
  normalizeModelId,
  preferredReasoningEffort,
  reasoningEffortsForModel,
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

test("provider model pickers preserve automatic, known, and custom selections", () => {
  const codex = modelsForProvider("codex");
  assert.equal(
    modelPickerChoice("codex", "", "medium", codex),
    AUTOMATIC_MODEL_CHOICE,
  );
  assert.equal(
    modelPickerChoice("codex", "gpt-5.6-luna", "medium", codex),
    "gpt-5.6-luna",
  );
  assert.equal(
    modelPickerChoice("codex", "future-model-1", "medium", codex),
    CUSTOM_MODEL_CHOICE,
  );
  assert.equal(automaticModelForProvider("codex", "high", codex), "");
  assert.equal(
    automaticModelForProvider("agy", "high", modelsForProvider("agy")),
    "gemini-3.6-flash-high",
  );
  assert.equal(
    modelPickerChoice(
      "agy",
      "gemini-3.6-flash-high",
      "high",
      modelsForProvider("agy"),
    ),
    "gemini-3.6-flash-high",
  );
  assert.equal(
    automaticModelForProvider("agy", "medium", [
      {
        id: "gemini-4.0-flash-high",
        label: "Gemini 4 Flash High",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["high"],
      },
    ]),
    "",
  );
});

test("reasoning choices follow the selected model without discarding custom ids", () => {
  const catalog = modelsForProvider("codex");
  const providerEfforts = [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ] as const;
  assert.deepEqual(
    reasoningEffortsForModel(providerEfforts, "gpt-5.6-luna", catalog),
    ["low", "medium", "high", "xhigh", "max"],
  );
  assert.deepEqual(
    reasoningEffortsForModel(providerEfforts, "future-model-1", catalog),
    providerEfforts,
  );
  assert.equal(
    preferredReasoningEffort(
      "ultra",
      ["low", "medium", "high", "xhigh", "max"],
      catalog.find((entry) => entry.id === "gpt-5.6-luna"),
    ),
    "medium",
  );
});

test("agy reasoning alignment never invents a missing sibling model", () => {
  const catalog = modelsForProvider("agy");
  assert.equal(
    agyModelForReasoning("gemini-3.1-pro-high", "medium", catalog),
    "gemini-3.1-pro-high",
  );
  assert.equal(
    agyModelForReasoning("gpt-oss-120b-medium", "high", catalog),
    "gpt-oss-120b-medium",
  );
  assert.match(
    agyModelReasoningProblem(
      "gemini-3.1-pro-high",
      "medium",
      catalog,
    ) ?? "",
    /select another model/iu,
  );
});
