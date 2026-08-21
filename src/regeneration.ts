import type { ExerciseV1, PracticeBankV2 } from "./model";
import {
  exerciseTypeDistributionProblem,
  planExerciseDistribution,
} from "./exercise-distribution";
import {
  EXERCISE_TYPES,
  type Difficulty,
  type ExerciseType,
  type ExerciseTypePercentages,
  type GenerationConfiguration,
  type PracticeLabConfigurationDefaults,
  type ProviderId,
  type ReasoningEffort,
} from "./ui/contracts";
import { modelIdProblem } from "./model-selection";

export const LEGACY_GENERATION_RECIPE_VERSION = 1 as const;
export const GENERATION_RECIPE_VERSION = 2 as const;

const RECIPE_FIELDS = {
  version: "practice-lab-generation-recipe",
  sourceHash: "practice-lab-generation-source-hash",
  provider: "practice-lab-generation-provider",
  model: "practice-lab-generation-model",
  reasoning: "practice-lab-generation-reasoning",
  quantity: "practice-lab-generation-quantity",
  difficulty: "practice-lab-generation-difficulty",
  focus: "practice-lab-generation-focus",
  mix: "practice-lab-generation-mix",
} as const;

export interface GenerationRecipeV1 {
  readonly schemaVersion: typeof LEGACY_GENERATION_RECIPE_VERSION;
  readonly sourceHash: string;
  readonly provider: ProviderId;
  readonly reasoningEffort: ReasoningEffort;
  readonly quantity: number;
  readonly difficulty: Difficulty;
  readonly focusInstructions: string;
  readonly exerciseTypePercentages: ExerciseTypePercentages;
}

export interface GenerationRecipeV2 {
  readonly schemaVersion: typeof GENERATION_RECIPE_VERSION;
  readonly sourceHash: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly quantity: number;
  readonly difficulty: Difficulty;
  readonly focusInstructions: string;
  readonly exerciseTypePercentages: ExerciseTypePercentages;
}

export type GenerationRecipeParseResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly message: string }
  | {
      readonly status: "ok";
      readonly recipe: GenerationRecipeV2;
      readonly storedSchemaVersion: 1 | 2;
    };

export interface RegenerationFallbacks {
  readonly provider: ProviderId;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly difficulty: Difficulty;
  readonly focusInstructions: string;
}

export interface RegenerationPreset {
  readonly defaults: PracticeLabConfigurationDefaults;
  readonly exactRecipe: boolean;
  readonly explanation: string;
}

export function createGenerationRecipe(
  configuration: GenerationConfiguration,
  sourceHash: string,
): GenerationRecipeV2 {
  const recipe: GenerationRecipeV2 = {
    schemaVersion: GENERATION_RECIPE_VERSION,
    sourceHash,
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    quantity: configuration.quantity,
    difficulty: configuration.difficulty,
    focusInstructions: configuration.focusInstructions,
    exerciseTypePercentages: copyPercentages(
      configuration.exerciseTypePercentages,
    ),
  };
  const problem = generationRecipeProblem(recipe);
  if (problem !== null) throw new Error(problem);
  return recipe;
}

export function serializeGenerationRecipeFrontmatter(
  recipe: GenerationRecipeV2,
): readonly string[] {
  const problem = generationRecipeProblem(recipe);
  if (problem !== null) {
    throw new Error(`Cannot serialize an invalid generation recipe: ${problem}`);
  }
  return [
    `${RECIPE_FIELDS.version}: ${recipe.schemaVersion}`,
    `${RECIPE_FIELDS.sourceHash}: ${yamlString(recipe.sourceHash)}`,
    `${RECIPE_FIELDS.provider}: ${yamlString(recipe.provider)}`,
    `${RECIPE_FIELDS.model}: ${yamlString(recipe.model)}`,
    `${RECIPE_FIELDS.reasoning}: ${yamlString(recipe.reasoningEffort)}`,
    `${RECIPE_FIELDS.quantity}: ${recipe.quantity}`,
    `${RECIPE_FIELDS.difficulty}: ${yamlString(recipe.difficulty)}`,
    `${RECIPE_FIELDS.focus}: ${yamlString(recipe.focusInstructions)}`,
    `${RECIPE_FIELDS.mix}: ${yamlString(JSON.stringify(recipe.exerciseTypePercentages))}`,
  ];
}

export function parseGenerationRecipeMarkdown(
  markdown: string,
): GenerationRecipeParseResult {
  const rawVersion = frontmatterValue(markdown, RECIPE_FIELDS.version);
  if (rawVersion === undefined) return { status: "missing" };
  const storedSchemaVersion = rawVersion.trim() === String(LEGACY_GENERATION_RECIPE_VERSION)
    ? LEGACY_GENERATION_RECIPE_VERSION
    : rawVersion.trim() === String(GENERATION_RECIPE_VERSION)
      ? GENERATION_RECIPE_VERSION
      : undefined;
  if (storedSchemaVersion === undefined) {
    return {
      status: "invalid",
      message: "The saved generation recipe uses an unsupported version.",
    };
  }
  try {
    const sourceHash = parseYamlString(
      requiredFrontmatterValue(markdown, RECIPE_FIELDS.sourceHash),
    );
    const provider = parseYamlString(
      requiredFrontmatterValue(markdown, RECIPE_FIELDS.provider),
    );
    const model = storedSchemaVersion === LEGACY_GENERATION_RECIPE_VERSION
      ? ""
      : parseYamlString(requiredFrontmatterValue(markdown, RECIPE_FIELDS.model));
    const reasoningEffort = parseYamlString(
      requiredFrontmatterValue(markdown, RECIPE_FIELDS.reasoning),
    );
    const rawQuantity = requiredFrontmatterValue(
      markdown,
      RECIPE_FIELDS.quantity,
    ).trim();
    if (!/^(?:[1-9]|[12][0-9]|30)$/u.test(rawQuantity)) {
      throw new Error("Invalid generation quantity.");
    }
    const quantity = Number.parseInt(rawQuantity, 10);
    const difficulty = parseYamlString(
      requiredFrontmatterValue(markdown, RECIPE_FIELDS.difficulty),
    );
    const focusInstructions = parseYamlString(
      requiredFrontmatterValue(markdown, RECIPE_FIELDS.focus),
    );
    const mixJson = parseYamlString(
      requiredFrontmatterValue(markdown, RECIPE_FIELDS.mix),
    );
    const mix = JSON.parse(mixJson) as unknown;
    const recipe = {
      schemaVersion: GENERATION_RECIPE_VERSION,
      sourceHash,
      provider,
      model,
      reasoningEffort,
      quantity,
      difficulty,
      focusInstructions,
      exerciseTypePercentages: mix,
    } as unknown as GenerationRecipeV2;
    const problem = generationRecipeProblem(recipe);
    return problem === null
      ? {
          status: "ok",
          recipe: cloneRecipe(recipe),
          storedSchemaVersion,
        }
      : { status: "invalid", message: problem };
  } catch {
    return {
      status: "invalid",
      message: "The saved generation recipe is incomplete or malformed.",
    };
  }
}

export function inferExerciseTypePercentages(
  exercises: readonly Pick<ExerciseV1, "type">[],
): Record<ExerciseType, number> {
  if (exercises.length === 0) {
    throw new Error("A saved practice bank must contain at least one exercise.");
  }
  const counts = new Map<ExerciseType, number>();
  for (const type of EXERCISE_TYPES) counts.set(type, 0);
  for (const exercise of exercises) {
    counts.set(exercise.type, (counts.get(exercise.type) ?? 0) + 1);
  }
  const targets = EXERCISE_TYPES.map((type, index) => {
    const exact = (counts.get(type) ?? 0) * 100 / exercises.length;
    return {
      type,
      index,
      percentage: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = 100 - targets.reduce(
    (total, target) => total + target.percentage,
    0,
  );
  for (const target of [...targets].sort((left, right) => (
    right.remainder - left.remainder || left.index - right.index
  ))) {
    if (remaining === 0) break;
    target.percentage += 1;
    remaining -= 1;
  }
  const percentages = Object.fromEntries(
    targets.map((target) => [target.type, target.percentage]),
  ) as Record<ExerciseType, number>;
  if (exercises.length <= 30) {
    const planned = planExerciseDistribution(percentages, exercises.length);
    const mismatch = planned.some(
      (target) => target.count !== (counts.get(target.type) ?? 0),
    );
    if (mismatch) {
      throw new Error("Practice Problem Generator could not reconstruct the previous exercise mix safely.");
    }
  }
  return percentages;
}

export function inferGenerationDifficulty(
  exercises: readonly Pick<ExerciseV1, "difficulty">[],
): Difficulty {
  if (exercises.length === 0) return "deep-exam";
  const score = exercises.reduce((total, exercise) => (
    total + (exercise.difficulty === "easy" ? 0 : exercise.difficulty === "medium" ? 1 : 2)
  ), 0) / exercises.length;
  if (score < 0.75) return "foundational";
  if (score >= 1.5) return "challenge";
  return "deep-exam";
}

export function regenerationPreset(
  bank: PracticeBankV2,
  recipeResult: GenerationRecipeParseResult,
  fallbacks: RegenerationFallbacks,
): RegenerationPreset {
  if (
    recipeResult.status === "ok"
    && recipeResult.recipe.sourceHash === bank.source.hash
  ) {
    const recipe = recipeResult.recipe;
    return {
      exactRecipe: true,
      defaults: {
        provider: recipe.provider,
        model: recipe.model,
        reasoningEffort: recipe.reasoningEffort,
        quantity: recipe.quantity,
        difficulty: recipe.difficulty,
        focusInstructions: recipe.focusInstructions,
        exerciseTypePercentages: copyPercentages(
          recipe.exerciseTypePercentages,
        ),
      },
      explanation: recipeResult.storedSchemaVersion === LEGACY_GENERATION_RECIPE_VERSION
        ? "Loaded the saved provider, reasoning, quantity, difficulty, focus instructions, and exercise mix. This older recipe did not record a pinned model, so provider default is selected."
        : "Loaded the exact provider, model, reasoning, quantity, difficulty, focus instructions, and exercise mix from this bank's last generation.",
    };
  }

  const generation = bank.generation;
  const invalidRecipe = recipeResult.status === "invalid"
    || (recipeResult.status === "ok" && recipeResult.recipe.sourceHash !== bank.source.hash);
  return {
    exactRecipe: false,
    defaults: {
      provider: generation?.provider ?? fallbacks.provider,
      model: fallbacks.model,
      reasoningEffort: generation?.reasoningEffort ?? fallbacks.reasoningEffort,
      quantity: Math.min(30, Math.max(1, bank.exercises.length)),
      difficulty: inferGenerationDifficulty(bank.exercises),
      focusInstructions: fallbacks.focusInstructions,
      exerciseTypePercentages: inferExerciseTypePercentages(bank.exercises),
    },
    explanation: invalidRecipe
      ? "The saved recipe could not be trusted, so provider and reasoning were restored where available, the current bank's quantity, difficulty, and exercise mix were reconstructed, and your default focus instructions were used."
      : "This older bank did not store a complete recipe. Provider and reasoning were restored where available; quantity, difficulty, and exercise mix were reconstructed from the bank, and your default focus instructions were used.",
  };
}

function generationRecipeProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "The generation recipe must be an object.";
  }
  const recipe = value as Partial<GenerationRecipeV2>;
  if (recipe.schemaVersion !== GENERATION_RECIPE_VERSION) {
    return "The generation recipe version is unsupported.";
  }
  if (typeof recipe.sourceHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(recipe.sourceHash)) {
    return "The generation recipe source hash is invalid.";
  }
  if (recipe.provider !== "codex" && recipe.provider !== "claude" && recipe.provider !== "agy") {
    return "The generation recipe provider is invalid.";
  }
  if (typeof recipe.model !== "string" || modelIdProblem(recipe.model) !== null) {
    return "The generation recipe model identifier is invalid.";
  }
  if (!isReasoningEffort(recipe.reasoningEffort)) {
    return "The generation recipe reasoning effort is invalid.";
  }
  if (!Number.isInteger(recipe.quantity) || (recipe.quantity ?? 0) < 1 || (recipe.quantity ?? 0) > 30) {
    return "The generation recipe quantity must be a whole number from 1 to 30.";
  }
  if (
    recipe.difficulty !== "foundational"
    && recipe.difficulty !== "deep-exam"
    && recipe.difficulty !== "challenge"
  ) {
    return "The generation recipe difficulty is invalid.";
  }
  if (typeof recipe.focusInstructions !== "string" || recipe.focusInstructions.length > 4_000) {
    return "The generation recipe focus instructions are invalid.";
  }
  const percentages = percentagesFromUnknown(recipe.exerciseTypePercentages);
  if (percentages === null) return "The generation recipe exercise mix is invalid.";
  return exerciseTypeDistributionProblem(percentages);
}

function percentagesFromUnknown(value: unknown): ExerciseTypePercentages | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== EXERCISE_TYPES.length
    || Object.keys(record).some((key) => !EXERCISE_TYPES.includes(key as ExerciseType))
  ) return null;
  const percentages = Object.fromEntries(EXERCISE_TYPES.map((type) => [
    type,
    record[type],
  ])) as Record<ExerciseType, number>;
  return EXERCISE_TYPES.every((type) => typeof percentages[type] === "number")
    ? percentages
    : null;
}

function copyPercentages(
  value: ExerciseTypePercentages,
): Record<ExerciseType, number> {
  return Object.fromEntries(EXERCISE_TYPES.map((type) => [type, value[type]])) as Record<ExerciseType, number>;
}

function cloneRecipe(recipe: GenerationRecipeV2): GenerationRecipeV2 {
  return {
    ...recipe,
    exerciseTypePercentages: copyPercentages(recipe.exerciseTypePercentages),
  };
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" || value === "ultra";
}

function yamlString(value: string): string {
  return JSON.stringify(value) ?? "undefined";
}

function parseYamlString(value: string): string {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "string") throw new Error("Expected a quoted string.");
  return parsed;
}

function requiredFrontmatterValue(markdown: string, key: string): string {
  const value = frontmatterValue(markdown, key);
  if (value === undefined) throw new Error(`Missing ${key}.`);
  return value;
}

function frontmatterValue(markdown: string, key: string): string | undefined {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escapedKey}:\\s*(.+)$`, "mu").exec(
    normalized.slice(4, end),
  )?.[1];
}
