import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceExerciseTypes,
  enabledExerciseTypes,
  exerciseTypeDistributionProblem,
  exerciseTypePercentageTotal,
  normalizeExerciseTypePercentages,
  planExerciseDistribution,
  rebalanceExerciseTypePercentage,
  rebalanceExerciseTypePercentageWithIntent,
  RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  toggleExerciseType,
} from "../src/exercise-distribution";

test("recommended exercise percentages form a valid constructed-response-heavy mix", () => {
  assert.equal(
    exerciseTypePercentageTotal(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES),
    100,
  );
  assert.equal(
    exerciseTypeDistributionProblem(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES),
    null,
  );
  const plan = planExerciseDistribution(
    RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
    10,
  );
  assert.equal(
    plan.reduce((total, target) => total + target.count, 0),
    10,
  );
  assert.equal(
    plan
      .filter((target) => [
        "short-answer",
        "causal-explanation",
        "application",
        "calculation",
      ].includes(target.type))
      .reduce((total, target) => total + target.count, 0),
    6,
  );
});

test("largest-remainder planning turns percentages into exact deterministic counts", () => {
  const percentages = {
    ...balanceExerciseTypes([]),
    "short-answer": 33,
    "causal-explanation": 33,
    application: 34,
  };
  assert.deepEqual(planExerciseDistribution(percentages, 10), [
    { type: "short-answer", percentage: 33, count: 3 },
    { type: "causal-explanation", percentage: 33, count: 3 },
    { type: "application", percentage: 34, count: 4 },
  ]);
});

test("balancing selected types preserves a 100 percent integer total", () => {
  const balanced = balanceExerciseTypes([
    "short-answer",
    "calculation",
    "ordering",
  ]);
  assert.deepEqual(
    enabledExerciseTypes(balanced),
    ["short-answer", "calculation", "ordering"],
  );
  assert.equal(balanced["short-answer"], 34);
  assert.equal(balanced.calculation, 33);
  assert.equal(balanced.ordering, 33);
  assert.equal(exerciseTypePercentageTotal(balanced), 100);
});

test("an intentionally deselected mix remains empty and explains how to continue", () => {
  const deselected = balanceExerciseTypes([]);
  assert.deepEqual(enabledExerciseTypes(deselected), []);
  assert.equal(exerciseTypePercentageTotal(deselected), 0);
  assert.equal(
    exerciseTypeDistributionProblem(deselected),
    "Select at least one exercise type.",
  );

  const reselected = toggleExerciseType(deselected, "calculation", true);
  assert.deepEqual(enabledExerciseTypes(reselected), ["calculation"]);
  assert.equal(reselected.calculation, 100);
  assert.equal(exerciseTypeDistributionProblem(reselected), null);
});

test("invalid saved percentages fail closed to the recommended mix", () => {
  const invalid = {
    ...RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
    calculation: 9,
  };
  assert.match(
    exerciseTypeDistributionProblem(invalid) ?? "",
    /total 99%/u,
  );
  assert.deepEqual(
    normalizeExerciseTypePercentages(invalid),
    RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  );
});

test("type toggles preserve the existing proportions while keeping a 100 percent total", () => {
  const enabled = toggleExerciseType(
    RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
    "image-occlusion",
    true,
  );
  assert.equal(enabled["image-occlusion"], 10);
  assert.equal(exerciseTypePercentageTotal(enabled), 100);
  assert.ok(enabled["short-answer"] > enabled.application);

  const disabled = toggleExerciseType(enabled, "image-occlusion", false);
  assert.equal(disabled["image-occlusion"], 0);
  assert.equal(exerciseTypePercentageTotal(disabled), 100);
  assert.ok(disabled["short-answer"] > disabled.application);
});

test("editing one percentage keeps it exact and rebalances the other selected types", () => {
  const adjusted = rebalanceExerciseTypePercentage(
    RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
    "calculation",
    25,
  );
  assert.equal(adjusted.calculation, 25);
  assert.equal(exerciseTypePercentageTotal(adjusted), 100);
  assert.ok(adjusted["short-answer"] > adjusted.application);
  assert.equal(adjusted["image-occlusion"], 0);
});

test("percentage editing cannot leave the mix empty or below 100 percent", () => {
  const oneType = balanceExerciseTypes(["short-answer"]);
  assert.deepEqual(
    rebalanceExerciseTypePercentage(oneType, "short-answer", 20),
    oneType,
  );
  const disabled = rebalanceExerciseTypePercentage(
    balanceExerciseTypes(["short-answer", "calculation"]),
    "calculation",
    0,
  );
  assert.equal(disabled.calculation, 0);
  assert.equal(disabled["short-answer"], 100);
  assert.equal(exerciseTypePercentageTotal(disabled), 100);
});

test("slider intent automatically restores types rounded to zero when sliding back", () => {
  const initial = balanceExerciseTypes([
    "short-answer",
    "causal-explanation",
    "application",
    "calculation",
  ]);
  const intended = new Set([
    "short-answer",
    "causal-explanation",
    "application",
    "calculation",
  ] as const);
  const nearlyAllShortAnswer = rebalanceExerciseTypePercentageWithIntent(
    initial,
    "short-answer",
    99,
    intended,
    initial,
  );
  assert.equal(nearlyAllShortAnswer["short-answer"], 99);
  assert.ok(
    [
      nearlyAllShortAnswer["causal-explanation"],
      nearlyAllShortAnswer.application,
      nearlyAllShortAnswer.calculation,
    ].filter((value) => value === 0).length >= 2,
  );

  const slidBack = rebalanceExerciseTypePercentageWithIntent(
    nearlyAllShortAnswer,
    "short-answer",
    40,
    intended,
    initial,
  );
  assert.equal(slidBack["short-answer"], 40);
  assert.ok(slidBack["causal-explanation"] > 0);
  assert.ok(slidBack.application > 0);
  assert.ok(slidBack.calculation > 0);
  assert.equal(exerciseTypePercentageTotal(slidBack), 100);
});
