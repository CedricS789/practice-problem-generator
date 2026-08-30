import assert from "node:assert/strict";
import test from "node:test";

import type { PracticeBankV2, ShortAnswerExerciseV1 } from "../src/model";
import { PRACTICE_BANK_SCHEMA_VERSION } from "../src/model";
import { serializePracticeBank } from "../src/persistence";
import {
  createGenerationRecipe,
  emptyGenerationRecipeCatalog,
  generationRecipeCatalogFromLegacy,
  generationRecipeForSet,
  inferExerciseTypePercentages,
  parseGenerationRecipeCatalogMarkdown,
  parseGenerationRecipeMarkdown,
  removeGenerationRecipeForSet,
  regenerationPreset,
  serializeGenerationRecipeCatalogFrontmatter,
  serializeGenerationRecipeFrontmatter,
  setGenerationRecipeForSet,
} from "../src/regeneration";
import { createSourceHash, segmentSource } from "../src/segmenter";
import {
  EXERCISE_TYPES,
  type ExerciseType,
  type GenerationConfiguration,
} from "../src/ui/contracts";

const sourceText = "# Source\nGrounded evidence for regeneration.";

function exercise(
  id: string,
  difficulty: ShortAnswerExerciseV1["difficulty"] = "medium",
): ShortAnswerExerciseV1 {
  const segment = segmentSource(sourceText).find((entry) => entry.kind === "paragraph");
  assert.ok(segment);
  return {
    id,
    type: "short-answer",
    title: "Grounded question",
    prompt: "What does the source establish?",
    difficulty,
    sourceSegmentIds: [segment.id],
    groundedAnswer: "Grounded evidence.",
    acceptableAnswers: ["Grounded evidence."],
    keyPoints: ["grounded", "evidence"],
  };
}

function bank(exercises = [exercise("exercise-1")]): PracticeBankV2 {
  const timestamp = "2026-08-21T09:00:00.000Z";
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-regeneration",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: {
      vaultPath: "Notes/Term/Course/Source.md",
      wikilink: "[[Notes/Term/Course/Source]]",
      title: "Source",
      scope: "note",
      hash: createSourceHash(sourceText),
    },
    segments: segmentSource(sourceText),
    visuals: [],
    exercises,
    sessions: [],
    generation: {
      provider: "claude",
      reasoningEffort: "high",
      generatedAt: timestamp,
      promptVersion: "practice-lab-v3.1",
    },
  };
}

const configuration: GenerationConfiguration = {
  provider: "codex",
  model: "gpt-5.6",
  reasoningEffort: "ultra",
  focusInstructions: "Focus on cause and effect.\nAvoid definition-only prompts \"when possible\".",
  quantity: 12,
  difficulty: "challenge",
  exerciseTypes: [
    "short-answer",
    "causal-explanation",
    "application",
    "calculation",
  ],
  exerciseTypePercentages: {
    "short-answer": 25,
    "causal-explanation": 25,
    application: 25,
    calculation: 25,
    cloze: 0,
    "single-select": 0,
    "multi-select": 0,
    matching: 0,
    ordering: 0,
    "image-occlusion": 0,
  },
  selectedVisualIds: [],
  aiContextCompletionPolicy: "selected-sources-only",
};

test("stores a complete generation recipe in hidden plugin metadata", () => {
  const savedBank = bank();
  const recipe = createGenerationRecipe(configuration, savedBank.source.hash);
  const markdown = serializePracticeBank(savedBank, recipe);
  const parsed = parseGenerationRecipeMarkdown(markdown);

  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  assert.deepEqual(parsed.recipe, recipe);
  assert.doesNotMatch(
    JSON.stringify(savedBank),
    /focusInstructions/u,
    "the existing PracticeBankV2 JSON contract stays unchanged",
  );
  assert.match(markdown, /<!-- practice-problem-generator-metadata-v1/u);
  assert.doesNotMatch(markdown, /^practice-lab-generation-recipe:/mu);
  assert.doesNotMatch(markdown, /^practice-lab-generation-model:/mu);
});

test("loads the exact saved recipe when its source hash matches the bank", () => {
  const savedBank = bank();
  const recipe = createGenerationRecipe(configuration, savedBank.source.hash);
  const preset = regenerationPreset(savedBank, {
    status: "ok",
    recipe,
    storedSchemaVersion: 2,
  }, {
    provider: "agy",
    model: "gemini-3.6-flash-low",
    reasoningEffort: "low",
    difficulty: "foundational",
    focusInstructions: "fallback",
  });

  assert.equal(preset.exactRecipe, true);
  assert.deepEqual(preset.defaults, {
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    quantity: configuration.quantity,
    difficulty: configuration.difficulty,
    focusInstructions: configuration.focusInstructions,
    exerciseTypePercentages: configuration.exerciseTypePercentages,
    aiContextCompletionPolicy: configuration.aiContextCompletionPolicy,
  });
});

test("version-one recipes migrate in memory with an explicitly unpinned model", () => {
  const savedBank = bank();
  const recipe = createGenerationRecipe(configuration, savedBank.source.hash);
  const legacyLines = serializeGenerationRecipeFrontmatter(recipe)
    .filter((line) => !line.startsWith("practice-lab-generation-context-policy:"))
    .map((line) => line.replace(
      "practice-lab-generation-recipe: 2",
      "practice-lab-generation-recipe: 1",
    ))
    .filter((line) => !line.startsWith("practice-lab-generation-model:"));
  const legacyMarkdown = ["---", ...legacyLines, "---", ""].join("\n");
  const parsed = parseGenerationRecipeMarkdown(legacyMarkdown);
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  assert.equal(parsed.storedSchemaVersion, 1);
  assert.equal(parsed.recipe.model, "");
  assert.equal(parsed.recipe.aiContextCompletionPolicy, undefined);
  const preset = regenerationPreset(savedBank, parsed, {
    provider: "agy",
    model: "gemini-3.6-flash-low",
    reasoningEffort: "low",
    difficulty: "foundational",
    focusInstructions: "fallback",
  });
  assert.equal(preset.defaults.model, "");
  assert.match(preset.explanation, /older recipe did not record a pinned model/iu);
  assert.equal(preset.defaults.aiContextCompletionPolicy, "approved-general-context");
});

test("older banks restore recorded provider/reasoning and infer only missing controls", () => {
  const savedBank = bank([
    exercise("exercise-1", "easy"),
    exercise("exercise-2", "medium"),
    exercise("exercise-3", "hard"),
  ]);
  const preset = regenerationPreset(savedBank, { status: "missing" }, {
    provider: "agy",
    model: "gemini-3.6-flash-low",
    reasoningEffort: "low",
    difficulty: "foundational",
    focusInstructions: "Use my current default focus.",
  });

  assert.equal(preset.exactRecipe, false);
  assert.equal(preset.defaults.provider, "claude");
  assert.equal(preset.defaults.model, "gemini-3.6-flash-low");
  assert.equal(preset.defaults.reasoningEffort, "high");
  assert.equal(preset.defaults.quantity, 3);
  assert.equal(preset.defaults.difficulty, "deep-exam");
  assert.equal(preset.defaults.focusInstructions, "Use my current default focus.");
  assert.equal(preset.defaults.exerciseTypePercentages?.["short-answer"], 100);
  assert.match(preset.explanation, /older bank did not store a complete recipe/iu);
});

test("reconstructed percentages deterministically reproduce the saved type counts", () => {
  const counts: Readonly<Record<ExerciseType, number>> = {
    "short-answer": 4,
    "causal-explanation": 3,
    application: 2,
    calculation: 1,
    cloze: 1,
    "single-select": 0,
    "multi-select": 0,
    matching: 1,
    ordering: 0,
    "image-occlusion": 1,
  };
  const exercises = EXERCISE_TYPES.flatMap((type) => Array.from(
    { length: counts[type] },
    () => ({ type }),
  ));
  const percentages = inferExerciseTypePercentages(exercises);

  assert.equal(Object.values(percentages).reduce((sum, value) => sum + value, 0), 100);
  for (const type of EXERCISE_TYPES) {
    assert.equal(
      Math.round(percentages[type] * 1_000) >= 0,
      true,
      `${type} receives a valid non-negative percentage`,
    );
  }
});

test("a malformed or mismatched saved recipe fails closed to bank inference", () => {
  const savedBank = bank();
  const recipe = createGenerationRecipe(
    configuration,
    createSourceHash("different source"),
  );
  const preset = regenerationPreset(savedBank, {
    status: "ok",
    recipe,
    storedSchemaVersion: 2,
  }, {
    provider: "agy",
    model: "gemini-3.6-flash-low",
    reasoningEffort: "medium",
    difficulty: "foundational",
    focusInstructions: "fallback",
  });

  assert.equal(preset.exactRecipe, false);
  assert.equal(preset.defaults.provider, "claude");
  assert.equal(preset.defaults.quantity, 1);
  assert.equal(preset.defaults.focusInstructions, "fallback");
  assert.match(preset.explanation, /could not be trusted/iu);
});

test("recipe parsing rejects permissive numeric prefixes instead of guessing", () => {
  const savedBank = bank();
  const recipe = createGenerationRecipe(configuration, savedBank.source.hash);
  const markdown = [
    "---",
    ...serializeGenerationRecipeFrontmatter(recipe).map((line) => line.replace(
      "practice-lab-generation-quantity: 12",
      "practice-lab-generation-quantity: 12items",
    )),
    "---",
    "",
  ].join("\n");

  assert.deepEqual(parseGenerationRecipeMarkdown(markdown), {
    status: "invalid",
    message: "The saved generation recipe is incomplete or malformed.",
  });
});

test("set-scoped recipe catalog round-trips exact provider, model, reasoning, focus, and mix", () => {
  const bundleHash = `sha256:${"d".repeat(64)}`;
  let catalog = setGenerationRecipeForSet(
    emptyGenerationRecipeCatalog(),
    "set-foundations",
    configuration,
    bundleHash,
  );
  catalog = setGenerationRecipeForSet(
    catalog,
    "set-transfer",
    { ...configuration, quantity: 8, focusInstructions: "Focus on transfer." },
    bundleHash,
  );
  const markdown = [
    "---",
    serializeGenerationRecipeCatalogFrontmatter(catalog),
    "---",
    "",
  ].join("\n");
  const parsed = parseGenerationRecipeCatalogMarkdown(markdown);
  assert.deepEqual(parsed, { status: "ok", catalog });
  assert.equal(generationRecipeForSet(catalog, "set-foundations")?.model, "gpt-5.6");
  assert.equal(generationRecipeForSet(catalog, "set-transfer")?.reasoningEffort, "ultra");

  const removed = removeGenerationRecipeForSet(catalog, "set-foundations");
  assert.equal(generationRecipeForSet(removed, "set-foundations"), undefined);
  assert.ok(generationRecipeForSet(removed, "set-transfer"));
});

test("legacy single-bank recipe can migrate into the General practice set catalog", () => {
  const savedBank = bank();
  const recipe = createGenerationRecipe(configuration, savedBank.source.hash);
  const catalog = generationRecipeCatalogFromLegacy("set-general", {
    status: "ok",
    recipe,
    storedSchemaVersion: 2,
  });
  assert.deepEqual(generationRecipeForSet(catalog, "set-general"), recipe);
  assert.deepEqual(
    generationRecipeCatalogFromLegacy("set-general", { status: "missing" }),
    emptyGenerationRecipeCatalog(),
  );
});

test("recipe catalog rejects partial or oversized set recipes", () => {
  assert.throws(
    () => setGenerationRecipeForSet(
      emptyGenerationRecipeCatalog(),
      "unsafe set id",
      configuration,
      `sha256:${"e".repeat(64)}`,
    ),
    /set ID is invalid/iu,
  );
  let catalog = emptyGenerationRecipeCatalog();
  for (const setId of ["set-1", "set-2", "set-3", "set-4", "set-5"]) {
    catalog = setGenerationRecipeForSet(
      catalog,
      setId,
      { ...configuration, quantity: 12 },
      `sha256:${"e".repeat(64)}`,
    );
  }
  assert.throws(
    () => setGenerationRecipeForSet(
      catalog,
      "set-6",
      { ...configuration, quantity: 1 },
      `sha256:${"e".repeat(64)}`,
    ),
    /at most 60 exercises/iu,
  );
});
