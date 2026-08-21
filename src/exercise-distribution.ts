import {
  EXERCISE_TYPES,
  type ExerciseType,
  type ExerciseTypePercentages,
  type PlannedExerciseType,
} from "./ui/contracts";

export const RECOMMENDED_EXERCISE_TYPE_PERCENTAGES = {
  "short-answer": 20,
  "causal-explanation": 20,
  application: 10,
  calculation: 10,
  cloze: 10,
  "single-select": 5,
  "multi-select": 5,
  matching: 10,
  ordering: 10,
  "image-occlusion": 0,
} as const satisfies ExerciseTypePercentages;

const ROUNDING_PRIORITY: readonly ExerciseType[] = [
  "matching",
  "ordering",
  "image-occlusion",
  "short-answer",
  "causal-explanation",
  "application",
  "calculation",
  "cloze",
  "single-select",
  "multi-select",
];
const ROUNDING_PRIORITY_INDEX = new Map(
  ROUNDING_PRIORITY.map((type, index) => [type, index]),
);

function emptyPercentages(): Record<ExerciseType, number> {
  return Object.fromEntries(
    EXERCISE_TYPES.map((type) => [type, 0]),
  ) as Record<ExerciseType, number>;
}

function allocateWeightedTotal(
  types: readonly ExerciseType[],
  weights: ExerciseTypePercentages,
  total: number,
): Record<ExerciseType, number> {
  const result = emptyPercentages();
  if (types.length === 0 || total === 0) return result;
  const weightTotal = types.reduce(
    (sum, type) => sum + Math.max(0, weights[type]),
    0,
  );
  const targets = types.map((type) => {
    const exact = weightTotal === 0
      ? total / types.length
      : Math.max(0, weights[type]) * total / weightTotal;
    return {
      type,
      value: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = total - targets.reduce(
    (sum, target) => sum + target.value,
    0,
  );
  const ranked = [...targets].sort((left, right) => (
    right.remainder - left.remainder
    || (ROUNDING_PRIORITY_INDEX.get(left.type) ?? Number.MAX_SAFE_INTEGER)
      - (ROUNDING_PRIORITY_INDEX.get(right.type) ?? Number.MAX_SAFE_INTEGER)
  ));
  for (const target of ranked) {
    if (remaining === 0) break;
    target.value += 1;
    remaining -= 1;
  }
  for (const target of targets) result[target.type] = target.value;
  return result;
}

export function copyExerciseTypePercentages(
  value: ExerciseTypePercentages,
): Record<ExerciseType, number> {
  return Object.fromEntries(
    EXERCISE_TYPES.map((type) => [type, value[type]]),
  ) as Record<ExerciseType, number>;
}

export function exerciseTypePercentageTotal(
  value: ExerciseTypePercentages,
): number {
  return EXERCISE_TYPES.reduce((total, type) => total + value[type], 0);
}

export function enabledExerciseTypes(
  value: ExerciseTypePercentages,
): ExerciseType[] {
  return EXERCISE_TYPES.filter((type) => value[type] > 0);
}

export function exerciseTypeDistributionProblem(
  value: ExerciseTypePercentages,
): string | null {
  for (const type of EXERCISE_TYPES) {
    const percentage = value[type];
    if (
      !Number.isInteger(percentage)
      || percentage < 0
      || percentage > 100
    ) {
      return `${type} must use a whole percentage from 0 to 100.`;
    }
  }
  const total = exerciseTypePercentageTotal(value);
  if (total !== 100) {
    return `Exercise percentages currently total ${total}%. Adjust them to 100% or use a preset.`;
  }
  if (enabledExerciseTypes(value).length === 0) {
    return "Assign a positive percentage to at least one exercise type.";
  }
  return null;
}

export function balanceExerciseTypes(
  selected: Iterable<ExerciseType>,
): Record<ExerciseType, number> {
  const selectedSet = new Set(selected);
  const ordered = EXERCISE_TYPES.filter((type) => selectedSet.has(type));
  const result = emptyPercentages();
  if (ordered.length === 0) return result;
  const base = Math.floor(100 / ordered.length);
  let remainder = 100 - base * ordered.length;
  for (const type of ordered) {
    result[type] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return result;
}

export function toggleExerciseType(
  percentages: ExerciseTypePercentages,
  type: ExerciseType,
  enabled: boolean,
): Record<ExerciseType, number> {
  const selected = enabledExerciseTypes(percentages);
  if (enabled) {
    if (selected.includes(type)) return copyExerciseTypePercentages(percentages);
    if (selected.length === 0) {
      return { ...emptyPercentages(), [type]: 100 };
    }
    const newShare = Math.max(1, Math.round(100 / (selected.length + 1)));
    const result = allocateWeightedTotal(
      selected,
      percentages,
      100 - newShare,
    );
    result[type] = newShare;
    return result;
  }
  const remaining = selected.filter((selectedType) => selectedType !== type);
  return allocateWeightedTotal(remaining, percentages, 100);
}

export function rebalanceExerciseTypePercentage(
  percentages: ExerciseTypePercentages,
  type: ExerciseType,
  requestedPercentage: number,
): Record<ExerciseType, number> {
  if (!Number.isFinite(requestedPercentage)) {
    return copyExerciseTypePercentages(percentages);
  }
  const requested = Math.min(
    100,
    Math.max(0, Math.round(requestedPercentage)),
  );
  const selected = enabledExerciseTypes(percentages);
  const others = selected.filter((selectedType) => selectedType !== type);
  if (requested === 0) {
    return others.length === 0
      ? { ...emptyPercentages(), [type]: 100 }
      : allocateWeightedTotal(others, percentages, 100);
  }
  if (others.length === 0) {
    const result = emptyPercentages();
    result[type] = 100;
    return result;
  }
  const result = allocateWeightedTotal(
    others,
    percentages,
    100 - requested,
  );
  result[type] = requested;
  return result;
}

/**
 * Rebalances a continuously dragged slider without forgetting types that were
 * rounded down to 0% earlier in the same drag sequence. Once enough share is
 * available again, those intended types automatically return.
 */
export function rebalanceExerciseTypePercentageWithIntent(
  percentages: ExerciseTypePercentages,
  type: ExerciseType,
  requestedPercentage: number,
  intendedTypes: ReadonlySet<ExerciseType>,
  rememberedPercentages: ExerciseTypePercentages,
): Record<ExerciseType, number> {
  if (!Number.isFinite(requestedPercentage)) {
    return copyExerciseTypePercentages(percentages);
  }
  const requested = Math.min(
    100,
    Math.max(0, Math.round(requestedPercentage)),
  );
  const intended = EXERCISE_TYPES.filter((candidate) => (
    intendedTypes.has(candidate) || (candidate === type && requested > 0)
  ));
  const others = intended.filter((candidate) => candidate !== type);
  if (requested === 0) {
    return allocateWeightedTotal(
      others,
      positiveIntentWeights(percentages, rememberedPercentages, others),
      100,
    );
  }
  if (others.length === 0) {
    return { ...emptyPercentages(), [type]: 100 };
  }
  const result = allocateWeightedTotal(
    others,
    positiveIntentWeights(percentages, rememberedPercentages, others),
    100 - requested,
  );
  result[type] = requested;
  return result;
}

function positiveIntentWeights(
  current: ExerciseTypePercentages,
  remembered: ExerciseTypePercentages,
  types: readonly ExerciseType[],
): Record<ExerciseType, number> {
  const weights = emptyPercentages();
  for (const type of types) {
    const currentWeight = current[type];
    const rememberedWeight = remembered[type];
    weights[type] = currentWeight > 0
      ? currentWeight
      : rememberedWeight > 0 ? rememberedWeight : 1;
  }
  return weights;
}

export function normalizeExerciseTypePercentages(
  value: unknown,
): Record<ExerciseType, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES);
  }
  const candidate = emptyPercentages();
  const record = value as Readonly<Record<string, unknown>>;
  for (const type of EXERCISE_TYPES) {
    const percentage = record[type];
    if (typeof percentage !== "number") {
      return copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES);
    }
    candidate[type] = percentage;
  }
  return exerciseTypeDistributionProblem(candidate) === null
    ? candidate
    : copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES);
}

export function planExerciseDistribution(
  percentages: ExerciseTypePercentages,
  quantity: number,
): PlannedExerciseType[] {
  const problem = exerciseTypeDistributionProblem(percentages);
  if (problem !== null) throw new Error(problem);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 30) {
    throw new Error("Exercise quantity must be a whole number from 1 to 30.");
  }

  const targets = enabledExerciseTypes(percentages).map((type) => {
    const exactCount = percentages[type] * quantity / 100;
    return {
      type,
      percentage: percentages[type],
      count: Math.floor(exactCount),
      remainder: exactCount - Math.floor(exactCount),
    };
  });
  let remaining = quantity - targets.reduce(
    (total, target) => total + target.count,
    0,
  );
  const ranked = [...targets].sort((left, right) => (
    right.remainder - left.remainder
    || (ROUNDING_PRIORITY_INDEX.get(left.type) ?? Number.MAX_SAFE_INTEGER)
      - (ROUNDING_PRIORITY_INDEX.get(right.type) ?? Number.MAX_SAFE_INTEGER)
  ));
  for (const target of ranked) {
    if (remaining === 0) break;
    target.count += 1;
    remaining -= 1;
  }
  return targets.map(({ type, percentage, count }) => ({
    type,
    percentage,
    count,
  }));
}

export function plannedExerciseCount(
  plan: readonly PlannedExerciseType[],
  type: ExerciseType,
): number {
  return plan.find((target) => target.type === type)?.count ?? 0;
}
